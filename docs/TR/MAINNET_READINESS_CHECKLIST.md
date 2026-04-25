# Mainnet Hazırlık Checklist'i (Stabilization / Runbook)

> Amaç: Bu doküman **mainnet deploy zorunluluğu** getirmez; production/staging güvenlik doğrulaması için kullanılır.

## 1) Zorunlu Ortam Değişkenleri (Production fail-closed)

### Backend core
- `MONGODB_URI`
- `REDIS_URL`
- `JWT_SECRET`
- `ALLOWED_ORIGINS` (production'da wildcard değil, açık origin listesi)
- `ARAF_ESCROW_ADDRESS`
- `BASE_RPC_URL`
- `EXPECTED_CHAIN_ID` (kanonik chain env; Base Mainnet için `8453`)
- `SIWE_DOMAIN`
- `SIWE_URI`

Kritik not:
- `BASE_RPC_URL` zorunludur; backend worker artık public `https://mainnet.base.org` fallback kullanmaz.
- `ARAF_ESCROW_ADDRESS` tanımlı ve worker aktifken `BASE_RPC_URL` eksikse worker fail-closed davranır.

### Worker / replay güvenliği
- `WORKER_START_BLOCK` **veya** `ARAF_DEPLOYMENT_BLOCK` (checkpoint yoksa production'da zorunlu)
- `BASE_WS_RPC_URL` (önerilir; yoksa HTTP fallback gözlenmeli)

### Token env stratejisi (backend + deploy uyumu)
- `MAINNET_USDT_ADDRESS`
- `MAINNET_USDC_ADDRESS`
- `ARAF_TRACKED_TOKENS` (opsiyonel)

Kural:
- `ARAF_TRACKED_TOKENS` boşsa backend tracked seti deterministic olarak `MAINNET_USDT_ADDRESS` + `MAINNET_USDC_ADDRESS` üzerinden türetir.
- Bu kaynaklar da boşsa production config load **fail-closed** olmalıdır.
- Legacy alias (`USDT_ADDRESS` / `USDC_ADDRESS`) yalnız geriye uyum için kabul edilir; kanonik env önceliklidir.

### Deploy ownership güvenliği
- `TREASURY_ADDRESS`
- `FINAL_OWNER_ADDRESS` (public/custom deploy için zorunlu, `TREASURY_ADDRESS` ile aynı olamaz)

### KMS / encryption
- `KMS_PROVIDER`
- `KMS_PROVIDER=env` production'da kullanılmamalı.
- KMS seçimine göre ilgili env'ler:
  - AWS: `AWS_KMS_KEY_ARN`, `AWS_ENCRYPTED_DATA_KEY`, `AWS_REGION`
  - Vault: `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_KEY_NAME`

---

## 2) Stabilization Doğrulama Adımları (Deploy gerektirmez)

1. **Token config doğrulaması (kanonik getter)**
   - `getTokenConfig(MAINNET_USDT_ADDRESS)` ve `getTokenConfig(MAINNET_USDC_ADDRESS)` çıktılarında:
     - `supported=true`
     - `allowSellOrders/allowBuyOrders` beklenen policy ile uyumlu
     - `decimals` ve `tierMaxAmountsBaseUnit[4]` dolu

2. **Ownership doğrulaması**
   - `owner()` adresi `FINAL_OWNER_ADDRESS` ile eşleşmeli.
   - Public/custom modda `owner == treasury` olmamalı.

3. **Chain fail-closed doğrulaması**
   - `EXPECTED_CHAIN_ID=8453` iken RPC farklı chain (`84532` / `31337`) dönerse:
     - worker/protocol-config/cancel-signature yüzeyleri çalışmamalı.

4. **Worker checkpoint + finality doğrulaması**
   - Redis checkpoint anahtarları (`worker:last_block`, `worker:last_safe_block`) mevcut ve ileri yönde güncelleniyor olmalı.
   - Replay sonrası lag kabul edilebilir aralıkta olmalı.

5. **Health / readiness doğrulaması**
   - `/health` liveness: process ayakta.
   - `/ready` readiness: mongo/redis/provider/config/chainId/worker kontrolleri `ok=true` verebilmeli.

6. **Frontend production policy doğrulaması**
   - Production chain policy yalnız Base Mainnet (`8453`).
   - Test faucet/mint UI ve hook çağrıları production yüzeyinde kapalı.
   - API çağrıları same-origin `/api` rewrite policy ile uyumlu (harici `VITE_API_URL` policy dışı kullanılmamalı).

---

## 3) Smoke Test Komutları (local/staging)

- `cd backend && npm test -- --runInBand`
- `cd contracts && npm test -- --grep "deploy script"`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `curl -s http://localhost:4000/health`
- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/ready`

> Not: Bu smoke seti stabilization amaçlıdır; tek başına deploy onayı değildir.

---

## 4) Rollback Notları

1. Önce backend worker süreçlerini durdur.
2. Önceki backend/frontend sürümünü geri alıp yeniden başlat.
3. Checkpoint'i sadece en son güvenli işlenmiş bloğa geri al (asla ileri alma).
4. Trafiği açmadan readiness ve smoke kontrollerini tekrar çalıştır.
