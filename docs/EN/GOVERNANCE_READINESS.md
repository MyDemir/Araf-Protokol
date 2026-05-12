# Araf Governance Readiness — Owner-Controlled Surfaces

> Scope: `ArafEscrow.sol`, `ArafRevenueVault.sol`, `ArafRewards.sol`, and deploy/configure/switch scripts.
>
> This document does **not** change runtime behavior; it separates implemented on-chain guards from recommended operational controls.

## 1) Baseline governance principles

### Implemented guards
- Owner-only functions are protected by Solidity `onlyOwner`.
- Pause/unpause surfaces use OpenZeppelin `Pausable` to stop new write flows; existing close/read flows are evaluated separately by design.
- Some parameters have contract-level bounds, including fees, cooldowns, reward bps, token config, and reputation policy values.
- The deploy script enforces separation between `FINAL_OWNER_ADDRESS` and `TREASURY_ADDRESS` in public/custom deployment modes.
- Rewards treasury switching is isolated in a separate script with explicit environment confirmation.

### Operational recommendations — not automatic code guarantees
- The production owner should be a multisig or equivalent operational control, **not a personal hot wallet**.
- This repository does not automatically deploy a multisig or timelock. Any such control must be independently deployed and verified before use.
- For public/custom deployments, **final owner** and **treasury** should be separated.
- Config changes should be announced in advance, logged with a change ticket/runbook, and verified afterward with on-chain getters/events.
- Reward/treasury switching must not be bundled with initial deployment; it should happen only after smoke and verification in a separate change window.

## 2) Common change process

Every owner-controlled change should follow at least this process:

1. **Announcement**: purpose, contract, function, parameters, expected impact.
2. **Pre-check**: current on-chain values, owner address, treasury/funding addresses, token decimals, and chain id.
3. **Execution**: single-purpose transaction through multisig/operational control.
4. **Post-check**: getter/event/manifest/backend readiness verification.
5. **Log**: tx hash, block, old value, new value, approvers, rollback/mitigation note.

## 3) ArafEscrow.sol owner surfaces

| Function | Who should hold authority? | Expected production control model | Risk if misconfigured | Recommended pre-change checks | Recommended post-change verification |
|---|---|---|---|---|---|
| `transferOwnership(address)` | Final protocol owner | Multisig/equivalent; not a personal hot wallet | Loss of all owner surfaces or concentration under one person | New owner address, multisig threshold, chain, non-zero, separated from treasury? | `owner()` shows new address; manifest/runbook updated |
| `setTreasury(address)` | Final owner multisig | Separate change window; explicit approval for vault switch | Protocol revenue routed to wrong address; rewards/vault wiring can break | Current `treasury()`, target vault/treasury, `EXPECTED_CURRENT_TREASURY_ADDRESS`, vault wiring, smoke/verify results | `treasury()` target address; revenue event/smoke; backend config updated |
| `setFeeConfig(uint256,uint256)` | Final owner multisig | Announced parameter change | Excessive fees, user trust loss, snapshot confusion on active trades | Current `getFeeConfig()`, max 2000 bps guard, economic analysis, UI/env impact | `getFeeConfig()` new values; `FeeConfigUpdated`; new-order snapshot test |
| `setCooldownConfig(uint256,uint256)` | Final owner multisig | Anti-sybil/risk approval | Users can be unnecessarily blocked or sybil protection weakened | Current `getCooldownConfig()`, max cooldown guard, tier impact, support plan | `getCooldownConfig()` new values; `CooldownConfigUpdated`; taker-entry smoke |
| `setTokenConfig(address,bool,bool,bool,uint8,uint256[4])` | Final owner multisig | Token onboarding/offboarding runbook | Wrong token, decimals, direction flags, or tier limits can cause fund/revert/market outages | Token contract, decimals, supported/sell/buy flags, tier max array, liquidity, frontend/backend env alignment | `getTokenConfig()`, `getTierMaxAmount()`, `TokenConfigUpdated`, create/fill smoke |
| `setReputationPolicy(...)` | Final owner multisig | Risk/governance approval | Ban/decay/reward/penalty economics can become unfair or unsafe | Current policy, clean-period bounds, ban threshold, delta bounds, simulation | `ReputationPolicyUpdated`; sample outcome read-model checks |
| `setReputationTierThresholds(uint32[5],uint32[5])` | Final owner multisig | Risk/governance approval | Tier progression becomes too easy/hard; bond/eligibility economics break | Array ordering, max-risk monotonic rule, ban-threshold fit, sample user calculations | `ReputationTierThresholdsUpdated`; sample `getReputation()` effective tiers |
| `pause()` | Final owner multisig or emergency multisig module | Emergency runbook; reason and scope logged | New order/fill flows stop; user panic/support load | Incident definition, impacted flows, close flows remain available?, comms copy | `paused()==true`; create/fill reverts; close/read smoke |
| `unpause()` | Final owner multisig | Incident closure approval | Reopening before root cause fix can repeat exploit/outage | Root cause, patch/config verification, smoke, monitoring | `paused()==false`; create/fill smoke; incident log closed |

## 4) ArafRevenueVault.sol owner surfaces

| Function | Who should hold authority? | Expected production control model | Risk if misconfigured | Recommended pre-change checks | Recommended post-change verification |
|---|---|---|---|---|---|
| `transferOwnership(address)` | Rewards/vault governance owner | Multisig/equivalent | Vault treasury/reward settings are lost | New owner multisig, manifest, non-zero | `owner()` verification |
| `setRewardBps(uint256)` | Rewards governance owner | Announced reward split change | Treasury/reward split deviates from expectations; sustainability risk | Current `rewardBps`, 4000–7000 guard, budget analysis, mainnet checklist target | `rewardBps()`, `RewardBpsUpdated`, revenue split smoke |
| `setFinalTreasury(address)` | Rewards/vault governance owner | Treasury ops approval | Treasury share withdrawn to wrong address | Target address, accounting approval, non-zero | `finalTreasury()`, `FinalTreasuryUpdated`, optional small withdraw smoke |
| `setRewards(address)` | Rewards/vault governance owner | Only verified ArafRewards address | Reward reserve allocation power goes to wrong contract | Rewards address, `rewards.revenueVault()==vault`, manifest, verify script | `rewards()`, `RewardsUpdated`, allocation dry/smoke |
| `setSupportedToken(address,bool)` | Rewards/vault governance owner | Token support runbook | Revenue/funding opens/closes for wrong token | Token address, decimals/env, escrow token config alignment | `supportedToken(token)`, `SupportedTokenUpdated` |
| `setProductPool(bytes32,bool,string)` | Rewards/vault governance owner | Product/campaign ops approval | Sponsor funding goes to wrong campaign; analytics misleading | `productId`, metadata URI, enabled flag, campaign owner | `productPools(productId)`, `ProductPoolUpdated` |
| `withdrawTreasuryShare(address,uint256,address)` | Treasury ops multisig | Accounting-controlled withdrawal | Wrong recipient or amount; treasury reserve reduced | `treasuryReserve`, recipient, amount, supported token, accounting approval | `TreasuryShareWithdrawn`, balance/reserve deltas |
| `withdrawTreasuryShareToFinal(address,uint256)` | Treasury ops multisig | Preferred production withdrawal | Funds go to wrong address if final treasury is wrong | `finalTreasury`, reserve, amount, accounting approval | Event recipient is `finalTreasury`; balances |
| `pause()` / `unpause()` | Rewards/vault governance owner | Emergency runbook | Revenue hook/funding/allocation stop or restart too early | Incident, current escrow treasury target, rewards state | `paused()`, funding/revenue/allocation smoke |

## 5) ArafRewards.sol owner surfaces

| Function | Who should hold authority? | Expected production control model | Risk if misconfigured | Recommended pre-change checks | Recommended post-change verification |
|---|---|---|---|---|---|
| `transferOwnership(address)` | Rewards governance owner | Multisig/equivalent | Epoch allocation/finalization/sweep authority lost | New owner, manifest, threshold | `owner()` verification |
| `allocateEpochRewards(uint256,address,uint256)` | Rewards governance owner | Epoch allocation runbook | Wrong epoch/token/amount; reward reserve depletion or wrong claimable state | Epoch state, `epochTokenFinalized=false`, vault reserve/external funding, token supported, totalWeight | `epochRewardPool`, `epochTokenAllocated`, `EpochRewardAllocated`, vault reserve delta |
| `finalizeEpochToken(uint256,address)` | Rewards governance owner | Epoch close approval | Early/late finalize; claim flow breaks | Epoch ended, trade outcome records complete, token pool and totalWeight | `epochTokenFinalized`, `EpochTokenFinalizedEvent`, claimable smoke |
| `sweepEpochDust(uint256,address,address)` | Rewards governance owner | Treasury/accounting approval after claim window | Sweep attempted before claims finish or to wrong recipient | `epochTokenFinalized`, claim delay/window, claimed weight, recipient | `EpochDustSwept`, pool conservation, recipient balance |
| `pause()` / `unpause()` | Rewards governance owner | Emergency runbook | Outcome recording/claim/allocation stops or restarts incorrectly | Incident, pending claims, allocation state, user comms | `paused()`, record/claim behavior smoke |

## 6) Deploy/configure/switch script governance surfaces

| Script / surface | Who should hold authority? | Expected production control model | Risk if misconfigured | Recommended pre-change checks | Recommended post-change verification |
|---|---|---|---|---|---|
| `contracts/scripts/deploy.js` — `TREASURY_ADDRESS` | Treasury ops control | Separate from final owner in public/custom deploys | Revenue goes to wrong treasury | Address, chain, non-zero, public/custom separation | `escrow.treasury()`, manifest |
| `contracts/scripts/deploy.js` — `FINAL_OWNER_ADDRESS` | Governance multisig | Required in public/custom deploys; must not equal treasury | Owner is hot wallet or confused with treasury | Multisig/equivalent, chain, threshold, separation | `escrow.owner()`, ownership transfer log |
| `contracts/scripts/deploy.js` — token env/config | Governance/deploy ops | Chain-aware token env | Wrong token/decimals/tier limits | BASE_MAINNET/BASE_SEPOLIA token env, decimals, tier max | `getTokenConfig`, manifest, smoke |
| `contracts/scripts/deployRewards.js` | Rewards governance/deploy ops | Vault/rewards deploy + wiring; no treasury switch | Wrong owner/finalTreasury/rewards wiring | `FINAL_OWNER_ADDRESS`, `FINAL_TREASURY_ADDRESS`, escrow address, tokens, manifest overwrite guard | manifest, `vault.rewards`, supported tokens, `rewardBps=4000` |
| `contracts/scripts/configureRewards.js` | Rewards governance ops | Wiring-only; treasury switch forbidden | Treasury switch accidentally bundled into configure | Env/manifest addresses, no `CONFIRM_SWITCH_TREASURY_TO_VAULT` | `vault.rewards`, supported tokens |
| `contracts/scripts/verifyRewardsDeployment.js` | Read-only ops | Go-live readiness verification | Missing/mismatched wiring goes unnoticed | Env/manifest addresses, optional expected treasury | OK/fail outputs; `rewardBps=4000`; token support |
| `contracts/scripts/switchRewardsTreasury.js` | Final owner multisig | Separate explicit change window; `CONFIRM_TREASURY_SWITCH=true` | Escrow treasury switches to wrong vault; revenue redirect risk | Vault/rewards/escrow wiring, token support, `rewardBps`, `EXPECTED_CURRENT_TREASURY_ADDRESS`, smoke | `escrow.treasury()==vault`, revenue-hook smoke, readiness |
| `contracts/scripts/smokeRewards.js` | Deploy/QA ops | Validation-only; not used for production governance changes | Public smoke on wrong network/mock context can give misleading confidence | Local/staging?, if public then `CONFIRM_PUBLIC_SMOKE=yes`, addresses are not production governance targets | Smoke output, and confirmation that no production owner state changed |

## 7) Go-live governance gates

- [ ] Production owner is multisig/equivalent; not a personal hot wallet.
- [ ] `FINAL_OWNER_ADDRESS != TREASURY_ADDRESS` for public/custom deploys.
- [ ] Rewards `FINAL_TREASURY_ADDRESS` is controlled by treasury/accounting ops.
- [ ] Deploy and configure are complete; treasury switch has not been performed yet.
- [ ] Verify/smoke passed.
- [ ] Treasury switch has a separate announcement, transaction, and post-check.
- [ ] All config changes are logged with tx hash and before/after values.
