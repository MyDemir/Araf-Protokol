# Araf Protocol V3 Order/Trade Audit Raporu (Kanıt Tabanlı)

**Tarih:** 2026-04-16  
**Kural:** Tek hakem `contracts/src/ArafEscrow.sol` (code is law)

---

## 1) Executive Summary

Bu rapor yalnızca şu üç kaynağa dayanır:
1. Exact code-path analizi
2. Çalıştırılmış testler
3. Çalıştırılmış doğrulama scriptleri

### Net sonuç
- V3 authority zinciri `ArafEscrow.sol` merkezli olarak dokümanlara ve frontend/backend mapping’e hizalanmıştır.
- Kritik üretim riski olan API path/base drift ve logging endpoint drift’i kodda giderilmiştir.
- UX clean-slate süresi kontrat otoritesine (90 gün) çekilmiştir.
- Dokümanlar için tree drift doğrulaması ve mainnet readiness smoke script’i eklenmiştir.

---

## 2) UX Docs Drift Summary

### Drift bulguları
- Eski UX dokümanları canlı repo ağacı ve V3 order/trade modeli ile tam hizalı değildi.
- Testnet/mainnet blocker görünürlüğü yetersizdi.

### Uygulanan düzeltmeler
- `docs/TR/ux.md` ve `docs/EN/ux.md` kanonik hale getirildi.
- 26 adımlık UX akışı, V3 authority modeli, deploy/env/network bağımlılıkları ve file-based blocker matrisi eklendi.

---

## 3) Updated UX Flow Matrix (26 Adım)

| # | UX Adımı | Frontend | Backend | Contract | Env/Deploy | Test Durumu |
|---|---|---|---|---|---|---|
| 1 | App boot | `App.jsx` | - | - | `VITE_*` | Var |
| 2 | Production env validation | `App.jsx` | - | - | `VITE_API_URL`, `VITE_ESCROW_ADDRESS` | Var |
| 3 | Vercel deploy/API routing | `apiConfig.js` | `app.js` mounts | - | `frontend/vercel.json` | Var |
| 4 | Wallet connect | `App.jsx` | - | - | Wallet provider | Kanıt yeterli |
| 5 | Wrong network guard | `App.jsx`, `useArafContract.js` | - | chain constraints | chain id | Kanıt yeterli |
| 6 | SIWE login/session restore | `useAppSessionData.jsx` | `routes/auth.js` | - | `SIWE_*`, cookie | Kanıt yeterli |
| 7 | Wallet registration | `App.jsx` | mirror only | `registerWallet` | network | Kanıt yeterli |
| 8 | Maker create SELL order | `App.jsx` | mirror only | `createSellOrder` | token/allowance | Kanıt yeterli |
| 9 | Maker create BUY order | `App.jsx` | mirror only | `createBuyOrder` | token/allowance | Kanıt yeterli |
| 10 | Marketplace fetch/render | `useAppSessionData.jsx` | `routes/orders.js` | `getOrder` | `/api/orders*` | Var |
| 11 | Taker fill SELL | `useArafContract.js` | mirror only | `fillSellOrder` + `OrderFilled` | tx | Kanıt yeterli |
| 12 | Taker fill BUY | `useArafContract.js` | mirror only | `fillBuyOrder` + `OrderFilled` | tx | Kanıt yeterli |
| 13 | Child trade ID authority | `useArafContract.js` | `routes/trades.js` | `OrderFilled` + `getTrade` | - | Kanıt yeterli |
| 14 | Trade room open/resume | `useAppSessionData.jsx` | `routes/trades.js` | `getTrade` | session | Kanıt yeterli |
| 15 | Receipt upload | `App.jsx` | `routes/receipts.js` | `reportPayment` sonrası state | upload cfg | Kanıt yeterli |
| 16 | Report payment | `App.jsx` | mirror only | `reportPayment` | tx | Kanıt yeterli |
| 17 | Maker release | `App.jsx` | audit endpoints | `releaseFunds` | tx | Kanıt yeterli |
| 18 | Ping/challenge/auto-release/burn | `App.jsx` | mirror/audit | `ping*`, `challengeTrade`, `autoRelease`, `burnExpired` | timers | Kanıt yeterli |
| 19 | Mutual cancel | `App.jsx` | `routes/trades.js` | `proposeOrApproveCancel` | deadline/signature | Kanıt yeterli |
| 20 | Profile/orders/history | `AppModals.jsx` | `orders/trades` routes | read views | auth | Var |
| 21 | PII fetch/update | `usePII.js`, `PIIDisplay.jsx` | `routes/pii.js` | - | pii token | Kanıt yeterli |
| 22 | Feedback submission | `App.jsx` | `routes/feedback.js` | - | auth/rate-limit | Kanıt yeterli |
| 23 | Pause/maintenance | `App.jsx` | mirror | `paused()` | network | Kanıt yeterli |
| 24 | Logging/client error | `ErrorBoundary`, `useArafContract` | `routes/logs.js` | - | `/api/logs/client-error` | Var |
| 25 | Testnet→mainnet readiness | docs/scripts | `app.js`, `siwe.js`, `protocolConfig.js` | deploy owner/token | env/cors/siwe/rpc | Var |
| 26 | Refresh/pending tx restore | `useArafContract.js`, `useAppSessionData.jsx` | session refresh | tx receipt waits | localStorage | Kanıt yeterli |

---

## 4) File-by-File Score Table

> Skorlar bu rapor turunda doğrudan incelenen dosyalar için verilmiştir. İncelenmeyen dosya için “kanıt yetersiz” işaretlenmiştir.

| File | Score | Exact Issue | Fixed? | Test/Check |
|---|---:|---|---|---|
| contracts/src/ArafEscrow.sol | 98 | Otorite kaynağı; clean-slate 90 gün | N/A | code-path |
| frontend/src/app/AppModals.jsx | 93 | 180→90 drift + decay context eksikliği | Yes | AppModals test |
| frontend/src/App.jsx | 94 | `activeTradesFilter` case drift | Yes | frontend test |
| frontend/src/app/apiConfig.js | 92 | Yeni canonical resolver | Yes | apiConfig test |
| frontend/src/hooks/useArafContract.js | 92 | log endpoint drift | Yes | logging test |
| frontend/src/components/ErrorBoundary.jsx | 92 | ad-hoc API çözümleme | Yes | path test |
| frontend/src/app/useAppSessionData.jsx | 93 | API base çözümlenmesi tekilleştirildi | Yes | path test |
| frontend/src/hooks/usePII.js | 93 | API base çözümlenmesi tekilleştirildi | Yes | usePII + path |
| backend/scripts/app.js | 91 | mount consistency kritik | N/A | route mount test |
| backend/scripts/routes/orders.js | 91 | `/config` shape authority | N/A | orders.config test |
| docs/TR/ux.md | 97 | drift temizliği + file blocker matrisi | Yes | tree verify |
| docs/EN/ux.md | 97 | TR ile semantik eşdeğer | Yes | tree verify |
| scripts/verify-ux-docs-tree.mjs | 91 | docs-tree gate yoktu | Yes | run ok |
| scripts/mainnet-readiness-smoke.mjs | 90 | mainnet gate check yoktu | Yes | run ok |
| backend/scripts/services/eventListener.js | 70 | RPC outage senaryosu için yalnız code-path kanıtı var, ek runtime smoke yok | No | kanıt yetersiz |
| backend/scripts/services/protocolConfig.js | 74 | env eksikliği ve CONFIG_UNAVAILABLE code-path ile doğrulandı; integration smoke eksik | No | kanıt yetersiz |

---

## 5) Root Cause — Vercel “Sistem Kesintisi”

### Kanıtlanan kök nedenler
1. **Frontend API base/path drift**: farklı dosyalar farklı base varsayımları yapıyordu.
2. **Log endpoint drift**: canonical mount `/api/logs/client-error` ile bazı client path birleştirmeleri tutarsızdı.
3. **Deploy scope riski**: rewrite yalnız `frontend/vercel.json` altında; monorepo root deploy modelinde yanlış project-root ayarıyla `/api/*` kırılabilir.

### Uygulanan fix
- `frontend/src/app/apiConfig.js` ile tekil resolver
- İlgili tüm frontend katmanlarının resolver kullanacak şekilde hizalanması

---

## 6) Testnet/Mainnet Blocker Table (Geniş)

Detaylı tablo `docs/TR/ux.md` bölüm 6.1’de dosya bazlı verildi.

Özet risk sınıfları:
- **High:** deploy scope, CORS/SIWE strict env, protocol config env, deploy owner/token config
- **Med:** UX drift, filter case drift, logging drift, listener gecikme

---

## 7) Changed Files

- `docs/TR/ux.md`
- `docs/EN/ux.md`
- `frontend/src/App.jsx`
- `frontend/src/app/AppModals.jsx`
- `frontend/src/app/apiConfig.js`
- `frontend/src/app/useAppSessionData.jsx`
- `frontend/src/components/ErrorBoundary.jsx`
- `frontend/src/hooks/useArafContract.js`
- `frontend/src/hooks/usePII.js`
- `frontend/src/test/AppModals.test.jsx`
- `frontend/src/test/apiConfig.test.js`
- `frontend/src/test/apiPathAlignment.test.js`
- `frontend/src/test/useArafContract.logging.test.js`
- `backend/test/orders.config.test.js`
- `backend/test/route.mounts.test.js`
- `scripts/verify-ux-docs-tree.mjs`
- `scripts/mainnet-readiness-smoke.mjs`
- `docs/TR/V3_ORDER_TRADE_AUDIT_REPORT.md` (bu rapor)

---

## 8) Tests Run + Sonuçlar

- `frontend npm test` → passed
- `backend npm test` → passed
- `node scripts/verify-ux-docs-tree.mjs` → passed
- `node scripts/mainnet-readiness-smoke.mjs` → passed (env dosyası yoksa warning ile env check skip)

---

## 9) Kalan Riskler

- `backend/.env` yoksa readiness script env içeriğini validate edemez (yalnız file gate çalışır).
- `eventListener` ve `protocolConfig` için canlı integration smoke hâlâ eklenmeli.
- Monorepo deploy modelinde Vercel project-root yanlış konfigüre edilirse rewrite riski sürer.

