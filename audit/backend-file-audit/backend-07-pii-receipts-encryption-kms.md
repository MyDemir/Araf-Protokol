# Backend File Audit — PII + receipts + encryption/KMS (07)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/routes/pii.js
- backend/scripts/routes/receipts.js
- backend/scripts/services/encryption.js

İlişkili dosyalar:
- backend/scripts/routes/auth.js
- backend/scripts/middleware/auth.js
- backend/scripts/models/Trade.js
- backend/scripts/models/User.js
- frontend/src/hooks/usePII.js
- frontend/src/components/PIIDisplay.jsx
- backend/package.json
- backend/.env.example

İlişkili testler:
- backend/test/pii.takerName.guard.test.js
- backend/test/cleanupSensitiveData.test.js
- backend/test/auth.profileRailsValidation.test.js

## 2. Method
- PII, receipts ve encryption servis dosyaları satır bazlı uçtan uca okundu.
- Auth/session bağları (`requireAuth`, `requireSessionWalletMatch`, `requirePIIToken`) route zincirlerinde kontrol edildi.
- Snapshot-only politikası ve current profile fallback davranışı endpoint bazında incelendi.
- Frontend `usePII` + `PIIDisplay` akışları backend endpoint kontratıyla eşleştirildi.
- KMS provider akışı package runtime dependencies ve .env örnekleriyle çapraz doğrulandı.

## 3. Function / Section Notes
- **PII token scope**: `POST /pii/request-token/:tradeId` tokenı taker + tek tradeId için üretiyor; `GET /pii/:tradeId` token type/tradeId/session wallet birlikte doğrulanıyor.
- **Session-wallet binding**: PII route’ların tamamında `requireSessionWalletMatch` mevcut.
- **Snapshot-only**: `GET /pii/:tradeId` ve `GET /pii/taker-name/:onchainId` current profile fallback’i kapatıp snapshot yoksa `SNAPSHOT_UNAVAILABLE` dönüyor.
- **Cache control**: Hassas PII yanıtlarında `Cache-Control: no-store` + `Pragma: no-cache` ayarlanmış.
- **Receipts**: Upload sadece taker + LOCKED state + tek-sefer receipt (`receipt_encrypted:null`) koşuluyla kabul ediliyor.
- **Encryption**: AES-256-GCM + hkdf(sha256) wallet-scoped DEK modeli uygulanıyor; DEK kullanım sonrası zero-fill var.
- **KMS mode**: Production’da `KMS_PROVIDER=env` bloklanıyor (fail-closed), aws/vault branch’leri mevcut.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B07-F01 | HIGH | deployment-env | backend/scripts/services/encryption.js + backend/package.json | AWS KMS branch `@aws-sdk/client-kms` require ediyor, ancak package runtime dependencies içinde yok. | `KMS_PROVIDER=aws` production modunda runtime `Cannot find module` ile PII encrypt/decrypt akışını kırabilir. | encryption.js aws lazy import var; package.json dependencies listesinde paket yok. | `@aws-sdk/client-kms` runtime dependency olarak eklenmeli ve aws-mode smoke test CI’da koşmalı. |
| B07-F02 | MEDIUM | PII-data-protection | backend/scripts/routes/pii.js (`POST /request-token/:tradeId`) | PII token response’u JSON body’de dönüyor; no-store headers bu endpointte set edilmiyor. | Ara proxy/client cache katmanında kısa ömürlü token kalıcılığı riski (düşük-orta, TTL kısa olsa da). | request-token endpointinde cache-control header set edilmemiş. | `Cache-Control: no-store` + `Pragma: no-cache` token endpointine de eklenmeli. |
| B07-F03 | MEDIUM | security | backend/scripts/services/encryption.js (Vault branch) | Vault provider `fetch` ile plaintext data key alıyor; node sürüm/fetch davranışı ortam bağımlı. Ayrıca TLS pinning/CA policy explicit değil. (uncertain) | Vault entegrasyonunda transport/config hatalarıyla key retrieval güvenilirliği/sıkılığı düşebilir. | `fetch(vaultAddr/..../datakey/plaintext/...)` doğrudan kullanılıyor. | Vault istemci policy’si (CA pinning, timeout, retry) explicitleştirilmeli; runtime compatibility testi eklenmeli. |
| B07-F04 | MEDIUM | auth-session | backend/scripts/routes/pii.js + frontend/src/hooks/usePII.js | `usePII` token’ı state’te tutmuyor (olumlu), ancak endpoint bazlı explicit nonce/anti-replay ek katmanı yok; tamamen JWT expiry + trade state check’e dayanıyor. (uncertain) | XSS veya memory scraping senaryosunda kısa süreli token penceresi içinde tekrar kullanım denenebilir. | Hook tokenı alıp hemen ikinci istekte kullanıyor; backend trade aktiflik kontrolünü tekrar yapıyor. | Kısa TTL iyi; ek olarak single-use pii token/jti blacklist opsiyonu değerlendirilebilir. |
| B07-F05 | LOW | testing-gap | backend/test/pii.takerName.guard.test.js | Testler identity guard ve büyük id parsing odaklı; `GET /pii/:tradeId` için snapshot-unavailable, cache-control ve role misuse senaryoları doğrudan kapsanmıyor. | PII erişim kontratı drift’leri route seviyesinde geç yakalanabilir. | Mevcut test kapsamı taker-name endpointine yoğun. | `GET /pii/:tradeId` için role/state/snapshot/cache-control odaklı testler eklenmeli. |
| B07-F06 | LOW | testing-gap | backend/test/cleanupSensitiveData.test.js | Cleanup testi terminal-state guard ve alan nulling kontrol ediyor; route-level receipt upload/PII erişim leak senaryolarını kapsamıyor. | Retention dışında runtime authorization regressions CI’da kaçabilir. | Test yalnız cleanup job query/update sözleşmelerini doğruluyor. | Receipts ve pii routes için integration test matrisleri genişletilmeli. |
| B07-F07 | INFO | security | backend/scripts/routes/pii.js + backend/scripts/middleware/auth.js | PII erişiminde token trade-scoped + session-wallet bağlı + canlı trade state re-check uygulanıyor. | Pozitif not: role/state drift ve stale token riskini azaltan çok katmanlı guard var. | requireAuth + requireSessionWalletMatch + requirePIIToken + ALLOWED_TRADE_STATES kontrolleri birlikte kullanılıyor. | Bu çok katmanlı desen korunmalı. |

## 5. No-Finding Notes
- Snapshot-only politika (`current profile fallback disabled`) kritik endpointlerde korunuyor.
- Receipts upload MIME allowlist + magic-byte doğrulaması içeriyor.
- Geçici upload dosyaları `finally` bloğunda siliniyor; diskte kalıcılık azaltılmış.
- Encryption DEK’leri operation sonunda zero-fill yapılıyor.
- Production’da `KMS_PROVIDER=env` fail-closed engeli açık ve net.
- Frontend `usePII` endpoint kontratıyla uyumlu iki adımlı flow kullanıyor ve unmount’ta state temizliyor.

## 6. Cross-File Risks
- **Runtime dependency drift**: KMS aws code path ve package dependency seti arasında açık uyumsuzluk var.
- **Token caching edge**: PII data endpointlerinde no-store var, ancak token issue endpointi cache kontrolünü explicit vermiyor.
- **Redis/JWT coupling**: auth/session guard güçlü ama pii token tek-kullanımlı değil; trade state check ile telafi ediliyor.
- **Frontend-backend contract sensitivity**: `usePII` akışı backendin 401/403/409 semantiğine sıkı bağlı; route davranış değişiklikleri UX/security etkiler.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/jobs/cleanupSensitiveData.js (retention zamanlaması ve field kapsamı)
- backend/scripts/routes/trades.js (receipt hash/payout snapshot yüzeylerinin dışa açılımı)
- backend/scripts/services/siwe.js (PII token expiry / optional one-time kullanım)
- backend/test/* (pii/:tradeId ve receipts/upload security integration matrix)
