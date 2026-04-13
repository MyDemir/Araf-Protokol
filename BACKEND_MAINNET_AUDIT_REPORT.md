# BACKEND_MAINNET_AUDIT_REPORT

## Executive summary
Bu inceleme yalnız backend kodu + çalıştırılan test komut çıktıları ile yapılmıştır.

Bu iterasyonda confirmed olarak **4 bulgu** sınıflandırıldı:
- High: 2
- Medium: 2
- Blocker: 0
- Low: 0

Bu bulgulardan patch uygulanabilenler minimal blast radius ile düzeltildi ve test eklendi.

---

## Confirmed blockers
- None.

## High risks

### HR-01 — Refresh rotasyonunda wallet parametresi istemciden geldiği için token-missing akışında hedefli session revoke yapılabiliyordu
- **severity:** high
- **status:** confirmed
- **file(s):** `backend/scripts/services/siwe.js`, `backend/scripts/routes/auth.js`
- **exact function / route:** `rotateRefreshToken`, `POST /api/auth/refresh`
- **root cause:** `rotateRefreshToken(walletAddress, refreshToken)` akışında token key bulunamazsa (`getDel` null), verilen wallet için family key'ler taranıp toplu siliniyordu. Wallet değeri route seviyesinde body/JWT fallback kaynaklı kullanıcı girdisinden taşınabiliyordu.
- **exploit / production impact:** Geçersiz refresh token denemeleri ile hedef wallet family revoke tetiklenebilir; kullanıcı oturumları zorla düşürülebilir (DoS/session disruption).
- **minimal fix strategy:** Wallet authority’i refresh token payload’ından al. `rotateRefreshToken(refreshToken, expectedWallet)` imzasına geç; missing token durumunda family cleanup yapma; stored payload wallet'i doğrula ve yalnız bu wallet/family için rotate et.

### HR-02 — PII token wallet ile session wallet eşleşmesi zorunlu değildi
- **severity:** high
- **status:** confirmed
- **file(s):** `backend/scripts/middleware/auth.js`
- **exact function / middleware:** `requirePIIToken`
- **root cause:** Middleware token wallet’i (`payload.sub`) session wallet’e karşı zorunlu kontrol etmeden `req.wallet` overwrite ediyordu.
- **exploit / production impact:** Token theft senaryosunda session-boundary zayıflar; bearer token ile yanlış oturum bağlamında PII erişim riski artar.
- **minimal fix strategy:** `payload.sub === req.wallet` zorunlu kontrolü, mismatch’te fail-closed `403`, overwrite yerine `req.piiWallet`.

## Medium risks

### MR-01 — WORKER_MAX_LAG_BLOCKS invalid env değerinde readiness lag eşiği güvenilir parse edilmiyordu
- **severity:** medium
- **status:** confirmed
- **file(s):** `backend/scripts/services/health.js`
- **exact function:** `getReadiness` tarafından kullanılan `MAX_WORKER_LAG_BLOCKS`
- **root cause:** `Number(process.env.WORKER_MAX_LAG_BLOCKS || 25)` invalid input’ta `NaN` üretebiliyordu.
- **exploit / production impact:** Readiness sinyali operasyonda yanlış-negatif/kararsız olabilir.
- **minimal fix strategy:** Güvenli integer parser + invalid değerde deterministic default (25).

### MR-02 — Chargeback ACK IP hash için raw x-forwarded-for header’ı doğrudan güveniliyordu
- **severity:** medium
- **status:** confirmed
- **file(s):** `backend/scripts/routes/trades.js`
- **exact function / route:** `_getRealIP`, `POST /api/trades/:id/chargeback-ack`
- **root cause:** Production’da `x-forwarded-for` başlığı doğrudan parse edilerek kullanılıyordu.
- **exploit / production impact:** Header spoofing ile audit IP hash değeri manipüle edilebilir; forensic doğruluk bozulur.
- **minimal fix strategy:** `trust proxy` aktifken yalnız Express normalize edilmiş `req.ip` kullan.

## Low risks
- None confirmed.

---

## Unresolved / runtime verification needed
1. Provider/WS gerçek kesinti/failover davranışının canlı ortamda gözlemlenmesi.
2. Mongo/Redis failover sırasında orchestrator restart stratejisinin runbook uyumu.
3. DLQ throughput/backoff davranışının yük testinde doğrulanması.

---

## Patches applied
1. **`backend/scripts/services/siwe.js`**
   - `rotateRefreshToken` wallet authority modeli hardened edildi.
   - Missing token artık toplu revoke tetiklemiyor.
   - Stored payload wallet formatı doğrulanıyor.
2. **`backend/scripts/routes/auth.js`**
   - Refresh route yeni `rotateRefreshToken` imzasına uyarlandı.
   - Response wallet artık service tarafından authoritative dönen değerden geliyor.
3. **`backend/scripts/middleware/auth.js`**
   - PII token/session wallet mismatch fail-closed.
4. **`backend/scripts/services/health.js`**
   - Worker lag threshold güvenli parse helper.
5. **`backend/scripts/routes/trades.js`**
   - Chargeback ack IP kaynağı `req.ip` ile sınırlandı.

---

## Tests added/updated
- `backend/scripts/__tests__/auth.middleware.test.js`
- `backend/scripts/__tests__/health.test.js`
- `backend/scripts/__tests__/siwe.refresh.test.js` (yeni)

Çalıştırılan test komutu:
- `cd backend && npm test -- --runInBand`

---

## Migration / rollout notes
- `rotateRefreshToken` imzası değişti; route uyarlaması aynı commit içinde yapıldı.
- Davranış değişikliği: invalid/missing refresh denemesi artık wallet-family toplu revoke yapmaz.
- Session güvenliği artırıldı; backward compatibility API seviyesinde korunuyor.

## Residual risks
- Runtime altyapı kesintilerinde (provider/redis/mongo) gerçek davranış için staging/prod gözlem şart.
- Off-chain cancel signature validity doğrulaması backend’de hâlâ storage-level; chain call öncesi signer-validation pipeline’ı operational olarak ayrıca doğrulanmalı.

---

## Ship / no-ship
### Ship only if...
- Tüm backend testleri CI’de geçerse,
- Refresh/PII auth akışları staging’de cookie + wallet senaryolarıyla doğrulanırsa,
- Readiness metricleri deploy sonrası izlenirse.

### Do not ship if...
- Refresh rotasyonunda eski servis imzasını çağıran başka kod path’i kalmışsa,
- Auth/session mismatch alarmları yükseliyorsa,
- Runtime readiness drift gözleniyorsa.
