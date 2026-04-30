# Backend File Audit — backend root/deployment/config (01)

## 1. Scope
İncelenen dosyalar:
- backend/package.json
- backend/.env.example
- backend/Dockerfile
- backend/fly.toml
- backend/.dockerignore

Cross-check edilen ilişkili dosyalar:
- backend/scripts/app.js
- backend/scripts/services/encryption.js
- backend/scripts/config/db.js
- backend/scripts/config/redis.js
- backend/test/health.readinessCorsConfig.test.js
- backend/test/protocolConfig.failclosed.test.js
- backend/test/eventListener.rpcEnvRequired.test.js

## 2. Method
- Her dosya baştan sona doğrudan okundu (search/grep kararıyla bulgu üretilmedi).
- app.js startup fail-closed kontrolleri, env guard’lar ve readiness route’ları deployment dosyaları ile eşleştirildi.
- encryption.js KMS sağlayıcı yolları package runtime dependencies ile karşılaştırıldı.
- db.js / redis.js fail-fast ve varsayılan davranışlar .env.example ve fly.toml ile karşılaştırıldı.
- İlgili test dosyaları mevcut kontrollerin deployment gerçekliği kapsamasını doğrulamak için satır bazında incelendi.

## 3. Function / Section Notes
- **package.json**: Runtime dependency seti temel backend için yeterli görünüyor; ancak encryption.js içinde kullanılan AWS KMS client paketi dependencies’te yok.
- **.env.example**: Güçlü güvenlik notları var (KMS env prod’da yasak, ALLOWED_ORIGINS prod fail-closed vb.). Ancak bazı placeholder varsayılanlar copy/paste hatasıyla riskli olabilir.
- **Dockerfile**: Basit ve çalışır. Root user ile çalışıyor, lockfile-bazlı deterministik install garantisi yok (npm install --production).
- **fly.toml**: Event listener sürekliliği için auto_stop kapalı olması doğru. Sadece /health check kullanımı readiness sinyallerini kapsamayabilir.
- **.dockerignore**: .env hariç tutuluyor. Ancak `.env.*` (genel) pattern’i yok; ör. `.env.production` veya `.env.staging` sızabilir.
- **app.js**: Production’da ALLOWED_ORIGINS ve SIWE_DOMAIN için fail-closed mevcut. MONGODB_URI/JWT/REDIS/RPC kontrolleri doğrudan app.js içinde değil; bir kısmı alt modüllerde fail ediyor.
- **encryption.js**: KMS provider akışları tanımlı; AWS modu `@aws-sdk/client-kms` require ediyor (runtime’da eksikse crash).
- **db.js**: MONGODB_URI zorunlu, disconnected fail-fast (process.exit(1)).
- **redis.js**: REDIS_URL default localhost fallback var; production’da explicit REDIS_URL zorunlu değil.
- **Testler**: CORS readiness ve worker RPC fail-closed testleri mevcut; deployment-level container hardening / dockerignore / dependency mismatch testlenmiyor.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B01-F01 | HIGH | deployment-env | backend/package.json / backend/scripts/services/encryption.js::_getMasterKey(aws) | AWS KMS runtime path’ı `@aws-sdk/client-kms` paketini require ediyor, fakat package.json dependencies içinde yok. | Production’da `KMS_PROVIDER=aws` iken encryption path ilk çağrıda `Cannot find module '@aws-sdk/client-kms'` ile kırılabilir; PII encrypt/decrypt akışı ve ilgili route’lar fail olur. | encryption.js aws branch lazy import kullanıyor; package.json dependencies listesinde paket bulunmuyor. | `@aws-sdk/client-kms` runtime dependency olarak eklenmeli ve CI’de `KMS_PROVIDER=aws` smoke testi çalıştırılmalı. |
| B01-F02 | HIGH | deployment-env | backend/.dockerignore | `.env` ignore edilmiş, ancak `.env.*` genel pattern’i yok; `.env.production`/`.env.staging` benzeri dosyalar image build context’e dahil olabilir. | Secret/artifact sızıntısı riski (imaja kopyalanma ve registry’de kalıcılık). | .dockerignore sadece `.env`, `.env.local`, `.env.*.local` içeriyor; `.env.production` gibi dosyaları kapsamıyor. | `.dockerignore` içine `.env*` veya en az `.env.*` fail-safe pattern’i eklenmeli (gerekirse allowlist yaklaşımı). |
| B01-F03 | MEDIUM | deployment-env | backend/Dockerfile | Container root user ile çalışıyor, non-root user drop yok. | RCE veya dependency compromise durumunda container breakout etki yüzeyi genişler. | Dockerfile’da `USER node` benzeri satır bulunmuyor. | Non-root user ile çalıştırma (`USER node`) ve gerekli dosya izinleri ayarlanmalı. |
| B01-F04 | MEDIUM | deployment-env | backend/Dockerfile | `npm install --production` lockfile deterministic kurulum garantisini zayıflatıyor; `npm ci --omit=dev` tercih edilmemiş. | Build’ler arasında bağımlılık drift’i ve beklenmedik runtime değişimleri. | Dockerfile install adımı `npm install --production`. | Lockfile zorunluluğu ile `npm ci --omit=dev` kullanılmalı. |
| B01-F05 | MEDIUM | deployment-env | backend/fly.toml + backend/scripts/app.js + health checks | Fly health check sadece `/health` endpoint’ini izliyor; `/ready` (DB/Redis/worker/provider readiness) check olarak kullanılmıyor. | Liveness başarılıyken servis işlevsel olarak hazır değilken trafik alabilir (özellikle startup/reconnect pencereleri). | fly.toml check path `/health`; app.js `/ready` 503 dönecek şekilde tasarlanmış. | Fly check path en azından kritik servislerde `/ready` olmalı veya ek readiness check tanımlanmalı. |
| B01-F06 | MEDIUM | auth-session | backend/.env.example + backend/scripts/app.js | `SIWE_DOMAIN=localhost` örnek değeri yer alıyor; production guard var ama deploy pipeline’da yanlış env ile boot-fail riski yüksek. | Yanlış production env ile deploy kesintisi (availability), özellikle IaC kopyalama hatalarında. | app.js production’da `SIWE_DOMAIN` localhost/boş ise exit(1). .env.example default localhost. | Example dosyada prod-safe placeholder (`example.com`) veya açık `REQUIRED_IN_PROD` etiketi kullanılmalı. |
| B01-F07 | LOW | testing-gap | backend/test/* (ilgili dosyalar) | Deployment güvenliği için container/user, dockerignore secret leakage, dependency completeness (KMS aws path) test kapsamı yok. | Regresyonlar review’a bağımlı kalır, CI yakalama gücü düşük olur. | İncelenen testler CORS readiness, protocol cache fail-closed, worker RPC env guard odaklı; deployment artefact testleri yok. | Build-time static checks (Dockerfile lint, dependency path smoke, ignore policy checks) eklenmeli. |
| B01-F08 | LOW | deployment-env | backend/scripts/config/redis.js | REDIS_URL varsayılanı localhost fallback (`redis://127.0.0.1:6379`). Production’da explicit zorunluluk yok. | Misconfigured production deploy’da readiness/başlangıç davranışı çevresel koşullara bağlı; fail-closed netliği azalır. | redis.js `const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";` | Production’da REDIS_URL explicit zorunlu kılınması değerlendirilmeli (policy kararı). |
| B01-F09 | INFO | deployment-env | backend/fly.toml | `primary_region = "ams"` (EU) sabitlenmiş; kullanıcı coğrafyası/latency ve veri-regülasyon gereksinimleri açısından operasyonel karar gerektirir. | Teknik güvenlik açığı değil; performans/compliance etkisi olabilir. | fly.toml region sabit. | Operasyonel gereksinime göre bölge stratejisi netleştirilmeli. |

## 5. No-Finding Notes
- app.js tarafında production CORS fail-closed yaklaşımı (wildcard/boş/localhost fallback engeli) güçlü.
- app.js SIWE_DOMAIN production guard net ve erken fail veriyor.
- db.js disconnected fail-fast stratejisi orchestrator restart modeliyle tutarlı.
- eventListener RPC env required davranışı testlerle korunuyor.
- protocol config fail-closed testinde partial mutation engeli doğru yönde.

## 6. Cross-File Risks
- **KMS runtime drift**: encryption.js AWS branch’i ile package runtime seti arasında mismatch mevcut (deploy anında latent failure).
- **Readiness-liveness ayrımı**: app.js `/ready` detaylı iken fly `/health` kullanıyor; kontrol düzeyleri arasında drift.
- **Secret hygiene drift**: `.dockerignore` kalıbı `.env` türevlerinin tamamını kapsamıyor; repo/pratik kullanımla çakışırsa sızıntı riski oluşur.
- **Env guard coverage heterojenliği**: CORS/SIWE için güçlü fail-closed varken Redis URL için explicit prod zorunluluğu daha gevşek.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/services/health.js (readiness check kapsamı/strictness)
- backend/scripts/middleware/auth.js (JWT/cookie/session fail-closed davranışı)
- backend/scripts/services/siwe.js (domain/nonce/session binding)
- backend/scripts/services/eventListener.js (worker replay/finality/env gating)
- backend/scripts/middleware/rateLimiter.js (redis down fail-open/fail-closed politikası)
