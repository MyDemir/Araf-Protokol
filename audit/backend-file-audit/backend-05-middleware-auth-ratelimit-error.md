# Backend File Audit — middleware/auth + middleware/rateLimiter + middleware/errorHandler (05)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/middleware/auth.js
- backend/scripts/middleware/rateLimiter.js
- backend/scripts/middleware/errorHandler.js

İlişkili dosyalar:
- backend/scripts/routes/auth.js
- backend/scripts/services/siwe.js
- backend/scripts/config/redis.js
- backend/scripts/utils/logger.js

İlişkili testler:
- backend/test/auth.cookiePolicy.test.js
- backend/test/auth.refreshNonceHardening.test.js
- backend/test/auth.sessionWalletMismatch.test.js
- backend/test/sessionWalletGuard.routes.test.js
- backend/test/rateLimiter.aliasCleanup.test.js
- backend/test/rateLimiter.tierOverlay.test.js
- backend/test/rateLimiter.writeFallback.test.js
- backend/test/scrubbers.test.js

## 2. Method
- Üç middleware dosyası satır bazlı, baştan sona incelendi.
- Auth middleware davranışı `routes/auth.js` ve `services/siwe.js` ile birlikte değerlendirildi.
- Rate limiter Redis readiness/fallback davranışı `config/redis.js` ile eşleştirildi.
- Error scrub davranışı `utils/logger.js` ve scrub testleri ile karşılaştırıldı.
- Test dosyaları gerçek runtime davranışı yakalama düzeyi açısından tek tek incelendi.

## 3. Function / Section Notes
- **requireAuth** yalnız cookie (`araf_jwt`) kabul ediyor; bearer fallback normal auth için yok.
- **requireSessionWalletMatch** mismatch’te blacklist + refresh revoke + cookie clear yapıyor; aktif invalidation uygulanıyor.
- **JWT blacklist fail mode** `siwe.isJWTBlacklisted` içinde Redis hata durumunda production default `closed`.
- **requirePIIToken** trade-scoped bearer token’ı session wallet ile çapraz doğruluyor.
- **rateLimiter** Redis ready değilse hassas yüzeyler in-memory fallback’e düşüyor; global fail-open yerine kontrollü degrade var.
- **makeInMemoryLimiter** bucket cleanup interval’i `unref` ile process kapanışını bloke etmiyor.
- **errorHandler** body scrub yapıyor, production’da stack response’a gitmiyor; log tarafında stack dev modda kaydediliyor.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B05-F01 | HIGH | access-control | backend/scripts/routes/auth.js (`/api/auth/refresh`) | Refresh endpoint chain’inde `requireSessionWalletMatch` yok; bu endpoint yalnız refresh token authority’sine dayanıyor. Bu tasarım bilinçli olabilir ancak session-bound guard uygulanmıyor. (uncertain) | Çalınmış refresh token senaryosunda header-wallet bağlamı olmadan token rotasyonu denenebilir (rotateRefreshToken kontrollerine bağımlı). | Route `router.post("/refresh", authLimiter, async ...)`; session-wallet middleware yok. | Threat modelde refresh token tek başına yeterli authority ise dokümante edilmeli; değilse opsiyonel session binding değerlendirilmeli. |
| B05-F02 | MEDIUM | auth-session | backend/scripts/middleware/auth.js::_getTokenPayload + siwe.isJWTBlacklisted | `payload.jti` yoksa blacklist kontrolü atlanıyor. Mevcut issuer jti üretiyor ama dış kaynaklı/legacy token’da jti yoksa blacklist mekanizması bypass olur. | Token family invalidate stratejisinde kör nokta oluşabilir. | Kod `if (payload.jti) { ... blacklist check ... }`. | `auth` tokenlarında jti zorunluluğu enforce edilmeli; jti yoksa reject düşünülmeli. |
| B05-F03 | MEDIUM | performance | backend/scripts/middleware/rateLimiter.js::makeInMemoryLimiter | In-memory fallback multi-pod ortamda node-local sayaç kullanıyor; dağıtık limit global olarak tutarlı değil. | Bot trafiği pod dağılımı ile limitleri aşabilir (per-instance bypass). | Fallback bucket process-local `Map`; Redis down’da her pod kendi limiti uygular. | Redis outage stratejisi için cluster-aware fallback (örn. shared emergency store) veya auth yüzeyinde daha düşük local limit + WAF kuralı önerilir. |
| B05-F04 | LOW | performance | backend/scripts/middleware/rateLimiter.js::makeInMemoryLimiter | Bucket temizliği yalnız interval ile yapılıyor; yüksek cardinality anahtarlarda intervaller arası bellek büyümesi olabilir. (uncertain) | Uzun Redis kesintilerinde memory pressure artabilir. | `bucket` Map + periodic cleanup; insert anında soft cap/eviction yok. | Güvenli upper-bound/eviction policy eklenmesi değerlendirilebilir. |
| B05-F05 | MEDIUM | PII-data-protection | backend/scripts/middleware/errorHandler.js + utils/logger.js | errorHandler body scrub yapsa da logger utility meta alanını ham stringify ediyor; başka katmanlardan gelen hassas meta redact edilmeyebilir. | Secret/JWT/PII log sızıntısı katmanlar arası tutarsızlıkla tekrar oluşabilir. | errorHandler scrub var; logger.js global redaction yok (ham meta stringify). | Logger seviyesinde merkezi redaction ile middleware-level scrub tamamlanmalı. |
| B05-F06 | LOW | testing-gap | backend/test/sessionWalletGuard.routes.test.js | Test route düzeyinde auth middleware’i mock’layarak doğruluyor; gerçek `requireSessionWalletMatch` side-effect’leri (blacklist/revoke/cookie clear) runtime zincirde testlenmiyor. | Entegrasyon drift’i yakalanmayabilir. | Testte middleware tamamen jest.mock ile stub. | Supertest + gerçek middleware + mocked siwe servis kombinasyonu ile integration senaryosu eklenmeli. |
| B05-F07 | LOW | testing-gap | backend/test/rateLimiter.writeFallback.test.js ve aliasCleanup | Bazı rate-limit testleri source-string doğrulaması yapıyor; gerçek runtime limit artışı/azalışı ve cleanup davranışı ölçülmüyor. | Refactor sonrası yanlış güven hissi / sahte pozitif. | `fs.readFileSync` ile contains assertions. | Runtime davranış testlerinin oranı artırılmalı (özellikle Redis-down + fallback counter). |
| B05-F08 | INFO | security | backend/scripts/middleware/auth.js + services/siwe.js | JWT blacklist Redis arızasında production default fail-closed (`closed`) davranışı güvenlik lehine. | Pozitif güvenlik notu: blacklist kontrolü fail-open’a düşmüyor (prod default). | `JWT_BLACKLIST_FAIL_MODE` yoksa production’da `closed`. | Bu davranış korunmalı; operasyonel alarm eklenebilir. |

## 5. No-Finding Notes
- `requireAuth` cookie-only doğrulama ile header authority karışmasını engelliyor.
- `requireSessionWalletMatch` mismatch anında aktif token invalidation yapıyor.
- `requirePIIToken` session wallet + tradeId + token type birlikte kontrol ediyor.
- Rate limiter tier çözümü cache/mirror arızasında güvenli tier0 fallback’e iniyor.
- errorHandler fallback response tüm beklenmeyen hatalarda yanıt üretip request hang riskini azaltıyor.

## 6. Cross-File Risks
- **Auth authority ayrımı**: refresh akışı session-wallet guard’dan bağımsız; bu kararın threat model dokümantasyonu kritik.
- **Redis outage ve abuse**: in-memory fallback availability sağlar ama distributed bypass riskini tamamen çözmez.
- **Scrub policy katman farkı**: errorHandler scrub iyi, fakat logger global redaction eksikliği kalan risk üretiyor.
- **Test realism gap**: birkaç kritik test source-string veya middleware mock odaklı; production fail-mode entegrasyonu sınırlı.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/routes/orders.js (hassas user-scoped route’larda guard zinciri)
- backend/scripts/routes/trades.js (room/coordination limiter ve auth sırası)
- backend/scripts/routes/pii.js (requireAuth + requirePIIToken doğru sıralama)
- backend/scripts/services/siwe.js (refresh family + reuse detection kapsamı)
- backend/scripts/services/health.js (Redis degrade durumunda auth/worker readiness sinyali)
