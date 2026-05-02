# Proof of Peace Rewards — Rollout Plan (EN)

This document defines a **safe, staged, and game-theory-aligned rollout** for Proof of Peace Rewards.

Proof of Peace is the positive-incentive side of the dispute system. Bleeding Escrow makes bad strategy expensive; Proof of Peace makes fast clean resolution more valuable in future reward epochs.

> Canonical principle: **Rewards are not cashback; they are a pro-rata peace premium for fast clean resolution.**

## 1) Economic and Authority Boundaries

- Rewards are **not trade cashback**.
- Eligibility is generated only from **ArafEscrow terminal outcomes**.
- Backend is **mirror/read-model only** and cannot define recipients, eligibility, weights, or claimable amounts.
- Admin cannot choose recipients.
- Sponsors/funders cannot choose recipients.
- `paymentRiskLevel` is **not** a reward multiplier.
- In MVP, these terminal outcomes are **zero-weight**:
  - auto-release
  - burn
  - mutual cancel
  - disputed release
- In MVP, **Tier 0 is not reward eligible**.
- `rewardBps` starts at **4000** and can only be **4000–7000**.

## 2) Game-Theory Guardrails

The reward system is not only a positive incentive; it is also a limited economic defense against farming and bad strategy.

| Behavior | Reward posture | Why |
|---|---|---|
| Fast clean release | Highest positive weight | Incentivizes the best cooperative equilibrium |
| Slow clean release | Lower positive weight | Prices delay as opportunity cost |
| Partial settlement | Low positive weight | Rewards dispute de-escalation without making disputes profitable |
| Auto-release | Zero weight | Maker inactivity is not rewarded |
| Mutual cancel | Zero weight | Avoids cancel-loop farming |
| Disputed release | Zero weight | Prevents challenge-then-release farming |
| Burn | Zero weight | Deadlock must never become rewardable |

Operational rule:

> **Expected reward must remain below the cost of synthetic volume / wash trading.**

Therefore sponsor campaigns, external funding, and `rewardBps` increases should be ramped gradually with observable metrics.

## 3) Staged Rollout

### Phase A — Read-only reward analytics
- Enable read-only analytics and observability only.
- No on-chain claim or treasury switch.
- Monitor outcome distribution, clean release speed, partial settlement ratio, zero-weight outcome ratio, and possible wash-trade clusters.

### Phase B — External funding enabled, claim disabled
- Enable external reward funding flows.
- Keep claim closed.
- Verify that sponsors/funders cannot choose recipients, weights, or multipliers.

### Phase C — Revenue split enabled, recordTradeOutcome enabled
- Enable revenue split accounting via vault.
- Enable `recordTradeOutcome` flow.
- Verify that outcome recording depends only on `ArafEscrow.getRewardableTrade`.

### Phase D — Claim enabled
- Enable epoch finalization/claim in controlled rollout.
- Increase operational monitoring and reserve-liability checks.
- Explain claim window, claimDelay, and dust sweep rules clearly to users.

### Phase E — Product pool enabled
- Enable product pool metadata/funding layer.
- Recipient selection remains contract-authoritative.
- Product pool must remain a funding/metadata bucket, not an eligibility engine.

## 4) Safety Notes

- No hardcoded production addresses.
- Treasury switch is a separate step from deployment.
- Oracle-free dispute model and settlement authority stay on-chain.
- Reward budget must never become large enough to economically encourage risky release behavior.
- Reward language must not be presented as guaranteed yield or per-trade cashback.

## Pre-Go-Live Verification
- Vault contract address must be verified from deployment manifest/config.
- Rewards contract address must be verified from deployment manifest/config.
- Supported token set must be USDT/USDC.
- `rewardBps` must start at 4000.
- Backend/frontend remain read-only / mirror-only.
- Backend/frontend do not define reward eligibility, weights, outcomes, recipients, or claimable authority.
- Treasury switch is not part of deployment.
- Treasury switch is a separate explicit post-verification operation.
- No production address is hardcoded.
- Smoke and verify commands must pass before treasury switch.
- Fast clean release / partial settlement / zero-weight outcome recording must be verified in staging.
- Sponsor/funder cannot choose recipients.
- Admin cannot drain reward reserve as treasury.
