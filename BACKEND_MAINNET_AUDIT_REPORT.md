# BACKEND_MAINNET_AUDIT_REPORT

## Executive summary
Bu çalışma yalnız backend kodu ve test çıktılarından doğrulanabilen kanıtlara dayanır.

- Kapsam: `backend/scripts/routes/**`, `services/**`, `middleware/**`, `models/**`, `utils/**`, `config/**`, `jobs/**`, `__tests__/**`
- Confirmed bulgu: **4** (High: 2, Medium: 2)
- Uygulanan patch: minimal blast radius, fail-closed tercihli
- Eklenen/güncellenen test: 3 dosya

---

## Confirmed blockers
- None.

## High risks

### HR-01 — Refresh token akışında wallet-targeted revoke DoS yüzeyi
- **severity:** high
- **status:** confirmed
- **file(s):** `backend/scripts/services/siwe.js`, `backend/scripts/routes/auth.js`
- **exact function / route:** `rotateRefreshToken`, `POST /api/auth/refresh`
- **root cause:** Eski akışta missing token durumunda route'tan gelen wallet parametresiyle family revoke tetiklenebiliyordu.
- **exploit / production impact:** Geçersiz token denemeleriyle hedef wallet session family’si düşürülebilir.
- **minimal fix strategy:** Authority refresh payload wallet’ına taşındı; missing token’da revoke yok; route authoritative wallet ile döner.

### HR-02 — PII token ile session wallet boundary eksikliği
- **severity:** high
- **status:** confirmed
- **file(s):** `backend/scripts/middleware/auth.js`
- **exact function / middleware:** `requirePIIToken`
- **root cause:** `payload.sub` ile `req.wallet` eşleşmesi zorunlu değildi.
- **exploit / production impact:** Token theft senaryosunda session boundary zayıflar.
- **minimal fix strategy:** strict equality check + mismatch fail-closed + `req.piiWallet` ayrımı.

## Medium risks

### MR-01 — Readiness lag threshold env parse hatası
- **severity:** medium
- **status:** confirmed
- **file(s):** `backend/scripts/services/health.js`
- **exact function:** module-level lag threshold parse, `getReadiness` tüketimi
- **root cause:** Invalid env değeri `NaN` üretebiliyordu.
- **exploit / production impact:** readiness sinyali kararsız/yanlış olabilir.
- **minimal fix strategy:** güvenli integer parse + default 25.

### MR-02 — Chargeback ACK IP hash için spoofable header trust
- **severity:** medium
- **status:** confirmed
- **file(s):** `backend/scripts/routes/trades.js`
- **exact function / route:** `_getRealIP`, `POST /api/trades/:id/chargeback-ack`
- **root cause:** Raw `x-forwarded-for` doğrudan tüketiliyordu.
- **exploit / production impact:** Audit IP hash manipülasyonu/forensic zayıflığı.
- **minimal fix strategy:** `req.ip` (trust proxy normalize) kullanımı.

## Low risks
- None confirmed.

---

## File-by-file review notes (backend + database related files)

### `backend/scripts/config/db.js`
- **Confirmed:** Mongo URI yoksa fail-fast (`throw`) uygulanıyor.
- **Confirmed:** `disconnected` event’inde `process.exit(1)` ile clean restart stratejisi var.
- **Unresolved/runtime:** Bu stratejinin orchestrator (PM2/K8s) ile uyumu runtime doğrulama gerektirir.

### `backend/scripts/config/redis.js`
- **Confirmed:** `isReady()` gate’i ve graceful close mevcut.
- **Confirmed:** TLS (`rediss://`/`REDIS_TLS`) desteği var.
- **Unresolved/runtime:** Managed Redis failover + reconnect pattern’i saha testine ihtiyaç duyar.

### `backend/scripts/models/User.js`
- **Confirmed:** PII allowlist dışı public profile leak etmiyor (`toPublicProfile`).
- **Confirmed:** `bank_change_history` rolling recompute yardımcıları var.
- **Unresolved/runtime:** TTL (`last_login`) operasyonel retention beklentisiyle doğrulanmalı.

### `backend/scripts/models/Trade.js`
- **Confirmed:** `onchain_escrow_id` unique index mevcut.
- **Confirmed:** PII snapshot + receipt alanları modelde ayrıştırılmış.
- **Unresolved/runtime:** TTL + cleanup job birlikte çalışması veri yaşam döngüsü testleriyle doğrulanmalı.

### `backend/scripts/models/Order.js`
- **Confirmed:** `onchain_order_id` ve `refs.order_ref` unique.
- **Unresolved/runtime:** Büyük hacimde sort/index davranışı için query plan gözlemi gerekli.

### `backend/scripts/routes/auth.js`
- **Confirmed fix:** refresh wallet authority service’e taşındı; route authoritative wallet döndürüyor.
- **Confirmed fix:** wallet body opsiyonel; doğrulama varsa strict format check.

### `backend/scripts/routes/trades.js`
- **Confirmed fix:** chargeback IP kaynağı header trust yerine `req.ip`.

### `backend/scripts/services/siwe.js`
- **Confirmed fix:** rotate authority artık stored refresh payload wallet.
- **Confirmed fix:** missing token path wallet-family cleanup tetiklemiyor.

### `backend/scripts/services/health.js`
- **Confirmed fix:** worker lag parse deterministic fallback.

### `backend/scripts/middleware/auth.js`
- **Confirmed fix:** PII token/session wallet strict match.

---

## Unresolved / runtime verification needed
1. Provider WS/HTTP kesinti ve reconnect davranışları (saha koşulu).
2. Mongo/Redis failover sırasında readiness + restart orchestration.
3. DLQ throughput/backoff davranışı (yük testinde).
4. Daily snapshot ve cleanup job’larının uzun süreli veri yaşam döngüsü etkisi.

---

## Patches applied
1. `backend/scripts/services/siwe.js`
2. `backend/scripts/routes/auth.js`
3. `backend/scripts/middleware/auth.js`
4. `backend/scripts/services/health.js`
5. `backend/scripts/routes/trades.js`
6. `backend/scripts/__tests__/siwe.refresh.test.js`

---

## Tests added/updated
- `backend/scripts/__tests__/auth.middleware.test.js`
- `backend/scripts/__tests__/health.test.js`
- `backend/scripts/__tests__/siwe.refresh.test.js`

Çalıştırılan komut:
- `cd backend && npm test -- --runInBand`

---

## Migration / rollout notes
- `rotateRefreshToken` imzası `rotateRefreshToken(refreshToken, expectedWallet = null)` oldu.
- Route uyarlaması aynı patch set içinde yapıldı.
- Refresh akışında wallet body artık zorunlu değil; varsa doğrulanır.

## Residual risks
- Runtime bağımlı entegrasyon riskleri (provider/db/redis) tamamen koddan kapanmaz.
- Operasyonel alarm/playbook gereksinimi devam eder.

---

## Ship / no-ship
### Ship only if...
- CI’da backend testleri tam geçiyorsa,
- Staging’de refresh/session/PII akışları gerçek cookie-wallet senaryolarında doğrulanmışsa,
- Readiness + worker lag metrikleri deploy sonrası izleniyorsa.

### Do not ship if...
- Eski rotate imzasını kullanan çağrılar kalmışsa,
- Auth/session mismatch oranı yükseliyorsa,
- Worker lag/readiness drift gözleniyorsa.
