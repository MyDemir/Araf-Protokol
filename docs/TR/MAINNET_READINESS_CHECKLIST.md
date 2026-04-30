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
- `WORKER_FINALITY_DEPTH` (önerilen production değeri: `6` veya üzeri)

### Rewards rollout env (backend/frontend + contracts uyumu)
- `ARAF_REVENUE_VAULT_ADDRESS`
- `ARAF_REWARDS_ADDRESS`
- `FINAL_TREASURY_ADDRESS`
- Base Mainnet token env:
  - `BASE_MAINNET_USDT_ADDRESS`
  - `BASE_MAINNET_USDC_ADDRESS`
- Base Sepolia token env:
  - `BASE_SEPOLIA_USDT_ADDRESS`
  - `BASE_SEPOLIA_USDC_ADDRESS`

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

## 2) Proof of Peace Rewards — Final Go-Live Sırası (zorunlu sıra)

Aşağıdaki sıra **bozulmamalıdır**:

1. **Contracts deployed**
   - ArafEscrow (var olan deployment veya ayrı migration)
   - ArafRevenueVault
   - ArafRewards
2. **Vault/Rewards configured**
   - `vault.rewards == ArafRewards`
   - USDT/USDC `supportedToken=true`
   - `rewardBps == 4000` başlangıç doğrulaması
3. **Backend/frontend env updated**
   - Kontrat adresleri ve chain-aware token env'leri güncellendi
   - Backend mirror-only, frontend authority-free davranışı doğrulandı
4. **Smoke verified**
   - Local/staging smoke senaryoları geçti
   - Public chain'de yalnız kontrollü doğrulama komutları çalıştırıldı
5. **Yalnız bundan sonra** `ArafEscrow.treasury -> ArafRevenueVault` switch
   - Ayrı change window
   - `EXPECTED_CURRENT_TREASURY_ADDRESS` ile guard zorunlu

> Kritik: Treasury switch deployment ile aynı adımda yapılmamalıdır.

---

## 3) Rewards Model Doğrulama Maddeleri

- Rewards, **trade cashback değildir**.
- Eligibility yalnız **ArafEscrow terminal outcome** verisinden üretilir.
- Backend yalnız mirror/read-model katmanıdır; recipient seçemez.
- Admin recipient seçemez.
- Sponsor/funder recipient seçemez.
- `paymentRiskLevel` reward multiplier değildir.
- MVP'de auto-release / burn / mutual cancel / disputed release zero-weight'tir.
- MVP'de Tier 0 reward eligibility dışıdır.
- `rewardBps` yalnız 4000–7000 aralığındadır (başlangıç 4000).

---

## 4) Stabilization Doğrulama Adımları (Deploy gerektirmez)

1. **Token config doğrulaması (kanonik getter)**
2. **Ownership doğrulaması**
3. **Chain fail-closed doğrulaması**
4. **Worker checkpoint + finality doğrulaması**
5. **Health / readiness doğrulaması**
6. **Frontend production policy doğrulaması**

---

## 5) Smoke Test Komutları (local/staging)

- `cd backend && npm test -- --runInBand`
- `cd contracts && npm test -- --grep "deploy script|rewards"`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `curl -s http://localhost:4000/health`
- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/ready`

---

## 6) Rollback Notları

1. Önce backend worker süreçlerini durdur.
2. Önceki backend/frontend sürümünü geri alıp yeniden başlat.
3. Checkpoint'i sadece en son güvenli işlenmiş bloğa geri al (asla ileri alma).
4. Trafiği açmadan readiness ve smoke kontrollerini tekrar çalıştır.

## Go-Live Öncesi Doğrulama
- Vault kontrat adresi deployment manifest/config üzerinden doğrulanmalıdır.
- Rewards kontrat adresi deployment manifest/config üzerinden doğrulanmalıdır.
- Supported token seti USDT/USDC olmalıdır.
- `rewardBps` başlangıcı 4000 olmalıdır.
- Backend/frontend read-only / mirror-only kalmalıdır.
- Backend/frontend reward eligibility, weight, outcome, recipient veya claimable authority tanımlamamalıdır.
- Treasury switch deployment sürecinin parçası değildir.
- Treasury switch doğrulama sonrası ayrı ve açık bir operasyon olarak yürütülmelidir.
- Production adresleri hardcode edilmemelidir.
- Treasury switch öncesi smoke ve verify komutları başarılı olmalıdır.
