# Araf Protocol UX (Canonical, V3)

Bu doküman **dokümantasyon otoritesi değildir**; canlı kodu açıkça referanslayarak UX akışını kanonikleştirir.
Tek hakem kontrattır: `contracts/src/ArafEscrow.sol`.

## 1) Canlı repo ağacı (UX ile doğrudan ilgili)

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

## 2) V3 authority modeli

- **Contract authority:** `ArafEscrow.sol` state değiştirir (`create*Order`, `fill*Order`, `cancel*Order`, `getOrder`, `getTrade`, `OrderFilled`).
- **Backend mirror/read authority:** `routes/*.js` + `eventListener.js` + `protocolConfig.js` sadece okuma/koordinasyon katmanıdır.
- **Frontend authority:** ABI + route mapping + UI state. Frontend state üretir ama protocol kararı vermez.
- **Child trade ID authority:** `fillSellOrder/fillBuyOrder` sonrası yalnız `OrderFilled` event + `getTrade` zinciri.

## 3) Deploy/env/network önkoşulları

- Destekli chain ID: `8453 (Base)`, `84532 (Base Sepolia)`, `31337 (local)`.
- Frontend zorunlu env:
  - `VITE_ESCROW_ADDRESS` (sıfır adres olamaz)
  - `VITE_USDT_ADDRESS`, `VITE_USDC_ADDRESS` (order açma/fill akışları için)
  - `VITE_API_URL` (opsiyonel ama prod’da önerilen: açıkça backend origin)
- Backend zorunlu env (prod kritik):
  - `ALLOWED_ORIGINS`, `SIWE_DOMAIN`, `SIWE_URI`, `JWT_SECRET`
  - `ARAF_ESCROW_ADDRESS`, `BASE_RPC_URL`, `ARAF_TRACKED_TOKENS`
- Vercel:
  - Rewrite dosyası `frontend/vercel.json` altındadır.
  - Monorepo root deploy ediliyorsa **root’ta vercel config yoksa** `/api/*` rewrite çalışmaz.

## 4) Canonical UX akışı (happy path + blocker path)

1. **App boot** → `App.jsx` render, env uyarıları, ErrorBoundary aktif.
2. **Production env validation** → `VITE_API_URL`/`VITE_ESCROW_ADDRESS` kontrolü.
3. **Vercel/API routing** → frontend `/api/*` çağrıları, rewrite veya explicit backend URL.
4. **Wallet connect** → wagmi connector seçimi.
5. **Wrong network guard** → chain whitelist.
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
19. **Mutual cancel** → off-chain imza koordinasyonu + on-chain `proposeOrApproveCancel`.
20. **Profile/my orders/active/history** → `/api/orders/my`, `/api/trades/my`, `/api/trades/history`.
21. **PII akışları** → `/api/pii/my`, `/api/pii/taker-name/:onchainId`, token-scoped fetch.
22. **Feedback** → `/api/feedback`.
23. **Pause/maintenance** → `paused()` + UI banner.
24. **Client logging** → `/api/logs/client-error`.
25. **Testnet→mainnet readiness** → CORS/SIWE/RPC/token config/treasury doğrulama.
26. **Refresh recovery/pending tx restore** → `localStorage.araf_pending_tx`.

## 5) Testnet/Mainnet farkları

- Testnette kolay geçen ama mainnette blocker olabilenler:
  - SIWE domain/uri gevşekliği
  - CORS wildcard
  - yanlış/eksik token config
  - treasury/final owner kontrolü
  - event listener RPC güvenilirliği
  - cookie güvenlik bayrakları (secure/sameSite)

## 6) Known blockers / failure gates

1. `VITE_API_URL` yanlış format (`.../api`) + path birleştirme tutarsızlığı → log endpoint kırılması.
2. `frontend/vercel.json` var ama root deploy’da kullanılmama riski.
3. `ALLOWED_ORIGINS` prod’da eksik/yanlış ise backend hard-fail.
4. `SIWE_DOMAIN/SIWE_URI` uyumsuzluğu prod login’i bloklar.
5. `ARAF_TRACKED_TOKENS` boşsa `/api/orders/config` token görünürlüğü eksik kalır.

### 6.1 Dosya bazlı blocker matrisi (testnet/mainnet)

| Dosya | Kök neden | Risk | Testnet etkisi | Mainnet etkisi | Fix | Test durumu |
|---|---|---|---|---|---|---|
| contracts/src/ArafEscrow.sol | `REPUTATION_DECAY_CLEAN_PERIOD = 90 days` | Med | UI 180 gün yazarsa kafa karışıklığı | Kullanıcı yanlış ekonomik beklentiye girer | UI metin/hesap 90 güne sabitlenmeli | ✅ |
| frontend/src/app/AppModals.jsx | clean-slate hesap/metin drift | Med | sessiz UX drift | canlıda yanlış yönlendirme | 90 gün + `decayReputation` call | ✅ |
| frontend/src/App.jsx | `activeTradesFilter` case mismatch (`all`/`ALL`) | Med | filtre boş görünebilir | aktif trade görünmez, yanlış support talebi | başlangıç `ALL` | ✅ |
| frontend/src/hooks/useArafContract.js | log endpoint path birleştirme drift | Med | local’de fark edilmez | prod observability kırılır | canonical `/api/logs/client-error` | ✅ |
| frontend/src/components/ErrorBoundary.jsx | API base çözümleme drift | Med | fallback ile çalışır gibi | prod’da yanlış origin/log drop | ortak API resolver | ✅ |
| frontend/.env.example | “Vercel proxy varsa gerekmez” notu eksik bağlam | High | testte tolere edilir | yanlış deploy modelinde API down | root/project scope notunu ekle | ⚠ manuel ops |
| frontend/vercel.json | rewrite yalnız frontend scope’da | High | frontend project root doğruysa çalışır | monorepo root deploy’da `/api/*` 404 | project root düzelt / root vercel.json | ⚠ manuel ops |
| backend/scripts/app.js | prod CORS/SIWE guard hard-fail | High | devde geçer | prod boot fail | env checklist + smoke script | ✅ |
| backend/scripts/services/siwe.js | SIWE domain/URI strict match | High | local varsayılan ile geçer | prod login tamamen bloklanır | domain/uri CI check | ⚠ ops |
| backend/scripts/services/protocolConfig.js | `BASE_RPC_URL`/`ARAF_ESCROW_ADDRESS` yoksa config unavailable | High | route 503 olabilir | read model bozulur | startup env doğrulama | ⚠ ops |
| backend/scripts/services/eventListener.js | RPC/chain kesintisi mirror geciktirir | Med | geç sync | stale order/trade görünümü | health/readiness takip + retry | ⚠ ops |
| contracts/scripts/deploy.js | token/treasury/owner env yanlış set | High | testte mock ile maskelenebilir | yanlış owner/token config kalıcı risk | deploy manifest review + checklist | ⚠ ops |

## 7) Doküman bakım kuralı

Bu dosya her değişiklikte aşağıdaki komutla doğrulanmalıdır:

```bash
node scripts/verify-ux-docs-tree.mjs
node scripts/mainnet-readiness-smoke.mjs
```

## 8) Doğrulama marker listesi (script için)

- backend/scripts/app.js
- frontend/src/App.jsx
- backend/scripts/routes/{auth,orders,trades,pii,receipts,stats,logs}.js
- backend/scripts/services/{eventListener,protocolConfig,siwe}.js
- frontend/src/hooks/{useArafContract,usePII}.js|.jsx
- docs/TR/ux.md
- docs/EN/ux.md
