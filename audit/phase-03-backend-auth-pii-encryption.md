# Phase 03 — Backend Auth / Session / PII / Encryption / Rate-Limit

## Scope
İncelenen dosyalar:
- backend/scripts/middleware/auth.js
- backend/scripts/middleware/rateLimiter.js
- backend/scripts/middleware/errorHandler.js
- backend/scripts/routes/auth.js
- backend/scripts/routes/pii.js
- backend/scripts/routes/receipts.js
- backend/scripts/services/siwe.js
- backend/scripts/services/encryption.js

İlişkili testler:
- backend/test/auth.cookiePolicy.test.js
- backend/test/auth.profileRailsValidation.test.js
- backend/test/auth.refreshNonceHardening.test.js
- backend/test/auth.sessionWalletMismatch.test.js
- backend/test/sessionWalletGuard.routes.test.js
- backend/test/pii.takerName.guard.test.js
- backend/test/cleanupSensitiveData.test.js
- backend/test/rateLimiter.aliasCleanup.test.js
- backend/test/rateLimiter.tierOverlay.test.js
- backend/test/rateLimiter.writeFallback.test.js
- backend/test/scrubbers.test.js

## Method
- Kapsamdaki her dosya `nl -ba` ile açılıp satır/fonksiyon bazlı okundu.
- SIWE, cookie, refresh rotation, PII token ve encryption provider akışları uçtan uca kontrol edildi.
- `encryption.js` ile `backend/package.json` dependency cross-check özellikle yapıldı.
- Test dosyaları davranış kapsamı ve boşluk analizi için tek tek okundu.

## File-by-File Notes
| Dosya | Durum | İnceleme derinliği | Not |
|---|---|---|---|
| middleware/auth.js | İncelendi | Fonksiyon bazlı | Cookie-only auth + session-wallet mismatch invalidation var. |
| middleware/rateLimiter.js | İncelendi | Fonksiyon bazlı | Redis hazır değilken in-memory fallback uygulanıyor. |
| middleware/errorHandler.js | İncelendi | Satır bazlı | Body scrub ve fallback 500 mevcut. |
| routes/auth.js | İncelendi | Endpoint bazlı | Nonce/verify/refresh/logout + cookie policy + profile lock kontrolleri mevcut. |
| routes/pii.js | İncelendi | Endpoint bazlı | Trade-scoped token, session-wallet eşleşmesi, snapshot-only ve no-store başlıkları var. |
| routes/receipts.js | İncelendi | Endpoint bazlı | MIME + magic-bytes doğrulama, trade state guard ve temp-file cleanup var. |
| services/siwe.js | İncelendi | Fonksiyon bazlı | Nonce race fix, JWT/refresh token lifecycle, blacklist fail mode değerlendirildi. |
| services/encryption.js | İncelendi | Fonksiyon bazlı | HKDF, key cache, env/aws/vault provider readiness incelendi. |
| İlişkili testler | İncelendi | Test-by-test | Bazı kritik güvenlik davranışları iyi; bazıları source-string odaklı. |

## Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P03-001 | MAINNET-BLOCKER | deployment-env | backend/scripts/services/encryption.js + backend/package.json | `KMS_PROVIDER=aws` akışında `@aws-sdk/client-kms` import ediliyor ancak `backend/package.json` bağımlılıklarında yok. | Production’da aws provider seçildiğinde runtime `Cannot find module '@aws-sdk/client-kms'` ile PII encrypt/decrypt path’i kırılır; auth/profile ve trade PII süreçleri fail olabilir. | encryption.js satır 100’de import; package.json dependencies içinde paket bulunmuyor. | `@aws-sdk/client-kms` runtime dependency olarak eklenmeli, provider smoke test’i CI’ye alınmalı. |
| P03-002 | HIGH | auth-session | backend/scripts/services/siwe.js / isJWTBlacklisted | `JWT_BLACKLIST_FAIL_MODE` değeri whitelist edilmeden kullanılıyor; typo/yanlış değer production’da fail-open davranışa düşebilir (`closed` dışında her şey false döner). | Redis arızasında blacklist kontrolü etkisiz kalıp revoke edilmiş JWT’lerin geçici kabul edilmesi riski doğar. | `return failMode === "closed"`; failMode env’den direkt geliyor. | Env değeri strict enum (`open|closed`) validate edilmeli; production default+invalid durumunda zorunlu `closed` uygulanmalı. |
| P03-003 | HIGH | deployment-env | backend/scripts/middleware/rateLimiter.js | Redis down durumunda limiter process-local Map fallback’a düşüyor; çoklu pod/instance dağıtımında global limit koordinasyonu yok. | Dağıtık ortamda saldırgan istekleri instance’lara yayarak efektif limiti katlayabilir; auth/PII brute-force yüzeyi büyür. | `makeInMemoryLimiter` process-local bucket; all sensitive limiters buna fallback yapıyor. | Çoklu pod için degradasyon stratejisi (shared fallback store, edge/WAF limit, strict fail-closed for auth-critical routes) netleştirilmeli. |
| P03-004 | MEDIUM | testing-gap | backend/test/sessionWalletGuard.routes.test.js ve bazı rateLimiter testleri | Bazı güvenlik testleri gerçek middleware davranışını değil mocked sürümleri veya source-string içeriklerini doğruluyor. | Gerçek davranış regressions (cookie clear, revoke/blacklist side effect, fallback policy) testten kaçabilir. | sessionWalletGuard testinde auth middleware tamamen mock; writeFallback/alias testleri source text arıyor. | Davranışsal integration test kapsamı artırılmalı (gerçek middleware + mocked dependencies). |
| P03-005 | LOW | PII-data-protection | backend/scripts/routes/receipts.js | Desteklenen mime listesinde `image/gif` var; GIF metadata/embedded content yüzeyi diğer formatlara göre daha geniş ve sıkı sanitize pipeline belirtilmemiş. | PII sızıntısı doğrudan değil ancak operasyonel içerik güvenliği ve moderation yüzeyi büyüyebilir. | fileFilter allowlist içinde GIF izinli. | Ürün gerekçesi yoksa GIF kaldırılmalı veya ek içerik tarama/sanitize pipeline dokümante edilmeli. |

## No-Finding Notes
- SIWE nonce lifecycle’de `SET NX` + race sonrası Redis re-read yaklaşımı uygulanmış; nonce drift azaltılmış.
- Production SIWE domain/URI guard’ları (`domain!=localhost`, `https`, host match) mevcut.
- JWT secret kalite kontrolleri (min length, placeholder blacklist, entropy check) aktif.
- Session-wallet mismatch durumunda cookie temizleme + refresh family revoke + JWT blacklist akışı mevcut.
- PII erişimi trade-scoped token + cookie session wallet eşleşmesi + canlı trade state kontrolü ile sınırlandırılmış.
- PII decrypt yanıtlarında `Cache-Control: no-store` ve `Pragma: no-cache` başlıkları uygulanıyor.
- `encryption.js` HKDF kullanımında Node native `crypto.hkdf` ve DEK zeroization (`dek.fill(0)`) mevcut.
- `errorHandler.js` body scrub ve genel fallback response mekanizması mevcut; doğrudan plaintext PII loglama belirgin görünmedi.

## Cross-File Observations
- KMS readiness tasarımı (`encryption.js`) güçlü düşünülmüş; fakat dependency eksikliği nedeniyle aws provider pratikte çalışmaz durumda.
- Auth/PII limiter politikası “availability-first” yaklaşımıyla in-memory fallback’a dayanıyor; distributed deployment varsayımı ile birlikte saldırı yüzeyi değerlendirmesi ops runbook’ta netleştirilmeli.
- PII route güvenlik katmanları çoklu kontrol (auth + session + token + state + snapshot) olarak iyi katmanlanmış.

## Follow-up Needed
- Sonraki fazda deployment/ops dokümanlarında KMS provider runbook (aws/vault), healthcheck ve startup fail-fast davranışları çapraz doğrulanmalı.
- JWT blacklist fail-mode için production policy kararının kod+env+doküman uyumu birlikte incelenmeli.
- Multi-instance rate-limit bypass riskine karşı edge/WAF ve app-layer birlikte ele alınmalı.
