# Proof of Peace Rewards — Rollout (TR)

## Temel ilkeler
- Rewards **trade cashback değildir**.
- Eligibility yalnızca `ArafEscrow` terminal outcome kaydından üretilir.
- Backend sadece mirror'dır, authority değildir.
- Admin/sponsor recipient seçemez.
- `paymentRiskLevel` reward multiplier değildir.
- MVP'de auto-release, burn, mutual cancel, disputed release **zero-weight**.
- MVP'de Tier 0 reward-eligible değildir.
- `rewardBps` başlangıç 4000; sadece 4000–7000 aralığı geçerlidir.

## Güvenli deploy sırası
1) Escrow güncellemesi (veya upgrade/migration notları)
2) RevenueVault deploy (escrow, FINAL_TREASURY_ADDRESS, rewardBps=4000)
3) Rewards deploy (escrow, revenueVault, epoch=7 gün, claimDelay=24 saat)
4) `vault.setRewards(rewards)`
5) `setSupportedToken(USDT/USDC)`
6) Verify sonrası `escrow.setTreasury(vault)`

## Fazlar
- Phase A: Read-only analytics
- Phase B: External funding enabled, claim disabled
- Phase C: Revenue split + recordTradeOutcome enabled
- Phase D: Claim enabled
- Phase E: Product pool enabled
