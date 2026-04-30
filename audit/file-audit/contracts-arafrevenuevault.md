# File Audit — contracts/src/ArafRevenueVault.sol

## 1. Scope
- Primary file (full line-by-line read): `contracts/src/ArafRevenueVault.sol`
- Cross-check files:
  - `contracts/test/ArafRevenueVault.test.js`
  - `contracts/src/ArafEscrow.sol`
  - `contracts/src/ArafRewards.sol`
  - `contracts/scripts/switchRewardsTreasury.js`
  - `contracts/scripts/verifyRewardsDeployment.js`
  - `backend/scripts/services/eventListener.js`

## 2. Method
- `ArafRevenueVault.sol` was read top-to-bottom and each state-changing function was checked for auth, CEI order, reserve accounting, and transfer assumptions.
- Hook semantics (`onArafRevenue`) were compared against escrow caller behavior in `ArafEscrow._sendProtocolRevenue`.
- Reward allocation flow was cross-checked with `ArafRewards.allocateEpochRewards` and worker event mirror signatures.
- Existing tests were reviewed for covered vs uncovered accounting scenarios.

## 3. Function / Section Notes
- `onArafRevenue`: escrow-only, supported token gate, split by `rewardBps`, emits `EscrowRevenueReceived`.
- `fundGlobalRewards` / `fundProductRewards`: exact-in enforcement using before/after balance delta.
- `withdrawTreasuryShare*`: owner-only withdrawal constrained by `treasuryReserve` mapping.
- `transferRewardAllocation` / `transferEpochAllocation`: rewards-only pull model; reserve debited before transfer.
- pause surface blocks revenue hook, external funding, and reward allocation transfers.

## 4. Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| ARV-001 | CRITICAL | accounting-math | `contracts/src/ArafRevenueVault.sol` / `onArafRevenue` | Revenue hook does **not** prove that the specific `amount` was transferred by escrow in the same operation; it only checks `balanceAfter >= liabilities + amount`. Existing surplus balance (e.g., external funding) can satisfy this inequality. | Escrow (or compromised escrow authority) can classify pre-existing vault balance as fresh escrow revenue, inflating reserves and misclassifying external funds into protocol-split buckets. This breaks accounting isolation between escrow revenue and sponsor funding. | `onArafRevenue` computes `currentLiability` then checks inequality against full token balance; no pre/post delta tied to this call. | Enforce exact-in for escrow hook as well (track prior accounted balance or require escrow passes balance proof pattern); alternatively segregate escrow-revenue and external-funding custody addresses/tokens. |
| ARV-002 | MEDIUM | testing-gap | `contracts/test/ArafRevenueVault.test.js` | Tests validate exact-in for external funding but do not include adversarial scenario where `onArafRevenue` is called without fresh transfer while surplus balance already exists. | Critical liability-mix bug can remain undetected in regression cycles. | No test case asserting escrow hook must fail when amount is not freshly transferred and only surplus is present. | Add negative test: pre-fund vault via external funding, call `onArafRevenue` without new mint/transfer, expect revert (after fixing hook invariant). |

## 5. No-Finding Notes
- **onArafRevenue caller auth:** `onlyEscrow` is strict and constructor sets immutable escrow.
- **supported token policy:** gate exists in hook and funding functions; owner-controlled as expected.
- **treasury withdrawal safety:** treasury withdraws are constrained by `treasuryReserve`; reward reserve cannot be directly withdrawn via treasury functions.
- **reward allocation auth:** only configured `rewards` contract can call allocation transfer functions.
- **multi-token separation:** reserve/funding/liability mappings are token-scoped, preventing cross-token accounting bleed.
- **CEI/reentrancy posture:** key transfer functions are `nonReentrant`; reserve decrements happen before `safeTransfer` in withdrawal/allocation paths.
- **event coverage:** vault events for escrow revenue, external/product funding, and treasury withdrawals are present; worker ABI includes corresponding reward/revenue events.

## 6. Cross-File Risks
- `ArafEscrow._sendProtocolRevenue` assumes treasury hook (`onArafRevenue`) is a reliable accounting sink; ARV-001 weakens that assumption and can contaminate downstream reward/treasury metrics.
- `ArafRewards.allocateEpochRewards` relies on vault reserves being truthful; if reserves are inflated by misclassified escrow revenue, epoch pools can be sourced from unintended balances.
- Deployment scripts check wiring/flags (`escrow/rewards/supportedToken/rewardBps`) but do not validate runtime accounting invariants.

## 7. Follow-up
1. Fix `onArafRevenue` accounting invariant to bind credited amount to actual fresh inflow.
2. Add targeted tests for surplus-balance misclassification and liability invariants across mixed funding sources.
3. Add invariant test: `tokenBalance >= rewardReserve + treasuryReserve + sum(externalFunding buckets)` with controlled transitions.
4. Extend operational monitoring to alert on abnormal jumps in `totalEscrowRevenue` without matching escrow transfer traces.
