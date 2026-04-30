# Backend File Audit — config/db + config/redis + config/paymentRailRiskConfig (03)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/config/db.js
- backend/scripts/config/redis.js
- backend/scripts/config/paymentRailRiskConfig.js

İlişkili testler:
- backend/test/db.disconnectPolicy.test.js
- backend/test/redis.connectReadiness.test.js
- backend/test/paymentRailRiskConfig.validation.test.js
- backend/test/health.readinessCorsConfig.test.js

## 2. Method
- Her config dosyası baştan sona satır bazlı okundu.
- db/redis config davranışları app lifecycle ve health/readiness beklentileri ile cross-check edildi.
- payment rail risk config için validation kontratı, fallback çözümleme ve defaultların güvenlik etkisi değerlendirildi.
- İlişkili test dosyaları production fail-mode kapsamı açısından tek tek incelendi.

## 3. Function / Section Notes
- **db.js**: `MONGODB_URI` yoksa throw ile fail-closed; disconnected event’inde default fail-fast `process.exit(1)`.
- **db.js**: Connection logunda URI `@` sonrası kısmı yazılıyor; credential çoğunlukla maskeleniyor ancak query string/cluster metadata görünür kalabilir.
- **redis.js**: `isReady` ile connected/readiness ayrımı doğru modellenmiş; `connectPromise` ile paralel connect yarışları azaltılmış.
- **redis.js**: `REDIS_URL` yoksa localhost fallback var; production’da explicit zorunluluk yok.
- **redis.js**: TLS `rediss://` veya `REDIS_TLS=true` ile açılıyor; `REDIS_TLS_SKIP_VERIFY=true` opsiyonu güvenli olmayan bypass sunuyor.
- **paymentRailRiskConfig.js**: riskLevel ve surcharge bps alanları için temel schema doğrulaması mevcut; unsupported rail’ler reddediliyor.
- **paymentRailRiskConfig.js**: country bucket adı serbest; rail-country uyuşmazlığı explicit doğrulanmıyor (örn. `US.SEPA_IBAN` teknik olarak validate geçebilir).

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B03-F01 | MEDIUM | deployment-env | backend/scripts/config/redis.js::connectRedis | `REDIS_URL` tanımsızsa localhost fallback kullanılıyor; production’da explicit fail-closed zorunluluğu yok. | Yanlış env ile production deploy’da local/yanlış endpoint’e bağlanma veya readiness sapması yaşanabilir. | `const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";` | Production modunda `REDIS_URL` zorunlu kılınmalı veya health/readiness’de blocker seviyesinde işaretlenmeli. |
| B03-F02 | HIGH | security | backend/scripts/config/redis.js (TLS options) | `REDIS_TLS_SKIP_VERIFY=true` ile TLS certificate doğrulaması kapatılabiliyor; ortam bazlı guard yok. | Production’da yanlışlıkla açık kalırsa MITM riski artar; managed Redis bağlantısı güven varsayımı kırılır. | `rejectUnauthorized: process.env.REDIS_TLS_SKIP_VERIFY !== "true"` | Production’da `REDIS_TLS_SKIP_VERIFY=true` hard-fail etmeli veya en az kritik readiness alarmı üretmeli. |
| B03-F03 | MEDIUM | deployment-env | backend/scripts/config/db.js | Mongo URI doğrulaması sadece “var/yok” düzeyinde; format/scheme/production güvenlik parametreleri için ek validation yok. | Hatalı URI ile runtime connect hatası veya güvenlik parametrelerinde zayıf konfigürasyon riski. | `if (!uri) throw ...` dışında URI policy kontrolü bulunmuyor. | URI schema/policy doğrulaması (mongodb+srv tercihleri, opsiyon zorunlulukları) değerlendirilmeli. |
| B03-F04 | LOW | PII-data-protection | backend/scripts/config/db.js | Connection info logu `uri.split("@").pop()` ile credential kısmını atıyor; ancak host/query metadata loglanıyor. (uncertain) | Hassas olmayan ama operasyonel topoloji bilgisi loglarda gereksiz ifşa olabilir. | Logger info mesajında sanitize edilmiş URI kalan kısmı yazılıyor. | Production’da host-level masking veya log seviyesini düşürme değerlendirilebilir. |
| B03-F05 | MEDIUM | data-model | backend/scripts/config/paymentRailRiskConfig.js::validatePaymentRailRiskConfig | Validation rail tipini kontrol ediyor ama country bucket ile rail eşleşmesini zorunlu kılmıyor. | Konfigürasyon hatasıyla yanlış ülke altında yanlış rail policy’si “geçerli” kabul edilebilir; risk/surcharge yanlış uygulanabilir. | `PROFILE_SUPPORTED_RAILS` check var; `countryBucket -> allowed rails` kuralı yok. | Bucket-rail matrix validation eklenmeli (örn. TR→TR_IBAN, US→US_ACH, EU→SEPA_IBAN). |
| B03-F06 | LOW | testing-gap | backend/test/db.disconnectPolicy.test.js | DB testi yalnız export varlığını doğruluyor; disconnect fail-fast, listener attach, env fail-closed senaryoları testlenmiyor. | Kritik production fail-mode davranışları regresyonda kaçabilir. | Tek assertion: `typeof setAllowProcessExitOnDisconnect === 'function'`. | Mongoose mock ile disconnected event ve process.exit davranışını kapsayan testler eklenmeli. |
| B03-F07 | LOW | testing-gap | backend/test/paymentRailRiskConfig.validation.test.js | Validation testi temel senaryoları kapsıyor; rail-country mismatch, bps sınır uçları (10000/10001), description boş string edge-case’leri eksik. | Mainnet config drift’leri CI’da geç yakalanabilir. | Mevcut test 3 case ile sınırlı. | Edge-case matrisi genişletilmeli. |
| B03-F08 | INFO | state-machine | backend/scripts/config/redis.js + health/readiness | Redis readiness ayrımı (isReady vs isOpen) doğru yönde ve testle desteklenmiş. | Pozitif not: open-but-not-ready client’in erken kullanılmasını engeller. | `waitForReady`, `connectPromise`, ve `redis.connectReadiness` testi mevcut. | Mevcut yaklaşım korunmalı; rate-limit/worker entegrasyon testleriyle desteklenebilir. |

## 5. No-Finding Notes
- `db.js` disconnected fail-fast yaklaşımı orchestrator restart modeliyle tutarlı.
- `redis.js` connect yarışlarını `connectPromise` ile tekilleştiriyor; readiness bekleme davranışı doğru.
- `paymentRailRiskConfig` için riskLevel ve bps aralık doğrulaması temel fail-closed güvence sağlıyor.
- `paymentRailRiskConfig.validation.test.js` invalid riskLevel’i doğru şekilde reddediyor.

## 6. Cross-File Risks
- **Redis policy drift**: config katmanında localhost fallback + TLS verify bypass opsiyonu varken production guard merkezi değil.
- **DB/health test coverage gap**: health testleri CORS/config odaklı; Mongo disconnect ve Redis TLS fail-mode senaryolarını kapsamıyor.
- **Payment risk config correctness**: on-chain authority üretmiyor olsa da off-chain UX/risk etiketleri yanlış yapılandırmada operasyonel kararları yanıltabilir.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/services/health.js (REDIS_TLS_SKIP_VERIFY / REDIS_URL policy diagnostics)
- backend/scripts/middleware/rateLimiter.js (Redis down mode’un auth/public surface etkisi)
- backend/scripts/routes/* (payment rail config kullanım noktaları)
- backend/scripts/services/eventListener.js (Redis checkpoint bağımlılığı fail-mode davranışı)
