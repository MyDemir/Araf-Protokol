# Araf V3 — Faz 2 Repo-Teyitli Uygulanabilir Ürün ve Geliştirme Raporu

Hazırlanma tarihi: 24 Nisan 2026  
Repo: `MyDemir/Araf-Protokol`  
Odak: Faz 2 — Simetrik çözüm semantiği, coarse payment risk class ve reputation signal separation

---

## 1. Yönetici özeti

Faz 2 artık sıfırdan tasarlanacak bir fikir paketi değil. Güncel repo incelendiğinde Faz 0 ve Faz 1 zemininin önemli bir bölümünün zaten kodda yer aldığı görülüyor:

- V3 parent order + child trade ayrımı kurulmuş.
- Child trade gerçek escrow lifecycle olarak modellenmiş.
- Payout/profile snapshot alanları backend modelinde mevcut.
- Banka profili değişim riski trade-scoped ve non-authoritative biçimde türetiliyor.
- Admin panel read-only observability çizgisinde ilerliyor.
- Reputation artık tek sayı olmaktan çıkmış; contract/backend/frontend seviyesinde ayrıştırılmış sayaçlara doğru evrilmiş.
- Locked / Paid / Challenged hızlı erişim mantığı frontend’de aktif işlem odalarına yönlendirme amacıyla zaten uygulanmış.

Bu nedenle Faz 2’nin gerçek odağı şu olmalı:

> Araf, insan hakemi olmadan iki tarafın imzasıyla kontrollü partial settlement üretebilmeli; payment risk class’ı görünür ve sınırlı ekonomik parametre olarak taşımalı; reputation semantiğini partial settlement olaylarıyla tamamlamalıdır.

En kritik bulgu: `SettlementProposal`, `splitBps`, partial/agreed settlement için on-chain struct, event, endpoint veya frontend akışı henüz implementasyon dosyalarında görünmüyor. Bu yüzden Faz 2’nin ilk ana paketi partial settlement olmalıdır.

---

## 2. Repo teyit özeti

### 2.1 Kontrat katmanı

Dosya: `contracts/src/ArafEscrow.sol`

Teyit edilen mevcut zemin:

- `TradeState` şu durumları içeriyor: `OPEN`, `LOCKED`, `PAID`, `CHALLENGED`, `RESOLVED`, `CANCELED`, `BURNED`.
- Parent order yapısı mevcut: `OrderSide`, `OrderState`, `Order` struct.
- Child trade parent order’dan doğuyor ve gerçek escrow lifecycle’ı taşıyor.
- Fee snapshot alanları mevcut: `takerFeeBpsSnapshot`, `makerFeeBpsSnapshot`.
- `MAX_FEE_CONFIG_BPS = 2_000` ile owner fee tavanı daraltılmış.
- `cleanPeriod = 90 days` constructor default olarak mevcut.
- Reputation struct ayrıştırılmış: `manualReleaseCount`, `autoReleaseCount`, `mutualCancelCount`, `disputedResolvedCount`, `burnCount`, `disputeWinCount`, `disputeLossCount`, `riskPoints`.
- `ReputationUpdated` event’i bu sayaçları dışarı yayıyor.

Eksik kalan Faz 2 alanı:

- `SettlementProposal` yok.
- `splitBps` yok.
- `PARTIAL_SETTLED` veya `SETTLEMENT_PROPOSED` benzeri state yok.
- Partial settlement finalize fonksiyonu yok.
- Payment risk class on-chain order/trade snapshot alanı olarak yok.
- Partial settlement’e özel reputation counter yok.

Ürün kararı:

Kontratta reputation separation önemli ölçüde başlamış durumda. Faz 2’de contract-level reputation separation sıfırdan yapılmamalı; mevcut struct korunup partial settlement semantiğiyle genişletilmeli.

---

### 2.2 Backend user/payout profili

Dosyalar:

- `backend/scripts/models/User.js`
- `backend/scripts/routes/auth.js`

Teyit edilen mevcut zemin:

- `payout_profile.rail` enum’u `TR_IBAN`, `US_ACH`, `SEPA_IBAN` ile sınırlı.
- `country`, `contact`, `payout_details_enc`, `fingerprint` alanları mevcut.
- Payout details AES-256-GCM ile şifreleniyor.
- `profileVersion`, `lastBankChangeAt`, `bankChangeCount7d`, `bankChangeCount30d` alanları mevcut.
- Banka profili değişim geçmişi public profile’a sızdırılmıyor.
- Aktif `LOCKED / PAID / CHALLENGED` trade varken payout profile değişimi engelleniyor.
- `PROFILE_SCHEMA`, TR, US ve SEPA rail validation kurallarını uyguluyor.

Ürün kararı:

Bu katman Faz 2 için yeterli temel sağlar. Payment risk class globalleşecekse aynı dosyada hard-code büyütmek yerine ayrı bir `paymentRailRiskConfig` / `jurisdictionRailConfig` katmanı açılmalıdır.

---

### 2.3 Backend trade modeli ve risk görünürlüğü

Dosyalar:

- `backend/scripts/models/Trade.js`
- `backend/scripts/routes/trades.js`
- `backend/scripts/routes/tradeRisk.js`

Teyit edilen mevcut zemin:

- Trade modeli child trade mirror olarak kurulmuş.
- `payout_snapshot.maker` ve `payout_snapshot.taker` alanları var.
- Snapshot içinde rail, country, fingerprint hash, profile version, bank change count ve reputation context tutuluyor.
- `trades.js` güvenli projection ile hassas alanları filtreliyor.
- `_attachBankProfileRisk()` trade response’larına `bank_profile_risk` ve `offchain_health_score_input` ekliyor.
- `tradeRisk.js` katmanı açıkça `readOnly`, `nonBlocking`, `canBlockProtocolActions: false`, `informational_only: true`, `non_authoritative_semantics: true` dönüyor.
- Cancel flow backend’de yalnız EIP-712 signature coordination ve audit rolü üstleniyor; kontrat yerine cancel yapmıyor.

Eksik kalan Faz 2 alanı:

- `settlement_proposal` alanı yok.
- Settlement proposal endpoint’i yok.
- `splitBps` snapshot veya audit alanı yok.
- Partial settlement history yok.

Ürün kararı:

Mevcut backend risk katmanı doğru yerde duruyor: karar verici değil. Faz 2’de settlement backend’i de aynı felsefeyle kurulmalı: fon dağıtımı backend tarafından belirlenmemeli; backend yalnız proposal read-model, signature coordination ve audit yüzeyi olmalı.

---

### 2.4 Backend orders ve market trust visibility

Dosyalar:

- `backend/scripts/models/Order.js`
- `backend/scripts/routes/orders.js`

Teyit edilen mevcut zemin:

- Parent order read model mevcut.
- Order tarafı `SELL_CRYPTO / BUY_CRYPTO` olarak side-aware.
- Market feed `trust_visibility_summary` üretiyor.
- Bu summary `GREEN / YELLOW / RED` band mantığına yakın şekilde compact taker-facing sinyal üretiyor.
- Summary privacy-conscious ve read-only.
- `orders/config` bond, fee, cooldown ve token config döndürüyor.

Eksik kalan Faz 2 alanı:

- Order’da `paymentRiskLevel` yok.
- Rail/jurisdiction risk config yok.
- Bond/fee preview payment risk class’a göre ayrışmıyor.

Ürün kararı:

Payment risk class ilk aşamada order create UX ve backend config ile görünür hale getirilmeli; ardından on-chain coarse snapshot ve fiyatlama açılmalı. Davranışsal risk kesinlikle kontrata taşınmamalı.

---

### 2.5 Admin observability

Dosya: `backend/scripts/routes/admin.js`

Teyit edilen mevcut zemin:

- Admin route auth + wallet allowlist ile korunuyor.
- `/summary`, `/feedback`, `/trades` endpoint’leri mevcut.
- Readiness, DLQ, worker, scheduler state, active trade counts, incomplete snapshot, feedback listesi ve risk-enriched trade listesi dönüyor.
- Admin yüzeyi read-only gözlem çizgisinde.

Eksik kalan Faz 2 alanı:

- Active settlement proposal listesi yok.
- Expired proposal listesi yok.
- Settlement abuse/spam gözlemi yok.
- Split oran dağılımı analitiği yok.

Ürün kararı:

Admin panel Faz 2’de settlement observability ile genişletilmeli; settlement outcome override kesinlikle eklenmemeli.

---

### 2.6 Frontend

Dosyalar:

- `frontend/src/App.jsx`
- `frontend/src/app/useAppSessionData.jsx`
- `frontend/src/app/AppViews.jsx`

Teyit edilen mevcut zemin:

- Frontend `LOCKED`, `PAID`, `CHALLENGED` durumlarını hızlı erişim akordiyonu olarak gösteriyor.
- Bu durumlar işlem felsefesi değil, kullanıcının aktif odalarına kısa erişim filtresi olarak çalışıyor.
- `useAppSessionData` aktif escrows datasını backend’den çekiyor.
- `offchainHealthScoreInput` ve `bankProfileRisk` payload’ları frontend state’e taşınıyor.
- `mapReputationToSessionView` contract authority counter’larını frontend’e paketliyor.
- Payout profile frontend canonicalizer TR/US/SEPA rail alanlarını normalize ediyor.
- `ReferenceRateTicker` marketplace görünümüne entegre.

Eksik kalan Faz 2 alanı:

- Settlement sekmesi yok.
- Settlement proposal card yok.
- Split preview yok.
- Accept/reject/withdraw/counter-offer UI yok.
- Settlement history yok.
- Payment risk class selector veya preview yok.

Ürün kararı:

Frontend tarafında Faz 2’nin ana işi yeni “settlement lane” açmaktır. Existing Locked/Paid/Challenged yapısı korunmalı; yanına `Settlement` hızlı erişim filtresi eklenmelidir.

---

## 3. Faz 2 yeni ürün tanımı

Faz 2 ürün cümlesi:

> Araf, anlaşmazlığı insan hakemine taşımaz; iki tarafın imzasıyla, audit edilebilir ve geri alınamaz controlled settlement yolu açar.

Bu faz üç modüle ayrılmalı:

1. Partial settlement / `SettlementProposal` / `splitBps`
2. Payment risk class / coarse rail risk / bond-fee preview
3. Reputation event taxonomy extension

---

## 4. Modül A — Partial Settlement

### 4.1 Neden birinci öncelik?

Repo zaten risk visibility ve admin observability tarafında iyi bir zemin kurmuş. Eksik olan parça, anlaşmazlık büyüdüğünde insan hakemi olmadan binary olmayan çıkış yoludur.

Mevcut akışta kullanıcılar temel olarak şu sonuçlara gider:

- Release
- Cancel
- Challenge / burn / timeout

Faz 2’de yeni sonuç:

- Agreed partial settlement

### 4.2 Ürün gereksinimi

Trade room içinde iki tarafın da görebileceği bir `Settlement Proposal` alanı açılmalı.

Temel aksiyonlar:

- Teklif oluştur
- Teklifi geri çek
- Teklifi reddet
- Teklifi kabul et
- Süresi dolan teklifi expired say
- Kabul sonrası on-chain finalization

MVP’de counter-offer ayrı teklif olarak modellenebilir; nested negotiation gerekmez.

### 4.3 Önerilen on-chain tasarım

Yeni enum:

```solidity
enum SettlementProposalState {
    NONE,
    PROPOSED,
    ACCEPTED,
    REJECTED,
    WITHDRAWN,
    EXPIRED,
    FINALIZED
}
```

Yeni struct:

```solidity
struct SettlementProposal {
    uint256 id;
    uint256 tradeId;
    address proposer;
    uint16 makerShareBps;
    uint16 takerShareBps;
    uint64 proposedAt;
    uint64 expiresAt;
    SettlementProposalState state;
}
```

Not:

- `makerShareBps + takerShareBps = 10_000` olmalı.
- `splitBps` tek başına ambiguous olabilir. Daha okunabilir model: `makerShareBps` + `takerShareBps`.
- Eğer tek alan kullanılacaksa adı `makerShareBps` olmalı; bu, split’in yönünü netleştirir.

Yeni mapping:

```solidity
mapping(uint256 => SettlementProposal) public settlementProposalsByTrade;
mapping(uint256 => uint256) public settlementProposalNonceByTrade;
```

Yeni event’ler:

```solidity
event SettlementProposed(
    uint256 indexed tradeId,
    uint256 indexed proposalId,
    address indexed proposer,
    uint16 makerShareBps,
    uint16 takerShareBps,
    uint256 expiresAt
);

event SettlementRejected(uint256 indexed tradeId, uint256 indexed proposalId, address indexed rejecter);
event SettlementWithdrawn(uint256 indexed tradeId, uint256 indexed proposalId, address indexed proposer);
event SettlementFinalized(
    uint256 indexed tradeId,
    uint256 indexed proposalId,
    uint256 makerPayout,
    uint256 takerPayout,
    uint256 takerFee,
    uint256 makerFee
);
```

### 4.4 Hangi state’lerde teklif açılmalı?

MVP kararı:

- `LOCKED`: Açılabilir
- `PAID`: Açılabilir
- `CHALLENGED`: Açılabilir
- `RESOLVED / CANCELED / BURNED`: Açılamaz
- `OPEN`: Açılamaz

Neden?

Araf’ın aktif risk alanı child trade lock olduktan sonra başlıyor. Settlement de yalnız gerçek escrow oluşunca anlamlıdır.

### 4.5 Fon dağıtım ilkesi

Partial settlement, normal release/cancel/burn mantığını bypass eden gizli bir karar motoru olmamalı. Sadece iki tarafın imzasıyla aktifleşmeli.

Önerilen dağıtım:

- `cryptoAmount + makerBond + takerBond` settlement pool olarak ele alınmalı.
- Fee modeli mevcut `takerFeeBpsSnapshot` / `makerFeeBpsSnapshot` ile uyumlu netleştirilmeli.
- Fee alınacaksa hem preview hem event’te net gösterilmeli.
- Fee alınmayacaksa bu da protokol kararı olarak açıkça sabitlenmeli.

MVP için daha güvenli tasarım:

- Partial settlement yalnız principal + bond pool üzerinde split uygulasın.
- Mevcut fee snapshot semantiği korunarak treasury kesintisi tek yerde hesaplanmalı.
- Rounding remainder deterministik olarak treasury’ye değil, protokolde önceden belirlenen tarafa veya son ödeme alıcısına gitmeli.

### 4.6 Abuse guardrail

Kontrat seviyesi:

- Trade başına tek aktif proposal
- Minimum expiry
- Maximum expiry
- Aynı proposer için cooldown
- Terminal state check
- `makerShareBps + takerShareBps == 10_000`
- Proposal accept yalnız karşı tarafça yapılabilir
- Withdraw yalnız proposer tarafından yapılabilir
- Reject yalnız karşı tarafça yapılabilir

Backend/UI seviyesi:

- Teklif geçmişi gösterimi
- Net payout preview
- Kabul öncesi final modal
- Spam teklif sayacı
- Admin read-only proposal monitor

### 4.7 Backend yapılacaklar

Dosyalar:

- `backend/scripts/models/Trade.js`
- `backend/scripts/routes/trades.js`
- `backend/scripts/services/eventListener.js`
- `backend/scripts/routes/admin.js`

Trade model ek alan:

```js
settlement_proposal: {
  proposal_id: String,
  state: String,
  proposed_by: String,
  maker_share_bps: Number,
  taker_share_bps: Number,
  proposed_at: Date,
  expires_at: Date,
  finalized_at: Date,
  maker_payout: String,
  taker_payout: String,
  tx_hash: String
}
```

Trades route ek endpoint’ler:

- `GET /api/trades/:id/settlement-proposal`
- `POST /api/trades/:id/settlement-proposal/preview`

Not:

On-chain proposal tx kullanıcı cüzdanından gönderilmeli. Backend endpoint state-changing authority olmamalı. Backend yalnız preview, read-model ve audit sağlar.

### 4.8 Frontend yapılacaklar

Dosyalar:

- `frontend/src/App.jsx`
- `frontend/src/app/useAppSessionData.jsx`
- `frontend/src/app/AppViews.jsx`
- Yeni: `frontend/src/components/SettlementProposalCard.jsx`
- Yeni: `frontend/src/components/SettlementPreviewModal.jsx`

UI parçaları:

- Trade room settlement card
- Split slider veya iki alanlı yüzde input
- Net payout preview
- Accept/reject/withdraw buttons
- Expiry countdown
- Proposal history
- Settlement hızlı erişim filtresi

Copy:

```text
Araf bu dağılıma senin yerine karar vermez. Karşı taraf kabul ederse işlem bu oranla on-chain kapanır.
```

---

## 5. Modül B — Payment Risk Class

### 5.1 Repo durumu

Mevcut repo payment rail validation açısından olgunlaşmış: TR_IBAN, US_ACH ve SEPA_IBAN net biçimde destekleniyor. Ancak order veya trade üzerinde `paymentRiskLevel` yok.

### 5.2 Ürün kararı

`paymentRiskLevel` davranışsal kullanıcı skoru değildir. Şunu temsil eder:

> Seçilen payment rail / jurisdiction / trade method kombinasyonunun operasyonel ve uyuşmazlık karmaşıklığı.

Önerilen değerler:

- `LOW`
- `MEDIUM`
- `HIGH`
- `RESTRICTED`

### 5.3 İlk aşama: backend/UI config

Yeni dosya önerisi:

- `backend/scripts/config/paymentRailRiskConfig.js`

Örnek config:

```js
module.exports = {
  TR: {
    TR_IBAN: {
      riskLevel: "MEDIUM",
      minBondSurchargeBps: 0,
      feeSurchargeBps: 0,
      warningKey: "BANK_TRANSFER_CAN_BE_REVERSED_OR_DELAYED",
      enabled: true,
    },
  },
  US: {
    US_ACH: {
      riskLevel: "HIGH",
      minBondSurchargeBps: 50,
      feeSurchargeBps: 0,
      warningKey: "ACH_REVERSAL_AND_SETTLEMENT_DELAY_RISK",
      enabled: true,
    },
  },
  EU: {
    SEPA_IBAN: {
      riskLevel: "MEDIUM",
      minBondSurchargeBps: 0,
      feeSurchargeBps: 0,
      warningKey: "SEPA_TRANSFER_CONFIRMATION_REQUIRED",
      enabled: true,
    },
  },
};
```

Yeni endpoint:

- `GET /api/orders/payment-risk-config`

Frontend:

- Order create modal içinde payment rail seçimi
- Risk class açıklaması
- Bond/fee preview
- Taker tarafında compact warning

### 5.4 İkinci aşama: on-chain coarse snapshot

Kontrat extension:

```solidity
enum PaymentRiskLevel {
    LOW,
    MEDIUM,
    HIGH,
    RESTRICTED
}
```

Order struct’a:

```solidity
PaymentRiskLevel paymentRiskLevel;
```

Trade struct’a:

```solidity
PaymentRiskLevel paymentRiskLevelSnapshot;
```

Event’lere eklenmeli:

- `OrderCreated`
- `OrderFilled`

Önemli:

- Davranışsal risk kontrata taşınmamalı.
- Backend health score kontrat sonucunu değiştirmemeli.
- `RESTRICTED` on-chain create’i engellemek yerine frontend/backend availability config ile yönetilmeli; kontratta yalnız geçerli enum olmalı veya hiç kabul edilmemeli.

---

## 6. Modül C — Reputation taxonomy extension

### 6.1 Repo durumu

Mevcut contract/backend/frontend zaten şu sayaçları taşıyor:

- manual release
- auto release
- mutual cancel
- disputed resolved
- burn
- dispute win/loss
- risk points

Bu Faz 2 için güçlü zemin.

Eksik olan settlement-specific sayaçlar:

- `partialSettlementCount`
- `settlementProposalAcceptedCount`
- `settlementProposalRejectedCount`
- `settlementProposalWithdrawnCount`
- opsiyonel: `settlementAsProposerCount`

### 6.2 Önerilen minimal ekleme

Kontrat `Reputation` struct:

```solidity
uint32 partialSettlementCount;
```

Event:

```solidity
ReputationUpdated(..., uint256 partialSettlementCount, ...)
```

Backend `User.js`:

```js
partial_settlement_count: { type: Number, default: 0, min: 0 }
```

Frontend `mapReputationToSessionView`:

```js
partialSettlementCount: Number(repData.partialSettlementCount ?? 0n)
```

Market/UI gösterimi:

- Maker detailed breakdown’da görünür.
- Taker tarafında tek başına kırmızı sinyal olmamalı.
- Çok yüksek partial settlement oranı varsa `YELLOW` reason olarak değerlendirilebilir.

Ürün yorumu:

Partial settlement kötü değil; çoğu zaman sağlıklı anlaşmadır. Bu yüzden `partialSettlementCount` risk cezası değil, olay semantiğidir.

---

## 7. Sprint planı

### Sprint 1 — Contract settlement core

Dosya:

- `contracts/src/ArafEscrow.sol`

İşler:

- Settlement enum/struct ekle
- Proposal mapping ekle
- Events ekle
- `proposeSettlement()` ekle
- `rejectSettlement()` ekle
- `withdrawSettlement()` ekle
- `acceptSettlement()` veya `finalizeSettlement()` ekle
- Split/payout hesaplarını test et
- Terminal state guard ekle

Acceptance criteria:

- LOCKED/PAID/CHALLENGED trade için settlement teklif oluşturulabiliyor.
- Karşı taraf kabul etmeden fon hareketi olmuyor.
- Kabul sonrası trade terminal state’e geçiyor.
- ReentrancyGuard ve CEI korunuyor.
- Fee/payout event parametreleri doğru sırada emit ediliyor.

---

### Sprint 2 — Backend settlement mirror

Dosyalar:

- `backend/scripts/models/Trade.js`
- `backend/scripts/services/eventListener.js`
- `backend/scripts/routes/trades.js`
- `backend/scripts/routes/admin.js`

İşler:

- `settlement_proposal` read model ekle
- Event ABI’ye settlement event’lerini ekle
- Worker handler’larını ekle
- Safe projection’a settlement alanlarını ekle
- `GET settlement proposal` ve `preview` endpoint’i ekle
- Admin trades response’a settlement state ekle

Acceptance criteria:

- On-chain proposal event’i Mongo trade mirror’a düşüyor.
- Frontend aktif trade içinde settlement state okuyabiliyor.
- Admin proposal’ları read-only görebiliyor.
- Backend fon dağıtımı kararı üretmiyor.

---

### Sprint 3 — Frontend settlement UX

Dosyalar:

- `frontend/src/App.jsx`
- `frontend/src/app/useAppSessionData.jsx`
- `frontend/src/app/AppViews.jsx`
- `frontend/src/hooks/useArafContract.js`
- Yeni components

İşler:

- Contract hook’a settlement write/read fonksiyonları ekle
- Active trade mapper’a settlement payload ekle
- Trade room settlement card ekle
- Preview modal ekle
- Settlement hızlı erişim filtresi ekle
- Proposal countdown ekle
- Kabul/reddet/geri çek akışı ekle

Acceptance criteria:

- Kullanıcı split teklifini anlayarak oluşturabiliyor.
- Karşı taraf net payout görmeden kabul edemiyor.
- Settlement aktif trade listesinde ayrı filtrelenebiliyor.
- Kullanıcıya “Araf karar vermez, iki taraf imzalar” dili tutarlı gösteriliyor.

---

### Sprint 4 — Payment risk config

Dosyalar:

- `backend/scripts/config/paymentRailRiskConfig.js`
- `backend/scripts/routes/orders.js`
- `frontend/src/app/AppModals.jsx` veya order create modal dosyası
- `frontend/src/app/orderUiModel.js`

İşler:

- Rail/country risk config ekle
- Orders config response’a payment risk config ekle
- Order create UI’da risk class göster
- Taker order detail’de risk warning göster
- Bond/fee preview alanı ekle

Acceptance criteria:

- Payment risk class kullanıcıya görünüyor.
- Risk class kullanıcı hakkında kesin hüküm gibi yazılmıyor.
- Davranışsal risk kontrata taşınmıyor.

---

### Sprint 5 — Reputation settlement extension

Dosyalar:

- `contracts/src/ArafEscrow.sol`
- `backend/scripts/models/User.js`
- `backend/scripts/services/eventListener.js`
- `backend/scripts/routes/tradeRisk.js`
- `frontend/src/app/useAppSessionData.jsx`
- Admin/user profile UI

İşler:

- `partialSettlementCount` counter ekle
- EventListener mirror update ekle
- Trust breakdown’a settlement satırı ekle
- Taker summary’de settlement yoğunluğu için hafif uyarı kuralı ekle

Acceptance criteria:

- Partial settlement negatif reputation gibi davranmıyor.
- Ancak yüksek oranlı settlement davranışı açıklanabilir event olarak görünüyor.
- Tüm katmanlarda field isimleri tutarlı.

---

## 8. Yapılmaması gerekenler

Bu Faz 2’de özellikle kaçınılmalı:

- Backend/admin tarafından settlement outcome override.
- Health score’a göre otomatik fon dağıtımı.
- Banka profili değişimine göre on-chain ceza.
- `paymentRiskLevel`’ı kullanıcı güven puanı gibi göstermek.
- Partial settlement’i cancel flow’un küçük yaması gibi yazmak.
- Proposal spam’ini tamamen UI’da bırakmak.
- Settlement’i `CANCELED` veya `RESOLVED` içine semantik kayıp yaratacak şekilde gömmek.

---

## 9. Final karar

Güncel repo Faz 2’ye düşündüğümüzden daha hazır. Settlement integrity, payout snapshot, non-authoritative risk visibility ve read-only admin observability tarafında güçlü temel var.

Bu yüzden Faz 2 şu sırayla uygulanmalı:

1. Partial settlement on-chain core
2. Settlement backend mirror ve admin observability
3. Settlement frontend UX
4. Payment rail risk config
5. Coarse payment risk on-chain snapshot
6. Partial settlement reputation taxonomy

Araf’ın global ürün farkı bu faz sonunda şöyle netleşmeli:

> Araf, tarafları doğrulayan veya kimin haklı olduğuna karar veren bir platform değildir. Araf, karşı tarafa tam güvenmeden işlem yapılabilmesi için riski görünür kılar, fonları kontrat kurallarına bağlar ve uyuşmazlıkta iki tarafın imzasıyla kontrollü settlement sağlar.
