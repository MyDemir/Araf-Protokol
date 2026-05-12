# Araf Governance Readiness — Owner Kontrollü Yüzeyler

> Kapsam: `ArafEscrow.sol`, `ArafRevenueVault.sol`, `ArafRewards.sol` ve deploy/configure/switch script yüzeyleri.
>
> Bu doküman **runtime davranışı değiştirmez**; uygulanmış on-chain guard'ları ve önerilen operasyonel kontrolleri ayırır.

## 1) Temel governance prensipleri

### Uygulanmış guard'lar
- Owner-only fonksiyonlar Solidity `onlyOwner` guard'ı ile korunur.
- Pause/unpause yüzeyleri OpenZeppelin `Pausable` ile yeni write akışlarını durdurur; mevcut kapanış/read akışları tasarıma göre ayrı değerlendirilir.
- Fee, cooldown, reward bps, token config, reputation policy gibi bazı parametrelerde contract seviyesinde üst/alt sınırlar vardır.
- Deploy script public/custom deploy modunda `FINAL_OWNER_ADDRESS` ve `TREASURY_ADDRESS` ayrımını zorlar.
- Rewards treasury switch ayrı script ve explicit env confirmation ile yapılır.

### Operasyonel öneriler — kodda otomatik garanti değildir
- Production owner **kişisel hot wallet olmamalıdır**; multisig veya eşdeğer operasyonel kontrol kullanılmalıdır.
- Multisig/timelock varlığı bu repo tarafından otomatik deploy edilmez. Kullanılacak kontrol modeli deploy öncesi zincir üzerinde ayrıca doğrulanmalıdır.
- Public/custom deploy'larda **final owner** ve **treasury** ayrılmalıdır.
- Config değişiklikleri önceden duyurulmalı, change ticket/runbook ile loglanmalı ve işlem sonrası on-chain getter/event ile doğrulanmalıdır.
- Reward/treasury switch initial deployment ile bundle edilmemelidir; smoke + verify sonrası ayrı change window'da yapılmalıdır.

## 2) Ortak change süreci

Her owner-controlled değişiklik için minimum süreç:

1. **Ön duyuru**: değişiklik amacı, etkilenen kontrat, fonksiyon, parametre, beklenen etki.
2. **Pre-check**: mevcut on-chain değerler, owner adresi, treasury/funding adresleri, token decimals ve chain id.
3. **Execution**: multisig/operasyonel kontrol üzerinden tek amaçlı transaction.
4. **Post-check**: getter/event/manifest/backend readiness doğrulaması.
5. **Log**: tx hash, block, önceki değer, yeni değer, onaylayanlar, rollback/mitigation notu.

## 3) ArafEscrow.sol owner yüzeyleri

| Fonksiyon | Authority kimde olmalı? | Production kontrol modeli | Yanlış konfigürasyon riski | Pre-change checks | Post-change verification |
|---|---|---|---|---|---|
| `transferOwnership(address)` | Final protocol owner | Multisig/eşdeğer; kişisel hot wallet değil | Tüm owner yüzeylerinin kaybı veya tek kişide toplanması | Yeni owner adresi, multisig threshold, chain, zero-address değil, treasury'den ayrı mı? | `owner()` yeni adresi gösteriyor; manifest/runbook güncellendi |
| `setTreasury(address)` | Final owner multisig | Ayrı change window; özellikle vault switch için explicit approval | Protokol gelirleri yanlış adrese yönlenir; rewards/vault wiring bozulabilir | Mevcut `treasury()`, hedef vault/treasury adresi, `EXPECTED_CURRENT_TREASURY_ADDRESS`, vault wiring, smoke/verify sonuçları | `treasury()` hedef adres; revenue event/smoke; backend config güncel |
| `setFeeConfig(uint256,uint256)` | Final owner multisig | Duyurulu parametre değişikliği | Aşırı fee, kullanıcı güven kaybı, eski aktif trade'lerde snapshot beklenti karışıklığı | Mevcut `getFeeConfig()`, max 2000 bps guard, ekonomik analiz, UI copy/env etkisi | `getFeeConfig()` yeni değer; `FeeConfigUpdated`; yeni order snapshot testi |
| `setCooldownConfig(uint256,uint256)` | Final owner multisig | Anti-sybil/risk ekibi onayı | Kullanıcı girişleri gereksiz kilitlenir veya sybil koruması zayıflar | Mevcut `getCooldownConfig()`, max cooldown guard, tier etkisi, support planı | `getCooldownConfig()` yeni değer; `CooldownConfigUpdated`; taker entry smoke |
| `setTokenConfig(address,bool,bool,bool,uint8,uint256[4])` | Final owner multisig | Token onboarding/offboarding runbook'u | Yanlış token, yanlış decimals, yön izinleri veya tier limitleri fon kaybı/revert/market outage yaratır | Token contract adresi, decimals, supported/sell/buy flags, tier max array, liquidity ve frontend/backend env uyumu | `getTokenConfig()`, `getTierMaxAmount()`, `TokenConfigUpdated`, create/fill smoke |
| `setReputationPolicy(...)` | Final owner multisig | Risk/governance onayı | Ban/decay/reward/penalty ekonomisi bozulur; kullanıcılar haksız kısıtlanabilir | Mevcut policy, clean period min/max, ban threshold, delta sınırları, simülasyon | `ReputationPolicyUpdated`; birkaç outcome read-model kontrolü |
| `setReputationTierThresholds(uint32[5],uint32[5])` | Final owner multisig | Risk/governance onayı | Tier progression aşırı kolay/zor olur; bond/eligibility ekonomisi bozulur | Array sıraları, max risk monotonic kuralı, ban threshold uyumu, örnek kullanıcı hesapları | `ReputationTierThresholdsUpdated`; `getReputation()` effective tier örnekleri |
| `pause()` | Final owner multisig veya acil durum multisig modülü | Emergency runbook; sebep ve kapsam loglanmalı | Yeni order/fill akışları durur; kullanıcı panik/support yükü | Incident tanımı, hangi akışların duracağı, kapanış akışları açık mı, iletişim metni | `paused()==true`; create/fill revert; close/read smoke |
| `unpause()` | Final owner multisig | Incident kapanış onayı | Sorun çözülmeden yeniden açılırsa tekrar exploit/outage olabilir | Root cause, patch/config doğrulaması, smoke, monitoring | `paused()==false`; create/fill smoke; incident log kapanışı |

## 4) ArafRevenueVault.sol owner yüzeyleri

| Fonksiyon | Authority kimde olmalı? | Production kontrol modeli | Yanlış konfigürasyon riski | Pre-change checks | Post-change verification |
|---|---|---|---|---|---|
| `transferOwnership(address)` | Rewards/vault governance owner | Multisig/eşdeğer | Vault treasury/reward ayarları kaybedilir | Yeni owner multisig, manifest, zero-address değil | `owner()` doğrulaması |
| `setRewardBps(uint256)` | Rewards governance owner | Duyurulu reward split değişikliği | Treasury/reward paylaşımı beklenenden sapar; sürdürülebilirlik bozulur | Mevcut `rewardBps`, 4000–7000 guard, bütçe analizi, mainnet checklist hedefi | `rewardBps()`, `RewardBpsUpdated`, revenue split smoke |
| `setFinalTreasury(address)` | Rewards/vault governance owner | Treasury ops onayı | Treasury share yanlış adrese çekilir | Hedef adres, muhasebe/onay, zero-address değil | `finalTreasury()`, `FinalTreasuryUpdated`, küçük withdraw smoke gerekirse |
| `setRewards(address)` | Rewards/vault governance owner | Sadece doğrulanmış ArafRewards adresi | Reward reserve yetkisiz/yanlış kontrata allocation verebilir | Rewards adresi, `rewards.revenueVault()==vault`, manifest, verify script | `rewards()`, `RewardsUpdated`, allocation dry/smoke |
| `setSupportedToken(address,bool)` | Rewards/vault governance owner | Token support runbook'u | Revenue/funding yanlış token için açılır/kapanır | Token adresi, decimals/env, escrow token config ile uyum | `supportedToken(token)`, `SupportedTokenUpdated` |
| `setProductPool(bytes32,bool,string)` | Rewards/vault governance owner | Product/campaign ops onayı | Sponsor funding yanlış kampanyaya yönlenir; analytics yanıltır | `productId`, metadata URI, enabled flag, campaign owner | `productPools(productId)`, `ProductPoolUpdated` |
| `withdrawTreasuryShare(address,uint256,address)` | Treasury ops multisig | Muhasebe kontrollü withdrawal | Yanlış recipient veya tutar; treasury reserve azalır | `treasuryReserve`, recipient, amount, supported token, accounting approval | `TreasuryShareWithdrawn`, balance/reserve değişimi |
| `withdrawTreasuryShareToFinal(address,uint256)` | Treasury ops multisig | Tercih edilen production withdrawal | Final treasury yanlışsa fon yanlış adrese gider | `finalTreasury`, reserve, amount, accounting approval | Event recipient `finalTreasury`; balances |
| `pause()` / `unpause()` | Rewards/vault governance owner | Emergency runbook | Revenue hook/funding/allocation akışları durur veya erken açılır | Incident, escrow treasury current target, rewards state | `paused()`, funding/revenue/allocation smoke |

## 5) ArafRewards.sol owner yüzeyleri

| Fonksiyon | Authority kimde olmalı? | Production kontrol modeli | Yanlış konfigürasyon riski | Pre-change checks | Post-change verification |
|---|---|---|---|---|---|
| `transferOwnership(address)` | Rewards governance owner | Multisig/eşdeğer | Epoch allocation/finalization/sweep yetkisi kaybedilir | Yeni owner, manifest, threshold | `owner()` doğrulaması |
| `allocateEpochRewards(uint256,address,uint256)` | Rewards governance owner | Epoch allocation runbook'u | Yanlış epoch/token/tutar; reward reserve tüketimi veya claimable yanlışlığı | Epoch durumu, `epochTokenFinalized=false`, vault reserve/external funding, token supported, totalWeight | `epochRewardPool`, `epochTokenAllocated`, `EpochRewardAllocated`, vault reserve değişimi |
| `finalizeEpochToken(uint256,address)` | Rewards governance owner | Epoch kapanış onayı | Erken/geç finalize; claim süreci aksar | Epoch ended, trade outcome kayıtları tamam, token pool ve totalWeight kontrolü | `epochTokenFinalized`, `EpochTokenFinalizedEvent`, claimable smoke |
| `sweepEpochDust(uint256,address,address)` | Rewards governance owner | Claim window sonrası treasury/accounting onayı | Kullanıcı claim penceresi bitmeden dust süpürme denemesi veya yanlış recipient | `epochTokenFinalized`, claim delay/window, claimed weight, recipient | `EpochDustSwept`, pool conservation, recipient balance |
| `pause()` / `unpause()` | Rewards governance owner | Emergency runbook | Outcome recording/claim/allocation durur; yanlış zamanda açılır/kapanır | Incident, pending claims, allocation state, user comms | `paused()`, record/claim behavior smoke |

## 6) Deploy/configure/switch script governance yüzeyleri

| Script / yüzey | Authority kimde olmalı? | Production kontrol modeli | Yanlış konfigürasyon riski | Pre-change checks | Post-change verification |
|---|---|---|---|---|---|
| `contracts/scripts/deploy.js` — `TREASURY_ADDRESS` | Treasury ops control | Public/custom deploy'da final owner'dan ayrı adres | Gelirler yanlış treasury'ye gider | Address, chain, non-zero, public/custom separation | `escrow.treasury()`, manifest |
| `contracts/scripts/deploy.js` — `FINAL_OWNER_ADDRESS` | Governance multisig | Public/custom deploy'da zorunlu; treasury ile aynı olmamalı | Owner hot wallet veya treasury ile karışır | Multisig/eşdeğer, chain, threshold, separation | `escrow.owner()`, ownership transfer log |
| `contracts/scripts/deploy.js` — token env/config | Governance/deploy ops | Chain-aware token env | Yanlış token/decimals/tier limit | BASE_MAINNET/BASE_SEPOLIA token env, decimals, tier max | `getTokenConfig`, manifest, smoke |
| `contracts/scripts/deployRewards.js` | Rewards governance/deploy ops | Vault/rewards deploy + wiring; treasury switch yok | Yanlış owner/finalTreasury/rewards wiring | `FINAL_OWNER_ADDRESS`, `FINAL_TREASURY_ADDRESS`, escrow address, tokens, manifest overwrite guard | manifest, `vault.rewards`, supported tokens, `rewardBps=4000` |
| `contracts/scripts/configureRewards.js` | Rewards governance ops | Wiring-only; treasury switch yasak | Configure sırasında treasury switch yanlışlıkla yapılır | Env/manifest addresses, no `CONFIRM_SWITCH_TREASURY_TO_VAULT` | `vault.rewards`, supported tokens |
| `contracts/scripts/verifyRewardsDeployment.js` | Read-only ops | Go-live readiness verification | Eksik/mismatched wiring fark edilmez | Env/manifest addresses, optional expected treasury | OK/fail outputs; `rewardBps=4000`; token support |
| `contracts/scripts/switchRewardsTreasury.js` | Final owner multisig | Ayrı explicit change window; `CONFIRM_TREASURY_SWITCH=true` | Escrow treasury yanlış vault'a geçer; revenue redirect riski | Vault/rewards/escrow wiring, token support, `rewardBps`, `EXPECTED_CURRENT_TREASURY_ADDRESS`, smoke | `escrow.treasury()==vault`, revenue hook smoke, readiness |
| `contracts/scripts/smokeRewards.js` | Deploy/QA ops | Validation-only; production governance değişikliği için kullanılmaz | Public smoke yanlış ağda/mock bağlamda çalıştırılırsa yanıltıcı sonuç verir | Local/staging mi, public ise `CONFIRM_PUBLIC_SMOKE=yes`, kullanılan adreslerin gerçek governance adresleri olmadığı | Smoke çıktısı, hiçbir production owner state değişmediği doğrulaması |

## 7) Go-live governance kapıları

- [ ] Production owner multisig/eşdeğer; kişisel hot wallet değil.
- [ ] Public/custom deploy'da `FINAL_OWNER_ADDRESS != TREASURY_ADDRESS`.
- [ ] Rewards `FINAL_TREASURY_ADDRESS` muhasebe/treasury kontrolünde.
- [ ] Deploy ve configure tamamlandı; treasury switch yapılmadı.
- [ ] Verify/smoke geçti.
- [ ] Treasury switch için ayrı duyuru, ayrı tx, ayrı post-check var.
- [ ] Tüm config değişiklikleri tx hash ve önce/sonra değerlerle loglandı.
