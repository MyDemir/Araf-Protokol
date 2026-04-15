# Araf Protokol Mimarisi (Kanonik V3)

> **Durum:** `main` branch’inin fiili durumuna göre kanonik teknik mimari dokümanıdır.
>
> **Gerçeklik kuralı:** Otorite kontrattadır. Backend/doküman/frontend kontrat gerçeğine uyar.

---

## 1) Vizyon ve temel felsefe

Araf; **non-custodial**, **oracle-free**, **insan hakemsiz** bir protokoldür.

Sert kurallar:
- **Tek authoritative state machine kontrattır.**
- **Backend protocol authority üretmez.** Sadece mirror, koordinasyon ve gizlilik katmanıdır.
- **Frontend enforcement katmanı değildir.**
- **Code is law:** Backend/frontend niyeti, `ArafEscrow.sol` ile çelişirse kontrat geçerlidir.
- **Dürüstsüzlük ekonomik olarak pahalılaştırılır** (bond, ceza, decay, burn).

---

## 2) Canonical V3 architecture

V3 açıkça iki katmanlı on-chain modeldir:

1. **Parent Order Layer (kamusal likidite / market intent)**
   - Public market keşif katmanı.
   - Kanonik kimlikler: `orderId`, `orderRef`.
2. **Child Trade Layer (gerçek escrow lifecycle)**
   - Her fill, gerçek escrow yaşam döngüsünü taşıyan child trade üretir.
   - Kanonik kimlikler: `tradeId` (escrow id), `parentOrderId`.

Kanonik akış:
- `createSellOrder` / `createBuyOrder` parent order likiditesini açar.
- `fillSellOrder` / `fillBuyOrder` child trade üretir ve `OrderFilled` emit eder.
- Child yaşam döngüsü `reportPayment`, `releaseFunds`, `challengeTrade`, `proposeOrApproveCancel`, `autoRelease`, `burnExpired` ile yönetilir.

---

## 3) Authority boundaries

### 3.1 Authoritative
- `contracts/src/ArafEscrow.sol`.

### 3.2 Mirrored (authoritative değil)
- `backend/scripts/services/eventListener.js`: event tabanlı mirror worker.
- `backend/scripts/models/Order.js`, `backend/scripts/models/Trade.js`: read model deposu.

### 3.3 Derived
- `orders.js`, `trades.js`, stats/analytics ve UI card projeksiyonları.

### 3.4 Deprecated
- `backend/scripts/routes/listings.js`: compatibility alias/read katmanı.

---

## 4) Contract-first state machine

V3 kontratı şunların tek kaynağıdır:
- parent order create/fill/cancel geçişleri,
- child trade lifecycle geçişleri,
- reputation gate ve anti-sybil kontrolleri,
- mutable protokol config’i (`feeConfig`, `cooldownConfig`, `tokenConfigs`).

Kanonik çekirdek fonksiyonlar:
- `createSellOrder`, `createBuyOrder`, `fillSellOrder`, `fillBuyOrder`,
- `cancelSellOrder`, `cancelBuyOrder`,
- `reportPayment`, `releaseFunds`, `challengeTrade`, `autoRelease`, `burnExpired`,
- `proposeOrApproveCancel`, `decayReputation`,
- read/config helper’ları: `getOrder`, `getTrade`, `getFeeConfig`, `getCooldownConfig`, `antiSybilCheck`, `getCurrentAmounts`, `getReputation`, `getFirstSuccessfulTradeAt`, `registerWallet`, `setTokenConfig`.

---

## 5) Parent order vs child trade ayrımı

### Parent Order (kamusal market katmanı)
- Kamusal likidite niyeti.
- Order modelinde aynalanan alanlar:
  - `onchain_order_id`, `side`, `status`, `tier`, `amounts`, `reserves`, `fee_snapshot`, `refs.order_ref`.
- Kanonik okuma yüzeyi: `GET /api/orders`, `GET /api/orders/:id`.

### Child Trade (escrow lifecycle katmanı)
- Gerçek escrow state ilerleyişi (`OPEN -> LOCKED -> PAID -> CHALLENGED -> RESOLVED/CANCELED/BURNED`).
- Trade modelinde aynalanan alanlar:
  - `onchain_escrow_id`, `parent_order_id`, `status`, `financials`, `fee_snapshot`, timer ve evidence snapshot’ları.
- Kanonik okuma yüzeyi: `GET /api/trades/*`.

### Kimlik ilişkisi (açık tutulmalı)
- `onchain_order_id` = parent order kimliği.
- `onchain_escrow_id` = child trade kimliği.
- `parent_order_id` = child → parent bağı.
- `order_ref` = order seviyesinde kanonik referans.
- `listing_ref` = uyumluluk/event-iz referansı; **authoritative state değildir**.

---

## 6) Backend mirror ve koordinasyon modeli

Backend’in yaptığı:
- kontrat event/state’ini read modele mirror etmek,
- sorgu API’lerini sunmak,
- off-chain imza/belge koordinasyonu yapmak,
- auth/rate-limit/gizlilik sınırlarını uygulamak.

Backend’in yapmadığı:
- protocol state üretmez,
- kontrat state’ini override etmez,
- kontrat config’i okunamadığında sahte ekonomik fallback üretmez.

---

## 7) Privacy / PII / audit sınırı

- Trade modelindeki encrypted receipt ve payout snapshot alanları operasyonel gizlilik/denetim içindir.
- Bu alanlar **protocol authority değildir**; on-chain sonucu değiştirmez.
- PII/dekont retention operasyonel politikadır; settlement semantiği kontrata bağlı kalır.

---

## 8) On-chain config ve governance modeli

V3 config mutable’dır ve kontrattan okunmalıdır:
- `getFeeConfig()` → güncel taker/maker fee bps.
- `getCooldownConfig()` → tier cooldown değerleri.
- `tokenConfigs(token)` → token direction authority (`supported`, `allowSellOrders`, `allowBuyOrders`).

Governance sonuçları:
- Fee/cooldown entegrasyonda sabit varsayılmaz.
- Token yön authority’si `tokenConfigs`’tir; legacy map’ler değildir.
- Config okunamazsa backend güvenli şekilde durur (`CONFIG_UNAVAILABLE`), ekonomi uydurmaz.

---

## 9) Event / mirror semantiği

Kanonik V3 yorumu:
- Child trade authority’si `OrderFilled` + `getTrade(tradeId)` ekseninde kurulmalıdır.
- Event’ler authority değil, mirror ingestion tetikleyicisidir.

Current repository reality (drift):
- `eventListener.js` halen ABI/event map içinde legacy zinciri (`EscrowCreated`, `EscrowLocked`) taşır.
- Branch’teki kontrat gerçeği direct-escrow compatibility yüzeyini kaldırmıştır.
- Bu nedenle backend worker ile kontrat arasında tam hizalama henüz tamamlanmamıştır; follow-up gerekir.

---

## 10) Güvenlik modeli ve bilinen sınırlar

Güvenlik duruşu:
- Anti-sybil ve role gate’ler kontratta enforce edilir.
- Settlement/dispute sonuçları kontrat tarafından belirlenir.
- Backend security kontrolleri (auth, rate limit, session-wallet match) API kötüye kullanım kontrolüdür; protocol consensus değildir.

Bilinen sınırlar:
- Mirror gecikmesi/kesintisi UX’i etkiler; protocol truth’u etkilemez.
- Deprecated alias route’lar authoritative sanılırsa entegrasyon yanılır.
- Kaldırılmış ABI/event varsayımlarını taşıyan backend bileşenleri operasyonel kırılma üretir.

---

## 11) Veri modelleri

### `Order.js` — architecture role
- **Yapar:** parent-order snapshot aynası ve order feed sorguları.
- **Authoritative değildir:** order state geçişleri ve reserve hesapları.
- **Azalttığı risk:** deterministik sorgu/sayfalama ve dashboard performansı.
- **Mirror/coordination rolü:** evet.

### `Trade.js` — architecture role
- **Yapar:** child-trade lifecycle aynası, financial snapshot ve PII/audit alanlarını tutar.
- **Authoritative değildir:** escrow sonucu veya dispute kararı.
- **Azalttığı risk:** trade geçmişi, kullanıcı görünürlüğü, denetim operasyonu.
- **Mirror/coordination rolü:** evet.

---

## 12) API surface özeti

### Kanonik read yüzeyleri
- `orders.js`
  - **Yapar:** parent-order read endpoint’leri (`/api/orders`, `/api/orders/:id`, `/api/orders/:id/trades`, `/api/orders/config`).
  - **Authoritative değildir:** create/fill/cancel state değişimi.
  - **Azalttığı risk:** market görünümünde sürekli raw chain sorgusu ihtiyacını azaltır.
- `trades.js`
  - **Yapar:** child-trade read + koordinasyon endpoint’leri.
  - **Authoritative değildir:** trade state geçişleri (on-chain kalır).
  - **Azalttığı risk:** private trade bağlamına kontrollü erişim ve cancel-signature koordinasyonu.

### Deprecated compatibility alias
- `listings.js`
  - **Yapar:** açık SELL order’ları listing-card formatına projekte eder.
  - **Authoritative değildir:** listing create/cancel.
  - **Azalttığı risk:** legacy UI tüketicileri için geçiş kolaylığı.
  - `POST /api/listings` ve `DELETE /api/listings/:id` açıkça deprecated (410).

---

## 13) Deployment ve operasyon notları

- Deploy scriptleri ve operasyon araçları güncel ABI ile birebir uyumlu olmalıdır.
- Config bağımlı API’ler açılmadan önce kontrat config yüklemesi başarılı olmalıdır.
- `protocolConfig.js` hardcoded ekonomik fallback üretmemeyi hedefler; config yoksa servis unavailable dönmelidir.

Current repository reality:
- Bazı deploy/service kodları hâlâ legacy `supportedTokens` ve legacy event zinciri varsayımlarını taşımaktadır.
- Bu referanslar operasyonel drift’tir; pure V3 ABI’ye hizalanmalıdır.

---

## 14) Deprecated / compatibility surface’ler

Repo’daki deprecated/non-canonical yüzeyler:
- `listings.js` write endpoint’leri (`POST`, `DELETE`) → bilinçli deprecated.
- Worker tarafında `EscrowCreated` / `EscrowLocked` legacy varsayımı.
- `supportedTokens(address)` bekleyen legacy config okuma yolları.

Normatif kural:
- Deprecated yüzeyler hiçbir koşulda birincil authority yolu gibi belgelenmez/kullanılmaz.

---

## 15) Açık riskler ve follow-up notları

1. **Event worker drift**
   - Kaldırılan compatibility event bağımlılıkları temizlenmeli; V3 kanonik event/state stratejisine dönülmeli.
2. **Protocol config ABI drift**
   - `supportedTokens(address)` bağımlılığı kaldırılmalı, sadece `tokenConfigs` okunmalı.
3. **Model yorum drift’i**
   - `Trade.js` içindeki direct-escrow ikincil semantiği anlatan yorumlar pure V3 diline çekilmeli.
4. **Ops script drift’i**
   - Deploy scriptlerindeki legacy compatibility okumaları temizlenmeli.

Tüm follow-up’lar için son kural:
- Her yüzey açıkça **authoritative**, **mirrored**, **derived** veya **deprecated** olarak etiketlenmeli.
- Legacy uyumluluk, canonical flow gibi geri getirilmemeli.
