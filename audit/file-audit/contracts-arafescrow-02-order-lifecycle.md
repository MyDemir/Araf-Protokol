# File Audit — contracts/src/ArafEscrow.sol (Order Lifecycle 02)

## 1. Scope
- Primary file: `contracts/src/ArafEscrow.sol`
  - `createSellOrder`
  - `fillSellOrder`
  - `cancelSellOrder`
  - `createBuyOrder`
  - `fillBuyOrder`
  - `cancelBuyOrder`
  - order getter/view/helper surfaces (`getOrder`, `getTrade`, `_isTokenAllowedFor*`, `_safeTransferExactIn`, `_proportionalSlice` usage context)
  - parent order / child trade linkage
  - `OrderCreated` / `OrderFilled` / `OrderCanceled` emission
- Cross-check files:
  - `contracts/test/ArafEscrow.test.js`
  - `backend/scripts/models/Order.js`
  - `backend/scripts/models/Trade.js`
  - `backend/scripts/services/eventListener.js`
  - `backend/scripts/routes/orders.js`
  - `backend/scripts/routes/trades.js`
  - `frontend/src/App.jsx`
  - `frontend/src/hooks/useArafContract.js`
  - `frontend/src/app/orderUiModel.js`

## 2. Method
- Contract order lifecycle was read function-by-function in source order.
- For each function, state transitions, reserve/accounting math, transfer pattern, and emitted events were checked.
- Event ABI/arg order was compared against:
  - frontend inline ABI + event extraction path,
  - backend worker ABI + normalization + persistence model fields.
- ID semantics (`orderId` vs `tradeId`) were checked across model/route/UI layers.

## 3. Function / Section Notes
- **createSellOrder**: validates token direction, amount/minFill/tier/ref; snapshots fee/risk at order open; pre-locks inventory + maker reserve via `_safeTransferExactIn`.
- **fillSellOrder**: enforces open/partial state and min-fill rules; computes taker bond + proportional maker reserve slice; decrements remaining fields before creating child trade; emits `OrderFilled(orderId, tradeId, ...)`.
- **cancelSellOrder**: only owner; only OPEN/PARTIALLY_FILLED; refunds unfilled inventory + unused maker reserve; zeroes remaining fields and marks canceled.
- **createBuyOrder**: validates like sell side + enforces taker gate at create; pre-locks total taker reserve; snapshots fee/risk.
- **fillBuyOrder**: seller becomes child-trade maker; slices taker reserve proportionally; filler locks `fillAmount + makerBond` exact-in; emits `OrderFilled` with child trade id.
- **cancelBuyOrder**: only owner; refunds only unused taker reserve.
- **Getter/view**: `getOrder` + `getTrade` preserve explicit parent-child linkage through `Trade.parentOrderId`.

## 4. Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| AES-ORDER-001 | HIGH | frontend-tx-orchestration | `frontend/src/hooks/useArafContract.js` / `fillSellOrder`, `fillBuyOrder` | Frontend extracts child `tradeId` by decoding first matching `OrderFilled` log without contract-address filtering. | In a transaction containing another contract emitting a same-signature log, UI could bind wrong child trade id (mis-navigation / wrong follow-up actions). | `extractEventArgs` decodes all receipt logs with `strict:false`, matches only by `eventName`, does not check `log.address === ESCROW_ADDRESS`. | Filter logs by escrow address before decoding, or parse via receipt logs already scoped to write target contract.
| AES-ORDER-002 | MEDIUM | worker-mirror | `backend/scripts/services/eventListener.js` + `backend/scripts/models/Order.js` | **uncertain**: model has `stats.child_trade_count` / `stats.total_filled_amount`, but observed route of this review slice does not show guaranteed atomic updates in tandem with `OrderFilled`. | Potential dashboard drift for parent-order analytics if stats are not deterministically recomputed from authoritative on-chain fields. | Schema contains stats fields; in inspected sections no explicit invariant contract shown for those counters. | Verify worker handlers for `OrderFilled`/`OrderCanceled` perform deterministic recompute from `getOrder/getTrade`; if not, prefer recompute jobs over incremental counters.
| AES-ORDER-003 | LOW | ABI-drift | `contracts/src/ArafEscrow.sol` + frontend/backend ABI mirrors | Contract emits `OrderCanceled` (US spelling), while user-facing text/instructions sometimes references `OrderCancelled` (UK spelling). Current code is aligned, but naming ambiguity is integration hazard. | Future manual ABI edits may introduce silent miss-subscription in off-chain consumers. | Contract + worker + frontend ABI currently use `OrderCanceled`; task text used `OrderCancelled`. | Keep a single canonical glossary in docs and CI assert event names against contract ABI artifact.

## 5. No-Finding Notes
- **Parent/child ID separation:** contract stores child link as `Trade.parentOrderId`, and `OrderFilled` emits both `orderId` and `tradeId`; backend model also keeps `parent_order_id` and `onchain_escrow_id` as separate fields.
- **Remaining amount transitions:** both fill paths reduce `remainingAmount` exactly by `_fillAmount`, with state advancing to `FILLED` only at zero; partial path remains `PARTIALLY_FILLED`.
- **Double-fill/race guard:** fills/cancels are `nonReentrant` and state-gated (`OPEN`/`PARTIALLY_FILLED`), reducing same-order double consumption within tx ordering rules.
- **Refund semantics:** sell-cancel refunds unfilled inventory + maker reserve; buy-cancel refunds unfilled taker reserve only; both zero storage remainder before external transfer.
- **Exact-in safeguards:** order create/fill lock paths use `_safeTransferExactIn`, rejecting fee-on-transfer/deflationary short-receive behavior.
- **Event arg order alignment:** `OrderCreated`, `OrderFilled`, `OrderCanceled` signatures are consistent across contract, frontend inline ABI, and backend worker ABI in this review.

## 6. Cross-File Risks
- **Frontend child trade extraction robustness:** event-name-only decode increases coupling risk under multi-log receipts; contract authority is sound but UI binding can be fragile.
- **Mirror analytics fields vs authority fields:** off-chain `stats` convenience counters can drift from authoritative `remainingAmount`/reserves if not recomputed from chain snapshots.
- **Terminology drift risk:** “Canceled/Cancelled” inconsistency in human docs may create operational confusion despite ABI currently consistent.

## 7. Follow-up
1. Audit next slice: `releaseFunds / autoRelease / burnExpired / settlement` accounting and terminal snapshots.
2. Inspect backend worker `OrderFilled`/`OrderCanceled` handlers in full (beyond this slice) for counter idempotency and replay safety.
3. Add CI ABI conformance check for frontend/backend inline ABI event names + arg order against contract artifact.
4. Validate frontend post-fill flow rejects null `tradeId` and blocks downstream actions until authoritative trade fetch succeeds.
