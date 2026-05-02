# Araf Spot — Liquidity Peace Tier & Reward Plan

**Versiyon:** v0.1  
**Tarih:** 2026-05-02  
**Kapsam:** Araf Spot tarafı için fee, tier, liquidity reward ve reward-vault entegrasyon planı  
**Temel ilke:** Backend karar vermez; IP/fingerprint/linked-wallet takibi yoktur; tier ve reward mümkün olduğunca on-chain fill, fee-paid ve liquidity contribution üzerinden şekillenir.

---

## 1. Amaç

Araf Spot sistemi klasik CEX VIP programı gibi yalnızca hacim yapan kullanıcıya indirim veren bir model olmamalıdır. Araf’ın spot tarafı iki hedefi aynı anda taşımalıdır:

1. **Ucuz ve sade on-chain al-sat deneyimi** sunmak.
2. **Gerçek likidite sağlayan kullanıcıları reward ile çekmek.**

Bu nedenle önerilen modelin adı:

```text
Araf Spot Liquidity Peace Tier
```

Bu sistemde spot tier bir risk motoru değildir. Tier; kullanıcının on-chain spot tarafında ürettiği gerçek katkıya göre şekillenen bir liquidity contribution sistemidir.

---

## 2. Repo’dan teyit edilen mevcut reward bazları

Mevcut `contracts/src/ArafRewards.sol` içinde escrow reward sistemi şu katsayıları kullanıyor:

```solidity
uint256 public constant BPS = 10_000;
uint256 public constant SCALE = 100_000_000;

// Outcome multipliers (BPS)
uint256 public constant CLEAN_FAST_BPS = 25_000;      // <=1h
uint256 public constant CLEAN_24H_BPS = 15_000;       // <=24h
uint256 public constant CLEAN_72H_BPS = 10_000;       // <=72h
uint256 public constant CLEAN_SLOW_BPS = 5_000;       // >72h or paidAt=0
uint256 public constant PARTIAL_SETTLEMENT_BPS = 3_000;

// Tier multipliers (BPS)
uint256 public constant TIER1_BPS = 10_000;
uint256 public constant TIER2_BPS = 11_000;
uint256 public constant TIER3_BPS = 12_000;
uint256 public constant TIER4_BPS = 13_000;
```

Mevcut escrow reward formülü:

```solidity
makerW = (base * outcomeBps * tierBps) / SCALE;
takerW = (base * outcomeBps * tierBps) / SCALE;
```

Burada `base = stableNotional` olarak alınıyor. `SCALE = 100_000_000`, çünkü iki adet BPS çarpanı birlikte kullanılıyor.

### 2.1 Escrow reward felsefesi

| Escrow outcome | BPS | Çarpan | Anlam |
|---|---:|---:|---|
| Clean fast <= 1h | 25.000 | 2.50x | En kaliteli sonuç |
| Clean <= 24h | 15.000 | 1.50x | Çok iyi sonuç |
| Clean <= 72h | 10.000 | 1.00x | Normal temiz sonuç |
| Clean slow | 5.000 | 0.50x | Geç ama temiz sonuç |
| Partial settlement | 3.000 | 0.30x | Uzlaşma var ama zayıf |
| Auto release / disputed / burned | 0 | 0x | Reward yok |

### 2.2 Escrow tier felsefesi

| Escrow tier | BPS | Çarpan |
|---|---:|---:|
| T1 | 10.000 | 1.00x |
| T2 | 11.000 | 1.10x |
| T3 | 12.000 | 1.20x |
| T4 | 13.000 | 1.30x |

Spot tarafında bu mantık birebir kopyalanmaz. Escrow’da reward kalitesi “işlem sonucu davranışı” ile ölçülür. Spot’ta dispute/clean release olmadığı için kalite ölçümü **likidite katkısı** üzerinden yapılmalıdır.

```text
Escrow outcome quality = çözüm davranışı kalitesi
Spot outcome quality   = likidite katkısı kalitesi
```

---

## 3. Privacy ve authority sınırları

Spot tier sistemi aşağıdaki veri ve karar mekanizmalarını kullanmamalıdır:

```text
- IP tracking yok
- Device fingerprint yok
- Linked-wallet surveillance yok
- Backend risk scoring yok
- Backend tarafından keyfi tier kararı yok
- Escrow riskPoints ile otomatik spot tier düşürme yok
- Counterparty concentration analizi yok
- Off-chain manual review tabanlı genel kullanıcı cezalandırması yok
```

Backend’in rolü:

```text
- Event mirror
- UI read-model
- Analytics
- Indexing
```

Ekonomik authority:

```text
- ArafSpot kontratı
- ArafRewards kontratı
- ArafRevenueVault muhasebe katmanı
```

---

## 4. Spot tier ana prensibi

Spot tier bir hacim yarışı olmamalıdır. Sadece volume ödüllendirilirse wash trading teşvik edilir. Bu yüzden spot reward ve tier metrikleri öncelikle gerçek protokol katkısına dayanmalıdır:

```text
Primary base = feePaid
Secondary base = makerFilledNotional
Temporal base = activeEpochCount
```

Tier hesaplama mantığı:

```text
SpotTier = min(
  feeContributionTier,
  liquidityContributionTier,
  consistencyTier
)
```

Bu yapı kullanıcının tek bir metriği şişirerek en üst tier’e çıkmasını engeller.

---

## 5. Spot fee tablosu

Araf Spot için önerilen fee sistemi:

| Tier | İsim | Maker fee | Taker fee | Kullanıcı tipi |
|---|---|---:|---:|---|
| L1 | Public Trader | 5 bps | 15 bps | Herkesin başladığı seviye |
| L2 | Active Trader | 4 bps | 14 bps | Düzenli işlem yapan kullanıcı |
| L3 | Liquidity Builder | 3 bps | 12 bps | Maker tarafında anlamlı katkı sağlayan kullanıcı |
| L4 | Peace Maker | 2 bps | 10 bps | Güçlü ve sürekli likidite sağlayıcı |
| L5 | Anchor Maker | 0–1 bps | 8–10 bps | Pair bazlı stratejik likidite sağlayıcı |

BPS sade karşılık:

```text
1 bps  = %0.01
5 bps  = %0.05
10 bps = %0.10
15 bps = %0.15
```

Örnek: L1’de 1.000 USDC spot işlem için:

```text
Maker fee = 0.50 USDC
Taker fee = 1.50 USDC
```

---

## 6. Spot reward katsayıları

Spot tarafında `outcomeBps` yerine `liquidityOutcomeBps` kullanılmalıdır.

Önerilen başlangıç katsayıları:

```solidity
uint256 public constant SPOT_MAKER_FILLED_BPS = 15_000;       // 1.50x
uint256 public constant SPOT_TAKER_FILL_BPS = 10_000;         // 1.00x
uint256 public constant SPOT_BALANCED_BONUS_BPS = 1_000;      // +0.10x opsiyonel
uint256 public constant SPOT_PASSIVE_EXPIRED_BPS = 0;         // 0x
```

### 6.1 Spot liquidity outcome tablosu

| Spot outcome | BPS | Çarpan | Kim alır? | Anlam |
|---|---:|---:|---|---|
| `MAKER_FILLED` | 15.000 | 1.50x | Maker | Likidite sağladı ve fill aldı |
| `TAKER_FILL` | 10.000 | 1.00x | Taker | Likidite kullandı |
| `BALANCED_TRADER` | +1.000 | +0.10x | Hem maker hem taker | Aynı epoch içinde iki yönlü katkı |
| `PASSIVE_ORDER_EXPIRED` | 0 | 0x | Kimse | Emir fill almadan kapandı |
| `SELF_TRADE_ATTEMPT` | 0 | 0x | Kimse | Aynı wallet self-trade engeli |

Maker reward’ın taker’dan yüksek olması bilinçli bir tercihtir. Spot ürününün ilk aşamadaki ana ihtiyacı **likidite çekmek ve orderbook derinliği oluşturmak**tır.

---

## 7. Spot tier reward BPS tablosu

Mevcut escrow tarafında T4 = 1.30x. Spot tarafında L4 de 1.30x’e denklenir. Spot’a özel olarak L5 Anchor Maker eklenir.

| Spot tier | İsim | Tier BPS | Reward çarpanı | Açıklama |
|---|---|---:|---:|---|
| L1 | Public Trader | 10.000 | 1.00x | Başlangıç seviyesi |
| L2 | Active Trader | 10.750 | 1.075x | Küçük ama hissedilir artış |
| L3 | Liquidity Builder | 11.750 | 1.175x | Maker katkısını büyütür |
| L4 | Peace Maker | 13.000 | 1.30x | Escrow T4 ile dengeli |
| L5 | Anchor Maker | 15.000 | 1.50x | Spot’a özel stratejik likidite katmanı |

---

## 8. Spot reward weight formülü

Ana formül:

```solidity
spotWeight = (feePaid * liquidityOutcomeBps * spotTierBps) / SCALE;
```

Maker için:

```solidity
makerWeight = (makerFeePaid * SPOT_MAKER_FILLED_BPS * spotTierBps) / SCALE;
```

Taker için:

```solidity
takerWeight = (takerFeePaid * SPOT_TAKER_FILL_BPS * spotTierBps) / SCALE;
```

Balanced bonus opsiyonel olarak epoch sonunda hesaplanabilir:

```solidity
if (epochMakerFeePaid[user] > 0 && epochTakerFeePaid[user] > 0) {
    bonusWeight = (baseSpotWeight * SPOT_BALANCED_BONUS_BPS) / BPS;
}
```

### 8.1 Örnek hesap

L3 kullanıcısı için:

```text
spotTierBps = 11.750 = 1.175x
maker outcome = 15.000 = 1.50x
makerFeePaid = 100 USDC
```

Reward weight:

```text
100 × 1.50 × 1.175 = 176.25 weight
```

Aynı kullanıcı taker olarak 100 USDC fee öderse:

```text
100 × 1.00 × 1.175 = 117.5 weight
```

Sonuç: Aynı fee katkısında maker daha fazla reward weight üretir. Bu, likidite çekmek için doğru teşviktir.

---

## 9. Tier yükselme metrikleri

Tier yükselme üç boyutlu olmalıdır:

```text
1. Fee contribution
2. Liquidity contribution
3. Consistency
```

### 9.1 Fee contribution tier

| Tier | Lifetime fee paid eşiği |
|---|---:|
| L1 | Default |
| L2 | >= 25 USDC |
| L3 | >= 250 USDC |
| L4 | >= 1.000 USDC |
| L5 | >= 5.000 USDC |

### 9.2 Liquidity contribution tier

| Tier | Maker-filled notional eşiği |
|---|---:|
| L1 | Default |
| L2 | >= 10.000 USDC |
| L3 | >= 75.000 USDC |
| L4 | >= 500.000 USDC |
| L5 | >= 2.500.000 USDC |

### 9.3 Consistency tier

| Tier | Active epoch eşiği |
|---|---:|
| L1 | Default |
| L2 | >= 1 active epoch |
| L3 | >= 2 active epochs |
| L4 | >= 4 active epochs |
| L5 | >= 8 active epochs |

`active epoch` tanımı:

```text
Bir epoch içinde kullanıcının spot fee katkısı >= ACTIVE_EPOCH_MIN_FEE
```

Öneri:

```solidity
uint256 public constant ACTIVE_EPOCH_MIN_FEE = 5e6; // USDC 6 decimals varsayımıyla 5 USDC
```

---

## 10. Tier hesaplama pseudocode

```solidity
function computedSpotTier(address user) public view returns (uint8) {
    uint8 feeTier = _feeContributionTier(user);
    uint8 liquidityTier = _liquidityContributionTier(user);
    uint8 consistencyTier = _consistencyTier(user);

    uint8 tier = _min3(feeTier, liquidityTier, consistencyTier);

    if (anchorMaker[pairId][user]) {
        // Pair bazlı L5 yetkisi yalnız ilgili pair reward/fee hesabında uygulanmalı.
        return 5;
    }

    if (tier == 0) return 1;
    return tier;
}
```

Not: L5 global değil, ideal olarak pair bazlıdır.

---

## 11. Anchor Maker sistemi

L5, Araf Spot’u global VIP sistemlerinden ayıracak özel katmandır.

```text
L5 Anchor Maker = belirli pair’de likidite omurgası sağlayan kullanıcı
```

### 11.1 Pair bazlı L5 mapping

```solidity
mapping(bytes32 pairId => mapping(address user => bool)) public anchorMaker;
```

### 11.2 L5 avantajları

```text
- Maker fee: 0–1 bps
- Taker fee: 8–10 bps
- Reward tier: 1.50x
- Daha yüksek max order amount
- Pair bazlı reward cap
```

### 11.3 L5 sınırları

L5 sisteminin havuzu domine etmemesi için cap zorunludur:

```text
- Anchor Maker tek kullanıcı epoch spot reward cap: %10
- Tek pair spot reward cap: %15
- Spot toplam reward share cap: %30
```

---

## 12. Reward cap sistemi

Spot reward, escrow reward havuzunu ezmemelidir. Araf’ın ana anlatısı escrow + Proof of Peace olduğu için spot tarafı likidite çekmeli ama tüm reward ekonomisini domine etmemelidir.

Önerilen cap’ler:

| Cap tipi | Öneri |
|---|---:|
| Spot total reward share cap | %30 |
| Tek kullanıcı spot reward cap | %5 |
| Tek pair spot reward cap | %15 |
| Anchor Maker cap | %10 |
| Stable-stable pair reward cap | %0–5 |

Bu cap’ler risk skoru değildir. Bunlar ekonomik denge korumasıdır.

---

## 13. ArafSpot veri yapısı önerisi

### 13.1 Fill modeli

```solidity
struct SpotFill {
    uint256 id;
    bytes32 pairId;
    address maker;
    address taker;
    address baseToken;
    address quoteToken;
    uint256 baseAmount;
    uint256 quoteGross;
    uint256 makerFeePaid;
    uint256 takerFeePaid;
    uint256 filledAt;
    uint8 makerTierSnapshot;
    uint8 takerTierSnapshot;
}
```

### 13.2 Kullanıcı epoch stats

```solidity
struct SpotUserEpochStats {
    uint256 makerFeePaid;
    uint256 takerFeePaid;
    uint256 makerFilledNotional;
    uint256 takerFilledNotional;
    uint256 makerFillCount;
    uint256 takerFillCount;
    bool activeEpochCounted;
}
```

### 13.3 Kullanıcı lifetime stats

```solidity
struct SpotUserLifetimeStats {
    uint256 totalMakerFeePaid;
    uint256 totalTakerFeePaid;
    uint256 totalMakerFilledNotional;
    uint256 totalTakerFilledNotional;
    uint256 activeEpochCount;
}
```

### 13.4 Tier config

```solidity
struct SpotTierConfig {
    uint16 makerFeeBps;
    uint16 takerFeeBps;
    uint16 tierRewardBps;
    uint256 maxOrderNotional;
    bool rewardEligible;
}
```

---

## 14. ArafRewards entegrasyon önerisi

Mevcut `ArafRewards.sol` escrow için `recordTradeOutcome(uint256 tradeId)` kullanıyor. Spot tarafı için ayrı bir kayıt fonksiyonu eklenmelidir.

```solidity
function recordSpotFill(uint256 fillId) external nonReentrant whenNotPaused;
```

Mevcut `userWeight` tek havuz olarak kalırsa spot ve escrow ağırlıkları karışır. Bu yüzden ayrık ledger önerilir:

```solidity
mapping(uint256 => mapping(address => uint256)) public escrowUserWeight;
mapping(uint256 => mapping(address => uint256)) public spotUserWeight;

mapping(uint256 => uint256) public totalEscrowWeight;
mapping(uint256 => uint256) public totalSpotWeight;
```

Final claim hesabında, epoch havuzu iki alt havuza ayrılabilir:

```text
epochRewardPool = escrowRewardPool + spotRewardPool
```

veya cap uygulanmış ağırlık sistemiyle tek pool içinde dağıtılabilir.

MVP için daha kontrollü yaklaşım:

```text
Escrow reward allocation ve Spot reward allocation ayrı tutulmalı.
```

---

## 15. RevenueVault entegrasyonu

Mevcut `ArafRevenueVault.sol`, escrow gelirlerini reward/treasury rezervlerine bölüyor:

```solidity
uint256 public constant MIN_REWARD_BPS = 4_000;
uint256 public constant MAX_REWARD_BPS = 7_000;
```

Spot geliri için iki seçenek vardır.

### Seçenek A — Tek vault, yeni revenue kind

Vault aynı kalır; yeni revenue kind eklenir:

```solidity
enum RevenueKind {
    MANUAL_RELEASE_FEE,
    AUTO_RELEASE_FEE_OR_PENALTY,
    PARTIAL_SETTLEMENT_FEE,
    DISPUTED_RELEASE_FEE,
    BURN_RESIDUAL,
    SPOT_MAKER_FEE,
    SPOT_TAKER_FEE
}
```

Artı:

```text
- Tek muhasebe katmanı
- Reward reserve tek yerde
```

Eksi:

```text
- Escrow ve spot gelirleri aynı reserve içinde karışır
```

### Seçenek B — Ürün bazlı pool

Vault içindeki mevcut `ProductPool` altyapısı spot için kullanılabilir.

```text
productId = keccak256("ARAF_SPOT")
```

Artı:

```text
- Spot funding/reward ayrı izlenir
- Campaign/pair bazlı analiz kolaylaşır
```

Eksi:

```text
- Daha fazla muhasebe yüzeyi
```

Öneri:

```text
MVP için Seçenek B daha temizdir.
Spot reward allocation, escrow reward allocation’dan ayrı izlenmelidir.
```

---

## 16. Pair class sistemi

Her pair aynı reward/fee sistemine sokulmamalıdır.

| Pair class | Örnek | Fee | Reward |
|---|---|---|---|
| Class A | WETH/USDC, cbBTC/USDC | Tam tier fee | Tam reward eligible |
| Class B | cbETH/USDC | Biraz daha yüksek fee | Sınırlı reward |
| Class S | USDC/USDT | Çok düşük fee | Reward kapalı veya %0–5 cap |
| Class R | Yeni/riskli asset | Daha yüksek fee | Reward kapalı veya cap’li |

Pair config:

```solidity
struct PairConfig {
    bool enabled;
    address baseToken;
    address quoteToken;
    uint8 pairClass;
    uint16 rewardCapBps;
    bool rewardEligible;
}
```

---

## 17. Minimal güvenlik guardrail’leri

Spot tarafı privacy-first kalmalı, ancak temel on-chain güvenlik kontrolleri olmalıdır:

```text
- Same-wallet self-trade engeli
- Pair allowlist
- Quote token allowlist
- Fee-on-transfer token engeli veya exact-in/out kontrolü
- Max fee cap
- Pause / unpause
- Snapshot fee/tier mantığı
- ReentrancyGuard
- SafeERC20
```

Self-trade guard:

```solidity
if (maker == taker) revert SelfTradeForbidden();
```

Bu linked-wallet analizi değildir. Sadece aynı address’in kendisiyle işlem yapmasını engeller.

---

## 18. Snapshot semantiği

Mevcut escrow sisteminde order create anında fee snapshot alınması iyi bir desendir. Spot tarafında da aynı ilke uygulanmalıdır.

```text
- Maker tier snapshot: order create veya fill anında alınır.
- Taker tier snapshot: fill anında alınır.
- Sonradan tier değişimi geçmiş fill ekonomisini değiştirmez.
```

Bu kullanıcı güveni için önemlidir.

---

## 19. Uygulama fazları

### Faz 1 — Minimal ArafSpot

```text
- Pair allowlist
- Maker/taker fee kesimi
- L1–L4 tier config
- Fee snapshot
- Fill eventleri
- Fee revenue routing
- Self-trade guard
```

### Faz 2 — Spot reward recording

```text
- SpotFill view interface
- ArafRewards.recordSpotFill(fillId)
- Maker/taker spot weight hesabı
- Spot/escrow ayrık weight ledger
- Reward cap sistemi
```

### Faz 3 — Liquidity Peace Tier

```text
- Fee contribution tier
- Liquidity contribution tier
- Consistency tier
- activeEpochCount
- min(feeTier, liquidityTier, consistencyTier)
```

### Faz 4 — Anchor Maker

```text
- Pair bazlı anchorMaker mapping
- L5 fee config
- L5 reward multiplier
- Anchor cap
- Pair cap
```

### Faz 5 — Ürün/pair bazlı reward pool

```text
- ARAF_SPOT product pool
- Pair class reward caps
- Campaign funding
- Separate spot allocation policy
```

---

## 20. Test planı

### 20.1 Fee testleri

```text
- L1 maker/taker fee doğru kesiliyor
- L2/L3/L4 fee config doğru uygulanıyor
- Fee snapshot sonradan değişmiyor
- Fee-on-transfer token exact-in/out ihlali yakalanıyor
```

### 20.2 Reward weight testleri

```text
- Maker weight = makerFeePaid × 1.50 × tier
- Taker weight = takerFeePaid × 1.00 × tier
- Passive expired order reward üretmiyor
- Self-trade attempt reward üretmiyor
- Balanced bonus yalnız maker+taker fee varsa çalışıyor
```

### 20.3 Tier testleri

```text
- L1 default
- Fee threshold tek başına yeterli değil
- Maker notional tek başına yeterli değil
- Active epoch tek başına yeterli değil
- min(feeTier, liquidityTier, consistencyTier) doğru çalışıyor
- L5 yalnız pair bazlı uygulanıyor
```

### 20.4 Cap testleri

```text
- Spot total reward cap aşılamıyor
- Tek kullanıcı cap aşılamıyor
- Pair cap aşılamıyor
- Anchor Maker cap aşılamıyor
- Stable-stable cap düşük/kapalı çalışıyor
```

### 20.5 Privacy/authority testleri

```text
- Backend olmadan tier hesaplanabiliyor
- IP/fingerprint input’u yok
- linked-wallet input’u yok
- escrow riskPoints spot tier’i otomatik düşürmüyor
- same-wallet self-trade engeli çalışıyor
```

---

## 21. Net karar özeti

```text
Araf Spot tier sistemi basit VIP tablosu olmayacak.
Araf Spot tier sistemi on-chain liquidity contribution sistemi olacak.
```

Korunacak sınırlar:

```text
No IP tracking.
No backend scoring.
No linked-wallet surveillance.
No escrow risk-point dependency.
No volume-only reward.
```

Ana formül:

```text
Araf Spot reward = feePaid × liquidityOutcomeBps × spotTierBps / SCALE
```

Ana tier mantığı:

```text
SpotTier = min(feeContributionTier, liquidityContributionTier, consistencyTier)
```

Likidite çekme stratejisi:

```text
Maker fee düşük tutulur.
Maker reward weight taker’dan yüksek olur.
L5 Anchor Maker ile pair bazlı stratejik likidite çekilir.
Cap sistemiyle reward havuzu domine edilmez.
```

---

## 22. Açık kararlar

Uygulamaya geçmeden önce netleştirilmesi gereken kararlar:

1. Spot reward escrow ile aynı token/havuzdan mı dağıtılacak, yoksa ayrı `ARAF_SPOT` product pool mu kullanılacak?
2. L5 Anchor Maker governance-approved mi olacak, yoksa tamamen on-chain eşiklerle mi açılacak?
3. L5 maker fee 0 bps mi, 1 bps mi olacak?
4. Spot total reward cap başlangıçta %30 mu olmalı?
5. Stable-stable pair’lerde reward tamamen kapatılacak mı, yoksa %0–5 cap mi uygulanacak?
6. Active epoch minimum fee eşiği 5 USDC mi, 10 USDC mi olmalı?
7. Tier threshold’lar lifetime mı başlayacak, yoksa sezon/epoch resetli mi olacak?

---

## 23. Önerilen MVP parametre seti

```text
L1: maker 5 bps, taker 15 bps, tierRewardBps 10_000
L2: maker 4 bps, taker 14 bps, tierRewardBps 10_750
L3: maker 3 bps, taker 12 bps, tierRewardBps 11_750
L4: maker 2 bps, taker 10 bps, tierRewardBps 13_000
L5: maker 0–1 bps, taker 8–10 bps, tierRewardBps 15_000

SPOT_MAKER_FILLED_BPS = 15_000
SPOT_TAKER_FILL_BPS = 10_000
SPOT_BALANCED_BONUS_BPS = 1_000
ACTIVE_EPOCH_MIN_FEE = 5 USDC
SPOT_TOTAL_REWARD_CAP_BPS = 3_000
SINGLE_USER_SPOT_CAP_BPS = 500
PAIR_SPOT_CAP_BPS = 1_500
ANCHOR_MAKER_CAP_BPS = 1_000
```

---

## 24. Sonuç

Araf Spot için en güçlü model klasik CEX VIP programını kopyalamak değildir. En güçlü model, Araf’ın mevcut escrow reward mantığını spot’a şu şekilde tercüme etmektir:

```text
Escrow’da barışçıl ve hızlı çözüm ödüllendirilir.
Spot’ta gerçek ve sürekli likidite katkısı ödüllendirilir.
```

Bu planla Araf Spot:

```text
- on-chain trader için ucuz,
- market maker için cazip,
- reward sistemi için sürdürülebilir,
- privacy-first,
- backend-authority’siz,
- global borsa VIP modellerinden farklı ve özgün
```

bir yapıya kavuşur.
