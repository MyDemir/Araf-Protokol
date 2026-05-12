# Rewards Abuse Observability Plan — Read-Only

> Scope: Proof of Peace reward-abuse monitoring for wash-trading, Sybil-style coordination, and sponsor/product concentration.
>
> This plan is **observability-only**. It does not add backend/admin authority and must not be used to rewrite on-chain outcome, reward recipient, multiplier, weight, epoch pool, or claimable amount.

## 1) Authority boundary

This document follows the incentive architecture in `ARCHITECTURE_INCENTIVES.md`:

- Proof of Peace is a peace premium, **not cashback**.
- Eligibility comes only from `ArafEscrow` terminal outcome data.
- `ArafRewards` owns outcome-derived weight, epoch accounting, and pro-rata claim math.
- Backend/admin/sponsor dashboards may observe risk, but they **cannot choose recipients, weights, or multipliers**.
- Any signal here can trigger investigation, budget review, product-policy review, or future governance discussion; it cannot mutate already-derived reward accounting.

## 2) Data source rules

Use only mirror/read-model data that already exists for operations and analytics:

- child trade ids, parent order ids, maker/taker wallet addresses, terminal outcome, status, token, amount, timestamps, epoch id, and duration metrics;
- event mirror fields for `OrderFilled`, terminal resolution events, reward outcome recording, allocation, funding, and claim events;
- `payout_snapshot` metadata only where the privacy policy and access controls allow aggregate/hashed analysis;
- product/sponsor funding read models from `ArafRevenueVault` events, including product id, token, amount, epoch, and funder/sponsor address if available.

Do not use plaintext PII, decrypted payout details, receipt contents, private support notes, or manual admin labels as reward-authority inputs. If payout fingerprint or rail metadata is used, keep it aggregate, access-controlled, and non-public.

## 3) Read-only abuse metrics

| Metric | Suggested calculation | Why it matters | Dashboard action only |
|---|---|---|---|
| Repeated counterparties | Count maker/taker pair repetitions per epoch and rolling 7/30-day windows; include direction-flipped pairs | Wash trading often reuses counterparties across wallets or stable pairs | Flag pair clusters for review; do not zero weight |
| Counterparty graph density | Wallet cluster with high internal trade ratio vs external trade ratio | Sybil rings may trade mostly inside the same cluster | Mark cluster risk tier in analytics only |
| Epoch concentration | User or wallet-cluster share of `userWeight`, trade count, clean-release count, or rewardable volume in an epoch | A small group dominating an epoch can indicate farming or poor budget sizing | Review epoch pool size and future sponsor budget |
| Same token/amount patterns | Repeated exact or near-exact token + amount combinations by pair/cluster within short windows | Synthetic volume often uses templated amounts | Flag pattern; compare with organic order distribution |
| Short-cycle clean release clustering | Many fast clean releases with very short `LOCKED -> PAID -> RESOLVED` durations, especially from repeated pairs | Proof of Peace rewards fast clean resolution, so abuse may mimic fast cooperation | Alert if velocity exceeds normal cohort baseline |
| Payout fingerprint repetition | Repeated payout fingerprint hash across multiple wallets, where policy allows | Multiple wallets may point to the same payout beneficiary | Aggregate/private risk signal only; no plaintext reveal |
| Rail metadata concentration | Same rail/country/channel patterns concentrated in a wallet cluster, where policy allows | Can support other signals without exposing PII | Use as secondary correlation, not standalone abuse proof |
| Sponsor/product funding concentration | Share of external funding by sponsor, product id, token, or epoch | Sponsor campaigns could unintentionally make farming profitable | Review future funding caps and campaign design |
| Funding-to-weight overlap | Compare top funded product/epoch with top user/cluster weight recipients | Detect whether a sponsor/product pool is repeatedly captured by one cluster | Escalate for sponsor ops review only |
| Zero-weight outcome ratio | Auto-release, mutual cancel, disputed release, burn, and other zero-weight outcomes by pair/cluster | Reward farming attempts may leave failed loops around the edges | Feed risk analytics, not reward rewrites |

## 4) Dashboard fields

A dashboard should show only read-model fields and derived aggregates. Recommended fields:

### Epoch summary

- `epoch_id`
- `epoch_start_at`, `epoch_end_at`
- `token`
- `epoch_reward_pool`
- `external_funding_amount`
- `reward_reserve_allocation_amount`
- `total_weight`
- `rewardable_trade_count`
- `zero_weight_trade_count`
- `top_wallet_weight_share_percent`
- `top_cluster_weight_share_percent`
- `clean_release_median_seconds`
- `clean_release_p10_seconds`
- `clean_release_p90_seconds`

### Wallet / cluster risk summary

- `wallet_address` or internal `cluster_id`
- `epoch_id`
- `rewardable_trade_count`
- `clean_release_count`
- `partial_settlement_count`
- `zero_weight_outcome_count`
- `user_weight`
- `user_weight_share_percent`
- `unique_counterparty_count`
- `repeated_counterparty_count`
- `top_counterparty_share_percent`
- `same_token_amount_pattern_count`
- `short_cycle_clean_release_count`
- `payout_fingerprint_reuse_count` where policy allows
- `rail_metadata_pattern_count` where policy allows
- `risk_observability_score` as an analytics label only, not a contract input

### Pair / pattern summary

- `maker_address`
- `taker_address`
- `epoch_id`
- `trade_count`
- `direction_flipped_trade_count`
- `token`
- `amount_bucket`
- `exact_amount_repeat_count`
- `median_resolution_seconds`
- `clean_release_count`
- `zero_weight_outcome_count`
- `latest_trade_id`

### Sponsor / product funding summary

- `epoch_id`
- `product_id`
- `sponsor_or_funder_address` if available in the read model
- `token`
- `funded_amount`
- `funding_share_percent`
- `top_wallet_weight_share_percent`
- `top_cluster_weight_share_percent`
- `funding_to_weight_overlap_score`

## 5) Alert thresholds and review flow

Initial thresholds should be conservative and environment-specific. Examples:

- one wallet/cluster exceeds a configured share of epoch weight;
- maker/taker pair repeats above a configured count in an epoch;
- short-cycle clean releases exceed the cohort baseline by a configured multiplier;
- exact token/amount repeats cluster above a configured threshold;
- one sponsor/product pool is repeatedly captured by the same wallet cluster.

Review flow:

1. Dashboard raises a read-only alert.
2. Operations reviews aggregate metrics and public/mirror event traces.
3. If needed, sponsor/product owners adjust **future** campaign budget, epoch allocation size, or rollout rules through governance/runbook processes.
4. No backend/admin process edits terminal outcome, reward recipient, multiplier, weight, claimable amount, or already-finalized epoch accounting.

## 6) Privacy and logging constraints

- Never display plaintext payout details, names, bank accounts, contact values, or receipt contents in the rewards-abuse dashboard.
- Do not log decrypted PII while calculating observability metrics.
- Payout fingerprint and rail metadata analysis must remain aggregate, access-controlled, and subject to privacy policy review.
- Public reports should use coarse aggregates and avoid wallet doxxing beyond already-public chain data.

## 7) Non-goals

This plan does not:

- prove off-chain fiat truth;
- decide who was right in a dispute;
- produce reward eligibility;
- change on-chain terminal outcome;
- choose reward recipient;
- change multiplier, weight, epoch pool, or claimable amount;
- convert Proof of Peace into cashback or a fixed rebate program.
