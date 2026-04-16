# Araf Protocol UX Canonical (TR, V3 Order/Trade)

Bu doküman **authority değildir**; canlı kodun (özellikle `contracts/src/ArafEscrow.sol`) davranışını UX seviyesinde eşler.

## 1) Canlı repo ağacı (UX için kanonik, doğrulanmış)

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

## 2) V3 otorite modeli

- **Tek hakem (code is law):** `contracts/src/ArafEscrow.sol`
- Backend (`orders/trades/auth/pii/...`) yalnız mirror/read + session/PII güvenlik katmanıdır.
- Frontend yalnızca:
  - kontrat ABI + event decode (`useArafContract.js`)
  - backend response mapping (`useAppSessionData.jsx`, `orderModel.js`)
  - UI state yönetir.

## 3) Ağ/Deploy önkoşulları

### Desteklenen chain ID
- `8453` Base Mainnet
- `84532` Base Sepolia
- `31337` Hardhat local

### Frontend zorunlu env
- `VITE_ESCROW_ADDRESS` (sıfır adres olamaz)
- `VITE_USDT_ADDRESS`, `VITE_USDC_ADDRESS` (trade akışlarında gerekli)
- `VITE_API_URL` opsiyonel ama kritik:
  - varsa backend base URL (ör: `https://api.example.com`) olmalı
  - yoksa frontend `/api/*` aynı-origin proxy bekler (`frontend/vercel.json`)

### Backend zorunlu env (özet)
- `ARAF_ESCROW_ADDRESS`, `BASE_RPC_URL`, `ALLOWED_ORIGINS`
- SIWE/cookie için domain + secure ayarları (`services/siwe.js`, `routes/auth.js`)
- Listener/Protocol config için RPC erişimi (`eventListener.js`, `protocolConfig.js`)

## 4) V3 UX akışı (happy + blocker)

1. **App boot:** `App.jsx` + `useAppSessionData.jsx` yüklenir; env banner ve ilk fetchler başlar.
2. **Production env validation:** `VITE_ESCROW_ADDRESS` yoksa kontrat write/read bloklanır.
3. **Vercel deploy/API routing:** `frontend/vercel.json` `/api/*` isteklerini backend’e rewrite eder.
4. **Wallet connect:** wagmi connect + adres state senkronu.
5. **Wrong network guard:** chain id destek dışıysa kontrat çağrısı reddedilir.
6. **SIWE login/session restore:** `/api/auth/nonce` → imza → `/api/auth/verify`; restore `/api/auth/me`.
7. **Wallet registration (anti-sybil):** `registerWallet()` ve `antiSybilCheck()`.
8. **Maker SELL order:** `approveToken` → `createSellOrder`.
9. **Maker BUY order:** `approveToken` (reserve) → `createBuyOrder`.
10. **Marketplace fetch/render:** `/api/orders` + `/api/orders/config`.
11. **Taker fill SELL:** `fillSellOrder`.
12. **Taker fill BUY:** `fillBuyOrder`.
13. **Child trade ID authority:** yalnız `OrderFilled` event decode + gerekirse `getTrade(tradeId)` doğrulaması.
14. **Trade room open/resume:** `/api/trades/my` + aktif trade state.
15. **Receipt upload:** `/api/receipts/upload`.
16. **Report payment:** `reportPayment(tradeId, ipfsHash)`.
17. **Maker release:** `releaseFunds(tradeId)`.
18. **Ping/challenge/auto-release/burn:** `pingMaker`, `pingTakerForChallenge`, `challengeTrade`, `autoRelease`, `burnExpired`.
19. **Mutual cancel:** `signCancelProposal` + `proposeOrApproveCancel`.
20. **Profile/my orders/active/history:** `/api/orders/my`, `/api/trades/my`, `/api/trades/history`.
21. **PII akışı:** `/api/pii/request-token/:tradeId` → `/api/pii/:tradeId`; taker adı `/api/pii/taker-name/:onchainId`.
22. **Feedback:** `/api/feedback`.
23. **Pause mode:** kontrat `paused()` state’i UI guard’da kullanılır.
24. **Client error logging:** `/api/logs/client-error`.
25. **Testnet→Mainnet readiness:** token/address/cors/siwe/proxy/listener checklist.
26. **Recovery after refresh:** `localStorage.araf_pending_tx` + yeniden sorgu.

## 5) Testnet vs Mainnet

- Testnette düşük güvenlik konfigleri tolere edilebilir (ör. gevşek origin/cookie domain).
- Mainnette aşağıdakiler zorunlu:
  - `ALLOWED_ORIGINS` production domainlerle tam eşleşmeli
  - `SIWE_DOMAIN` gerçek domain olmalı
  - secure cookie (`https`) zorunlu
  - token/address map production adresleriyle eşleşmeli
  - listener + protocol config canlı RPC ile senkron çalışmalı

## 6) Known blockers / failure gates

1. **Vercel root yanlış seçimi:** deploy root `frontend/` değilse `frontend/vercel.json` rewrite devreye girmeyebilir → `/api/*` 404.
2. **`VITE_API_URL` ve proxy tutarsızlığı:** proxy yok + env boş ise frontend API çağrıları başarısız.
3. **CORS yanlış origin:** backend ayrı origin’deyse `ALLOWED_ORIGINS` eksikliği login/PII/trade fetch bloklar.
4. **SIWE domain/cookie yanlış:** auth restore döngüsü ve 401/409 artışı.
5. **Chain/address mismatch:** yanlış chain ID veya sıfır escrow adresiyle write path kapalı.
6. **Mainnet token config eksik:** tracked token/pair map yanlışsa order create/fill pratikte kilitlenir.

## 7) Ekonomik kural notu (kontratla senkron)

- Clean-slate (`decayReputation`) eşiği: **90 gün** (`REPUTATION_DECAY_CLEAN_PERIOD = 90 days`).
- UX kopyaları ve backend decay job eşiği bu değere eşit olmalıdır.

