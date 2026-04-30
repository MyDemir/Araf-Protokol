# File Audit — contracts/src/ArafEscrow.sol (Settlement Proposal 04)

## 1. Scope
- Primary file: `contracts/src/ArafEscrow.sol`
  - `proposeSettlement`
  - `acceptSettlement`
  - `rejectSettlement`
  - `withdrawSettlement` (requested `withdrawSettlementProposal` surface)
  - `expireSettlement` (requested `expireSettlementProposal` surface)
  - settlement proposal storage (`settlementProposalsByTrade`, `settlementProposalNonceByTrade`)
  - settlement events (`SettlementProposed/Rejected/Withdrawn/Expired/Finalized`)
  - settlement helpers/views (`_isSettlementAllowedTradeState`, `_expireSettlementProposalIfNeeded`, `getSettlementProposal`)
- Cross-check files:
  - `contracts/test/partialSettlement.core.test.js`
  - `backend/scripts/routes/trades.js`
  - `backend/test/trades.settlementProposal.route.test.js`
  - `backend/scripts/services/eventListener.js`
  - `frontend/src/components/SettlementPreviewModal.jsx`
  - `frontend/src/components/SettlementProposalCard.jsx`
  - `frontend/src/App.jsx`

## 2. Method
- Settlement lifecycle functions were read in execution sequence from proposal creation to finalization/expiry.
- Storage overwrite/nonce behavior and deadline handling were checked directly against function logic.
- Event signatures and argument order were compared with worker ABI + event handlers.
- Backend preview math and frontend presentation were checked against on-chain acceptance math.

## 3. Function / Section Notes
- **proposeSettlement**: only CHALLENGED + trade party; expires stale active proposal first; prohibits second active proposal; increments per-trade nonce and overwrites storage with new proposal record.
- **rejectSettlement**: only counterparty can reject active proposal; blocked if expired/finalized/non-proposed.
- **withdrawSettlement**: only proposer can withdraw active proposal; same active/finalized guards.
- **expireSettlement**: anyone can mark proposed offer expired after deadline.
- **acceptSettlement**: only counterparty can accept active proposal; computes pool from current post-decay amounts; applies split then fee snapshots; state to RESOLVED + proposal FINALIZED before transfers (CEI).
- **helpers/views**: `getSettlementProposal` returns current per-trade storage object; `_expireSettlementProposalIfNeeded` mutates expired active proposal to EXPIRED and emits event.

## 4. Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| AES-SET-001 | MEDIUM | state-machine | `contracts/src/ArafEscrow.sol` / `proposeSettlement`, `acceptSettlement` | Proposal record is single-slot per trade and overwritten on each new proposal (after non-PROPOSED states), while `settlementProposalNonceByTrade` only provides monotonic IDs. | Historical proposal bodies are not kept on-chain; consumers relying only on current storage can lose prior proposal context unless event-sourced. | `settlementProposalsByTrade[_tradeId] = SettlementProposal({...})` replaces prior struct; nonce increments but old struct is not archived in storage. | Keep worker/event store as canonical proposal history; document clearly that `getSettlementProposal` is “current snapshot”, not immutable full history. |
| AES-SET-002 | LOW | docs-mismatch | `contracts/src/ArafEscrow.sol` API surface vs requested naming | Function names are `withdrawSettlement` and `expireSettlement` (not `withdrawSettlementProposal` / `expireSettlementProposal`). | Integration teams may call wrong selector if they follow naming from docs/tasks instead of ABI. | Contract exports `withdrawSettlement(uint256)` / `expireSettlement(uint256)` only. | Update integration docs/snippets to exact ABI names and add ABI-based compile-time checks in off-chain clients. |

## 5. No-Finding Notes
- **Locked funds consistency:** accepted settlement pool uses `currentCrypto + currentMakerBond + currentTakerBond` from `_calculateCurrentAmounts`, so split base is aligned with live locked value after decay.
- **Split safety / rounding:** maker share is bounded to `<=10000`, taker share computed as complement; gross payouts sum exactly to pool (`takerGross = pool - makerGross`) eliminating split-over/underflow drift.
- **Accept/reject/withdraw/expire ordering:** state-machine guards enforce PROPOSED-only mutations; FINALIZED path is terminal and blocked for later proposal mutations.
- **Terminal re-entry:** after settlement acceptance (`t.state = RESOLVED`), release/burn/settlement mutation paths are blocked by their state gates.
- **Deadline checks:** proposal creation enforces future + min expiry + max horizon; explicit and lazy expiry paths are both present.
- **Backend preview parity:** preview route computes from on-chain `getCurrentAmounts` + mirrored fee snapshots, matching accept-settlement math structure and marked informational/non-authoritative.
- **Frontend authority boundary:** settlement modal/card explicitly labels preview as non-authoritative; tx authority remains on-chain (proposal/accept calls).
- **Event arg order:** settlement event signatures/arg order are aligned between contract and worker ABI/arg-key maps.

## 6. Cross-File Risks
- **Current-snapshot vs history confusion:** on-chain storage exposes one current proposal; history exists effectively in events/worker DB, so tooling must not treat `getSettlementProposal` as full timeline.
- **Preview-time drift:** preview uses time-sensitive on-chain current amounts; numbers may change before acceptance tx mines (by design under decay).
- **Mirror dependency:** backend read-model routes depend on worker event ingestion quality for settlement proposal UX continuity.

## 7. Follow-up
1. Add explicit product docs: `getSettlementProposal` = current record, event log = immutable history.
2. Add ABI contract tests in frontend/backend build to assert exact function names (`withdrawSettlement`, `expireSettlement`) and settlement event arg order.
3. Validate worker replay/idempotency for settlement event sequences under reorg simulations.
4. Consider exposing optional on-chain view for last N proposal IDs only if history-in-contract becomes a product requirement.
