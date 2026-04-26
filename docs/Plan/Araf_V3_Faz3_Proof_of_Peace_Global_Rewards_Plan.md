# Araf V3 Faz 3 — Proof of Peace Global Rewards Plan

**Plan tipi:** Repo gerçekliğine dayalı Faz 3 ürün + kontrat mimarisi  
**Repo:** `MyDemir/Araf-Protokol`  
**Ana tez:** Oracle, hakem veya moderatör olmadan; yalnız `ArafEscrow.sol` contract-authoritative terminal sonuçlarına göre global ödül sistemi kurmak.  
**Ödül kaynağı:** Hazineye giden tüm protokol gelirlerinden minimum `%40`, maksimum `%70` + dışarıdan gelen global/product reward funding.

---

## 0. Yönetici Özeti

Araf Rewards, tekil trade cashback sistemi olmamalıdır.

Doğru model:

```text
Araf Rewards = treasury-backed + externally fundable + global epoch-based incentive layer
```

Bu modelde:

```text
Para hazine gelirinden gelebilir.
Para dış sponsor, ürün, partner veya topluluk fonlamasından gelebilir.
Ama ödül hakkını yalnız ArafEscrow’un contract-authoritative terminal sonucu üretir.
```

Oracle yoktur. Hakem yoktur. Backend authority yoktur. Admin kullanıcı seçmez. Sponsor kullanıcı seçmez.

Amaç:

```text
- Dolandırıcılık davranışlarını pahalılaştırmak
- Başarısız / disputed / burned işlemleri azaltmak
- Clean release ve partial settlement davranışını ödüllendirmek
- Hazine gelirlerini ekosistem teşvikine dönüştürmek
- Dış fonlamayı ekosisteme sokmak
```

---

## 1. Repo Gerçekliği

Bu plan aşağıdaki mevcut repo gerçeklerine dayanır.

### 1.1 `ArafEscrow.sol` mevcut ana authority’dir

Mevcut kontrat:

```text
contracts/src/ArafEscrow.sol
```

Zaten şunları içerir:

```solidity
address public treasury;

uint256 public constant DEFAULT_TAKER_FEE_BPS = 15;
uint256 public constant DEFAULT_MAKER_FEE_BPS = 15;

uint256 public takerFeeBps;
uint256 public makerFeeBps;
```

Trade ve order snapshot alanları vardır:

```solidity
struct Trade {
    uint256 id;
    uint256 parentOrderId;
    address maker;
    address taker;
    address tokenAddress;
    uint256 cryptoAmount;
    uint256 makerBond;
    uint256 takerBond;
    uint16  takerFeeBpsSnapshot;
    uint16  makerFeeBpsSnapshot;
    uint8   tier;
    PaymentRiskLevel paymentRiskLevelSnapshot;
    TradeState state;
    uint256 lockedAt;
    uint256 paidAt;
    uint256 challengedAt;
}
```

Parent order ve child trade ayrımı mevcuttur:

```solidity
struct Order {
    uint256 id;
    address owner;
    OrderSide side;
    address tokenAddress;
    uint256 totalAmount;
    uint256 remainingAmount;
    uint256 minFillAmount;
    uint256 remainingMakerBondReserve;
    uint256 remainingTakerBondReserve;
    uint16  takerFeeBpsSnapshot;
    uint16  makerFeeBpsSnapshot;
    uint8   tier;
    PaymentRiskLevel paymentRiskLevel;
    OrderState state;
    bytes32 orderRef;
}
```

### 1.2 Backend authority değil, mirror katmanıdır

Mevcut backend modeli:

```text
backend/scripts/models/Trade.js
backend/scripts/models/Order.js
backend/scripts/services/eventListener.js
```

Bu dosyalarda tekrar eden mimari ilke:

```text
Backend trade/order state üretmez.
Backend economic authority üretmez.
Backend on-chain event ve getter’ları mirror eder.
```

Bu Faz 3 için korunmalıdır.

### 1.3 Reputation outcome ayrımı mevcuttur

`ArafEscrow.sol` içinde terminal davranış semantiği için zemin vardır:

```solidity
enum ReputationOutcome {
    MANUAL_RELEASE,
    AUTO_RELEASE,
    MUTUAL_CANCEL,
    DISPUTED_RESOLUTION_WIN,
    DISPUTED_RESOLUTION_LOSS,
    BURNED,
    PARTIAL_SETTLEMENT
}
```

Reputation struct şu davranış sayaçlarını taşır:

```solidity
uint32 manualReleaseCount;
uint32 autoReleaseCount;
uint32 mutualCancelCount;
uint32 disputedResolvedCount;
uint32 burnCount;
uint32 disputeWinCount;
uint32 disputeLossCount;
uint32 partialSettlementCount;
uint32 riskPoints;
```

Bu, Proof of Peace için doğru bir zemindir; fakat rewards contract’ın doğrudan okuyacağı ayrı bir `RewardableTradeView` henüz yoktur.

### 1.4 Payment risk davranış skoru değildir

Mevcut kontratta:

```solidity
enum PaymentRiskLevel {
    LOW,
    MEDIUM,
    HIGH,
    RESTRICTED
}
```

Bu alan ödeme rail/jurisdiction operasyonel karmaşıklığıdır; davranışsal reward multiplier olmamalıdır.

Kural:

```text
paymentRiskLevel reward multiplier olarak kullanılmayacak.
```

### 1.5 Rewards / RevenueVault henüz yoktur

Repo aramasında aşağıdaki bileşenler bulunmamıştır:

```text
ArafRewards
ArafRevenueVault
RewardClaimed
StableRevenueReceived
fundGlobalRewards
rewardBps
epochRewardPool
userWeight
totalWeight
claim
```

Bu nedenle Faz 3 doğrudan claim UI veya reward contract ile başlamamalı; önce revenue classification + rewardable trade surface kurulmalıdır.

---

## 2. Ana Game Theory Tezi

Araf Protocol oracle-free bir escrow sistemidir. Bu nedenle sistem dış dünyada gerçekten kimin haklı olduğunu bilemez. Fakat sistem şu davranışları teşvik edebilir:

```text
- Taker hızlı ödeme bildirir.
- Maker hızlı release eder.
- Taraflar dispute/burn yerine partial settlement yapar.
- Auto-release, burn ve challenge oranı azalır.
- Temiz işlem yapan kullanıcılar global reward hakkı kazanır.
```

Ödül sistemi bu yüzden şu şeye hizmet etmelidir:

```text
Contract hakem olduğu için, ekonomik teşvikler tarafları contract’ın ölçebildiği iyi davranışlara yönlendirmelidir.
```

Bu planın en önemli kuralı:

```text
Gelir pool’a girebilir.
Ama kötü veya başarısız outcome weight üretmez.
```

Örnek:

```text
Auto-release penalty reward pool’a kaynak olabilir.
Ama auto-release outcome kullanıcıya reward weight kazandırmaz.
```

Bu ayrım dolandırıcılık ve farming riskini azaltır.

---

## 3. Hazine Gelir Kalemleri

ArafEscrow’daki hazineye gidebilecek kalemler aşağıdaki gibi sınıflandırılmalıdır.

| Gelir / Akış Kalemi | Hazine Geliri mi? | Reward Pool Split | Weight Üretir mi? | Gerekçe |
|---|---:|---:|---:|---|
| Manual clean release fee | Evet | `%40-%70` | Evet | Hedef davranış |
| Fast clean release fee | Evet | `%40-%70` | Evet, yüksek | Hızlı ve temiz çözüm |
| Partial settlement fee | Evet | `%40-%70` | Evet, düşük | Oracle yokken barışçıl uzlaşma |
| Auto-release fee/penalty | Evet | `%40-%70` | Hayır | Gelir olabilir ama ödüllendirilecek davranış değil |
| Disputed release fee | Evet | `%40-%70` | MVP’de hayır | Çatışmalı sonuç |
| Burn / decayed residual treasury’ye gidiyorsa | Evet | `%40-%70` veya Safety Reserve | Hayır | Başarısız outcome |
| Mutual cancel refund | Hayır | Yok | Hayır | Revenue değil, refund |
| Locked principal | Hayır | Yok | Hayır | Kullanıcı fonu |
| Maker/taker bond principal | Hayır | Yok | Hayır | Teminat; sadece penalty kısmı revenue olabilir |

---

## 4. Yeni Global Mimari

```text
ArafEscrow.sol
    |
    | hazineye giden fee / penalty / settlement fee
    v
ArafRevenueVault.sol
    |
    | rewardReserve + treasuryReserve
    v
ArafRewards.sol
    |
    | epoch, userWeight, claim
    v
User Claim
```

Temel karar:

```text
ArafEscrow.treasury = ArafRevenueVault
ArafRevenueVault.finalTreasury = multisig / ops treasury
ArafRevenueVault.rewardBps = 4000-7000
```

Bu sayede mevcut escrow yapısı bozulmadan, hazineye akan gelir önce vault’a uğrar.

---

## 5. Revenue Split Politikası

### 5.1 Minimum ve maksimum oran

```solidity
uint16 public rewardBps = 4000; // %40 başlangıç
uint16 public constant MIN_REWARD_BPS = 4000;
uint16 public constant MAX_REWARD_BPS = 7000;
uint16 public constant BPS = 10_000;
```

Governance / owner yalnız bu aralıkta değiştirebilir:

```solidity
error RewardBpsOutOfRange();

function setRewardBps(uint16 newRewardBps) external onlyOwner {
    if (newRewardBps < MIN_REWARD_BPS || newRewardBps > MAX_REWARD_BPS) {
        revert RewardBpsOutOfRange();
    }

    rewardBps = newRewardBps;

    emit RewardBpsUpdated(newRewardBps);
}
```

### 5.2 Önerilen başlangıç

```text
Mainnet MVP: %40 reward / %60 treasury
Growth dönemi: %50 reward / %50 treasury
Agresif likidite dönemi: %60-%70 reward / %40-%30 treasury
```

Başlangıç önerisi:

```text
rewardBps = 4000
```

Neden?

```text
- Abuse maliyeti gözlemlenmeden pool çok büyütülmez.
- Proof of Peace anlatısı güçlü kalır.
- Treasury sürdürülebilirliği korunur.
```

---

## 6. ArafEscrow.sol Uyum Planı

### 6.1 Yeni revenue kind enum’u

`ArafEscrow.sol` içine eklenmelidir:

```solidity
enum RevenueKind {
    MANUAL_RELEASE_FEE,
    AUTO_RELEASE_FEE_OR_PENALTY,
    PARTIAL_SETTLEMENT_FEE,
    DISPUTED_RELEASE_FEE,
    BURN_RESIDUAL
}
```

### 6.2 Treasury transferleri tek helper’dan geçmeli

Mevcut doğrudan treasury transferleri tek internal helper’a taşınmalıdır:

```solidity
interface IArafRevenueReceiver {
    function onArafRevenue(
        address token,
        uint256 amount,
        uint8 kind,
        uint256 tradeId
    ) external;
}
```

```solidity
error RevenueHookFailed();

function _sendProtocolRevenue(
    address token,
    uint256 amount,
    RevenueKind kind,
    uint256 tradeId
) internal {
    if (amount == 0) return;

    IERC20(token).safeTransfer(treasury, amount);

    if (treasury.code.length > 0) {
        try IArafRevenueReceiver(treasury).onArafRevenue(
            token,
            amount,
            uint8(kind),
            tradeId
        ) {} catch {
            revert RevenueHookFailed();
        }
    }

    emit ProtocolRevenueSent(token, amount, kind, tradeId, treasury);
}
```

Event:

```solidity
event ProtocolRevenueSent(
    address indexed token,
    uint256 amount,
    RevenueKind indexed kind,
    uint256 indexed tradeId,
    address treasury
);
```

### 6.3 Revenue kind mapping

| ArafEscrow path | RevenueKind |
|---|---|
| clean `releaseFunds` | `MANUAL_RELEASE_FEE` |
| `autoRelease` | `AUTO_RELEASE_FEE_OR_PENALTY` |
| `acceptSettlement` | `PARTIAL_SETTLEMENT_FEE` |
| challenged `releaseFunds` | `DISPUTED_RELEASE_FEE` |
| `burnExpired` treasury residual varsa | `BURN_RESIDUAL` |

### 6.4 Mevcut escrow authority bozulmamalı

Kural:

```text
ArafEscrow payout hesaplamaya devam eder.
ArafEscrow fee/penalty üretmeye devam eder.
ArafEscrow terminal outcome üretmeye devam eder.
ArafRevenueVault sadece gelen revenue’yu böler.
```

---

## 7. Rewardable Trade Surface

Mevcut `TradeState` tek başına yeterli değildir:

```solidity
enum TradeState {
    OPEN,
    LOCKED,
    PAID,
    CHALLENGED,
    RESOLVED,
    CANCELED,
    BURNED
}
```

Çünkü `RESOLVED` şu farklı outcome’ları saklayabilir:

```text
- clean manual release
- auto release
- disputed release
- partial settlement
```

Bu yüzden rewards için yeni view gerekir.

### 7.1 TerminalOutcome enum’u

```solidity
enum TerminalOutcome {
    NONE,
    CLEAN_RELEASE,
    AUTO_RELEASE,
    MUTUAL_CANCEL,
    PARTIAL_SETTLEMENT,
    DISPUTED_RELEASE,
    BURNED
}
```

### 7.2 RewardableTradeView struct

```solidity
struct RewardableTradeView {
    uint256 tradeId;
    uint256 parentOrderId;
    address maker;
    address taker;
    address token;
    uint256 stableNotional;
    uint256 takerFeePaid;
    uint256 makerFeePaid;
    uint8 tier;
    TerminalOutcome outcome;
    uint256 lockedAt;
    uint256 paidAt;
    uint256 terminalAt;
    bool hadChallenge;
    bool isOrderChild;
}
```

### 7.3 Getter

```solidity
function getRewardableTrade(uint256 tradeId)
    external
    view
    returns (RewardableTradeView memory);
```

### 7.4 Stable notional

Repo şu an `cryptoAmount` taşır. Desteklenen token’lar USDT/USDC olduğu için bu değer stable notional olarak kullanılabilir, fakat Faz 3 için isimlendirme netleştirilmelidir:

```text
stableNotional = trade.cryptoAmount
```

Eğer ileride stable olmayan token desteklenirse rewards eligibility kapatılmalıdır.

---

## 8. ArafRevenueVault.sol Planı

### 8.1 Görev

`ArafRevenueVault` şunlardan sorumludur:

```text
- ArafEscrow’dan gelen hazine gelirini almak
- Geliri rewardReserve ve treasuryReserve olarak ayırmak
- Minimum %40, maksimum %70 reward split uygulamak
- Dış fonlamayı kabul etmek
- Global ve product/campaign pool’ları yönetmek
- Reward reserve’ü ArafRewards’a tahsis etmek
- Treasury share’i finalTreasury’ye çekilebilir yapmak
```

### 8.2 Minimum state

```solidity
contract ArafRevenueVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    address public immutable escrow;
    address public rewards;
    address public finalTreasury;

    uint16 public rewardBps = 4000;
    uint16 public constant MIN_REWARD_BPS = 4000;
    uint16 public constant MAX_REWARD_BPS = 7000;
    uint16 public constant BPS = 10_000;

    mapping(address token => bool) public supportedToken;

    mapping(address token => uint256) public totalEscrowRevenue;
    mapping(address token => uint256) public rewardReserve;
    mapping(address token => uint256) public treasuryReserve;

    mapping(address token => uint256) public totalExternalFunding;
    mapping(uint256 epoch => mapping(address token => uint256 amount)) public externalFundingByEpoch;
}
```

### 8.3 Escrow revenue receive

```solidity
event EscrowRevenueReceived(
    address indexed token,
    uint256 amount,
    uint256 rewardShare,
    uint256 treasuryShare,
    uint8 indexed kind,
    uint256 indexed tradeId
);

function onArafRevenue(
    address token,
    uint256 amount,
    uint8 kind,
    uint256 tradeId
) external onlyEscrow nonReentrant whenNotPaused {
    if (!supportedToken[token]) revert UnsupportedRewardToken();
    if (amount == 0) return;

    uint256 rewardShare = (amount * rewardBps) / BPS;
    uint256 treasuryShare = amount - rewardShare;

    rewardReserve[token] += rewardShare;
    treasuryReserve[token] += treasuryShare;
    totalEscrowRevenue[token] += amount;

    emit EscrowRevenueReceived(
        token,
        amount,
        rewardShare,
        treasuryShare,
        kind,
        tradeId
    );
}
```

### 8.4 Treasury withdrawal

```solidity
event TreasuryShareWithdrawn(
    address indexed token,
    address indexed to,
    uint256 amount
);

function withdrawTreasuryShare(
    address token,
    address to,
    uint256 amount
) external onlyOwner nonReentrant {
    if (to == address(0)) revert InvalidRecipient();
    if (amount > treasuryReserve[token]) revert InsufficientTreasuryReserve();

    treasuryReserve[token] -= amount;
    IERC20(token).safeTransfer(to, amount);

    emit TreasuryShareWithdrawn(token, to, amount);
}
```

### 8.5 Reward reserve admin tarafından çekilemez

Kural:

```text
rewardReserve[token] yalnız ArafRewards epoch allocation için kullanılabilir.
Owner/admin reward reserve’ü çekemez.
```

---

## 9. Dış Fonlama Sistemi

Bu Faz 3 için kritik bir büyüme özelliğidir.

Örnek:

```text
Bir sponsor / ürün / partner / topluluk 10.000 USDC gönderir.
Bu para global veya product-specific pool’a eklenir.
Sponsor kime gideceğini seçemez.
Dağıtım hakkını yine ArafEscrow terminal outcome belirler.
```

### 9.1 Global external funding

```solidity
event ExternalRewardFunded(
    address indexed funder,
    address indexed token,
    uint256 amount,
    uint256 indexed targetEpoch,
    bytes32 fundingRef
);

function fundGlobalRewards(
    address token,
    uint256 amount,
    uint256 targetEpoch,
    bytes32 fundingRef
) external nonReentrant whenNotPaused {
    if (!supportedToken[token]) revert UnsupportedRewardToken();
    if (amount == 0) revert ZeroAmount();

    _safeTransferExactIn(IERC20(token), msg.sender, amount);

    externalFundingByEpoch[targetEpoch][token] += amount;
    totalExternalFunding[token] += amount;

    emit ExternalRewardFunded(
        msg.sender,
        token,
        amount,
        targetEpoch,
        fundingRef
    );
}
```

### 9.2 Product / campaign funding

```solidity
struct ProductPool {
    bool enabled;
    bytes32 productId;
    string metadataURI;
}

mapping(bytes32 productId => ProductPool) public productPools;
mapping(uint256 epoch => mapping(bytes32 productId => mapping(address token => uint256 amount)))
    public productFundingByEpoch;
```

```solidity
event ProductRewardFunded(
    address indexed funder,
    bytes32 indexed productId,
    address indexed token,
    uint256 amount,
    uint256 targetEpoch,
    bytes32 fundingRef
);

function fundProductRewards(
    bytes32 productId,
    address token,
    uint256 amount,
    uint256 targetEpoch,
    bytes32 fundingRef
) external nonReentrant whenNotPaused {
    if (!productPools[productId].enabled) revert UnsupportedProduct();
    if (!supportedToken[token]) revert UnsupportedRewardToken();
    if (amount == 0) revert ZeroAmount();

    _safeTransferExactIn(IERC20(token), msg.sender, amount);

    productFundingByEpoch[targetEpoch][productId][token] += amount;
    totalExternalFunding[token] += amount;

    emit ProductRewardFunded(
        msg.sender,
        productId,
        token,
        amount,
        targetEpoch,
        fundingRef
    );
}
```

### 9.3 Sponsor sınırları

Sponsor şunları yapabilir:

```text
- Global pool’a fon gönderebilir.
- Product/campaign pool’a fon gönderebilir.
- fundingRef ile kampanya referansı bırakabilir.
```

Sponsor şunları yapamaz:

```text
- Kullanıcı seçemez.
- Weight yazamaz.
- Outcome seçemez.
- Multiplier belirleyemez.
- Claim listesi üretemez.
- Admin gibi davranamaz.
```

---

## 10. ArafRewards.sol Planı

### 10.1 Görev

`ArafRewards` şunları yapar:

```text
- ArafEscrow.getRewardableTrade(tradeId) okur
- Terminal outcome’a göre weight üretir
- userWeight ve totalWeight tutar
- epoch reward pool’unu claim ettirir
- double-record ve double-claim engeller
```

### 10.2 Minimum state

```solidity
contract ArafRewards is Ownable, ReentrancyGuard, Pausable {
    IArafEscrowRewardView public immutable escrow;
    ArafRevenueVault public immutable revenueVault;

    uint256 public epochDuration = 7 days;
    uint256 public claimDelay = 24 hours;

    mapping(uint256 epoch => uint256 totalWeight) public totalWeight;
    mapping(uint256 epoch => mapping(address user => uint256 weight)) public userWeight;

    mapping(uint256 epoch => mapping(address token => uint256 pool)) public epochRewardPool;
    mapping(uint256 epoch => mapping(address user => mapping(address token => bool claimed))) public claimed;

    mapping(uint256 tradeId => bool recordedTrade) public recordedTrade;
}
```

### 10.3 Record trade outcome

```solidity
function recordTradeOutcome(uint256 tradeId) external nonReentrant whenNotPaused {
    if (recordedTrade[tradeId]) revert TradeAlreadyRecorded();

    RewardableTradeView memory t = escrow.getRewardableTrade(tradeId);

    if (t.outcome == TerminalOutcome.NONE) revert TradeNotTerminal();
    if (!t.isOrderChild) revert DirectEscrowNotRewardable();
    if (t.tier == 0) revert TierZeroNotRewardable();

    uint256 makerWeight = _computeMakerWeight(t);
    uint256 takerWeight = _computeTakerWeight(t);

    uint256 epoch = _epochOf(t.terminalAt);

    if (makerWeight > 0) {
        userWeight[epoch][t.maker] += makerWeight;
        totalWeight[epoch] += makerWeight;
    }

    if (takerWeight > 0) {
        userWeight[epoch][t.taker] += takerWeight;
        totalWeight[epoch] += takerWeight;
    }

    recordedTrade[tradeId] = true;

    emit TradeOutcomeRecorded(
        tradeId,
        epoch,
        t.maker,
        t.taker,
        makerWeight,
        takerWeight,
        t.outcome
    );
}
```

---

## 11. Weight Politikası

### 11.1 Outcome multipliers

| Outcome | Weight Multiplier |
|---|---:|
| Clean release, paid → release <= 1 saat | `2.5x` |
| Clean release, paid → release <= 24 saat | `1.5x` |
| Clean release, normal | `1.0x` |
| Clean release, slow | `0.5x` |
| Partial settlement | `0.3x` |
| Mutual cancel | `0x` |
| Auto-release | `0x` |
| Disputed release | `0x` |
| Burned | `0x` |

### 11.2 Tier multipliers

| Tier | Multiplier |
|---|---:|
| Tier 0 | `0x` |
| Tier 1 | `1.0x` |
| Tier 2 | `1.1x` |
| Tier 3 | `1.2x` |
| Tier 4 | `1.3x` |

### 11.3 MVP ilkeleri

```text
Tier 0 reward alamaz.
Auto-release reward alamaz.
Burn reward alamaz.
Mutual cancel reward alamaz.
Disputed release MVP’de reward alamaz.
Partial settlement düşük reward alır.
```

### 11.4 Neden auto-release 0x?

Auto-release bazen mağdur takeri korur; fakat sistemin hedef davranışı maker’ın gönüllü ve hızlı release yapmasıdır.

Auto-release’e reward verilirse bazı aktörler şu davranışa kayabilir:

```text
- maker’ın release etmesini bekletmek
- pingleme ve auto-release sürecini farming’e çevirmek
- reward için pasif konflik üretmek
```

Bu yüzden MVP’de auto-release outcome weight üretmemelidir.

---

## 12. Epoch Pool Hesabı

Her epoch için claim edilebilir pool:

```text
epochRewardPool =
    escrowRevenueRewardShare
  + externalGlobalFunding
  + externalProductFunding
  + previousEpochDust
```

Claim formülü:

```text
claimable = epochRewardPool[epoch][token] * userWeight[epoch][user] / totalWeight[epoch]
```

Kritik kural:

```text
Fon kaynağı değişebilir.
Dağıtım hakkı değişmez.
Hak sahipliği yalnız ArafEscrow terminal outcome’dan gelir.
```

---

## 13. Product Pool Semantiği

Product/campaign funding MVP’de iki şekilde tasarlanabilir.

### Seçenek A — Sadece global boosting

Product funding de global epoch pool’a eklenir; metadata’da productId tutulur.

Artı:

```text
- Basit
- Daha az attack surface
- İlk MVP için güvenli
```

Eksi:

```text
- Product-specific kullanıcı hedeflemesi yok
```

### Seçenek B — Product-scoped eligibility

Product funding yalnız belirli productId ile ilişkili trade’lere dağıtılır.

Bunun için `ArafEscrow` içinde product/order ilişkisi contract-authoritative olmalıdır.

Gereken ek alan:

```solidity
bytes32 productId;
```

veya event-ref ilişkisi:

```solidity
event OrderCreated(
    uint256 indexed orderId,
    address indexed owner,
    OrderSide side,
    address token,
    uint256 totalAmount,
    uint256 minFillAmount,
    uint8 tier,
    PaymentRiskLevel paymentRiskLevel,
    bytes32 orderRef,
    bytes32 productId
);
```

MVP önerisi:

```text
İlk sürümde Seçenek A uygulanmalı.
Product-specific eligibility daha sonra eklenmeli.
```

---

## 14. Security Invariants

### 14.1 Reward split invariant

```text
MIN_REWARD_BPS <= rewardBps <= MAX_REWARD_BPS
```

### 14.2 Accounting invariant

```text
rewardReserve[token] + treasuryReserve[token] + allocatedButUnclaimed[token]
<= IERC20(token).balanceOf(address(vault))
```

### 14.3 No admin drain

```text
Owner rewardReserve çekemez.
Owner sadece treasuryReserve çekebilir.
```

### 14.4 No backend authority

```text
Backend userWeight yazamaz.
Backend reward eligibility yazamaz.
Backend outcome yazamaz.
Backend claim listesi üretemez.
```

### 14.5 No sponsor authority

```text
Sponsor sadece para ekler.
Sponsor kullanıcı seçemez.
Sponsor multiplier belirleyemez.
```

### 14.6 Idempotency

```text
recordedTrade[tradeId] == true ise aynı trade tekrar kaydedilemez.
claimed[epoch][user][token] == true ise aynı claim tekrar yapılamaz.
```

### 14.7 Tier 0 exclusion

```text
tier == 0 ise reward weight = 0.
```

### 14.8 Supported token only

```text
Vault sadece supportedToken kabul eder.
Fee-on-transfer token kabul edilmez.
```

Repo’da fee-on-transfer token güvenliği test edildiği için aynı exact-in yaklaşımı vault transferlerinde de kullanılmalıdır.

---

## 15. Test Planı

### 15.1 ArafEscrow revenue tests

```text
test_releaseFunds_sends_manual_release_fee_with_revenue_kind
test_autoRelease_sends_auto_release_penalty_with_revenue_kind
test_acceptSettlement_sends_partial_settlement_fee_with_revenue_kind
test_challenged_release_sends_disputed_release_fee_with_revenue_kind
test_burnExpired_sends_burn_residual_kind_if_applicable
```

### 15.2 RewardableTradeView tests

```text
test_getRewardableTrade_clean_release
test_getRewardableTrade_auto_release
test_getRewardableTrade_partial_settlement
test_getRewardableTrade_mutual_cancel
test_getRewardableTrade_burned
test_getRewardableTrade_direct_escrow_exclusion
```

### 15.3 RevenueVault tests

```text
test_rewardBps_cannot_go_below_40_percent
test_rewardBps_cannot_go_above_70_percent
test_onArafRevenue_splits_40_60_initially
test_treasury_can_only_withdraw_treasuryReserve
test_rewardReserve_cannot_be_admin_drained
test_external_global_funding_adds_to_epoch
test_external_product_funding_adds_to_product_epoch
test_fee_on_transfer_token_reverts
test_unsupported_token_reverts
```

### 15.4 Rewards tests

```text
test_recordTradeOutcome_clean_release_adds_weight
test_recordTradeOutcome_partial_settlement_adds_low_weight
test_recordTradeOutcome_auto_release_zero_weight
test_recordTradeOutcome_burned_zero_weight
test_recordTradeOutcome_mutual_cancel_zero_weight
test_recordTradeOutcome_tier0_zero_weight
test_recordTradeOutcome_reverts_double_record
test_claim_reverts_before_claim_delay
test_claim_reverts_double_claim
test_claim_distributes_global_pool_pro_rata
test_external_funding_increases_claimable_amount
```

---

## 16. Backend Planı

Backend yalnız mirror ve analytics yapar.

Yeni read-model alanları:

```text
RewardEpoch
RewardFunding
RewardClaim
RevenueEvent
ProductRewardCampaign
```

Backend endpoint önerileri:

```text
GET /api/rewards/epochs/current
GET /api/rewards/epochs/:epoch
GET /api/rewards/:wallet/claimable
GET /api/rewards/:wallet/history
GET /api/rewards/funding/global
GET /api/rewards/funding/product/:productId
GET /api/admin/revenue
GET /api/admin/rewards/health
```

Backend yazmamalı:

```text
userWeight
totalWeight
claimable authority
eligibility
terminal outcome
```

---

## 17. Frontend Planı

Kullanıcı tarafı:

```text
- Current epoch reward pool
- My reward weight
- My claimable rewards
- Eligible completed trades
- Claim button
- Proof of Peace explanation
```

Sponsor / partner tarafı:

```text
- Fund global rewards
- Fund product/campaign rewards
- Select token: USDT/USDC
- Select epoch
- Enter amount
- fundingRef / campaign metadata
```

Admin tarafı:

```text
- Revenue split %
- Treasury reserve
- Reward reserve
- External funding totals
- Product pool totals
- Unrecorded terminal trades
- Epoch health
- Claim health
```

---

## 18. PR Sırası

### PR-1

```text
feat(escrow): classify protocol revenue before treasury transfer
```

Amaç:

```text
ArafEscrow’daki hazine gelirlerini RevenueKind ile işaretlemek.
```

### PR-2

```text
feat(escrow): expose rewardable terminal trade view
```

Amaç:

```text
ArafRewards’ın backend’e ihtiyaç duymadan outcome okuması.
```

### PR-3

```text
feat(revenue): add treasury revenue vault with 40-70 reward split
```

Amaç:

```text
Hazineye giden tüm gelirlerden minimum %40 maksimum %70 reward share ayırmak.
```

### PR-4

```text
feat(revenue): add external global and product reward funding
```

Amaç:

```text
Dış sponsor / ürün / partner fonlarının pool’a girmesi.
```

### PR-5

```text
feat(rewards): add global epoch weight accounting
```

Amaç:

```text
Contract terminal outcome’a göre userWeight üretmek.
```

### PR-6

```text
feat(rewards): add epoch finalize and claim
```

Amaç:

```text
Kullanıcıların epoch bazlı claim yapması.
```

### PR-7

```text
feat(backend): mirror rewards, revenue, and funding events
```

Amaç:

```text
Backend read-model ve analytics katmanını eklemek.
```

### PR-8

```text
feat(frontend): add rewards dashboard and sponsor funding UI
```

Amaç:

```text
Claim, reward pool, sponsor deposit ve product campaign arayüzlerini eklemek.
```

---

## 19. Migration Planı

### 19.1 Deploy sırası

```text
1. ArafEscrow revenue hook değişiklikleri deploy edilir.
2. ArafRevenueVault deploy edilir.
3. ArafRewards deploy edilir.
4. ArafRevenueVault.rewards set edilir.
5. ArafEscrow.treasury = ArafRevenueVault yapılır.
6. Supported reward tokens set edilir.
7. rewardBps = 4000 ile başlanır.
8. Backend event listener ABI güncellenir.
9. Frontend reward dashboard açılır.
```

### 19.2 Rollout

```text
Phase A: Read-only reward analytics
Phase B: External funding enabled, claim disabled
Phase C: Revenue split enabled, recordTradeOutcome enabled
Phase D: Claim enabled
Phase E: Product pool enabled
```

---

## 20. MVP Parametreleri

```text
rewardBps = 4000
epochDuration = 7 days
claimDelay = 24 hours
supportedTokens = USDT, USDC
tier0RewardEligible = false
autoReleaseRewardEligible = false
burnRewardEligible = false
mutualCancelRewardEligible = false
disputedReleaseRewardEligible = false
partialSettlementMultiplier = 0.3x
cleanFastReleaseMultiplier = 2.5x
clean24hReleaseMultiplier = 1.5x
cleanStandardReleaseMultiplier = 1.0x
cleanSlowReleaseMultiplier = 0.5x
```

---

## 21. Nihai Mimari Cümlesi

```text
Araf Rewards, tekil trade cashback sistemi değildir.
ArafEscrow’dan hazineye akan tüm protokol gelirlerinin %40-%70 arası bir kısmını
ve dışarıdan gelen global/product fonları,
contract-authoritative clean behavior gösteren kullanıcılara epoch bazlı dağıtan
Proof of Peace incentive layer’dır.
```

Kritik güvenlik cümlesi:

```text
Fon kaynağı çoklu olabilir.
Hak sahipliği tek kaynaktan gelir: ArafEscrow terminal outcome.
```
