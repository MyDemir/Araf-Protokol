# 🌀 Araf Protocol API (Current Backend Surface)

> Base URL: `/api`  
> Canonical model: **V3 order-first** (parent order + child trade)

This document reflects the currently mounted backend routes in `backend/scripts/app.js`.

---

## 1) Auth model

Authentication uses SIWE + cookie sessions:
- `araf_jwt` (short-lived auth cookie)
- `araf_refresh` (refresh cookie, `/api/auth` path)
- trade-scoped PII token (`Authorization: Bearer ...`) for sensitive payout access

Session-wallet consistency is enforced (`requireSessionWalletMatch`) on protected routes.

---

## 2) Mounted route groups

- `/api/auth`
- `/api/orders`
- `/api/trades`
- `/api/pii`
- `/api/feedback`
- `/api/stats`
- `/api/receipts`
- `/api/logs`
- `/health` (liveness)
- `/ready` (readiness)

`/api/listings` is **not** part of the canonical mounted surface in `app.js`.

---

## 3) Auth routes (`/api/auth`)

### `GET /api/auth/nonce?wallet=<address>`
Generates a SIWE nonce (Redis-backed, short TTL).

### `POST /api/auth/verify`
Verifies SIWE signature and sets auth/refresh cookies.

Request:
```json
{ "message": "EIP-4361 message", "signature": "0x..." }
```

### `GET /api/auth/me`
Returns `{ wallet, authenticated: true }` for valid session cookie.

### `POST /api/auth/refresh`
Rotates refresh session and issues new cookie pair.

Request:
```json
{ "wallet": "0x..." }
```

### `POST /api/auth/logout`
Revokes refresh family and clears cookies.

### `PUT /api/auth/profile`
Updates encrypted payout profile (rail-aware) in `User.payout_profile`.

Key behavior:
- Bank-profile changes are blocked while active trades exist (`LOCKED/PAID/CHALLENGED`).
- Bank profile version/counters are updated for risk signaling.

Accepted request body:
```json
{
  "payoutProfile": {
    "rail": "TR_IBAN | US_ACH | SEPA_IBAN",
    "country": "TR | US | DE | ...",
    "contact": {
      "channel": "telegram | email | phone | null",
      "value": "string | null"
    },
    "fields": {
      "account_holder_name": "string",
      "iban": "string | null",
      "routing_number": "string | null",
      "account_number": "string | null",
      "account_type": "checking | savings | null",
      "bic": "string | null",
      "bank_name": "string | null"
    }
  }
}
```

Rail-country rules (enforced):
- `TR_IBAN` -> `TR`
- `US_ACH` -> `US`
- `SEPA_IBAN` -> one of `DE, FR, NL, BE, ES, IT, AT, PT, IE, LU, FI, GR`

Contact canonicalization:
- `telegram`: leading `@` is removed before storage
- `email`: validated with basic e-mail pattern
- `phone`: spaces are removed, then validated with `+`-optional numeric pattern
- `channel/value` must be both present or both null

Rail-specific fields:
- `TR_IBAN`: `account_holder_name`, `iban`, optional `bank_name`
- `SEPA_IBAN`: `account_holder_name`, `iban`, optional `bic`, optional `bank_name`
- `US_ACH`: `account_holder_name`, `routing_number`, `account_number`, `account_type`, optional `bank_name`

Invalid example (rejected with 400):
```json
{ "payoutProfile": { "rail": "US_ACH", "country": "TR", "contact": { "channel": null, "value": null }, "fields": { "account_holder_name": "John Doe", "iban": null, "routing_number": "021000021", "account_number": "1234567890", "account_type": "checking", "bic": null, "bank_name": null } } }
```

Legacy flat fields are no longer accepted: `bankOwner`, `iban`, `telegram`, `contactChannel`, `contactValue`.

---

## 4) Orders routes (`/api/orders`)

Order routes are read-layer mirrors of parent-order state.
State-changing order actions happen on-chain.

### `GET /api/orders/config`
Returns mirrored protocol config snapshot:
- bond map
- fee config
- cooldown config
- token map

### `GET /api/orders`
Public order feed with filters:
- `side`: `SELL_CRYPTO | BUY_CRYPTO`
- `status`: `OPEN | PARTIALLY_FILLED | FILLED | CANCELED`
- `tier`
- `token_address`
- `owner_address`
- pagination (`page`, `limit`)

### `GET /api/orders/my`
Authenticated paginated list of caller-owned orders.

### `GET /api/orders/:id`
Returns one mirrored parent order by on-chain order ID.

### `GET /api/orders/:id/trades`
Returns child trades for caller-owned order (owner-only access).

---

## 5) Trades routes (`/api/trades`)

Trades are child-trade read/coordination endpoints.

### `GET /api/trades/my`
Active trades for the caller (`LOCKED/PAID/CHALLENGED/...` non-terminal set).

### `GET /api/trades/history`
Terminal trades (`RESOLVED/CANCELED/BURNED`) with pagination.

### `GET /api/trades/by-escrow/:onchainId`
Fetches child trade by on-chain trade identity (`onchain_escrow_id`).

### `GET /api/trades/:id`
Fetches a trade by Mongo `_id` (party-restricted).

### `POST /api/trades/propose-cancel`
Stores EIP-712 cancel signatures for coordination before on-chain submit.

Request:
```json
{
  "tradeId": "mongodb_object_id",
  "signature": "0x...",
  "deadline": 1735000000
}
```

### `POST /api/trades/:id/chargeback-ack`
Maker acknowledgment endpoint (legal/risk audit signal) for `PAID/CHALLENGED` states.

---

## 6) PII routes (`/api/pii`)

PII routes are child-trade-scoped and heavily guarded.

### `GET /api/pii/my`
Returns caller’s own decrypted payout profile.

### `GET /api/pii/taker-name/:onchainId`
Maker can read taker account-holder name from trade snapshot when state allows.

### `POST /api/pii/request-token/:tradeId`
Issues short-lived trade-scoped PII token for eligible taker.

### `GET /api/pii/:tradeId`
Returns maker payout info using valid PII token + session checks.

Security characteristics:
- no-store cache headers on sensitive responses
- snapshot-first behavior for trade consistency
- access restricted by wallet role + trade state

---

## 7) Receipt route (`/api/receipts`)

### `POST /api/receipts/upload`
Uploads encrypted receipt payload for child trade.

Expected multipart fields:
- `receipt` file (JPEG/PNG/WebP/GIF/PDF, max 5 MB)
- `onchainEscrowId` (positive numeric trade ID)

Behavior:
- verifies MIME magic bytes
- encrypts payload
- stores receipt hash + encrypted blob on trade document
- allowed only for taker while trade is `LOCKED`

---

## 8) Feedback & stats

### `POST /api/feedback`
Authenticated feedback submission endpoint.

### `GET /api/stats`
Public protocol statistics read endpoint.

### `POST /api/logs/client-error`
Client-side non-blocking error telemetry endpoint used by frontend runtime.
Payload is expected to include severity/message/context fields; endpoint is rate-limited.

---

## 9) Health endpoints

### `GET /health`
Liveness probe (process-up signal).

### `GET /ready`
Readiness probe (Mongo/Redis/worker/provider/config checks).

---

## 10) Canonical terminology notes

- Canonical market primitive is **parent order**, not listing.
- Canonical escrow lifecycle is **child trade**.
- `onchain_escrow_id` in backend models refers to child-trade on-chain identity.
- Backend is a mirror/coordination layer, not protocol authority.
