# Backend File Audit — auth route + siwe session surface (06)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/routes/auth.js
- backend/scripts/services/siwe.js

İlişkili dosyalar:
- backend/scripts/middleware/auth.js
- backend/scripts/config/redis.js
- backend/scripts/models/User.js
- frontend/src/App.jsx
- frontend/src/app/useAppSessionData.jsx

İlişkili testler:
- backend/test/auth.cookiePolicy.test.js
- backend/test/auth.profileRailsValidation.test.js
- backend/test/auth.refreshNonceHardening.test.js
- backend/test/auth.sessionWalletMismatch.test.js
- backend/test/sessionWalletGuard.routes.test.js

## 2. Method
- `auth.js` ve `siwe.js` dosyaları baştan sona, route/servis akışı adım adım okundu.
- Nonce üretim/tüketim, JWT/refresh lifecycle ve cookie policy alanları satır bazında izlendi.
- Session-wallet guard davranışı middleware ve frontend authenticated fetch akışı ile çapraz doğrulandı.
- Profil rail doğrulaması User modeli ve ilgili testlerle birlikte değerlendirildi.

## 3. Function / Section Notes
- **Nonce lifecycle**: `generateNonce` existing nonce reuse + `SET NX` race sonrası re-read yapıyor; `verifySiweSignature` `getDel` ile one-time tüketim yapıyor.
- **SIWE config**: production’da domain/uri zorunlu, localhost ve non-https engelli, URI host=domain kontrolü var.
- **JWT quality gate**: startup anında secret length/placeholder/entropy kontrolü ile fail-closed.
- **Access/refresh**: JWT 15m default, refresh 7d TTL; rotate sırasında eski refresh token `getDel` ile tek-kullanımlık.
- **Logout**: current JWT blacklist + refresh family revoke + cookie clear kombinasyonu uygulanıyor.
- **Wallet separation**: backend session wallet (`req.wallet`) ile connected wallet (`x-wallet-address`) mismatch kontrolü route/middleware tarafında korunuyor.
- **Profile rails validation**: Joi + custom validator ile rail-country/contact/details kontrolleri güçlü; payload normalize edilerek işleniyor.
- **Frontend uyumu**: `authenticatedFetch` 401’de refresh, 409’da logout/clear session akışını backend contract ile uyumlu yürütüyor.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B06-F01 | MEDIUM | auth-session | backend/scripts/routes/auth.js (`POST /refresh`) | Refresh route yalnız `authLimiter` ile korunuyor; `requireSessionWalletMatch` zincirde yok. Tasarım token-authority odaklı olsa da connected-wallet bağlamı burada zorlanmıyor. (uncertain) | Çalınmış refresh token senaryosunda wallet-header uyuşmazlığı bu endpointte tek başına bloklayıcı değil. | Route imzası: `router.post("/refresh", authLimiter, async ...)`. | Threat modelde refresh-token tek başına authority olduğu açıkça dokümante edilmeli; gerekirse opsiyonel header-wallet doğrulaması eklenmeli. |
| B06-F02 | LOW | security | backend/scripts/services/siwe.js (JWT secret log) | Secret’ın kendisi loglanmıyor ancak entropy/uzunluk bilgisi info logunda yazılıyor. | Düşük riskli metadata ifşası; saldırı yüzeyi sınırlı ama gereksiz bilgi olabilir. | `logger.info("JWT_SECRET doğrulandı: <len>, entropy: <x>")`. | Production’da bu log debug seviyesine alınabilir veya kaldırılabilir. |
| B06-F03 | MEDIUM | auth-session | backend/scripts/middleware/auth.js::_getTokenPayload | `payload.jti` yoksa blacklist check atlanıyor; issuer jti üretse de jti-siz tokenlar için explicit reject yok. | Legacy/harici token kabulünde blacklist etkisiz kalabilir. | `if (payload.jti) { ... }` guard. | `auth` token için jti zorunlu kılınması değerlendirilmeli. |
| B06-F04 | LOW | testing-gap | backend/test/sessionWalletGuard.routes.test.js | Session guard route testi gerçek middleware değil mock middleware kullanıyor; revoke/blacklist/cookie-clear side-effect zinciri entegrasyon düzeyinde doğrulanmıyor. | Entegrasyon regresyonları testten kaçabilir. | Testte `jest.mock("../scripts/middleware/auth", ...)` ile stub. | Gerçek middleware + mocked siwe ile integration test eklenmeli. |
| B06-F05 | LOW | testing-gap | backend/test/auth.refreshNonceHardening.test.js | Nonce hardening testleri route-chain ve refresh authority odaklı; `generateNonce`/`consumeNonce` race + expiry davranışı doğrudan servis testleriyle kapsanmıyor. | Redis yarış/TTL kenar durumlarında davranış drift’i geç yakalanabilir. | Test dosyasında service-level nonce yarış senaryosu yok. | `siwe.generateNonce/verifySiweSignature` için concurrency + expiry odaklı unit testler eklenmeli. |
| B06-F06 | INFO | auth-session | backend/scripts/services/siwe.js + redis.js | Nonce yarış çözümü (`SET NX` + re-read) ve one-time consume (`getDel`) doğru güvenlik desenine yakın. | Pozitif not: replay yüzeyi belirgin biçimde daraltılmış. | `generateNonce` ve `consumeNonce` akışları. | Mevcut desen korunmalı; sadece servis-level yarış testleriyle güçlendirilmeli. |

## 5. No-Finding Notes
- SIWE domain/URI production fail-closed kontrolleri güçlü ve açık.
- Access token ve refresh token süresi/rotasyonu tutarlı bir kontrat izliyor.
- Refresh family revoke (`revokeRefreshToken`) scan + family member delete ile toplu iptal sağlıyor.
- Logout endpointi hem JWT blacklist hem refresh revoke uyguluyor.
- Profile rail doğrulaması ve normalization, PII alanlarında format disiplinini artırıyor.
- Frontend `authenticatedFetch` akışı backend 401/409 semantiğiyle uyumlu.

## 6. Cross-File Risks
- **Redis bağımlılığı**: nonce, blacklist ve refresh family mekanizmaları Redis’e bağlı; Redis fail-mode politika/izleme kritik.
- **Session-bound vs token-bound authority**: refresh akışı token-authority öncelikli, connected-wallet authority ikincil; bu ayrımın operasyonel dokümantasyonu önemli.
- **Test realism gap**: auth guard testlerinin bir kısmı mock-odaklı olduğu için gerçek middleware side-effect’leri sınırlı doğrulanıyor.
- **Frontend-backend coupling**: frontend 409’u kesin session-kapanış sinyali kabul ediyor; backend mismatch semantiğinin korunması kritik.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/routes/orders.js (user-scoped route’larda guard chain doğrulaması)
- backend/scripts/routes/trades.js (session-wallet guard + pii token chain)
- backend/scripts/services/encryption.js (profile payload şifreleme/deşifreleme hata modları)
- backend/test/* (siwe service concurrency + refresh revoke integration test genişletmesi)
