# File Audit — contracts/src/ArafEscrow.sol (Trade Lifecycle 03: release/challenge/burn)

## 1. Scope
- Primary file: `contracts/src/ArafEscrow.sol`
  - `reportPayment`
  - `releaseFunds`
  - `autoRelease`
  - `challengeTrade`
  - `burnExpired`
  - `pingMaker`
  - `pingTakerForChallenge`
  - `getCurrentAmounts` (`_calculateCurrentAmounts` path)
  - terminal helpers (`_recordTerminalOutcome`, terminal state transitions)
  - payout / transfer helpers (`_executeCancel`, `_sendProtocolRevenue`, `_safeTransferExactIn` usage context)
- Cross-check files:
  - `contracts/test/ArafEscrow.test.js`
  - `contracts/test/partialSettlement.core.test.js`
  - `contracts/test/protocolRevenue.classification.test.js`
  - `contracts/test/transferExactIn.security.test.js`
  - `backend/scripts/services/eventListener.js`
  - `backend/scripts/routes/trades.js`
  - `frontend/src/App.jsx`
  - `frontend/src/components/SettlementPreviewModal.jsx`
  - `frontend/src/components/SettlementProposalCard.jsx`

## 2. Method
- Trade lifecycle functions were read top-down in execution order.
- For each path, precondition/state guard → state mutation → transfer sequence (CEI) was checked.
- Event payload/order and off-chain mirror assumptions were compared with worker + frontend consumption.
- Decay math and timeout windows were cross-checked against tests and preview/read paths.

## 3. Function / Section Notes
- **reportPayment**: LOCKED→PAID, taker-only, non-empty receipt hash.
- **releaseFunds**: PAID/CHALLENGED→RESOLVED, maker-only, applies decay + fee snapshots; emits `EscrowReleased`.
- **pingTakerForChallenge / challengeTrade**: maker path split into ping wait + dispute open; conflicting ping path blocked.
- **pingMaker / autoRelease**: taker liveness path; 48h grace + 24h response window; penalties routed as treasury revenue.
- **burnExpired**: CHALLENGED + `challengedAt + MAX_BLEEDING`; burns all remaining value to treasury route.
- **_calculateCurrentAmounts**: challenge-time decay of maker/taker bonds and delayed decay for crypto leg.
- **_sendProtocolRevenue**: transfer to treasury + optional hook callback; hook revert reverts whole tx.
- **Terminal helpers**: first terminal snapshot is set-once via `_recordTerminalOutcome`.

## 4. Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| AES-TRADE-001 | HIGH | state-machine | `contracts/src/ArafEscrow.sol` / `releaseFunds` | `releaseFunds` on CHALLENGED path does not require maker to wait for full bleeding/burn horizon; maker can unilaterally finalize right after `challengeTrade` and before `burnExpired` window matures. | Dispute path can be short-circuited by the same actor that opened challenge, reducing predictability of “burn-or-decay pressure” expectations for counterparties. | `challengeTrade` sets CHALLENGED; `releaseFunds` accepts CHALLENGED immediately with no minimum challenge age check. | If protocol intent is strict challenge lock, add a minimum challenge-age gate for CHALLENGED release (or document this as intentional authority behavior explicitly in user-facing docs/UI). |
| AES-TRADE-002 | MEDIUM | worker-mirror | `backend/scripts/services/eventListener.js` / `_onMakerPinged` | Both `pingMaker` and `pingTakerForChallenge` emit `MakerPinged` with same signature; worker disambiguates by pinger role from mirrored trade addresses. **uncertain** under transient stale mirror/replay ordering. | If mirror is stale/missing at handler time, ping-path flags (`pinged_by_taker` vs `challenge_pinged_by_maker`) can drift until replay repair; UI timers may temporarily show wrong action window. | Single event name for two logical paths; handler must infer branch from address context instead of explicit enum in event. | Consider explicit ping-path event typing (ABI change) or enforce immediate chain re-read fallback inside ping handler before persisting branch flags. |
| AES-TRADE-003 | LOW | frontend-tx-orchestration | `frontend/src/components/SettlementPreviewModal.jsx` + `backend/scripts/routes/trades.js` | `getCurrentAmounts`-based preview is correctly marked non-authoritative, but UI renders raw amounts without explicit “post-decay and time-sensitive” label near numeric values. | Users may over-trust static preview numbers while decay continues between preview and on-chain acceptance/release. | Preview copy says informational, but amount rows do not restate time-sensitive decay semantics. | Add explicit “values can change with time/decay until tx mined” note adjacent to amounts (UX/docs hardening). |

## 5. No-Finding Notes
- **Double payout / re-transfer risk:** core terminalizing paths set terminal state (`RESOLVED`/`BURNED`/`CANCELED`) before transfers; re-entry to those flows is blocked by state guards.
- **CEI + reentrancy:** reviewed lifecycle functions are `nonReentrant`, and state transitions happen before outbound transfers in release/auto/burn/cancel/settlement finalize paths.
- **Burn accounting:** `burnExpired` computes remaining current pool via `_calculateCurrentAmounts`, transitions to `BURNED`, then routes total residual as `BURN_RESIDUAL` revenue.
- **Bond distribution:** release/auto/cancel each apply distinct, internally consistent maker/taker bond handling and fee/penalty booking.
- **Exact-in defense:** fee-on-transfer entry locks are rejected by `_safeTransferExactIn`; dedicated tests cover create/fill failure paths.
- **Event alignment:** lifecycle event signatures used by contract are mirrored in backend worker ABI and frontend flow expectations.

## 6. Cross-File Risks
- **Challenge path semantics clarity:** contract permits CHALLENGED→RESOLVED via maker release without minimum age; off-chain UX may assume longer dispute lock unless explicitly explained.
- **Ping event multiplexing:** single `MakerPinged` event for two routes increases mirror interpretation complexity.
- **Preview drift by design:** `getCurrentAmounts` is time-dependent during CHALLENGED; backend/frontend correctly avoid authority, but user education is critical.

## 7. Follow-up
1. Next pass: full settlement lifecycle (`propose/reject/withdraw/expire/accept`) with replay/idempotency emphasis in worker.
2. Inspect `_onEscrowReleased/_onEscrowBurned/_onBleedingDecayed` handlers end-to-end for monotonic status updates under reorg/retry.
3. Add explicit product docs for CHALLENGED release semantics vs burn path expectations.
4. Consider stronger event typing for ping paths to reduce mirror inference ambiguity.
