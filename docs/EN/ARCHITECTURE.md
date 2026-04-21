# Araf Protocol — Canonical Architecture & Technical Reference (V3 Order-First)

> This document preserves the correct V3 core introduced in PR #52 and expands it back to detailed technical-reference depth.  
> Source-of-truth order: `ArafEscrow.sol` → backend mirror/read layer → frontend guardrail layer → documentation.

---

## 1) Executive canonical model

In Araf V3, the public market primitive is no longer listing-first; it is **parent-order first**.

- **Parent Order** = public market/order layer
- **Child Trade** = actual escrow lifecycle (economic state machine)
- **Contract** = single authoritative state machine
- **Backend** = mirror + coordination + operational read layer
- **Frontend** = UX guardrail + contract access layer

### 1.1 Authority boundaries
- Final state transitions and economic payouts are contract-enforced.
- Backend is not an arbiter; it mirrors state and provides coordination surfaces.
- Frontend is not enforcement; it is a guardrail/orchestration layer.

### 1.2 Practical V3 consequence
- Market-facing primitive = parent order.
- Escrow/dispute/release/cancel/burn semantics live at child-trade level.
- Child-trade identity authority comes from `OrderFilled + getTrade(tradeId)`.

---

## 2) Hybrid architecture and technology stack

## 2.1 Why hybrid?
Araf must satisfy both hard security and practical operations:
- **On-chain:** custody, state transitions, economics, reputation enforcement
- **Off-chain (Mongo):** read model, performance, PII and operational metadata
- **Redis:** checkpoints, readiness, rate limiting, short-lived coordination

This yields a Web2.5 model: on-chain authority + off-chain operational acceleration.

## 2.2 Layer matrix

| Layer | Primary responsibility | Authority level | Technology |
|---|---|---|---|
| Contract | Escrow state machine, payouts, dispute economics, governance controls | **Authoritative** | Solidity / Base |
| Backend API | Session/security boundaries, projection, coordination | Non-authoritative | Node.js + Express |
| Event Worker | Event mirror, replay, checkpoint/DLQ handling | Non-authoritative | ethers + Mongo + Redis |
| Mongo | Read model / operational cache | Non-authoritative | MongoDB + Mongoose |
| Redis | Ephemeral coordination / runtime safety signals | Non-authoritative | Redis |
| Frontend | Contract write/read orchestration + UX guardrails | Non-authoritative | React + Wagmi + viem |

## 2.3 Non-custodial backend model
- Backend does not hold user-fund custody authority.
- Backend cannot fabricate release/challenge/cancel outcomes against contract rules.
- Backend strength lies in coordination, observability, and secure PII boundaries.

---

## 3) On-chain public surface (ArafEscrow.sol)

## 3.1 Parent-order write surface
- `createSellOrder`
- `fillSellOrder`
- `cancelSellOrder`
- `createBuyOrder`
- `fillBuyOrder`
- `cancelBuyOrder`

## 3.2 Child-trade lifecycle write surface
- `reportPayment`
- `releaseFunds`
- `challengeTrade`
- `autoRelease`
- `burnExpired`
- `proposeOrApproveCancel`

## 3.3 Liveness / auxiliary write surface
- `registerWallet`
- `pingMaker`
- `pingTakerForChallenge`
- `decayReputation`

## 3.4 Governance / mutable admin surface
- `setTreasury`
- `setFeeConfig`
- `setCooldownConfig`
- `setTokenConfig`
- `pause` / `unpause`

## 3.5 Read surface
- `getOrder`, `getTrade`, `getReputation`
- `getFeeConfig`, `getCooldownConfig`
- `getCurrentAmounts`
- `antiSybilCheck`, `getCooldownRemaining`, `getFirstSuccessfulTradeAt`

---

## 4) Parent order vs child trade state model

## 4.1 Parent-order states
- `OPEN`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELED`

Parent orders carry market visibility and fillability, not escrow dispute semantics.

## 4.2 Child-trade states
- `OPEN` (not practically used in pure V3 fill path)
- `LOCKED`
- `PAID`
- `CHALLENGED`
- `RESOLVED`
- `CANCELED`
- `BURNED`

## 4.3 Fill-time child-trade creation
Both `fillSellOrder` and `fillBuyOrder` spawn child trades directly in `LOCKED` state in the same transaction.

## 4.4 Identity relationship
- Parent identity: `orderId`
- Child identity: `tradeId` (`onchain_escrow_id` mirror)
- Link authority: `OrderFilled(orderId, tradeId, ...)` + `getTrade(tradeId)`

---

## 5) Sell flow, buy flow, and role mapping

## 5.1 Sell-order flow
1. Owner calls `createSellOrder`
2. Filler calls `fillSellOrder` (taker gate enforced)
3. Child trade enters `LOCKED`
4. Taker calls `reportPayment`
5. Maker resolves with `releaseFunds` or dispute/cancel paths

## 5.2 Buy-order flow
1. Owner calls `createBuyOrder` (owner is eventual taker; gate enforced at create-time)
2. Filler calls `fillBuyOrder`
3. Owner (taker) is re-checked at fill-time
4. Child trade enters `LOCKED`
5. `reportPayment` then resolution/dispute/cancel paths

## 5.3 Side-dependent role mapping
No universal “maker=seller, taker=buyer” rule:
- `SELL_CRYPTO`: owner→maker, filler→taker
- `BUY_CRYPTO`: owner→taker, filler→maker

---

## 6) Anti-sybil enforcement semantics (V3)

Canonical gate helper: `_enforceTakerEntry(wallet, tier)`

Gate components:
- active ban gate (`bannedUntil`)
- wallet age (`WALLET_AGE_MIN`)
- native dust threshold (`DUST_LIMIT`)
- tier cooldown (`tier0TradeCooldown`, `tier1TradeCooldown`)

V3 enforcement points:
- `fillSellOrder` (filler/taker)
- `createBuyOrder` (owner/eventual taker)
- `fillBuyOrder` (owner/taker re-check)

So anti-sybil is no longer lockEscrow-centered legacy; it is child-trade-entry centered in V3.

---

## 7) Dispute / Bleeding Escrow technical flow

## 7.1 Resolution paths after `PAID`
- **Normal close:** maker `releaseFunds`
- **Dispute path:** maker `pingTakerForChallenge` → wait window → `challengeTrade`
- **Liveness path:** taker `pingMaker` → wait window → `autoRelease`
- **Mutual cancel:** dual-signature `proposeOrApproveCancel`
- **Terminal burn:** `burnExpired` after challenge timeout

## 7.2 Bleeding components
- maker bond decay
- taker bond decay
- post-threshold crypto-side decay

`getCurrentAmounts(tradeId)` exposes authoritative real-time economics.

## 7.3 Challenge and liveness ping semantics
- Ping paths are mutually exclusive (conflict guard).
- Required wait windows are enforced by state guards.

## 7.4 Burn semantics
- `burnExpired` finalizes stale challenged trades once max window elapses.
- Remaining value is routed to treasury according to contract rules.

## 7.5 Cancel semantics
- `proposeOrApproveCancel` validates EIP-712 signature + nonce + deadline on-chain.
- Cancel finalization requires both party approvals.

---

## 8) Reputation / bans / clean-slate

## 8.1 Reputation fields
- `successfulTrades`
- `failedDisputes`
- `bannedUntil`
- `consecutiveBans`

## 8.2 Tier impact
- Success/failure history affects effective tier.
- Penalty ceilings (`maxAllowedTier`) may apply.
- `MIN_ACTIVE_PERIOD` enforces time-based progression discipline.

## 8.3 Clean-slate rule
- `decayReputation` requires clean-period completion.
- Current clean period: **90 days**.
- Not full amnesty: `failedDisputes` history is not erased.

---

## 9) Finalized parameters vs mutable config

## 9.0 Parameter-classification table

| Class | Parameters | Notes |
|---|---|---|
| Immutable/public constants | `TIER_MAX_AMOUNT_*`, `*_DECAY_BPS_H`, `WALLET_AGE_MIN`, `DUST_LIMIT`, `MAX_BLEEDING`, `MIN_ACTIVE_PERIOD`, `AUTO_RELEASE_PENALTY_BPS`, `MAX_CANCEL_DEADLINE`, `GOOD_REP_DISCOUNT_BPS`, `BAD_REP_PENALTY_BPS` | Not mutable via owner runtime calls. |
| Mutable runtime config | `takerFeeBps`, `makerFeeBps`, `tier0TradeCooldown`, `tier1TradeCooldown` | Adjustable through owner governance surface. |
| Direction-aware token runtime policy | `tokenConfigs[token] => {supported, allowSellOrders, allowBuyOrders}` | Token support is managed per order direction. |

## 9.1 Immutable/public-constant class
- tier max amount constants (`TIER_MAX_AMOUNT_*`)
- decay constants (`*_DECAY_BPS_H`)
- wallet age / dust / bleeding / active period limits
- auto-release penalty
- max cancel deadline
- reputation discount/penalty BPS

## 9.2 Mutable runtime config class
- `takerFeeBps`
- `makerFeeBps`
- `tier0TradeCooldown`
- `tier1TradeCooldown`
- direction-aware token config via `setTokenConfig`

## 9.3 Fee snapshot semantics
- Snapshot is captured at order creation.
- Child trade inherits parent snapshots.
- Later `setFeeConfig` changes do not retroactively rewrite active-trade economics.

## 9.4 Toolchain / deployment assumptions
- Deploy flow starts with `constructor(treasury)` and token direction config.
- Post-deploy token-direction policy should be verified on-chain via `tokenConfigs(token)`.
- Production guidance assumes owner governance key is managed by multisig to reduce key risk.

---

## 10) Runtime connectivity and operational policies

## 10.1 Backend bootstrap ordering
1. env/security prechecks
2. Mongo connect
3. Redis connect
4. worker init + protocol config load
5. route mount
6. health/readiness activation

## 10.2 Readiness-first operations
- Liveness (`/health`) answers “is process alive?”.
- Readiness (`/ready`) answers “are dependencies actually ready?”.
- Traffic gating should follow readiness, not liveness alone.

## 10.3 Fail-fast / fail-open choices
- Critical dependency failures follow fail-fast patterns (DB/worker integrity).
- Security boundaries prefer fail-closed semantics (auth/session/PII).

## 10.4 Timeout/connectivity policy
- Mongo uses tuned `maxPoolSize`, `socketTimeoutMS`, and `serverSelectionTimeoutMS` values for combined worker+API load.
- Mongo disconnect path favors fail-fast restart to reduce stale/partial-connection drift.
- Redis `isReady` is explicitly treated as distinct from mere connectivity.
- Redis TLS (`rediss://`) and managed-service assumptions are part of runtime configuration behavior.

## 10.5 Graceful shutdown ordering
- stop new requests
- stop worker
- clear scheduler timers
- close Mongo/Redis
- controlled process exit

## 10.6 Scheduler and cleanup jobs
- reputation decay trigger job
- stats snapshot job
- receipt + PII retention cleanup
- user bank-risk metadata cleanup
- DLQ processing

## 10.7 Operational meaning of health vs ready
- `/health`: process liveness only.
- `/ready`: dependency + config + worker lag/replay safety gate.
- During replay/high lag, liveness may be true while readiness is intentionally false.

---

## 11) Event worker / replay / mirror reliability

## 11.1 Worker state model
Worker consumes contract events and updates Mongo without becoming authority.

## 11.2 Checkpoint approach
- last processed block
- last safe checkpoint
- replay-safe startup logic

## 11.3 Replay and batch processing
- block-batch processing
- idempotent mirror intent
- state-regression guards to prevent backward drift

## 11.3.1 Last-safe-block semantics
- Worker tracks not only last seen block, but also last safe checkpoint block.
- Readiness includes lag between provider head and worker safe checkpoint.
- This prevents “appears alive but silently behind” operational blind spots.

## 11.4 DLQ and poison-event visibility
- unprocessable events go to DLQ
- retry/backoff applies
- operational logs preserve observability of failure modes

## 11.5 Identity normalization
- on-chain IDs stored with numeric-string discipline
- explicit lookup strategy prevents parent/child identity confusion

## 11.6 OrderFilled + getTrade linkage
Child-trade authority is mirrored through explicit event + getter linkage rather than heuristics.

## 11.7 Mirror-authority warning
- Event worker does not define protocol rules; it only projects authoritative chain state.
- If Mongo mirror fields and contract storage diverge, contract state is authoritative.

---

## 12) Security architecture and trust boundaries

## 12.1 Auth model (SIWE + JWT)
- nonce → SIWE sign → verify
- cookie-based auth/refresh session lifecycle
- session wallet authority enforcement

## 12.2 Cookie-only auth and session-wallet boundary
- cookie wallet is authoritative in backend auth checks
- `x-wallet-address` mismatch triggers session invalidation behavior

## 12.2.1 Refresh-token family invalidation
- On mismatch/logout, refresh-token family revocation reduces token-chain replay risk.
- This invalidates both active access context and long-lived refresh lineage.

## 12.3 PII access-token boundary
- short-lived trade-scoped PII token
- role + state + session checks applied together
- sensitive responses follow no-store/no-cache semantics

## 12.4 Encryption model
- AES-256-GCM envelope encryption
- HKDF/KMS/Vault-oriented key governance
- no persistent plaintext PII storage by design

## 12.5 Rate-limit classes
- distinct limiters for auth, market read, trade, PII, feedback, logs
- limiter classes map to abuse surface semantics
- Sensitive surfaces (auth/PII) apply in-memory fallback protection when Redis is unavailable.
- General/public surfaces may use controlled fail-open behavior to preserve availability.

## 12.6 Client-error logging boundary
- frontend runtime telemetry posts to `/api/logs/client-error`
- data minimization/scrubbing boundaries reduce sensitive leakage risk

## 12.7 Trust-boundary summary
- Contract = economic/state authority
- Backend = coordination/projection
- Frontend = guardrail
- Off-chain data = operational utility, not protocol authority

---

## 13) Data models (Mongo read-model layer)

> Mongo is not canonical protocol authority; it is still critical for read performance and operational observability.

## 13.1 User model

### Operationally critical fields (non-authoritative)
- `wallet_address` identity
- encrypted `payout_profile` (rail/country/contact/details)
- `reputation_cache` (on-chain mirror intent)
- local ban mirror fields
- `profileVersion`, `lastBankChangeAt`, `bankChangeCount7d`, `bankChangeCount30d`, `bank_change_history`

### Privacy/security notes
- encrypted payout fields
- safe public-profile projection that excludes sensitive fields
- bank-change metadata stored as risk signal
- `toPublicProfile()` returns allowlisted fields to minimize accidental PII leakage.

### Operational note
- `profileVersion` and 7d/30d counters support lock-time snapshot/risk comparisons.

## 13.2 Order model

### Identity and state
- `onchain_order_id` (string identity)
- owner, side, status, tier, token
- amount/reserve/fee snapshot mirrors
- `refs.order_ref` and order-level timers
- `stats.*` fields as child-trade-derived read-model helpers

### Mirror boundary
- Remaining amount/reserve values are mirrored from contract truth, not backend authority calculations.

## 13.3 Trade model

### Identity relationship
- child identity: `onchain_escrow_id`
- parent linkage: `parent_order_id`
- parent side: `parent_order_side`

### Financial field strategy
- BigInt-safe string fields (`crypto_amount`, bonds, total_decayed)
- numeric caches for query/UI convenience only
- `trade_origin`, `fill_metadata`, `fee_snapshot`, `canonical_refs` retained for linkage/forensics

### PII / receipt / snapshot
- lock-time payout snapshots
- encrypted receipt payload + receipt hash
- cancel-proposal + chargeback-ack audit fields

### Retention
- terminal-state TTL/cleanup strategy
- receipt/snapshot cleanup jobs for data minimization
- terminal trade TTL and receipt/snapshot retention fields are intentionally separate and complementary

## 13.4 Feedback / stats snapshot layer
- Feedback is a separate operational/user-signal surface.
- Daily/aggregated stats are observability surfaces, not protocol authority.

---

## 14) Backend route surface and coordination semantics

## 14.1 Orders routes
- parent-order read/config surfaces
- owner-scoped child-trade listing route

## 14.2 Trades routes
- active/history/by-escrow reads
- cancel-signature coordination
- chargeback-ack audit surface

## 14.3 Auth routes
- nonce/verify/refresh/logout/me/profile
- session-wallet mismatch guard behavior

## 14.4 PII routes
- `/my`, `taker-name`, request-token, trade-scoped retrieval
- snapshot-first and role-bound access

## 14.5 Receipts routes
- file validation + encryption + hash storage
- restricted to taker while `LOCKED`

## 14.6 Logs/stats/feedback
- client error logs
- protocol stats read surface
- feedback intake endpoint

---

## 15) Frontend UX guardrail layer

## 15.1 `useArafContract` role
- contract write/read orchestration
- chain/address preflight guards
- tx receipt tracking
- `OrderFilled` decode for tradeId extraction

## 15.2 `usePII` role
- trade-scoped PII token flow
- canonical API path resolution
- authenticated fetch integration
- race cancellation via AbortController
- sensitive-state cleanup after unmount

## 15.3 Session/auth UX guardrails
- auth me/refresh orchestration
- safe logout/recovery on session-wallet mismatch
- early user feedback on wrong network/address states

## 15.4 Enforcement boundary
Frontend does not replace contract enforcement; it reduces UX errors and unsafe user paths.

---

## 16) Attack vectors and known limitations

## 16.1 Mitigated/reduced risks
- legacy listing authority confusion
- hardcoded API-path drift risks in PII flow
- silent account/session confusion via mismatch handling
- PII overexposure reduced by token+role+state boundary

## 16.2 Remaining risk surface
- off-chain payment-proof ambiguity (fake receipt / chargeback realities)
- governance-key risk surface (owner mutable config)
- backend mirror interpreted as authority by operators
- frontend wrong-network / wrong-address configuration risk
- documentation/operator misunderstanding risk

## 16.3 Conscious limitations
- oracle-free design does not prove fiat transfer truth on-chain
- system enforces economic pressure, not subjective adjudication

---

## 17) Legacy concepts (historical / deprecated / non-canonical)

The following are not part of live V3 canonical behavior:
- createEscrow/lockEscrow-centered flow
- listing-first market primitive assumption
- fixed-fee/fixed-cooldown assumptions
- absolute maker=seller / taker=buyer mapping
- old single-dimension token-support language

Legacy references should be treated as historical context only; operational decisions must follow source-of-truth code and this V3 reference.

---

## 18) Final role of this document

This architecture document deliberately serves both:
1. an executive V3 canonical model
2. a deep technical reference (security, data models, runtime reliability, guardrails, attack surface)

So it is neither a shallow summary nor a stale legacy dump; it is a modern, operationally mature V3 architecture reference.
