# Araf Protocol Architecture (Canonical V3)

> **Status:** Canonical technical architecture for the repository state on `main`.
>
> **Reality rule:** Contract behavior is authoritative. Backend/docs/frontend must follow contract reality, not intent.

---

## 1) Vision and core philosophy

Araf is a **non-custodial**, **oracle-free**, **no-human-arbiter** protocol.

Hard rules:
- **Contract is the only authoritative state machine.**
- **Backend does not create protocol authority.** It mirrors, coordinates, and protects privacy.
- **Frontend is a client orchestration layer, not an enforcement layer.**
- **Code is law.** If backend/frontend assumptions conflict with `ArafEscrow.sol`, the contract wins.
- **Dishonesty is made economically expensive** through bonds, penalties, decay, and burn mechanics.

---

## 2) Canonical V3 architecture

V3 is explicitly a two-layer on-chain model:

1. **Parent Order Layer (public liquidity / market intent)**
   - Create/cancel/fill surface for public market discovery.
   - Canonical IDs: `orderId`, `orderRef`.
2. **Child Trade Layer (real escrow lifecycle)**
   - Every fill spawns a child trade carrying real escrow state transitions.
   - Canonical IDs: `tradeId` (escrow id), `parentOrderId`.

Canonical flow:
- `createSellOrder` / `createBuyOrder` create parent order liquidity.
- `fillSellOrder` / `fillBuyOrder` create child trade + emit `OrderFilled`.
- Child lifecycle is then managed via `reportPayment`, `releaseFunds`, `challengeTrade`, `proposeOrApproveCancel`, `autoRelease`, `burnExpired`.

---

## 3) Authority boundaries

### 3.1 Authoritative
- `contracts/src/ArafEscrow.sol`.

### 3.2 Mirrored (not authoritative)
- `backend/scripts/services/eventListener.js`: event-driven mirror worker into Mongo.
- `backend/scripts/models/Order.js`, `backend/scripts/models/Trade.js`: read model storage.

### 3.3 Derived
- REST projections from `orders.js`, `trades.js`, analytics/stats, UI card transformations.

### 3.4 Deprecated
- `backend/scripts/routes/listings.js` as compatibility alias/read projection.

---

## 4) Contract-first state machine

The V3 contract is the single source for:
- parent order creation/fill/cancel transitions,
- child trade lifecycle transitions,
- reputation gates and anti-sybil checks,
- mutable protocol config (`feeConfig`, `cooldownConfig`, `tokenConfigs`).

Canonical core functions preserved in V3 include:
- `createSellOrder`, `createBuyOrder`, `fillSellOrder`, `fillBuyOrder`,
- `cancelSellOrder`, `cancelBuyOrder`,
- `reportPayment`, `releaseFunds`, `challengeTrade`, `autoRelease`, `burnExpired`,
- `proposeOrApproveCancel`, `decayReputation`,
- read/config helpers: `getOrder`, `getTrade`, `getFeeConfig`, `getCooldownConfig`, `antiSybilCheck`, `getCurrentAmounts`, `getReputation`, `getFirstSuccessfulTradeAt`, `registerWallet`, `setTokenConfig`.

---

## 5) Parent order vs child trade separation

### Parent Order (public market layer)
- Public liquidity intent.
- Fields mirrored in Order model:
  - `onchain_order_id`, `side`, `status`, `tier`, `amounts`, `reserves`, `fee_snapshot`, `refs.order_ref`.
- Queried canonically via `GET /api/orders` and `GET /api/orders/:id`.

### Child Trade (escrow lifecycle layer)
- Real escrow state progression (`OPEN -> LOCKED -> PAID -> CHALLENGED -> RESOLVED/CANCELED/BURNED`).
- Fields mirrored in Trade model:
  - `onchain_escrow_id`, `parent_order_id`, `status`, `financials`, `fee_snapshot`, timers, evidence snapshots.
- Queried canonically via `GET /api/trades/*`.

### Identity mapping (must stay explicit)
- `onchain_order_id` = parent order identity.
- `onchain_escrow_id` = child trade identity.
- `parent_order_id` = child → parent linkage.
- `order_ref` = canonical order-level reference.
- `listing_ref` = compatibility/event-trace reference only; **not authoritative state**.

---

## 6) Backend mirror and coordination model

Backend responsibilities:
- mirror contract events/state to read models,
- provide query APIs,
- coordinate off-chain signatures/documents,
- enforce auth/rate-limit/privacy boundaries.

Backend non-responsibilities:
- does **not** mint protocol state,
- does **not** override contract state,
- does **not** fabricate economic config when contract config is unavailable.

---

## 7) Privacy / PII / audit boundary

- Trade model stores encrypted receipt and payout snapshots as operational privacy/audit support.
- These are **not protocol authority** and do not change on-chain outcomes.
- PII/receipt retention lifecycle is operational; contract state remains authoritative for settlement semantics.

---

## 8) On-chain config and governance model

V3 config is mutable on-chain and must be read from contract:
- `getFeeConfig()` → current taker/maker fee bps.
- `getCooldownConfig()` → tier cooldown values.
- `tokenConfigs(token)` → token direction authority (`supported`, `allowSellOrders`, `allowBuyOrders`).

Governance implications:
- Fee/cooldown are not static constants in integration assumptions.
- Token direction authority is `tokenConfigs`, not legacy compatibility maps.
- If config fetch fails, backend must fail safely (`CONFIG_UNAVAILABLE`) rather than invent fallback economics.

---

## 9) Event / mirror semantics

Canonical V3 interpretation:
- `OrderFilled` + `getTrade(tradeId)` define child trade authority.
- Mirror pipeline must treat events as ingestion triggers, not authority by themselves.

Current repository reality (important drift):
- `eventListener.js` still includes legacy assumptions/events (`EscrowCreated`, `EscrowLocked`) in its ABI/event map.
- Contract branch reality has removed direct-escrow compatibility surface in prior cleanup commits.
- Therefore, event worker and architecture are not yet fully aligned; backend follow-up is required.

---

## 10) Security model and known boundaries

Security posture:
- Contract-level anti-sybil checks and role gates enforce entry conditions.
- Settlement/dispute outcomes remain fully contract-bound.
- Backend security controls (auth, rate limiter, session-wallet match) are API abuse controls, not protocol consensus.

Known boundary conditions:
- Mirror lag/outage affects UX/read freshness, not protocol truth.
- Deprecated API aliases can mislead integrations if treated as authority.
- Stale backend assumptions about removed ABI/events can break operational mirrors.

---

## 11) Data models

### `Order.js` role in architecture
- **Does:** mirrors parent-order snapshots and supports order feed queries.
- **Not authoritative for:** order state transitions or reserve calculations.
- **Risk reduced:** improves deterministic querying/pagination and dashboard performance.
- **Mirror/coordination only:** yes.

### `Trade.js` role in architecture
- **Does:** mirrors child-trade lifecycle, financial snapshots, PII/audit support fields.
- **Not authoritative for:** escrow outcomes or disputes.
- **Risk reduced:** enables user/trade history and compliance/audit operations.
- **Mirror/coordination only:** yes.

---

## 12) API surface summary

### Canonical read surfaces
- `orders.js`
  - **Does:** canonical V3 parent-order read endpoints (`/api/orders`, `/api/orders/:id`, `/api/orders/:id/trades`, `/api/orders/config`).
  - **Not authoritative for:** create/fill/cancel state mutations.
  - **Risk reduced:** avoids frontend querying raw chain for every market view.
- `trades.js`
  - **Does:** canonical V3 child-trade read + coordination endpoints.
  - **Not authoritative for:** trade state transitions; those remain on-chain.
  - **Risk reduced:** controlled access to private trade context and cancel-signature coordination.

### Deprecated compatibility read alias
- `listings.js`
  - **Does:** projects open sell orders to listing-card shape; provides read alias.
  - **Not authoritative for:** listing creation/cancellation.
  - **Risk reduced:** gradual migration support for legacy UI consumers.
  - `POST /api/listings` and `DELETE /api/listings/:id` are explicitly deprecated (410).

---

## 13) Deployment and operational notes

- Deploy scripts and ops tooling must match current ABI.
- Config boot sequence must read contract values successfully before serving config-dependent APIs.
- `protocolConfig.js` is designed to avoid hardcoded economic fallback; when unavailable, APIs should return unavailability.

Current repository reality:
- Some deployment/service code still references legacy `supportedTokens` and legacy event chain semantics.
- These references are operational drift and should be removed to match pure V3 contract ABI.

---

## 14) Deprecated / compatibility surfaces

Deprecated/non-canonical surfaces in current repo:
- `listings.js` write endpoints (`POST`, `DELETE`) → intentionally deprecated.
- Legacy worker assumptions around `EscrowCreated` / `EscrowLocked`.
- Legacy config reads that still expect `supportedTokens(address)`.

Normative rule:
- Deprecated surfaces must never be documented or used as primary authority paths.

---

## 15) Open risks and follow-up notes

1. **Backend event worker drift**
   - Must remove strict dependence on removed compatibility events and rely on V3 canonical event/state strategy.
2. **Protocol config ABI drift**
   - Must remove `supportedTokens(address)` dependency and read from `tokenConfigs` only.
3. **Model-comment drift**
   - `Trade.js` comments still mention direct-escrow fallback semantics; this must be updated to pure V3 language.
4. **Ops script drift**
   - Deployment scripts still reference removed compatibility reads.

Final rule for all follow-ups:
- Mark each surface explicitly as **authoritative**, **mirrored**, **derived**, or **deprecated**.
- Do not reintroduce legacy compatibility as canonical flow.
