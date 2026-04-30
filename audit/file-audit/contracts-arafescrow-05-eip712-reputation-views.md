# File Audit — contracts/src/ArafEscrow.sol (EIP-712 / Reputation / Views 05)

## 1. Scope
- Primary file: `contracts/src/ArafEscrow.sol`
  - EIP-712 domain (`EIP712("ArafEscrow","1")`, `domainSeparator`)
  - `proposeOrApproveCancel`
  - cancel signature verification + nonce/deadline model
  - reputation update logic (`_record*`, `_apply*`, `_refreshTierAndBanState`, `decayReputation`)
  - reputation getters (`getReputation`, `getFirstSuccessfulTradeAt`)
  - `getRewardableTrade`
  - public/external view surfaces in requested area
  - internal math/helpers used by above flows
- Cross-check files:
  - `contracts/test/reputationV3.authority.test.js`
  - `contracts/test/rewardableTradeView.test.js`
  - `backend/scripts/routes/trades.js`
  - `backend/scripts/routes/rewards.js`
  - `backend/scripts/services/eventListener.js`
  - `frontend/src/hooks/useArafContract.js`
  - `frontend/src/app/useAppSessionData.jsx`

## 2. Method
- Contract cancel/reputation/view functions were read in source order.
- EIP-712 typed-data fields were matched against frontend signer and backend verifier code.
- Tuple order and named return assumptions were checked across frontend normalize logic and backend worker ABI strings.
- Reward view semantics were cross-checked with rewardable-trade tests.

## 3. Function / Section Notes
- **EIP-712 domain**: contract domain is fixed (`name=ArafEscrow`, `version=1`) and exposed via `domainSeparator()`.
- **Cancel signature flow**: `proposeOrApproveCancel` validates state, deadline window, signer party status, typed-data recovery, and increments trade-scoped nonce before marking proposer flags.
- **Replay model**: nonce key is `sigNonces[wallet][tradeId]` (wallet+trade scoped).
- **Reputation writes**: terminal action paths call `_record*` helpers, then `_emitReputationUpdated`; positive/negative signals update risk points and tier/ban constraints.
- **Reputation decay**: `decayReputation` is explicit call-based reset after clean-period checks.
- **Reward view**: `getRewardableTrade` returns terminal snapshot (`TerminalTradeSnapshot`) + trade metadata as contract-authoritative read model.

## 4. Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| AES-EIP712-001 | MEDIUM | frontend-tx-orchestration | `frontend/src/hooks/useArafContract.js` / `signCancelProposal` | Frontend typed-data uses wallet `chainId` from wagmi hook, while backend verifier derives chain from RPC provider; mismatch under wrong-wallet-network scenarios can cause user-signed payload rejection after off-chain coordination. | Not a fund-loss vector (fail-closed), but creates operational failure window and confusing UX around valid signatures. | Contract/backend domain checks are strict; frontend pre-validates chain but still depends on runtime chain context parity with backend RPC. | Keep strict chain gate; add explicit UI display of domain fields used for signing and reject signing if local chain differs from expected chain config.
| AES-EIP712-002 | LOW | docs-mismatch | `contracts/src/ArafEscrow.sol` / `proposeOrApproveCancel` vs comments in frontend | Frontend comment says “contract side should also enforce deadline cap”, and contract indeed enforces it (`MAX_CANCEL_DEADLINE`). Comment is stale/misleading now. | Integrator confusion (already-fixed control appearing “missing”). | Contract checks `_deadline > block.timestamp + MAX_CANCEL_DEADLINE` and reverts `DeadlineTooFar`. | Update frontend comment/docs to reflect current enforced contract invariant.

## 5. No-Finding Notes
- **EIP-712 domain alignment:** contract (`ArafEscrow`, `1`) matches frontend signing type/domain and backend `domainSeparator` verification logic.
- **Nonce replay resistance:** replay on same wallet+trade is blocked by nonce increment after successful signature verify; cross-trade replay is also blocked by typed message including `tradeId`.
- **Expired signature acceptance:** contract rejects when `block.timestamp > deadline`; backend also pre-checks deadline for coordination route.
- **Cancel terminal safety:** cancel flow only allowed in LOCKED/PAID/CHALLENGED and transitions to CANCELED before transfers via `_executeCancel`; no double terminalization observed in this path.
- **Reputation outcome mapping:** manual/auto/mutual/disputed/burn/partial counters and risk-point semantics are internally coherent and covered by dedicated authority tests.
- **`getRewardableTrade` authority model:** uses only contract state/snapshots; tests validate terminal outcome and fee fields per path.
- **Tuple order lock-step:** `getReputation` 16-field order matches frontend `REPUTATION_V3_KEYS` and backend worker ABI declaration.

## 6. Cross-File Risks
- **Typed-data environment drift:** strict by-design checks protect funds but can degrade UX if wallet network / backend expected chain / contract address are not tightly synchronized.
- **View ABI fragility:** inline ABI duplication in frontend/backend remains a maintenance risk (must stay lock-step with contract return order).
- **Decay execution model:** `decayReputation` is manual call-triggered; any assumed “automatic backend clean-slate job” must not be treated as protocol authority.

## 7. Follow-up
1. Add automated ABI conformance test to compare frontend/backend inline signatures against contract artifact (domain, `getReputation` tuple order, cancel fields).
2. In UI, show explicit EIP-712 domain summary before signing cancel payloads.
3. Add monitoring alert for high rate of backend `domainSeparator` mismatch / invalid-signature responses.
4. Document clearly that reputation clean-slate is on-chain callable logic, not backend scheduler authority.
