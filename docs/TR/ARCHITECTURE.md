# Araf Protokolü — Mimari (Kanonik, V3 Order-First)

Bu doküman, **protokol davranışını yalnızca `contracts/src/ArafEscrow.sol` gerçekliğinden** tanımlar.
Backend ve frontend katmanları authoritative değildir; yalnızca mirror/koordinasyon/UX katmanıdır.

## 1) Kanonik mimari modeli

Araf V3 artık **listing-first değil, order-first** çalışır.

- **Parent Order** = public market primitive (pazar katmanı)
- **Child Trade** = gerçek escrow lifecycle (ekonomik state machine)
- **Contract (`ArafEscrow.sol`)** = tek authoritative state machine
- **Backend** = on-chain event mirror + read/coordination katmanı
- **Frontend** = UX guardrail + contract access katmanı

> Legacy `createEscrow / lockEscrow` anlatısı kanonik akış değildir.

---

## 2) On-chain public surface (V3)

### 2.1 Parent order write surface
- `createSellOrder(token, totalAmount, minFillAmount, tier, orderRef)`
- `fillSellOrder(orderId, fillAmount, childListingRef)`
- `cancelSellOrder(orderId)`
- `createBuyOrder(token, totalAmount, minFillAmount, tier, orderRef)`
- `fillBuyOrder(orderId, fillAmount, childListingRef)`
- `cancelBuyOrder(orderId)`

### 2.2 Child trade (escrow) write surface
- `reportPayment(tradeId, ipfsHash)`
- `releaseFunds(tradeId)`
- `challengeTrade(tradeId)`
- `autoRelease(tradeId)`
- `burnExpired(tradeId)`
- `proposeOrApproveCancel(tradeId, deadline, sig)`

### 2.3 Yardımcı write surface
- `registerWallet()`
- `pingMaker(tradeId)`
- `pingTakerForChallenge(tradeId)`
- `decayReputation(wallet)`

### 2.4 Governance / owner-controlled mutable surface
- `setTreasury(address)`
- `setFeeConfig(takerFeeBps, makerFeeBps)`
- `setCooldownConfig(tier0TradeCooldown, tier1TradeCooldown)`
- `setTokenConfig(token, supported, allowSellOrders, allowBuyOrders)`
- `pause()` / `unpause()`

### 2.5 Read surface (seçilmiş)
- `getOrder(orderId)`
- `getTrade(tradeId)`
- `getReputation(wallet)`
- `getFeeConfig()`
- `getCooldownConfig()`
- `getCurrentAmounts(tradeId)`
- `antiSybilCheck(wallet)`
- `getCooldownRemaining(wallet)`
- `getFirstSuccessfulTradeAt(wallet)`

---

## 3) State machine: parent order ve child trade ayrımı

### Parent Order state
- `OPEN`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELED`

### Child Trade state (gerçek escrow lifecycle)
- `OPEN` (V3 fill path’inde pratikte kullanılmıyor)
- `LOCKED`
- `PAID`
- `CHALLENGED`
- `RESOLVED`
- `CANCELED`
- `BURNED`

V3’te child trade, fill anında **doğrudan `LOCKED`** doğar.
Bu nedenle child trade authority’si:
1. `OrderFilled(orderId, tradeId, ...)` event’i
2. `getTrade(tradeId)` verisi
kombinasyonundan gelir.

---

## 4) Happy path (V3) — iki ayrı akış

## 4.1 Sell order flow
1. Seller: `createSellOrder` çağrısı ile parent order açar.
   - Token inventory + toplam maker bond reserve upfront kilitlenir.
2. Filler (counterparty): `fillSellOrder` çağırır.
   - `_enforceTakerEntry` filler üzerinde uygulanır.
   - Child trade aynı tx içinde `LOCKED` oluşur.
3. Taker: `reportPayment`
4. Maker: `releaseFunds` (veya koşula göre `challengeTrade` / karşılıklı cancel / auto-release path)

## 4.2 Buy order flow
1. Buyer: `createBuyOrder` çağrısı ile parent order açar.
   - Buyer eventual taker olduğu için create anında `_enforceTakerEntry` uygulanır.
   - Toplam taker bond reserve upfront kilitlenir.
2. Seller (filler): `fillBuyOrder` çağırır.
   - Buy order owner (eventual taker) fill anında yeniden `_enforceTakerEntry` kontrolünden geçer.
   - Seller maker olur, order owner taker olur.
   - Child trade aynı tx içinde `LOCKED` oluşur.
3. Taker: `reportPayment`
4. Maker: `releaseFunds` (veya dispute/cancel path)

---

## 5) Roller: maker/taker eşleşmesi side-dependent

Mutlak “maker=seller, taker=buyer” kuralı yoktur; **order side’a bağlıdır**.

- `SELL_CRYPTO` order:
  - order owner => **maker**
  - filler => **taker**
- `BUY_CRYPTO` order:
  - order owner => **taker**
  - filler => **maker**

Dolayısıyla owner/filler ile maker/taker eşleşmesi her iki yönde simetrik değildir.

---

## 6) Anti-sybil ve taker entry enforcement (V3 semantiği)

`_enforceTakerEntry(wallet, tier)` şu kapıları uygular:
- aktif ban kontrolü (`bannedUntil`)
- wallet age (`WALLET_AGE_MIN`)
- native dust (`DUST_LIMIT`)
- tier bazlı cooldown (`tier0TradeCooldown`, `tier1TradeCooldown`; Tier2+ yok)

Uygulama noktaları:
- `fillSellOrder`: filler (taker) için zorunlu
- `createBuyOrder`: order owner (eventual taker) için zorunlu
- `fillBuyOrder`: order owner (taker) için tekrar zorunlu

Bu nedenle anti-sybil anlatısı artık `lockEscrow` değil, **V3 child-trade entry path** merkezlidir.

---

## 7) Reputation, ban ve clean-slate

- Başarısız dispute birikimi ban/cap mekanizmasını tetikler.
- `decayReputation(wallet)` sadece clean period dolunca `consecutiveBans` resetler.
- Güncel clean period: **90 gün** (`REPUTATION_DECAY_CLEAN_PERIOD = 90 days`).

Önemli:
- Bu mekanizma **tam af değildir**.
- `failedDisputes` geçmişi silinmez.
- Tier penalty flag/ceiling resetlenebilir; tarihsel dispute sayıları korunur.

---

## 8) Treasury, fee modeli ve mutable config

### 8.1 Immutable/public constants (ekonomik sabitler)
- tier max amounts (`TIER_MAX_AMOUNT_TIER0..3`)
- decay rates (`TAKER_BOND_DECAY_BPS_H`, `MAKER_BOND_DECAY_BPS_H`, `CRYPTO_DECAY_BPS_H`)
- wallet age min (`WALLET_AGE_MIN`)
- dust limit (`DUST_LIMIT`)
- max bleeding (`MAX_BLEEDING`)
- min active period (`MIN_ACTIVE_PERIOD`)
- auto release penalty (`AUTO_RELEASE_PENALTY_BPS`)
- max cancel deadline (`MAX_CANCEL_DEADLINE`)
- rep discount/penalty bps (`GOOD_REP_DISCOUNT_BPS`, `BAD_REP_PENALTY_BPS`)

### 8.2 Mutable runtime config (owner-controlled)
- `takerFeeBps`
- `makerFeeBps`
- `tier0TradeCooldown`
- `tier1TradeCooldown`

Ayrıca aktif trade’ler fee değişiminden korunur:
- Parent order açılışında fee snapshot alınır.
- Child trade, parent snapshot’ını taşır.
- Sonradan `setFeeConfig` ile global fee değişse de aktif trade economics snapshot üzerinden yürür.

---

## 9) Token support modeli (direction-aware)

V3 token yetkilendirmesi `TokenConfig` ile direction-aware çalışır:
- `supported`
- `allowSellOrders`
- `allowBuyOrders`

Yani bir token genel olarak desteklenirken sadece sell veya sadece buy order tarafında açılabilir.
Eski `supportedTokens/setSupportedToken` tek-boyutlu dil kanonik değildir.

---

## 10) Backend mimarisi (authoritative olmayan mirror)

`backend/scripts/app.js`, `eventListener.js`, `routes/orders.js`, `routes/trades.js` ile uyumlu güncel çerçeve:

- Backend **authority değildir**; kontrat state üretmez.
- MongoDB, on-chain event/state’in **mirror/read modeli**dir.
- Worker, özellikle `OrderCreated / OrderFilled / OrderCanceled` ve config event’lerini mirror eder.
- `orders` ve `trades` route’ları read layer’dır.
- PII, koordinasyon (oturum/cancel-signature orchestration) ve audit backend’dedir.
- Startup: DB/Redis/worker/config yükleme akışı vardır.
- Health/readiness/liveness endpointleri ve scheduler job’ları (decay, cleanup, stats, DLQ) operasyonel katmandadır.

---

## 11) Frontend mimarisi (UX guardrail + contract access)

`frontend/src/hooks/useArafContract.js` write surface’i order-first’tür:
- `create/fill/cancel` sell-buy order fonksiyonları
- child trade lifecycle fonksiyonları (`reportPayment`, `releaseFunds`, `challengeTrade`, `autoRelease`, `burnExpired`)
- `signCancelProposal` + `proposeOrApproveCancel` akışı

Frontend authority üretmez:
- tx gönderir, receipt/event decode eder,
- özellikle fill sonrası `OrderFilled` event’inden `tradeId` çıkarır,
- contract state’in UX guardrail katmanını sağlar.

---

## 12) Kaldırılan/yeniden çerçevelenen eski kavramlar

Kanonik mimariden çıkarılan veya ikincil hale alınan söylemler:
- listing-first ana model
- `createEscrow/lockEscrow` canonical happy path
- maker/taker için mutlak seller/buyer eşleşmesi
- fee/cooldown değerlerinin sabit varsayılması
- tek boyutlu token support anlatısı

Araf V3’te canonical gerçeklik: **Parent Order market katmanı + Child Trade escrow katmanı**.
