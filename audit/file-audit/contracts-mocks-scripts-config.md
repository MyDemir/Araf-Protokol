# File Audit — contracts mocks / scripts / config

## 1. Scope
- Mock contracts:
  - `contracts/src/MockERC20.sol`
  - `contracts/src/MockERC20FalseTransfer.sol`
  - `contracts/src/MockFeeOnTransferERC20.sol`
  - `contracts/src/MockRevenueReceiver.sol`
  - `contracts/src/MockRevenueReceiverReverter.sol`
  - `contracts/src/MockEscrowRewardView.sol`
- Deployment / ops scripts:
  - `contracts/scripts/deploy.js`
  - `contracts/scripts/deployRewards.js`
  - `contracts/scripts/configureRewards.js`
  - `contracts/scripts/smokeRewards.js`
  - `contracts/scripts/switchRewardsTreasury.js`
  - `contracts/scripts/verifyRewardsDeployment.js`
- Tooling/config:
  - `contracts/hardhat.config.js`
  - `contracts/package.json`
  - `contracts/.env.example`
- Cross-check context:
  - `contracts/src/ArafEscrow.sol`
  - `contracts/src/ArafRevenueVault.sol`
  - `contracts/src/ArafRewards.sol`
  - `backend/scripts/services/eventListener.js`

## 2. Method
- Each listed file was opened and reviewed line-by-line.
- For scripts, fail-closed guards, chain/address validation, and unsafe default behavior were checked.
- For mocks, behavior parity with real-world attack/failure modes was evaluated.
- Package/config was checked for security testing depth (coverage/fuzz/invariant/static analysis).

## 3. Function / Section Notes
- **MockERC20**: faucet + owner-only fixture mint; suitable for controlled tests.
- **MockFeeOnTransferERC20**: transferFrom fee behavior models exact-in shortfall path.
- **MockRevenueReceiver/Reverter**: hook success/failure paths are modeled.
- **MockEscrowRewardView**: open setter for test authority simulation.
- **deployRewards/configure/switch/verify**: strong address normalization + explicit confirmations in critical paths.
- **hardhat config**: runtime fail-closed RPC enforcement for selected network; placeholders used only to pass config parse.

## 4. Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| MSC-001 | MEDIUM | testing-gap | `contracts/src/MockERC20FalseTransfer.sol` | Mock only overrides `transfer` to return `false`, but does **not** override `transferFrom`. | Fails to model common broken-token path for `transferFrom` false-return behavior used by escrow/vault deposit flows. Coverage can overstate robustness for false-transfer tokens. | Contract inherits OZ transferFrom behavior unchanged; only `transfer(...)` overridden. | Add dedicated mock that returns false on `transferFrom` as well (or separate explicit mock for each failure mode). |
| MSC-002 | MEDIUM | deployment-env | `contracts/scripts/smokeRewards.js` | Public smoke mode (`CONFIRM_PUBLIC_SMOKE=yes`) still deploys fresh mock token + mock escrow + new vault/rewards and performs writes. | Accidental execution on public network creates stateful side effects/cost and may give false confidence vs real production contracts. | Script always deploys mocks/contracts; no branch to attach existing production addresses. | Keep write-smoke separated from read-only readiness; add explicit `CONFIRM_PUBLIC_WRITE_SMOKE=yes` + default read-only smoke for public nets. |
| MSC-003 | LOW | testing-gap | `contracts/package.json` | Security script matrix lacks dedicated fuzz/invariant/static analysis commands (e.g., slither/echidna/foundry invariant). | Important edge-case classes may be missed despite unit + coverage. | Scripts include compile/test/coverage and deployment ops only. | Add optional scripts for static analysis and invariant/fuzz regression pipelines. |

## 5. No-Finding Notes
- **Wrong-chain / wrong-RPC fail-closed**: hardhat env extension enforces mandatory RPC vars for `base` and `base-sepolia`.
- **Wrong-address guards**: reward deploy/config/switch/verify scripts normalize and reject zero/invalid addresses.
- **Treasury handoff isolation**: switch is intentionally separated and gated by explicit confirmation + precondition checks.
- **Wrong-owner/wiring checks**: verify/switch scripts assert vault↔rewards↔escrow link consistency and token support.
- **Private key fallback**: network accounts are empty when `DEPLOYER_PRIVATE_KEY` absent (safer than implicit fallback signer for remote networks).
- **Worker event coverage**: reward/revenue event signatures needed by backend worker are present and mapped.

## 6. Cross-File Risks
- Current mock suite strongly tests fee-on-transfer exact-in paths, but false-return transferFrom modeling gap can hide integration fragility with non-compliant ERC-20s.
- Readiness scripts validate wiring/flags but do not formally assert runtime accounting invariants (especially vault/rewards economic consistency).
- `.env.example` contains placeholder keys clearly, yet using `PRIVATE_KEY` (not `DEPLOYER_PRIVATE_KEY`) may confuse operators unless docs map both explicitly.

## 7. Follow-up
1. Add `MockERC20FalseTransferFrom` (or extend existing mock) and wire new negative tests for deposit paths.
2. Split smoke into read-only and write-smoke profiles for public chains.
3. Add security scripts (`slither`, fuzz, invariant) to package scripts and CI.
4. Add explicit operator docs mapping env variable names used by each script (`PRIVATE_KEY` vs `DEPLOYER_PRIVATE_KEY`, token env precedence).
