# Araf Protocol UX (Canonical, V3)

This document is **not authority** by itself; it canonicalizes UX by explicitly mapping to live code.
Single source of truth is `contracts/src/ArafEscrow.sol`.

## 1) Live repo tree (UX-critical)

```text
contracts/
  src/ArafEscrow.sol
  test/ArafEscrow.test.js
  scripts/deploy.js
backend/scripts/
  app.js
  middleware/auth.js
  routes/{auth,orders,trades,pii,receipts,stats,logs}.js
  services/{eventListener,protocolConfig,siwe}.js
frontend/
  .env.example
  vercel.json
  src/
    App.jsx
    app/{useAppSessionData,AppViews,AppModals,orderModel,apiConfig}.jsx|.js
    hooks/{useArafContract,usePII}.js|.jsx
    components/PIIDisplay.jsx
docs/
  TR/ux.md
  EN/ux.md
```

## 2) V3 authority model

- **Contract authority:** `ArafEscrow.sol` mutates state (`create*Order`, `fill*Order`, `cancel*Order`, `getOrder`, `getTrade`, `OrderFilled`).
- **Backend mirror/read authority:** `routes/*.js` + `eventListener.js` + `protocolConfig.js` are read/coordination only.
- **Frontend authority:** ABI + backend response mapping + UI state. It does not redefine protocol rules.
- **Child trade ID authority:** only `OrderFilled` event + `getTrade` chain after fill.

## 3) Deploy/env/network prerequisites

- Supported chain IDs: `8453 (Base)`, `84532 (Base Sepolia)`, `31337 (local)`.
- Frontend required env:
  - `VITE_ESCROW_ADDRESS` (must not be zero address)
  - `VITE_USDT_ADDRESS`, `VITE_USDC_ADDRESS` (required for create/fill flows)
  - `VITE_API_URL` (optional, but strongly recommended in prod as explicit backend origin)
- Backend required env (prod-critical):
  - `ALLOWED_ORIGINS`, `SIWE_DOMAIN`, `SIWE_URI`, `JWT_SECRET`
  - `ARAF_ESCROW_ADDRESS`, `BASE_RPC_URL`, `ARAF_TRACKED_TOKENS`
- Vercel:
  - Rewrite config exists at `frontend/vercel.json`.
  - If deployed from monorepo root, rewrite fails unless root-level Vercel config/project root is correctly set.

## 4) Canonical UX flow (happy path + blocker path)

1. **App boot** → `App.jsx` render, env warnings, ErrorBoundary active.
2. **Production env validation** → `VITE_API_URL`/`VITE_ESCROW_ADDRESS` checks.
3. **Vercel/API routing** → frontend `/api/*` calls via rewrite or explicit backend URL.
4. **Wallet connect** → wagmi connector selection.
5. **Wrong network guard** → chain whitelist enforcement.
6. **SIWE login/session restore/wallet mismatch** → `/api/auth/*` + cookie refresh.
7. **Wallet registration (anti-sybil)** → `registerWallet`, `antiSybilCheck`.
8. **Maker SELL order create** → `createSellOrder`.
9. **Maker BUY order create** → `createBuyOrder`.
10. **Marketplace fetch/render** → `/api/orders`, `/api/orders/config`.
11. **Taker fill SELL** → `fillSellOrder`, `OrderFilled` decode.
12. **Taker fill BUY** → `fillBuyOrder`, `OrderFilled` decode.
13. **Child trade authority** → event tradeId + `/api/trades/by-escrow/:id` + `getTrade`.
14. **Trade room open/resume** → active trade restore.
15. **Receipt upload** → `/api/receipts/upload` (LOCKED + taker only).
16. **Report payment** → `reportPayment`.
17. **Maker release** → `releaseFunds`.
18. **Maker/taker ping + challenge + auto-release + burnExpired**.
19. **Mutual cancel** → off-chain signature coordination + on-chain `proposeOrApproveCancel`.
20. **Profile/my orders/active/history** → `/api/orders/my`, `/api/trades/my`, `/api/trades/history`.
21. **PII flows** → `/api/pii/my`, `/api/pii/taker-name/:onchainId`, token-scoped fetch.
22. **Feedback** → `/api/feedback`.
23. **Pause/maintenance** → `paused()` + UI banner.
24. **Client logging** → `/api/logs/client-error`.
25. **Testnet→mainnet readiness** → CORS/SIWE/RPC/token config/treasury validation.
26. **Refresh recovery/pending tx restore** → `localStorage.araf_pending_tx`.

## 5) Testnet/Mainnet differences

- Often silent on testnet, blocking on mainnet:
  - SIWE domain/URI strictness
  - CORS wildcard bans
  - missing or wrong token config
  - treasury/final owner controls
  - event listener RPC reliability
  - cookie security flags (secure/sameSite)

## 6) Known blockers / failure gates

1. `VITE_API_URL` format drift (`.../api`) + path join mismatch can break log endpoint.
2. `frontend/vercel.json` exists, but root deployment may ignore it.
3. Backend hard-fails if `ALLOWED_ORIGINS` is missing/invalid in production.
4. `SIWE_DOMAIN/SIWE_URI` mismatch blocks production login.
5. Empty `ARAF_TRACKED_TOKENS` reduces `/api/orders/config` token visibility.

## 7) Documentation maintenance rule

Run this check after every relevant change:

```bash
node scripts/verify-ux-docs-tree.mjs
```

## 8) Validation marker list (for script)

- backend/scripts/app.js
- frontend/src/App.jsx
- backend/scripts/routes/{auth,orders,trades,pii,receipts,stats,logs}.js
- backend/scripts/services/{eventListener,protocolConfig,siwe}.js
- frontend/src/hooks/{useArafContract,usePII}.js|.jsx
- docs/TR/ux.md
- docs/EN/ux.md
