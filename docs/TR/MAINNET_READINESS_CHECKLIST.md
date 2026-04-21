# Mainnet Hazırlık Checklist'i (Stabilization)

## Zorunlu Ortam Değişkenleri
- `MONGODB_URI`
- `REDIS_URL`
- `ARAF_ESCROW_ADDRESS`
- `SIWE_DOMAIN`
- `SIWE_URI`
- `JWT_SECRET`
- `TREASURY_ADDRESS`
- `BASE_RPC_URL`
- `BASE_WS_RPC_URL` (önerilir)
- `WORKER_START_BLOCK` veya `ARAF_DEPLOYMENT_BLOCK` (checkpoint yoksa production'da zorunlu)
- `MAINNET_USDT_ADDRESS` ve `MAINNET_USDC_ADDRESS` (production deploy script için zorunlu)
- `RELAYER_PRIVATE_KEY` (sadece automation job açıksa)

## Deploy Sonrası Zorunlu Admin Adımları
1. `tokenConfigs(MAINNET_USDT_ADDRESS).supported` ve `tokenConfigs(MAINNET_USDC_ADDRESS).supported` değerlerini `true` doğrula.
2. Ownership devrini doğrula (`owner()` kontrolü).
3. Redis checkpoint anahtarını (`worker:last_block`) seed/doğrula.
4. `/health` (liveness) ve `/ready` (readiness) endpoint'lerini doğrula.
5. Smoke trade çalıştırıp DB event senkronunu doğrula.

## Smoke Test Komutları
- `cd backend && npm test -- --runInBand`
- `cd contracts && npm test -- --grep "deploy script"`
- `curl -s http://localhost:4000/health`
- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/ready`

## Rollback Notları
1. Önce backend worker süreçlerini durdur.
2. Önceki backend sürümünü geri alıp yeniden başlat.
3. Checkpoint'i sadece en son güvenli işlenmiş bloğa geri al (asla ileri alma).
4. Trafiği açmadan readiness ve smoke kontrollerini tekrar çalıştır.
