# Proof of Peace Rewards — Rollout Plan (EN)

This document defines a **safe staged rollout** for Proof of Peace Rewards.

## 1) Economic and Authority Boundaries

- Rewards are **not trade cashback**.
- Eligibility is generated only from **ArafEscrow terminal outcomes**.
- Backend is **mirror/read-model only** and cannot choose recipients.
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

## 2) Staged Rollout

### Phase A — Read-only reward analytics
- Enable read-only analytics and observability only.

### Phase B — External funding enabled, claim disabled
- Enable external reward funding flows.
- Keep claim closed.

### Phase C — Revenue split enabled, recordTradeOutcome enabled
- Enable revenue split accounting via vault.
- Enable `recordTradeOutcome` flow.

### Phase D — Claim enabled
- Enable epoch finalization/claim in controlled rollout.

### Phase E — Product pool enabled
- Enable product pool metadata/funding layer.
- Recipient selection remains contract-authoritative.

## 3) Safety Notes

- No hardcoded production addresses.
- Treasury switch is a separate step from deployment.
- Oracle-free dispute model and settlement authority stay on-chain.
