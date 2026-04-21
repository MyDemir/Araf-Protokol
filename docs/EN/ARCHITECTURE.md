# Araf Protocol — Canonical Architecture & Technical Reference (V3)

> Source-of-truth priority: `ArafEscrow.sol` > backend mirror layer > frontend UX layer > documentation.

This document preserves the correct V3 core introduced in PR #52 and restores detailed technical-reference depth.

---

## 1) Canonical architecture model

Araf is no longer listing-first; it is **order-first**:

- **Parent Order** = public market/order layer
- **Child Trade** = real escrow lifecycle (economic state machine)
- **Contract** = single authoritative state machine
- **Backend** = mirror + coordination + read layer
- **Frontend** = UX guardrail + contract access layer

### Authority boundary
- On-chain state transitions are defined only by the contract.
- Backend does not invent order/trade state; it mirrors events/getters.
- Frontend does not create economic truth; it sends tx and reads receipts/events.

### Legacy framing
`createEscrow/lockEscrow` and listing-first narratives are not canonical in V3. They may only appear as historical/legacy context.

---

## 2) On-chain public surface (ArafEscrow.sol)

## 2.1 Order write surface
- `createSellOrder(address token, uint256 totalAmount, uint256 minFillAmount, uint8 tier, bytes32 orderRef)`
- `fillSellOrder(uint256 orderId, uint256 fillAmount, bytes32 childListingRef)`
- `cancelSellOrder(uint256 orderId)`
- `createBuyOrder(address token, uint256 totalAmount, uint256 minFillAmount, uint8 tier, bytes32 orderRef)`
- `fillBuyOrder(uint256 orderId, uint256 fillAmount, bytes32 childListingRef)`
- `cancelBuyOrder(uint256 orderId)`

## 2.2 Child-trade (escrow lifecycle) write surface
- `reportPayment(uint256 tradeId, string ipfsHash)`
- `releaseFunds(uint256 tradeId)`
- `challengeTrade(uint256 tradeId)`
- `autoRelease(uint256 tradeId)`
- `burnExpired(uint256 tradeId)`
- `proposeOrApproveCancel(uint256 tradeId, uint256 deadline, bytes sig)`

## 2.3 Auxiliary/liveness write surface
- `registerWallet()`
- `pingMaker(uint256 tradeId)`
- `pingTakerForChallenge(uint256 tradeId)`
- `decayReputation(address wallet)`

## 2.4 Governance (owner-controlled mutable surface)
- `setTreasury(address)`
- `setFeeConfig(uint256 takerFeeBps, uint256 makerFeeBps)`
- `setCooldownConfig(uint256 tier0TradeCooldown, uint256 tier1TradeCooldown)`
- `setTokenConfig(address token, bool supported, bool allowSellOrders, bool allowBuyOrders)`
- `pause()` / `unpause()`

## 2.5 Critical read surface
- `getOrder(orderId)`, `getTrade(tradeId)`, `getReputation(wallet)`
- `getFeeConfig()`, `getCooldownConfig()`, `getCurrentAmounts(tradeId)`
- `antiSybilCheck(wallet)`, `getCooldownRemaining(wallet)`, `getFirstSuccessfulTradeAt(wallet)`

---

## 3) Parent-order vs child-trade state model

## 3.1 Parent Order state machine
- `OPEN`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELED`

Parent order is market access logic; escrow resolution logic runs at child-trade level.

## 3.2 Child Trade state machine (actual escrow)
- `OPEN` (not practically used in pure V3 fill path)
- `LOCKED`
- `PAID`
- `CHALLENGED`
- `RESOLVED`
- `CANCELED`
- `BURNED`

In V3, child trades are created directly as `LOCKED` in the fill transaction.

## 3.3 Child-trade authority linkage
In V3, child-trade identity/context is authoritative through:
1. `OrderFilled(orderId, tradeId, filler, fillAmount, remainingAmount, childListingRef)`
2. `getTrade(tradeId)`

---

## 4) Flows: Sell order and Buy order

## 4.1 Sell-order flow
1. Owner calls `createSellOrder`.
   - Token inventory + maker bond reserve are locked upfront.
2. Counterparty calls `fillSellOrder`.
   - `_enforceTakerEntry` is applied to the filler.
   - Child trade is spawned as `LOCKED`.
3. Taker calls `reportPayment` (`PAID`).
4. Maker resolves via `releaseFunds` (`RESOLVED`) or goes to dispute/cancel path.

## 4.2 Buy-order flow
1. Owner calls `createBuyOrder`.
   - Since owner is eventual taker, `_enforceTakerEntry` is applied at create-time.
   - Taker bond reserve is locked upfront.
2. Counterparty calls `fillBuyOrder`.
   - Buy owner (taker) is checked again via `_enforceTakerEntry` at fill-time.
   - Filler becomes maker; owner becomes taker.
   - Child trade is spawned as `LOCKED`.
3. Taker calls `reportPayment`.
4. Maker resolves via `releaseFunds` or dispute/cancel path.

---

## 5) Role mapping: owner/filler ↔ maker/taker

No universal “maker=seller, taker=buyer” rule exists; mapping is side-dependent:

- `SELL_CRYPTO`
  - order owner => maker
  - filler => taker
- `BUY_CRYPTO`
  - order owner => taker
  - filler => maker

This mapping drives both payout economics and anti-sybil entry points.

---

## 6) Anti-sybil enforcement semantics

Canonical enforcement helper: `_enforceTakerEntry(wallet, tier)`

Enforced gates:
- active ban gate (`bannedUntil`)
- wallet age (`WALLET_AGE_MIN`)
- native dust threshold (`DUST_LIMIT`)
- tier cooldown (`tier0TradeCooldown`, `tier1TradeCooldown`; none for tier2+)

### V3 enforcement points
- `fillSellOrder`: filler/taker entry
- `createBuyOrder`: owner/eventual taker pre-gate
- `fillBuyOrder`: owner/taker re-check

Therefore anti-sybil is no longer lockEscrow-centered legacy; it is V3 child-trade-entry centered.

---

## 7) Dispute system (Bleeding Escrow)

After `PAID`, three main resolution paths exist:

1. **Normal path:** maker `releaseFunds`
2. **Dispute path:** maker `pingTakerForChallenge` → wait window → `challengeTrade`
3. **Liveness path:** taker `pingMaker` → wait window → `autoRelease`

### Bleeding mechanics
- In `CHALLENGED`, maker bond, taker bond, and (after threshold) crypto side decay over time.
- `getCurrentAmounts` exposes real-time economics.
- `burnExpired` sweeps remaining value to treasury once `MAX_BLEEDING` expires.

### Mutual cancel
- `proposeOrApproveCancel` captures both parties’ EIP-712 signed intent.
- Once both approvals exist, `_executeCancel` runs.
- Refund/fee behavior is state-dependent and contract-enforced.

---

## 8) Reputation, bans, and clean-slate behavior

Reputation mapping fields:
- `successfulTrades`
- `failedDisputes`
- `bannedUntil`
- `consecutiveBans`

### Ban/tier impact
- Failed-dispute accumulation can trigger ban escalation.
- Tier-ceiling penalty (`hasTierPenalty`, `maxAllowedTier`) may be activated.

### Clean-slate semantics
- `decayReputation(wallet)` requires clean-period completion.
- Current clean period: **90 days** (`REPUTATION_DECAY_CLEAN_PERIOD = 90 days`).
- This is not full amnesty:
  - `consecutiveBans` may reset,
  - `hasTierPenalty` may clear,
  - historical `failedDisputes` does not disappear.

---

## 9) Treasury, fee model, mutable config

## 9.1 Immutable/public-constant class
- tier max amounts (`TIER_MAX_AMOUNT_TIER0..3`)
- decay rates (`TAKER_BOND_DECAY_BPS_H`, `MAKER_BOND_DECAY_BPS_H`, `CRYPTO_DECAY_BPS_H`)
- `WALLET_AGE_MIN`, `DUST_LIMIT`, `MAX_BLEEDING`
- `MIN_ACTIVE_PERIOD`, `AUTO_RELEASE_PENALTY_BPS`, `MAX_CANCEL_DEADLINE`
- `GOOD_REP_DISCOUNT_BPS`, `BAD_REP_PENALTY_BPS`

## 9.2 Mutable runtime-config class
- `takerFeeBps`
- `makerFeeBps`
- `tier0TradeCooldown`
- `tier1TradeCooldown`

### Fee snapshot protection
- Fee snapshots are taken at order creation.
- Child trades inherit those snapshots.
- Later `setFeeConfig` changes do not retroactively rewrite active-trade economics.

---

## 10) TokenConfig: direction-aware token support

Token management is direction-aware (not single-boolean):
- `supported`
- `allowSellOrders`
- `allowBuyOrders`

A token can be globally supported but enabled only for one order direction.
Legacy `supportedTokens/setSupportedToken` wording is stale in V3.

---

## 11) Backend architecture (non-authoritative)

Role of `backend/scripts/app.js` and route/service layers:

- session/rate-limit/PII security boundary and API orchestration
- mirroring on-chain events into Mongo read models
- exposing fast read endpoints for UI/ops

### Non-authoritative principle
- Backend does not define order/trade rules.
- Contract rejection cannot be overridden by backend logic.
- Mongo data is canonical for read performance, not protocol authority.

---

## 12) Event worker / replay / mirror reliability

`eventListener.js` design principles:
- contract is authority, worker is mirror
- parent order and child trade use explicit identities (`orderId`, `tradeId`, `orderRef`)
- child-trade authority mirrors `OrderFilled + getTrade`

### Reliability layers
- Redis checkpoints (`worker:last_block`, `worker:last_safe_block`)
- retry + DLQ
- block-batch replay
- identity normalization (numeric ID string discipline)
- trade-state regression guards

This improves mirror consistency under reprocessing/replay/partial-update conditions.

---

## 13) Data model layer (User / Order / Trade)

## 13.1 Order model
- Mirrors on-chain parent-order fields.
- Remaining amount/reserve/fee snapshots are mirrored from contract, not computed as authority in backend.

## 13.2 Trade model
- Child-trade-centric identity: `onchain_escrow_id`.
- `parent_order_id`, `parent_order_side`, `fee_snapshot`, `financials`, `timers` as mirror fields.
- PII/receipt/snapshot fields are for coordination and legal/audit boundaries, not protocol authority.

## 13.3 User model
- Payout profile stored with AES-256-GCM encryption.
- `reputation_cache` and local ban fields are cache/mirror aids.
- Final enforcement remains on-chain via reputation + anti-sybil gates.

---

## 14) Frontend architecture / contract hook / UX guardrails

`useArafContract.js` exposes an order-first write surface:
- sell/buy order create/fill/cancel
- child-trade lifecycle writes
- EIP-712 cancel flows

### Runtime guardrails
- chain validation
- escrow-address validation
- receipt/event decoding
- post-fill `tradeId` extraction from `OrderFilled`

Frontend does not generate authority; it safely projects contract truth into UX.

---

## 15) Security architecture

- **Non-custodial:** backend does not control user funds.
- **Pausable governance:** new entries can be stopped in emergencies.
- **EIP-712 cancel:** signature/nonce checks in contract.
- **PII boundary:** trade-scoped token + session-wallet match + no-store responses.
- **Data minimization:** sensitive fields excluded from read projections.
- **Operational security:** health/readiness, scheduler locks, graceful shutdown, cleanup jobs.

---

## 16) Operational notes

- Startup ordering (DB/Redis/worker/config) is operationally critical.
- Traffic should not open while readiness fails.
- DLQ backlog and replay metrics require active monitoring.
- PII retention and receipt cleanup jobs must remain enabled.

---

## 17) Deprecated / reframed legacy concepts

The following are no longer canonical:
- listing-first market primitive narrative
- `createEscrow/lockEscrow` canonical happy path
- fixed-fee/fixed-cooldown assumptions
- absolute seller/buyer maker-taker mapping
- single-dimension token-support language

Legacy references should be treated as historical context only. Live behavior must follow contract truth and this V3 architecture reference.
