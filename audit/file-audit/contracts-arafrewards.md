# File Audit — contracts/src/ArafRewards.sol

## 1. Scope
- Primary file (full line-by-line read): `contracts/src/ArafRewards.sol`
- Cross-check files:
  - `contracts/test/ArafRewards.test.js`
  - `contracts/test/rewards.rollout.e2e.test.js`
  - `contracts/test/rewards.goLive.readiness.test.js`
  - `contracts/src/ArafRevenueVault.sol`
  - `contracts/src/ArafEscrow.sol`
  - `contracts/src/MockEscrowRewardView.sol`
  - `contracts/scripts/configureRewards.js`
  - `contracts/scripts/deployRewards.js`
  - `contracts/scripts/smokeRewards.js`
  - `frontend/src/hooks/useRewardsContract.js`
  - `frontend/src/components/RewardsDashboard.jsx`
  - `backend/scripts/routes/rewards.js`
  - `backend/scripts/services/eventListener.js`

## 2. Method
- `ArafRewards.sol` reviewed top-to-bottom, function-by-function.
- Authority boundaries were checked at each transition (escrow view read, vault pull, claim).
- Epoch math, finalize/claim timing, and distribution invariants were cross-checked against tests.
- Off-chain read/UI paths were checked for authority leakage and tuple/ABI drift risk.

## 3. Function / Section Notes
- `recordTradeOutcome` is permissionless but sources outcome strictly from `escrow.getRewardableTrade`.
- `recordedTrade[tradeId]` blocks duplicate writes.
- Epoch is derived from `terminalAt / epochDuration`.
- `allocateEpochRewards` is owner-only and pulls from vault via `transferEpochAllocation`.
- `finalizeEpochToken` is owner-only, epoch-end-gated; claim additionally enforces `claimDelay`.
- `claim` uses deterministic pro-rata formula over fixed `epochRewardPool` and `totalWeight`.

## 4. Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| ARR-001 | MEDIUM | accounting-math | `contracts/src/ArafRewards.sol` / `claim` | Integer floor division leaves deterministic rounding dust in contract (`sum(claims) <= epochRewardPool`), with no explicit sweep/rollover path. | Small residual balances can accumulate per epoch-token and become operationally stranded or require manual policy outside contract. | Claim amount uses `(epochRewardPool * userWeight) / totalWeight` with per-user floor; pool is never decremented/settled to zero by design. | Add explicit dust policy (rollover to next epoch or treasury/reward reserve reclaim) and emit dust accounting event when finalization/closure happens. |
| ARR-002 | LOW | state-machine | `contracts/src/ArafRewards.sol` / `finalizeEpochToken` | Token can be finalized without checking whether allocation was ever made (`epochTokenAllocated` is written but not enforced). | Not unsafe for funds, but can produce confusing UX/state where finalized token exists with zero pool and claims revert `ZeroAmount`/`ZeroTotalWeight`. | `finalizeEpochToken` checks end-time and finalized flag only; no `epochTokenAllocated` guard. | Consider optional guard or informational event/route flag to signal “finalized-empty epoch token” explicitly. |

## 5. No-Finding Notes
- **Outcome authority:** reward outcome is contract-authoritative from escrow view (`getRewardableTrade`), not backend/frontend inputs.
- **Double record prevention:** `recordedTrade` mapping enforces single write per trade id.
- **Epoch boundaries:** epoch derivation and claim/finalize timing checks are coherent and test-covered.
- **Finalize/claim ordering:** claim requires finalized token and epoch+delay windows; allocation without finalize cannot be claimed.
- **Zero-weight behavior:** `ZeroTotalWeight` and `ZeroUserWeight` reverts are explicit and correct fail-closed behavior.
- **Claim cap:** aggregate claims cannot exceed `epochRewardPool` due fixed pro-rata over invariant denominator.
- **External funding mixing:** rewards contract does not compute source; vault handles source precedence (`externalFundingByEpoch` first, then rewardReserve).
- **Permissionless griefing:** `recordTradeOutcome` is permissionless but bounded by escrow terminal view and one-time record gate.
- **Backend authority boundary:** rewards route is read-only / mirror-only and explicitly marks claimable estimate as unavailable off-chain.
- **Dashboard authority boundary:** UI copy correctly states recipients/weights/outcomes are not sponsor-configurable.

## 6. Cross-File Risks
- `ArafRewards` safety depends on truthful vault accounting; if vault revenue accounting is compromised, epoch pools inherit contamination risk.
- Frontend hook uses on-chain `claimable` directly (good), while backend `/claimable` endpoint is intentionally non-authoritative; clients must not mix these semantics.
- Worker tracks `EpochRewardAllocated` and `RewardClaimed` as mirror events; on-chain remains source of truth for eligibility math.

## 7. Follow-up
1. Define and implement explicit rounding-dust lifecycle policy.
2. Decide whether `finalizeEpochToken` should require prior allocation (or remain permissive with stronger UX signaling).
3. Add invariant tests for cumulative claimed <= epoch pool across many users and random weights.
4. Integrate vault-fix validation into rewards go-live readiness, since rewards accounting inherits vault correctness.
