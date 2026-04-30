# Backend File Audit — backend/scripts/app.js bootstrap + express lifecycle (02)

## 1. Scope
İncelenen ana dosya:
- backend/scripts/app.js

Cross-check edilen ilişkili dosyalar:
- backend/scripts/config/db.js
- backend/scripts/config/redis.js
- backend/scripts/middleware/auth.js
- backend/scripts/middleware/rateLimiter.js
- backend/scripts/middleware/errorHandler.js
- backend/scripts/services/health.js
- backend/scripts/services/eventListener.js
- backend/test/app.corsFailClosed.test.js
- backend/test/health.readinessCorsConfig.test.js
- backend/test/route.mounts.test.js
- backend/test/stats.logs.rateLimiter.route.test.js

## 2. Method
- app.js dosyası baştan sona satır bazlı okundu; middleware sırası, bootstrap/shutdown akışı ve route mount düzeni fonksiyon bazında çıkarıldı.
- CORS, helmet, cookie parser, JSON body limit, mongo sanitize sıralaması middleware zinciri içinde kontrol edildi.
- readiness/liveness davranışı `services/health.js` ile birebir karşılaştırıldı.
- startup/shutdown güvenliği `db.js`, `redis.js`, `eventListener.js` ile lifecycle uyumu açısından doğrulandı.
- test dosyaları tek tek okunarak gerçek middleware/route sırası davranışını ne ölçüde yakaladığı değerlendirildi.

## 3. Function / Section Notes
- `app.set("trust proxy", 1)` reverse proxy arkasında IP tabanlı limiter için doğru bir önkoşul oluşturuyor; rateLimiter `req.ip` bağımlılığı ile uyumlu.
- Middleware sırası: helmet → cors → json(50kb) → cookieParser → mongoSanitize; güvenlik açısından genel olarak doğru dizilim.
- Production CORS fail-closed: boş `ALLOWED_ORIGINS`, wildcard, localhost fallback ve invalid origin formatları startup’ta `process.exit(1)` ile engelleniyor.
- `/health` ve `/ready` ayrımı uygulanmış; `/health` liveness, `/ready` dependency/worker/config readiness odaklı.
- Route mount sırası `/api/logs` dahil olmak üzere 404 ve global error handler’dan önce doğru yerleştirilmiş.
- Shutdown akışında timer temizliği + worker.stop + mongoose close + redis close zinciri var; fatal event’lerde de aynı shutdown orkestrasyonu çağrılıyor.
- `uncaughtException` / `unhandledRejection` için fail-fast exit semantiği mevcut.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B02-F01 | MEDIUM | deployment-env | backend/scripts/app.js + backend/scripts/services/health.js | Fly benzeri orkestrasyonlarda genellikle `/health` probe kullanılırken, app tarafında `/ready` daha güçlü kontrol sağlıyor; probe eşleşmezse hazır olmayan instance trafik alabilir. | Worker replay/redis/provider geçici hazır değilken canlı görünen instance’a trafik düşebilir. | app.js `/health` sadece liveness döndürüyor; `/ready` detaylı readiness veriyor. | Deploy platform probe’larının `/ready` ile hizalanması önerilir. |
| B02-F02 | MEDIUM | security | backend/scripts/app.js (cors config) | CORS’ta `credentials: true` kullanılırken `allowedOrigins` sadece env string parse ile belirleniyor; runtime’da origin callback ile ek doğrulama yapılmıyor. (uncertain) | Config hatasında beklenmeyen origin davranışı oluşabilir; current fail-closed startup kontrolü riski azaltıyor. | Static allow-list array kullanılıyor; production validation startup anında yapılıyor. | İhtiyaç varsa origin callback tabanlı daha sıkı doğrulama düşünülmeli; mevcut model büyük ölçüde yeterli. |
| B02-F03 | LOW | performance | backend/scripts/app.js (`express.json({ limit: "50kb" })`) | Global JSON limit 50kb tüm route’lara uygulanıyor; log/telemetry benzeri uçlarda aşırı payload koruması iyi, ancak bazı meşru payloadlar kesilebilir. | Güvenlik açısından olumlu; işlevsel olarak 413 geri dönüşleri artabilir. | Global parser tüm route’lardan önce tanımlı. | Route-bazlı override gerekiyorsa sadece ihtiyaç olan endpoint’lerde artırılmalı. |
| B02-F04 | LOW | testing-gap | backend/test/route.mounts.test.js | Route mount testi source-string içerik kontrolü yapıyor; gerçek middleware yürütüm sırası veya auth bypass davranışını runtime’da test etmiyor. | Refactor veya dinamik mount değişimlerinde sahte pozitif/negatif riski. | Test `fs.readFileSync` ile satır içerik eşleşmesi yapıyor. | Supertest ile gerçek app instance üzerinde middleware/404/error-order davranışı e2e doğrulanmalı. |
| B02-F05 | LOW | testing-gap | backend/test/app.corsFailClosed.test.js | CORS fail-closed testi `process.exit` interception ile boot-fail kontrol ediyor; fakat başarılı boot senaryosunda CORS header davranışını request düzeyinde doğrulamıyor. | Guard varlığını yakalar, fakat gerçek response policy drift’i kaçabilir. | Testler ağırlıklı exit davranışı ve source-string kontrolü yapıyor. | Positive/negative origin request testleri (preflight + credential) eklenmeli. |

## 5. No-Finding Notes
- Middleware sırası güvenlik beklentileriyle uyumlu; `globalErrorHandler` tüm route’lardan sonra mount edilmiş.
- Production CORS fail-closed mantığı startup’ta güçlü ve açık.
- `trust proxy = 1` ayarı rateLimiter’in IP anahtarlaması ile uyumlu.
- Shutdown akışı graceful + fatal modlar için ayrımsız merkezi bir orkestratörde toplanmış.
- Mongo disconnected fail-fast (`db.js`) ve app shutdown suppression (`setAllowProcessExitOnDisconnect(false)`) birlikte kullanılarak çift-exit karmaşası azaltılmış.
- Health readiness üretim konfigürasyon driftlerini (`ALLOWED_ORIGINS`, `SIWE_URI`, chain id vb.) görünür yapıyor.

## 6. Cross-File Risks
- **Probe drift riski**: app.js `/ready` güçlü olmasına rağmen deploy katmanı `/health`e bağlı kalırsa operational drift oluşur.
- **Auth surface vs limiter**: `auth.js` session-wallet mismatch’te cookie temizleme + revoke yapıyor; `rateLimiter` auth yüzeyi için Redis-down fallback in-memory koruma sağlıyor. Bu kombinasyon olumlu.
- **PII/log sızıntısı**: `errorHandler` scrubBody ile azaltılmış; ancak route seviyesinde ham log yazımları varsa ayrıca doğrulanmalı (bu scope dışında).
- **Worker lifecycle**: startup’ta worker start başarısızsa app crash; tasarım fail-fast ama availability trade-off içerir (bilinçli tercih gibi görünüyor).

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/routes/auth.js (auth + nonce + refresh route/middleware sırası)
- backend/scripts/routes/pii.js (requireAuth + requirePIIToken sırası ve scope)
- backend/scripts/routes/trades.js (room/receipt/coordination limiter entegrasyonu)
- backend/scripts/routes/admin.js (admin read-only authz + limiter)
- backend/scripts/services/siwe.js (JWT blacklist/refresh family revoke semantiği)
