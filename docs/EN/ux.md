# Araf Protocol UX Canonical (EN, V3 Order/Trade)

This document is **not authority**; it maps UX behavior to live code (especially `contracts/src/ArafEscrow.sol`).

## 1) Live repository tree (UX-canonical, verified)

```text
contracts/src/ArafEscrow.sol
contracts/test/ArafEscrow.test.js
contracts/scripts/deploy.js
backend/scripts/app.js
backend/scripts/routes/orders.js
backend/scripts/routes/trades.js
backend/scripts/routes/auth.js
backend/scripts/routes/pii.js
backend/scripts/routes/receipts.js
backend/scripts/routes/stats.js
backend/scripts/routes/logs.js
backend/scripts/services/protocolConfig.js
backend/scripts/services/eventListener.js
backend/scripts/services/siwe.js
backend/scripts/middleware/auth.js
backend/scripts/jobs/reputationDecay.js
frontend/src/App.jsx
frontend/src/app/useAppSessionData.jsx
frontend/src/app/AppModals.jsx
frontend/src/app/AppViews.jsx
frontend/src/app/orderModel.js
frontend/src/hooks/useArafContract.js
frontend/src/hooks/usePII.js
frontend/src/components/PIIDisplay.jsx
frontend/.env.example
frontend/vercel.json
docs/TR/ux.md
docs/EN/ux.md
```

## 2) V3 authority model

- **Single authority (code is law):** `contracts/src/ArafEscrow.sol`
- Backend (`orders/trades/auth/pii/...`) is mirror/read + session/PII security layer only.
- Frontend only handles:
  - contract ABI + event decode (`useArafContract.js`)
  - backend response mapping (`useAppSessionData.jsx`, `orderModel.js`)
  - UI state.

## 3) Network/Deploy prerequisites

### Supported chain IDs
- `8453` Base Mainnet
- `84532` Base Sepolia
- `31337` Hardhat local

### Required frontend env
- `VITE_ESCROW_ADDRESS` (must not be zero address)
- `VITE_USDT_ADDRESS`, `VITE_USDC_ADDRESS` (required for trade flows)
- `VITE_API_URL` optional but critical:
  - if set, it must be backend base URL (e.g. `https://api.example.com`)
  - if unset, frontend expects same-origin `/api/*` proxy (`frontend/vercel.json`)

### Required backend env (summary)
- `ARAF_ESCROW_ADDRESS`, `BASE_RPC_URL`, `ALLOWED_ORIGINS`
- SIWE/cookie domain+secure config (`services/siwe.js`, `routes/auth.js`)
- RPC access for listener/protocol config (`eventListener.js`, `protocolConfig.js`)

## 4) V3 UX flow (happy + blocker paths)

1. **App boot:** `App.jsx` + `useAppSessionData.jsx` load; env banner and initial fetches start.
2. **Production env validation:** missing `VITE_ESCROW_ADDRESS` blocks contract read/write.
3. **Vercel deploy/API routing:** `frontend/vercel.json` rewrites `/api/*` to backend.
4. **Wallet connect:** wagmi connect + address state sync.
5. **Wrong network guard:** unsupported chain ID rejects contract calls.
6. **SIWE login/session restore:** `/api/auth/nonce` → signature → `/api/auth/verify`; restore via `/api/auth/me`.
7. **Wallet registration (anti-sybil):** `registerWallet()` + `antiSybilCheck()`.
8. **Maker SELL order:** `approveToken` → `createSellOrder`.
9. **Maker BUY order:** `approveToken` (reserve) → `createBuyOrder`.
10. **Marketplace fetch/render:** `/api/orders` + `/api/orders/config`.
11. **Taker fill SELL:** `fillSellOrder`.
12. **Taker fill BUY:** `fillBuyOrder`.
13. **Child trade ID authority:** only `OrderFilled` event decode + optional `getTrade(tradeId)` verification.
14. **Trade room open/resume:** `/api/trades/my` + active trade state.
15. **Receipt upload:** `/api/receipts/upload`.
16. **Report payment:** `reportPayment(tradeId, ipfsHash)`.
17. **Maker release:** `releaseFunds(tradeId)`.
18. **Ping/challenge/auto-release/burn:** `pingMaker`, `pingTakerForChallenge`, `challengeTrade`, `autoRelease`, `burnExpired`.
19. **Mutual cancel:** `signCancelProposal` + `proposeOrApproveCancel`.
20. **Profile/my orders/active/history:** `/api/orders/my`, `/api/trades/my`, `/api/trades/history`.
21. **PII flow:** `/api/pii/request-token/:tradeId` → `/api/pii/:tradeId`; taker name via `/api/pii/taker-name/:onchainId`.
22. **Feedback:** `/api/feedback`.
23. **Pause mode:** contract `paused()` is used in UI guards.
24. **Client error logging:** `/api/logs/client-error`.
25. **Testnet→Mainnet readiness:** token/address/cors/siwe/proxy/listener checklist.
26. **Recovery after refresh:** `localStorage.araf_pending_tx` + re-query.

## 5) Testnet vs Mainnet

- Testnet may tolerate weaker config (e.g., permissive origin/cookie domain).
- Mainnet requires:
  - `ALLOWED_ORIGINS` exact production domains
  - real `SIWE_DOMAIN`
  - secure cookies (`https`)
  - production token/address maps
  - listener + protocol config synced with live RPC

## 6) Known blockers / failure gates

1. **Wrong Vercel root selection:** if deploy root is not `frontend/`, `frontend/vercel.json` rewrite may not apply → `/api/*` 404.
2. **`VITE_API_URL` vs proxy mismatch:** no proxy + empty env causes frontend API failures.
3. **CORS misconfiguration:** when backend is cross-origin, missing `ALLOWED_ORIGINS` blocks login/PII/trade fetch.
4. **SIWE domain/cookie mismatch:** auth restore loops and rising 401/409 rates.
5. **Chain/address mismatch:** unsupported chain or zero escrow address blocks write paths.
6. **Missing mainnet token config:** wrong tracked token/pair map effectively blocks order create/fill.

## 7) Economic rule note (contract-synced)

- Clean-slate (`decayReputation`) threshold: **90 days** (`REPUTATION_DECAY_CLEAN_PERIOD = 90 days`).
- UX copy and backend decay job threshold must stay equal to this value.

