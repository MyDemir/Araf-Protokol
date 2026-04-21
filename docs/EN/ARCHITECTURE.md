# Araf Protocol — Architecture (Canonical, V3 Order-First)

This document defines protocol behavior from **`contracts/src/ArafEscrow.sol` as the source of truth**.
Backend and frontend are not authoritative; they are mirror/coordination/UX layers.

## 1) Canonical architecture model

Araf V3 is now **order-first, not listing-first**.

- **Parent Order** = public market primitive (market/order layer)
- **Child Trade** = actual escrow lifecycle
- **Contract (`ArafEscrow.sol`)** = single authoritative state machine
- **Backend** = on-chain mirror + coordination/read layer
- **Frontend** = UX guardrail + contract access layer

> Legacy `createEscrow / lockEscrow` storytelling is no longer canonical.

---

## 2) On-chain public surface (V3)

### 2.1 Parent-order write surface
- `createSellOrder(token, totalAmount, minFillAmount, tier, orderRef)`
- `fillSellOrder(orderId, fillAmount, childListingRef)`
- `cancelSellOrder(orderId)`
- `createBuyOrder(token, totalAmount, minFillAmount, tier, orderRef)`
- `fillBuyOrder(orderId, fillAmount, childListingRef)`
- `cancelBuyOrder(orderId)`

### 2.2 Child-trade (escrow) write surface
- `reportPayment(tradeId, ipfsHash)`
- `releaseFunds(tradeId)`
- `challengeTrade(tradeId)`
- `autoRelease(tradeId)`
- `burnExpired(tradeId)`
- `proposeOrApproveCancel(tradeId, deadline, sig)`

### 2.3 Auxiliary write surface
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

### 2.5 Read surface (selected)
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

## 3) State machine: parent order vs child trade

### Parent Order states
- `OPEN`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELED`

### Child Trade states (actual escrow lifecycle)
- `OPEN` (not used in the pure V3 fill path)
- `LOCKED`
- `PAID`
- `CHALLENGED`
- `RESOLVED`
- `CANCELED`
- `BURNED`

In V3, a child trade is created as **`LOCKED` at fill time**.
Child-trade authority comes from:
1. `OrderFilled(orderId, tradeId, ...)` event
2. `getTrade(tradeId)` payload

---

## 4) V3 happy path — two flows

## 4.1 Sell-order flow
1. Seller calls `createSellOrder` to open a parent order.
   - Token inventory + total maker bond reserve are locked upfront.
2. Counterparty calls `fillSellOrder`.
   - `_enforceTakerEntry` is applied to the filler.
   - Child trade is created as `LOCKED` in the same tx.
3. Taker calls `reportPayment`.
4. Maker calls `releaseFunds` (or challenge/cancel paths based on conditions).

## 4.2 Buy-order flow
1. Buyer calls `createBuyOrder` to open a parent order.
   - Since the owner becomes eventual taker, `_enforceTakerEntry` is applied at create time.
   - Total taker bond reserve is locked upfront.
2. Seller calls `fillBuyOrder`.
   - Buy-order owner (eventual taker) is re-checked by `_enforceTakerEntry` at fill.
   - Seller becomes maker; order owner becomes taker.
   - Child trade is created as `LOCKED` in the same tx.
3. Taker calls `reportPayment`.
4. Maker calls `releaseFunds` (or dispute/cancel paths).

---

## 5) Roles: maker/taker mapping is side-dependent

There is no universal “maker = seller, taker = buyer” rule. Mapping is **order-side dependent**.

- `SELL_CRYPTO` order:
  - order owner => **maker**
  - filler => **taker**
- `BUY_CRYPTO` order:
  - order owner => **taker**
  - filler => **maker**

So owner/filler and maker/taker are not symmetric across both sides.

---

## 6) Anti-sybil and taker-entry enforcement (V3 semantics)

`_enforceTakerEntry(wallet, tier)` enforces:
- active ban gate (`bannedUntil`)
- wallet age (`WALLET_AGE_MIN`)
- native dust requirement (`DUST_LIMIT`)
- tier cooldown (`tier0TradeCooldown`, `tier1TradeCooldown`; none for Tier2+)

Enforcement points:
- `fillSellOrder`: mandatory for filler as taker
- `createBuyOrder`: mandatory for owner as eventual taker
- `fillBuyOrder`: mandatory again for owner as taker

So anti-sybil is no longer described around `lockEscrow`; it is centered on the **V3 child-trade entry path**.

---

## 7) Reputation, ban history, and clean-slate behavior

- Failed disputes accumulate and can trigger ban/cap logic.
- `decayReputation(wallet)` resets only `consecutiveBans` after the clean period.
- Current clean period: **90 days** (`REPUTATION_DECAY_CLEAN_PERIOD = 90 days`).

Important:
- This is **not a full amnesty**.
- Historical `failedDisputes` are not erased.
- Tier-penalty flags/ceilings may reset, while dispute history remains.

---

## 8) Treasury, fee model, and mutable config

### 8.1 Immutable/public constants (economic invariants)
- tier max amounts (`TIER_MAX_AMOUNT_TIER0..3`)
- decay rates (`TAKER_BOND_DECAY_BPS_H`, `MAKER_BOND_DECAY_BPS_H`, `CRYPTO_DECAY_BPS_H`)
- wallet age min (`WALLET_AGE_MIN`)
- dust limit (`DUST_LIMIT`)
- max bleeding (`MAX_BLEEDING`)
- min active period (`MIN_ACTIVE_PERIOD`)
- auto release penalty (`AUTO_RELEASE_PENALTY_BPS`)
- max cancel deadline (`MAX_CANCEL_DEADLINE`)
- reputation discount/penalty bps (`GOOD_REP_DISCOUNT_BPS`, `BAD_REP_PENALTY_BPS`)

### 8.2 Mutable runtime config (owner-controlled)
- `takerFeeBps`
- `makerFeeBps`
- `tier0TradeCooldown`
- `tier1TradeCooldown`

Active trades are protected by fee snapshots:
- Snapshot taken when a parent order is created.
- Child trade inherits parent snapshots.
- Later `setFeeConfig` changes do not rewrite active-trade economics.

---

## 9) Token support model (direction-aware)

V3 token permissions are direction-aware via `TokenConfig`:
- `supported`
- `allowSellOrders`
- `allowBuyOrders`

A token may be supported globally but enabled only for sell or only for buy orders.
Legacy single-dimension `supportedTokens/setSupportedToken` wording is stale.

---

## 10) Backend architecture (non-authoritative mirror)

Aligned with `backend/scripts/app.js`, `eventListener.js`, `routes/orders.js`, `routes/trades.js`:

- Backend is **not authority**; it does not create contract truth.
- MongoDB is a **mirror/read model** of on-chain events/state.
- Worker mirrors `OrderCreated / OrderFilled / OrderCanceled` and config events.
- `orders` and `trades` endpoints are read layers.
- PII handling, coordination (session/cancel-signature orchestration), and audit are backend concerns.
- Startup includes DB/Redis/worker/config loading.
- Health/readiness/liveness and scheduled ops jobs (decay, cleanup, stats, DLQ) are operational responsibilities.

---

## 11) Frontend architecture (UX guardrail + contract access)

`frontend/src/hooks/useArafContract.js` exposes an order-first write surface:
- sell/buy `create/fill/cancel` order functions
- child-trade lifecycle functions (`reportPayment`, `releaseFunds`, `challengeTrade`, `autoRelease`, `burnExpired`)
- `signCancelProposal` + `proposeOrApproveCancel` flow

Frontend does not produce authority:
- it sends tx,
- decodes receipts/events,
- especially extracts `tradeId` from `OrderFilled` after fills,
- and serves as a UX guardrail over contract truth.

---

## 12) Deprecated/reframed concepts

Removed from canonical architecture (or reframed as legacy):
- listing-first core model
- `createEscrow/lockEscrow` canonical happy path
- absolute seller/buyer maker-taker mapping
- assumption that fee/cooldown are fixed constants
- single-dimension token support language

Canonical V3 truth: **Parent Order market layer + Child Trade escrow layer**.
