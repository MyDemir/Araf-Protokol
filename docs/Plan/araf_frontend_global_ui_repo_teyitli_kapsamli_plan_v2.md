# Araf Protocol Frontend Global UI Revizyonu — Repo Teyitli Kapsamlı Plan V2

> Amaç: Global ürün lansmanına uygun, modern, responsive, mobil uyumlu, kullanıcı yönlendirmeli ve açıklayıcı durumları netleşmiş bir frontend tasarım dili kurmak.  
> Kapsam: repo mimari dokümanları + frontend runtime dosyaları + hook/component/action yüzeyleri + V2 UX prensipleri.

---

## 1. Kaynak Teyidi ve Değişen Yaklaşım

Önceki global tasarım dili dosyası ürün vizyonunu tarif ediyordu fakat projenin tam mimari gerçekliğini, frontend dosya yüzeyini ve fonksiyon/method kapsamını yeterince taşımıyordu. Bu revizyon şu kaynak gerçeklerine göre yeniden kurulmuştur:

- Araf V3 canonical model: parent order market primitive, child trade gerçek escrow lifecycle.
- Contract authoritative state machine; backend mirror/coordination; frontend UX guardrail + contract access.
- Frontend React/Vite/Tailwind tabanlı; heavy UI framework yok.
- Tailwind theme token sistemi henüz boş; mevcut UI hardcoded dark theme class ağırlıklı.
- AppViews/AppModals/App/useAppSessionData/useArafContract büyük fonksiyon yüzeyi taşıyor.
- Aktif işlemler hızlı erişimi ürünün merkezi bir UX yüzeyi; `LOCKED / PAID / CHALLENGED` filtreleri korunmalı.
- PII, settlement, rewards, admin observability, reference ticker ve risk badge alanları non-authoritative UI olarak tasarlanmalı.

---

## 2. Mimari Gerçeklerden Çıkan Tasarım Kuralları

### 2.1 Frontend authority değildir

Frontend şunları yapamaz:

- escrow sonucunu belirlemek
- backend mirror verisini kontrat authority yerine geçirmek
- settlement dağılımını tarafların yerine kararlaştırmak
- payment risk sinyalini kullanıcı güven hükmüne çevirmek
- reference ticker verisini escrow sonucuna bağlamak
- rewards eligibility üretmek

Frontend şunları yapmalıdır:

- kullanıcıyı doğru contract action’a yönlendirmek
- state’i açıklayıcı ve anlaşılır göstermek
- kontrat preflight hatalarını insan diline çevirmek
- bekleme pencerelerini net anlatmak
- PII ve güvenlik akışlarında panik yaratmadan güven hissi vermek
- trade room’da kullanıcıya “şimdi ne yapmalıyım?” sorusunu cevaplamak

### 2.2 Ürün dili sınırı

Yanlış ürün dili:

- “Araf kimin haklı olduğunu ispatlar.”
- “Araf chargeback riskini yok eder.”
- “Dispute kazanılır/kaybedilir.”
- “Rewards cashback’tir.”
- “Payment risk counterparty trust score’dur.”

Doğru ürün dili:

- “Araf yargılamaz; davranışı fiyatlandırır.”
- “Araf hakem değildir; kurallar ve süre baskısı ile çözüm üretir.”
- “Payment risk ödeme yönteminin operasyonel karmaşıklığıdır.”
- “Proof of Peace hızlı temiz çözümü daha değerli hale getirir.”
- “Settlement yalnız CHALLENGED fazında iki taraf iradesiyle mümkündür.”

---

## 3. Frontend Dosya Haritası

Repo içindeki frontend dosya yapısı bu revizyonda şu şekilde ele alınmalıdır:

```txt
frontend/
├── src/
│   ├── app/
│   │   ├── apiConfig.js
│   │   ├── AppModals.jsx
│   │   ├── AppViews.jsx
│   │   ├── bootstrapState.js
│   │   ├── chainPolicy.js
│   │   ├── fillAmountPolicy.js
│   │   ├── orderUiModel.js
│   │   └── useAppSessionData.jsx
│   ├── components/
│   │   ├── ErrorBoundary.jsx
│   │   ├── PaymentRiskBadge.jsx
│   │   ├── PIIDisplay.jsx
│   │   ├── ReferenceRateTicker.jsx
│   │   ├── RewardsDashboard.jsx
│   │   ├── SettlementPreviewModal.jsx
│   │   └── SettlementProposalCard.jsx
│   ├── hooks/
│   │   ├── useArafContract.js
│   │   ├── useCountdown.js
│   │   ├── usePII.js
│   │   └── useRewardsContract.js
│   ├── test/
│   │   ├── AdminPanelPolling.test.jsx
│   │   ├── apiConfig.test.js
│   │   ├── apiPathAlignment.test.js
│   │   ├── AppModals.test.jsx
│   │   ├── AppRouting.test.js
│   │   ├── AppSmoke.test.jsx
│   │   ├── AppViews.referenceTicker.test.jsx
│   │   ├── AppViews.test.jsx
│   │   ├── bootstrapState.test.js
│   │   ├── chainPolicy.security.test.js
│   │   ├── deployEnvResolution.test.js
│   │   ├── fillAmountPolicy.test.js
│   │   ├── orderUiModel.test.js
│   │   ├── PaymentRiskBadge.test.jsx
│   │   ├── PIIDisplay.test.jsx
│   │   ├── ReferenceRateTicker.test.jsx
│   │   ├── rewards.authority.readonly.regression.test.js
│   │   ├── RewardsDashboard.test.jsx
│   │   ├── sessionGuardRegression.test.js
│   │   ├── sessionMapping.test.js
│   │   ├── setupTests.js
│   │   ├── SettlementProposalCard.test.js
│   │   ├── useAppSessionData.reputationMapping.test.js
│   │   ├── useAppSessionDataAuthChecked.test.jsx
│   │   ├── useAppSessionDataAuthToastDedup.test.jsx
│   │   ├── useArafContract.abiSource.test.js
│   │   ├── useArafContract.reputationV3.test.js
│   │   ├── usePII.test.jsx
│   │   └── useRewardsContract.abiSource.test.js
│   ├── AdminPanel.jsx
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── vercel.json
└── vite.config.js
```

---

## 4. Fonksiyon / Method Yüzeyi — Dosya Bazlı Envanter

Aşağıdaki tablo UI planında korunması, sadeleştirilmesi veya component tasarımına taşınması gereken fonksiyon/method yüzeyini gösterir.

### 4.1 Entry ve provider katmanı

| Dosya | Fonksiyon / method / yüzey | UX revizyon etkisi |
|---|---|---|
| `main.jsx` | `getCodespacesRPC(port)` | Dev RPC çözümü; global UI planında kullanıcı yüzeyine taşınmaz. |
| `main.jsx` | `createConfig`, `WagmiProvider`, `QueryClientProvider`, `ErrorBoundary`, `App` render tree | Provider yapısı korunmalı; ErrorBoundary provider içinde kalmalı. |
| `main.jsx` | `CHAIN_BY_ID`, `wagmiChains`, `config`, `queryClient` | Ağ/chain guardrail UI ile uyumlu kalmalı. |

### 4.2 App root ve kullanıcı akış handler’ları

| Dosya | Fonksiyon / method / yüzey | UI tasarım kararı |
|---|---|---|
| `App.jsx` | `StatChange` | MetricCard component’ine taşınmalı. |
| `App.jsx` | `canonicalizePayoutProfileDraft` | PaymentProfileForm içine taşınmalı; validation mesajları sadeleşmeli. |
| `App.jsx` | `formatTokenAmountFromRaw` | TokenAmount component/helper olarak ortaklaştırılmalı. |
| `App.jsx` | `rawTokenToDisplayNumber` | UI-only analytics helper olarak kalmalı. |
| `App.jsx` | `App` | Daha fazla büyütülmemeli; shell, views, modals ayrıştırılmalı. |
| `App.jsx` | `showToast` | Toast sistemi theme-aware ve accessible hale getirilmeli. |
| `App.jsx` | `openSidebar` | Auto-close kaldırılmalı; mobile drawer explicit close davranışı korunmalı. |
| `App.jsx` | `requireSignedSessionForActiveWallet` | Wallet/session mismatch UI mesajları SystemStatusBar’a bağlanmalı. |
| `App.jsx` | `handleLogoutAndDisconnect` | Profile/Account page action olarak tasarlanmalı. |
| `App.jsx` | `getWalletIcon` | WalletOption component içine alınmalı. |
| `App.jsx` | `loginWithSIWE` | Wallet sign-in flow için Stepper/Guidance panel kullanılmalı. |
| `App.jsx` | `handleMint` | Dev/test faucet UI production’da tamamen gizlenmeli. |
| `App.jsx` | `handleStartTrade` | Market card CTA flow’unun kalbi; preflight, approve, fill, backend sync durumları step-based gösterilmeli. |
| `App.jsx` | `handleFileUpload` | ReceiptUpload component’e ayrılmalı. |
| `App.jsx` | `handleReportPayment` | LOCKED/Taker primary action panel’e bağlanmalı. |
| `App.jsx` | `handleProposeCancel` | Secondary action; destructive/exit action olarak ayrılmalı. |
| `App.jsx` | `handleRelease` | PAID/Maker primary CTA. |
| `App.jsx` | `handleChallenge` | PAID/Maker secondary risk CTA; açıklama zorunlu. |
| `App.jsx` | `handlePingMaker` | PAID/Taker liveness CTA; countdown ile birlikte gösterilmeli. |
| `App.jsx` | `handleAutoRelease` | Taker için süre bitince açılan CTA. |
| `App.jsx` | `handleChargebackAck` | Taker onboarding/ack gate; kısa ama net risk açıklaması gerekir. |
| `App.jsx` | `handleCreateOrder` | Maker order section form submit flow. |
| `App.jsx` | `handleOpenMakerModal` | New order entrypoint; mobile’de bottom sheet veya route. |
| `App.jsx` | `handleDeleteOrder` | MyOrders destructive action; confirmation dialog tasarlanmalı. |
| `App.jsx` | `handleUpdatePII` | Payment profile save flow; success/failure state sadeleşmeli. |
| `App.jsx` | `submitFeedback` | FeedbackPanel action; global product feedback yüzeyi. |
| `App.jsx` | `getSafeTelegramUrl` | Contact safety helper; PII display içinde kullanılmalı. |

> Not: `App.jsx` çok geniştir; bu dosyaya yeni tasarım mantığı eklenmemeli. Mevcut handler’lar korunarak yeni component’lere prop olarak dağıtılmalı.

### 4.3 App view/render katmanı

| Dosya | Fonksiyon / method / yüzey | UI tasarım kararı |
|---|---|---|
| `AppViews.jsx` | `buildAppViews(ctx)` | View factory olarak kalabilir ama parçalanmalı. |
| `AppViews.jsx` | `renderSlimRail` | DesktopNavRail component’e ayrılmalı. |
| `AppViews.jsx` | `renderContextSidebar` | ContextFilterPanel’e ayrılmalı; auto-close kaldırılmalı. |
| `AppViews.jsx` | `renderHome` | HomePage component’e taşınmalı. |
| `AppViews.jsx` | `renderMarket` | MarketPage + MarketOrderCard + MarketFilterBar olarak bölünmeli. |
| `AppViews.jsx` | Trade room render yüzeyi | TradeRoomPage + StateGuidancePanel + PrimaryActionPanel olarak yeniden kurulmalı. |
| `AppViews.jsx` | Aktif escrow sidebar quick access | ActiveTradesCenter ve ActiveTradeCard’a taşınmalı. |
| `AppViews.jsx` | Settlement quick access | SettlementQuickAccess / SettlementQueue component’i olmalı. |

### 4.4 Modal/render katmanı

| Dosya | Fonksiyon / method / yüzey | UI tasarım kararı |
|---|---|---|
| `AppModals.jsx` | `EnvWarningBanner` | SystemStatusBar içine alınmalı. |
| `AppModals.jsx` | `buildAppModals(ctx)` | Modal factory küçültülmeli. |
| `AppModals.jsx` | `renderWalletModal` | WalletConnectDialog / WalletSheet olarak ayrılmalı. |
| `AppModals.jsx` | `renderFeedbackModal` | FeedbackPanel component’i olmalı. |
| `AppModals.jsx` | `renderMakerModal` | MakerOrderFlow / MakerOrderSheet olarak bölünmeli. |
| `AppModals.jsx` | `renderProfileModal` | Kısa vadede sade modal; orta vadede `/profile/*` route. |
| `AppModals.jsx` | Profile tab render blokları | Account, Reputation, MyOrders, ActiveTrades, History, PaymentProfile olarak ayrılmalı. |

### 4.5 App utility/model dosyaları

| Dosya | Fonksiyon / method | Rol | UI kararı |
|---|---|---|---|
| `apiConfig.js` | `resolveApiBaseUrl` | API base policy | Production same-origin policy korunmalı. |
| `apiConfig.js` | `resolveApiPolicyDiagnostics` | Env diagnostics | SystemStatusBar’a bağlanmalı. |
| `apiConfig.js` | `buildApiUrl` | Canonical API URL builder | Tüm fetch yüzeyleri bunu kullanmalı. |
| `apiConfig.js` | `resolveClientErrorLogUrl` | Client error logging URL | ErrorBoundary / contract logs kullanmaya devam etmeli. |
| `apiConfig.js` | `buildSettlementPreviewUrl` | Settlement preview endpoint | SettlementPreviewModal kullanmaya devam etmeli. |
| `bootstrapState.js` | `getInitialLang` | Initial language | Theme için benzer `getInitialThemeMode` eklenmeli. |
| `bootstrapState.js` | `getInitialTermsAccepted` | Terms state | Terms modal/consent UI sadeleşmeli. |
| `chainPolicy.js` | `getSupportedChainIds` | Env-aware chain support | NetworkGuard component olmalı. |
| `chainPolicy.js` | `getSupportedChainsMap` | Chain label map | Network mismatch UI’da kullanılmalı. |
| `chainPolicy.js` | `isSupportedChainId` | chain gate | CTA disabled reason olarak gösterilmeli. |
| `chainPolicy.js` | `isMintTokenEnabled` | faucet gate | Production’da faucet gizli kalmalı. |
| `fillAmountPolicy.js` | `resolveValidatedFillAmountRaw` | Partial fill fail-closed validator | Market fill input inline validation’a bağlanmalı. |
| `orderUiModel.js` | `normalizeOrderSide` | side normalization | Kullanıcı yüzeyinde raw side gösterilmemeli. |
| `orderUiModel.js` | `assertOrderSide` | fail-closed side check | CTA disabled reason’da anlaşılır açıklama. |
| `orderUiModel.js` | `resolveOrderActionFns` | fill/create/cancel fn resolver | App handler tarafında korunmalı. |
| `orderUiModel.js` | `getMakerModalCopy` | Maker form copy | Global copy dictionary’ye taşınmalı. |
| `orderUiModel.js` | `buildMakerPreview` | Reserve preview | ReservePreviewCard component. |
| `orderUiModel.js` | `resolvePaymentRiskEntry` | payment risk config lookup | PaymentRiskSummary component. |
| `orderUiModel.js` | `deriveOrderPaymentRiskSignal` | order-specific/generic risk signal | Market card risk copy sadeleşmeli. |
| `orderUiModel.js` | `removeOrderByOnchainId` | local order removal | MyOrders action sonrası optimistic cleanup. |
| `orderUiModel.js` | `mapOffchainHealthToUi` | health signal mapping | TrustHint read-only component. |
| `orderUiModel.js` | `mapCompactTrustSummary` | compact trust summary | Market hover/card badge. |
| `orderUiModel.js` | `mapApiOrderToUi` | API order → UI order adapter | MarketOrderCard’ın tek data source’u. |

### 4.6 Session data / app state hook

| Dosya | Fonksiyon / method | UI etkisi |
|---|---|---|
| `useAppSessionData.jsx` | `formatTokenAmountFromRaw` | ortak helper’a taşınmalı. |
| `useAppSessionData.jsx` | `rawTokenToDisplayNumber` | UI-only calculation. |
| `useAppSessionData.jsx` | `mapSettlementProposalFromApi` | Settlement state mapping; ProposalCard ve QuickAccess kullanır. |
| `useAppSessionData.jsx` | `buildSettlementQuickCounts` | Sidebar/ActiveTrades settlement counts. |
| `useAppSessionData.jsx` | `mapReputationToSessionView` | Reputation UI data model. |
| `useAppSessionData.jsx` | `mapResolutionTypeLabel` | History/terminal outcome copy. |
| `useAppSessionData.jsx` | `useAppSessionData` | App data authority orchestration; UI component’lere bölünmeli ama hook korunmalı. |
| `useAppSessionData.jsx` | `clearLocalSessionState` | Auth/session reset UX. |
| `useAppSessionData.jsx` | `bestEffortBackendLogout` | Logout flow. |
| `useAppSessionData.jsx` | `authenticatedFetch` | cookie/session managed fetch; PII/Admin/Trade fetch kullanır. |
| `useAppSessionData.jsx` | `fetchStats` | Home metrics. |
| `useAppSessionData.jsx` | `fetchMyTrades` | ActiveTrades + TradeRoom sync. |
| `useAppSessionData.jsx` | orders/config fetch effects | market/order config hydration. |
| `useAppSessionData.jsx` | token decimals effect | amount display correctness. |
| `useAppSessionData.jsx` | bleeding amount interval | CHALLENGED UI; gereksiz render azaltılmalı. |
| `useAppSessionData.jsx` | auth/me validation effect | session guard. |
| `useAppSessionData.jsx` | orders fetch effect | Market list. |
| `useAppSessionData.jsx` | my orders fetch effect | Profile/MyOrders. |
| `useAppSessionData.jsx` | reputation effect | Reputation page. |
| `useAppSessionData.jsx` | antiSybilCheck interval | Taker eligibility UI. |
| `useAppSessionData.jsx` | paused status interval | SystemStatusBar. |
| `useAppSessionData.jsx` | taker-name fetch effect | maker trade room PII context. |

### 4.7 Contract hook yüzeyi

| Dosya | Fonksiyon / method | UX karşılığı |
|---|---|---|
| `useArafContract.js` | `normalizeTradeIdOrThrow` | settlement/trade id validation. |
| `useArafContract.js` | `normalizeMakerShareBpsOrThrow` | settlement split validation. |
| `useArafContract.js` | `normalizeUnixSecondsOrThrow` | settlement expiry validation. |
| `useArafContract.js` | `normalizeV3Reputation` | reputation tuple authority mapping. |
| `useArafContract.js` | `normalizeTokenDecimalsOrThrow` | token display safety. |
| `useArafContract.js` | `extractOrderFilledArgs` | child trade id extraction; critical for trade room. |
| `useArafContract.js` | `useArafContract` | contract access hook. |
| `useArafContract.js` | `_validateChain` | network guardrail. |
| `useArafContract.js` | `writeContract` | base write wrapper; error logging. |
| `useArafContract.js` | `registerWallet` | onboarding/eligibility action. |
| `useArafContract.js` | `createSellOrder` | maker SELL order action. |
| `useArafContract.js` | `fillSellOrder` | taker fill SELL order. |
| `useArafContract.js` | `cancelSellOrder` | maker order cancel. |
| `useArafContract.js` | `createBuyOrder` | owner/taker BUY order action. |
| `useArafContract.js` | `fillBuyOrder` | maker fill BUY order. |
| `useArafContract.js` | `cancelBuyOrder` | buy order cancel. |
| `useArafContract.js` | `reportPayment` | LOCKED/Taker primary CTA. |
| `useArafContract.js` | `releaseFunds` | PAID/Maker primary CTA. |
| `useArafContract.js` | `challengeTrade` | dispute escalation CTA. |
| `useArafContract.js` | `autoRelease` | liveness release CTA. |
| `useArafContract.js` | `burnExpired` | CHALLENGED terminal action. |
| `useArafContract.js` | `pingMaker` | taker liveness ping. |
| `useArafContract.js` | `pingTakerForChallenge` | maker dispute pre-ping. |
| `useArafContract.js` | `decayReputation` | reputation maintenance action. |
| `useArafContract.js` | `proposeSettlement` | CHALLENGED settlement create. |
| `useArafContract.js` | `rejectSettlement` | settlement reject. |
| `useArafContract.js` | `withdrawSettlement` | settlement withdraw. |
| `useArafContract.js` | `expireSettlement` | settlement expire marker. |
| `useArafContract.js` | `acceptSettlement` | settlement finalization. |
| `useArafContract.js` | `approveToken` | ERC20 approval step. |
| `useArafContract.js` | `mintToken` | dev faucet. |
| `useArafContract.js` | `getAllowance` | approval preflight. |
| `useArafContract.js` | `getTokenDecimals` | token display/read safety. |
| `useArafContract.js` | `signCancelProposal` | EIP-712 cancel signature. |
| `useArafContract.js` | `proposeOrApproveCancel` | mutual cancel. |
| `useArafContract.js` | returned `getCurrentAmounts` | bleeding/decay UI. |
| `useArafContract.js` | returned `getSettlementProposal` | settlement state UI. |
| `useArafContract.js` | returned `getPaused` | protocol paused banner. |
| `useArafContract.js` | returned `antiSybilCheck` | eligibility UI. |
| `useArafContract.js` | returned `getCooldownRemaining` | cooldown UI. |
| `useArafContract.js` | returned `getWalletRegisteredAt` | wallet age/onboarding. |
| `useArafContract.js` | returned `getTakerFeeBps` | fee display. |
| `useArafContract.js` | returned `getFirstSuccessfulTradeAt` | reputation context. |
| `useArafContract.js` | returned `getReputation` | reputation page. |
| `useArafContract.js` | returned `getOrder` | parent order read. |
| `useArafContract.js` | returned `getTrade` | child trade read. |

### 4.8 Rewards hook yüzeyi

| Dosya | Fonksiyon / method | UX karşılığı |
|---|---|---|
| `useRewardsContract.js` | `readRewards` | rewards read wrapper. |
| `useRewardsContract.js` | `readVault` | vault read wrapper. |
| `useRewardsContract.js` | `writeVault` | sponsor/admin funding write. |
| `useRewardsContract.js` | `writeRewards` | claim/record write. |
| `useRewardsContract.js` | `getClaimableState` | user reward status UI. |
| `useRewardsContract.js` | `claimable` | claim amount read. |
| `useRewardsContract.js` | `claim` | Claim CTA. |
| `useRewardsContract.js` | `recordTradeOutcome` | outcome recording action. |
| `useRewardsContract.js` | `epochDuration` | reward period display. |
| `useRewardsContract.js` | `claimDelay` | claim lock display. |
| `useRewardsContract.js` | `userWeight` | user reward weight display. |
| `useRewardsContract.js` | `totalWeight` | epoch context. |
| `useRewardsContract.js` | `epochRewardPool` | pool display. |
| `useRewardsContract.js` | `rewardBps` | reward split config display. |
| `useRewardsContract.js` | `rewardReserve` | reserve display. |
| `useRewardsContract.js` | `treasuryReserve` | treasury reserve display. |
| `useRewardsContract.js` | `totalEscrowRevenue` | revenue context. |
| `useRewardsContract.js` | `totalExternalFunding` | sponsor funding context. |
| `useRewardsContract.js` | `fundGlobalRewards` | sponsor/admin funding action. |
| `useRewardsContract.js` | `fundProductRewards` | product-specific funding action. |

### 4.9 PII hook yüzeyi

| Dosya | Fonksiyon / method | UX karşılığı |
|---|---|---|
| `usePII.js` | `usePII` | secure PII fetch hook. |
| `usePII.js` | `fetchPII` | reveal payout profile action. |
| `usePII.js` | `clearPII` | hide/unmount cleanup. |
| `usePII.js` | AbortController cancellation | repeated click/race-safe UI. |

### 4.10 Countdown hook yüzeyi

| Dosya | Fonksiyon / method | UX karşılığı |
|---|---|---|
| `useCountdown.js` | `useCountdown` | deadline/countdown UI. |
| `useCountdown.js` | `getInitialState` | flicker-free initial state. |
| `useCountdown.js` | `calculateTimeLeft` | real-time remaining calculation. |
| `useCountdown.js` | visibility change sync | background tab drift correction. |

### 4.11 Components

| Dosya | Component / helper / method | UI kararı |
|---|---|---|
| `ErrorBoundary.jsx` | `scrubPII` | log redaction korunmalı. |
| `ErrorBoundary.jsx` | `ErrorBoundary.getDerivedStateFromError` | render fallback. |
| `ErrorBoundary.jsx` | `ErrorBoundary.componentDidCatch` | safe log send. |
| `ErrorBoundary.jsx` | `ErrorBoundary.render` | global error UI theme-aware yapılmalı. |
| `PIIDisplay.jsx` | `PIIDisplay` | PII reveal card daha sakin ve mobile-first. |
| `PIIDisplay.jsx` | `handleReveal` | reveal primary action. |
| `PIIDisplay.jsx` | `handleHide` | clear sensitive data. |
| `PIIDisplay.jsx` | `handleCopyField` | secure clipboard UX. |
| `PIIDisplay.jsx` | `buildTelegramUrl` | contact safety helper. |
| `PIIDisplay.jsx` | `buildContactHref` | contact CTA link. |
| `PIIDisplay.jsx` | `getContactCtaLabel` | localized contact action. |
| `PIIDisplay.jsx` | `getFieldLabel` | localized payment field labels. |
| `PaymentRiskBadge.jsx` | `PaymentRiskBadge` | Risk signal “method complexity” olarak sadeleşmeli. |
| `ReferenceRateTicker.jsx` | `sourceLabel` | ticker source label. |
| `ReferenceRateTicker.jsx` | `formatRate` | rate display. |
| `ReferenceRateTicker.jsx` | `ReferenceRateTicker` | non-authoritative ticker; 60s polling korunmalı. |
| `ReferenceRateTicker.jsx` | `fetchTicker` | hidden document guard korunmalı. |
| `RewardsDashboard.jsx` | `RewardsDashboard` | Proof of Peace ekranı daha açıklayıcı hale getirilmeli. |
| `SettlementProposalCard.jsx` | `normalizeSettlementState` | settlement state mapping. |
| `SettlementProposalCard.jsx` | `toUnixSeconds` | timestamp normalization. |
| `SettlementProposalCard.jsx` | `safeDate` | display helper. |
| `SettlementProposalCard.jsx` | `SettlementProposalCard` | CHALLENGED-only settlement UX. |
| `SettlementProposalCard.jsx` | `validateInput` | settlement input validation. |
| `SettlementProposalCard.jsx` | `loadPreview` | non-authoritative preview. |
| `SettlementProposalCard.jsx` | `runTx` | settlement tx wrapper. |
| `SettlementProposalCard.jsx` | `onPreviewCreate` | preview before propose. |
| `SettlementProposalCard.jsx` | `onConfirmCreate` | propose settlement tx. |
| `SettlementProposalCard.jsx` | `onPreviewAccept` | accept preview. |
| `SettlementPreviewModal.jsx` | `normalizeRawBigInt` | raw payout display guard. |
| `SettlementPreviewModal.jsx` | `shortNum` | readable big number. |
| `SettlementPreviewModal.jsx` | `getPreviewTotalPool` | preview pool fallback. |
| `SettlementPreviewModal.jsx` | `renderRawAmount` | raw amount render. |
| `SettlementPreviewModal.jsx` | `SettlementPreviewModal` | modal should become bottom sheet on mobile. |
| `AdminPanel.jsx` | `AdminPanel` | read-only observability UI; user nav’dan ayrılmalı. |
| `AdminPanel.jsx` | `fetchSummary` | admin summary polling. |
| `AdminPanel.jsx` | `fetchFeedback` | admin feedback view. |
| `AdminPanel.jsx` | `fetchTrades` | admin trade observability. |
| `AdminPanel.jsx` | `fetchSettlementProposals` | admin settlement observability. |
| `AdminPanel.jsx` | `updateFeedbackFilter` | filter state. |
| `AdminPanel.jsx` | `updateTradesFilter` | filter state. |
| `AdminPanel.jsx` | `updateSettlementFilter` | filter state. |
| `AdminPanel.jsx` | `refreshFeedbackNow` | manual refresh. |
| `AdminPanel.jsx` | `refreshSummaryNow` | manual refresh. |
| `AdminPanel.jsx` | `refreshTradesNow` | manual refresh. |
| `AdminPanel.jsx` | `refreshSettlementNow` | manual refresh. |
| `AdminPanel.jsx` | `toggleTradeExpanded` | detail expansion. |
| `AdminPanel.jsx` | `renderErrorBox` | error state component’e ayrılmalı. |
| `AdminPanel.jsx` | `renderUnauthorizedBox` | unauthorized component’e ayrılmalı. |

---

## 5. Test Dosyaları ve Tasarım Revizyonunda Korunacak Regresyon Alanları

Aşağıdaki test alanları UI revizyonu sırasında kırılmamalıdır:

| Test alanı | Korunacak davranış |
|---|---|
| `apiConfig.*` | production API same-origin policy |
| `apiPathAlignment.*` | endpoint path alignment |
| `AppModals.*` | modal render/state behavior |
| `AppRouting.*` | view switching |
| `AppSmoke.*` | app boot smoke |
| `AppViews.*` | core view rendering |
| `AppViews.referenceTicker.*` | ticker non-authority behavior |
| `bootstrapState.*` | language/terms persistence |
| `chainPolicy.security.*` | supported chain/faucet policy |
| `fillAmountPolicy.*` | fail-closed partial fill validation |
| `orderUiModel.*` | side-aware order mapping |
| `PaymentRiskBadge.*` | risk badge copy/logic |
| `PIIDisplay.*` | secure reveal/copy behavior |
| `ReferenceRateTicker.*` | polling/hidden-document behavior |
| `RewardsDashboard.*` | reward dashboard rendering |
| `rewards.authority.readonly.regression.*` | rewards authority boundary |
| `sessionGuardRegression.*` | session mismatch guard |
| `sessionMapping.*` | session mapping |
| `SettlementProposalCard.*` | CHALLENGED-only settlement behavior |
| `useAppSessionData.*` | auth/reputation/session fetch behavior |
| `useArafContract.*` | ABI source and reputation V3 mapping |
| `usePII.*` | PII token/fetch/cleanup behavior |
| `useRewardsContract.*` | rewards ABI source |

---

## 6. Global Ürün Tasarım Dili

### 6.1 Ürün kişiliği

Araf Protocol globalde “kripto terminali” değil, “güvenli işlem asistanı” gibi hissettirmelidir.

Karakter:

- sakin
- güven verici
- kuralları net
- teknik olarak ciddi
- kullanıcıyı karar anında yönlendiren
- state-driven
- mobile-first
- global dilde anlaşılır

Ana tasarım cümlesi:

> Clear escrow guidance, not crypto chaos.

TR karşılığı:

> Karmaşık kripto akışı değil, net escrow yönlendirmesi.

### 6.2 Görsel ton

Mevcut dark cyber/protocol dili global kullanıcı için yumuşatılmalı:

- koyu tema: premium fintech
- açık tema: global SaaS
- az glow
- daha çok whitespace
- daha büyük tipografi
- daha az kırmızı alarm
- daha net action hierarchy
- daha az raw technical label

---

## 7. Design Token Planı

### 7.1 Tema modları

Üç mod:

- System
- Day
- Night

Yeni storage key:

```js
export const APP_THEME_STORAGE_KEY = 'araf_theme_mode';
```

Yeni helper:

```js
export const getInitialThemeMode = () => {
  if (typeof window === 'undefined') return 'system';
  const saved = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
  return ['system', 'day', 'night'].includes(saved) ? saved : 'system';
};
```

### 7.2 CSS variable

```css
:root[data-theme="night"] {
  --color-bg-app: #07080b;
  --color-bg-shell: #0d1117;
  --color-bg-surface: #111827;
  --color-bg-elevated: #172033;
  --color-border-subtle: #263244;
  --color-border-strong: #334155;
  --color-text-primary: #f8fafc;
  --color-text-secondary: #cbd5e1;
  --color-text-muted: #94a3b8;
  --color-brand: #10b981;
  --color-info: #38bdf8;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-success: #22c55e;
}

:root[data-theme="day"] {
  --color-bg-app: #f8fafc;
  --color-bg-shell: #eef2f7;
  --color-bg-surface: #ffffff;
  --color-bg-elevated: #ffffff;
  --color-border-subtle: #e2e8f0;
  --color-border-strong: #cbd5e1;
  --color-text-primary: #0f172a;
  --color-text-secondary: #334155;
  --color-text-muted: #64748b;
  --color-brand: #059669;
  --color-info: #0284c7;
  --color-warning: #d97706;
  --color-danger: #dc2626;
  --color-success: #16a34a;
}
```

### 7.3 Tailwind extend önerisi

```js
theme: {
  extend: {
    colors: {
      app: 'var(--color-bg-app)',
      shell: 'var(--color-bg-shell)',
      surface: 'var(--color-bg-surface)',
      elevated: 'var(--color-bg-elevated)',
      borderSubtle: 'var(--color-border-subtle)',
      borderStrong: 'var(--color-border-strong)',
      textPrimary: 'var(--color-text-primary)',
      textSecondary: 'var(--color-text-secondary)',
      textMuted: 'var(--color-text-muted)',
      brand: 'var(--color-brand)',
      info: 'var(--color-info)',
      warning: 'var(--color-warning)',
      danger: 'var(--color-danger)',
      success: 'var(--color-success)',
    },
    borderRadius: {
      control: '12px',
      card: '16px',
      sheet: '24px',
    },
  },
}
```

---

## 8. Responsive Layout Planı

### 8.1 Breakpoint davranışı

| Breakpoint | Layout |
|---|---|
| 320–480 | tek kolon, bottom nav, sticky primary action |
| 481–767 | tek kolon + horizontal filters |
| 768–1023 | tablet grid, compact rail |
| 1024+ | desktop rail + content grid |
| 1280+ | dashboard density, max content width |

### 8.2 Mobile priority order

Her kritik ekranda sıra:

1. State
2. Primary action
3. Countdown / deadline
4. Trade summary
5. Counterparty/payment info
6. Secondary actions
7. Technical details

### 8.3 Desktop priority order

Desktop:

- left nav rail
- top system status
- page header
- content grid
- right contextual panel

---

## 9. Global Navigation Planı

Yeni ana ürün navigasyonu:

1. Home
2. Market
3. Active Trades
4. Profile
5. Help

Admin:

- primary navigation’da değil
- authenticated + authorized state’te secondary/admin entry
- read-only observability olduğu net yazılmalı

### 9.1 Route geçiş planı

Kısa vadede `currentView` korunabilir.

Orta vadede:

```txt
/
/market
/trades/active
/trades/active?state=locked
/trades/active?state=paid
/trades/active?state=challenged
/trade/:tradeId
/profile
/profile/reputation
/profile/orders
/profile/history
/profile/payment
/help
/admin
```

---

## 10. Ekran Bazlı Tasarım Planı

## 10.1 Home

Hedef:

- ürünü 10 saniyede anlatmak
- hakemsiz escrow mantığını sadeleştirmek
- ilk aksiyonu göstermek

Yeni yapı:

1. Hero
2. Primary CTA: Explore Market / Pazarı Keşfet
3. Secondary CTA: How It Works / Nasıl Çalışır?
4. 3-step explainer
5. Security/incentive model
6. Live protocol metrics
7. FAQ

Hero copy:

TR:
> Hakemsiz P2P escrow. Kurallar net, süreç şeffaf.

EN:
> Arbitrator-free P2P escrow. Clear rules, transparent outcomes.

## 10.2 Market

Kart bilgi sırası:

1. Side badge
2. Token + fiat pair
3. Rate
4. Available amount
5. Min/max limits
6. Payment method complexity
7. CTA

Side label:

| Sistem | TR | EN |
|---|---|---|
| SELL_CRYPTO | Kripto Satıyor | Selling Crypto |
| BUY_CRYPTO | Kripto Alıyor | Buying Crypto |

CTA:

| Side | TR CTA | EN CTA |
|---|---|---|
| SELL_CRYPTO | Satın Al | Buy |
| BUY_CRYPTO | Sat | Sell |

Yeni componentler:

- `MarketPage`
- `MarketFilterBar`
- `MarketOrderCard`
- `OrderSideBadge`
- `PaymentRiskSummary`
- `TrustHint`

## 10.3 Maker Order

Mevcut modal section-based hale getirilmeli.

Bölümler:

1. Order type
2. Asset
3. Amount
4. Rate
5. Limits
6. Tier
7. Reserve preview
8. Payment risk note
9. Confirm

Yeni componentler:

- `MakerOrderSheet`
- `OrderTypeSelector`
- `AssetSelector`
- `AmountLimitSection`
- `TierSelector`
- `ReservePreviewCard`
- `InlineValidation`
- `ConfirmActionButton`

## 10.4 Trade Room

Bu ekran ürünün merkezidir.

Üst blok:

```txt
Trade #1234
Status: Payment Reported
Your role: Maker
Primary action: Release Funds
```

Yeni bileşenler:

- `TradeRoomPage`
- `TradeRoomHeader`
- `StateGuidancePanel`
- `PrimaryActionPanel`
- `CountdownCard`
- `TradeSummaryCard`
- `TradeTimeline`
- `SecondaryActions`
- `TechnicalDetailsDisclosure`
- `SettlementActionCard`
- `PIIRevealPanel`

State bazlı:

### LOCKED

Taker:

- primary CTA: Ödeme Bildir / Report Payment
- upload receipt alanı görünür
- payment profile reveal alanı kontrollü gösterilir

Maker:

- primary message: Ödeme bildirimi bekleniyor
- liveness henüz aktif değil
- teknik detaylar collapse altında

### PAID

Maker:

- primary CTA: Fonları Serbest Bırak / Release Funds
- secondary CTA: İtiraz Başlat / Start Challenge
- challenge önce açıklama modalı gerekir

Taker:

- message: Maker onayı bekleniyor
- countdown görünür
- pingMaker / autoRelease akışı zamanla açılır

### CHALLENGED

Her iki taraf:

- state: İtiraz süreci başladı
- bleeding explanation
- settlement action
- release/cancel/burn/settlement seçenekleri role/time’a göre açıklanır

Settlement dili:

> Araf kimin haklı olduğuna karar vermez; settlement yalnız CHALLENGED dispute fazında iki taraf iradesiyle mümkündür.

## 10.5 Active Trades

Bu artık profile içinde kaybolmamalı.

Yeni route/page:

```txt
/trades/active
/trades/active?state=paid
/trades/active?state=challenged
```

Filtreler:

- All
- Locked
- Payment Reported
- Challenged
- Settlement

Kart:

```txt
Trade #1234
Payment Reported
You are Maker
1250 USDT
Primary action: Go to Trade Room
```

Yeni componentler:

- `ActiveTradesPage`
- `TradeStateFilterBar`
- `ActiveTradeCard`
- `SettlementQueueCard`
- `EmptyState`

## 10.6 Profile

Profile Center orta vadede modaldan çıkmalı.

Sekmeler:

- Account
- Payment Profile
- Reputation
- Orders
- Active Trades
- History

Yeni route:

```txt
/profile
/profile/payment
/profile/reputation
/profile/orders
/profile/history
```

## 10.7 PII Display

Mevcut güvenlik davranışı korunmalı:

- state’te kalıcı saklama yok
- reveal ile fetch
- clear on hide/unmount
- AbortController
- clipboard fallback
- httpOnly cookie + short-lived token

Yeni UI:

- locked state daha sade
- reveal CTA daha açık
- payment fields daha büyük
- security notice collapse
- mobile copy buttons 44px touch target

## 10.8 Payment Risk

Mevcut copy doğru yönde: “counterparty judgment değil, transaction complexity signal.”

Yeni UI:

- compact market card badge
- expanded detail only on hover/tap
- raw `minBondSurchargeBps`, `feeSurchargeBps`, `warningKey` default görünmemeli
- technical details disclosure içine alınmalı

## 10.9 ReferenceRateTicker

Korunacaklar:

- 60s polling
- document hidden guard
- informational-only copy

Değişiklik:

- mobile’de daha kısa chip
- motion reduce desteği genişletilmeli
- ticker kullanıcıyı kandıracak şekilde fiyat authority gibi gösterilmemeli

## 10.10 RewardsDashboard

Proof of Peace copy revizyonu:

- Cashback değil
- epoch-based
- terminal outcome-derived
- sponsor recipient seçemez
- claim state açık gösterilmeli

Yeni UI:

- `RewardsExplainerCard`
- `ClaimableRewardCard`
- `EpochStatusCard`
- `SponsorFundingPanel` admin/sponsor context’e ayrılmalı

## 10.11 AdminPanel

AdminPanel global kullanıcı ürününden ayrılmalı.

Tasarım:

- read-only observability badge
- polling açık/kapalı kontrolü görünür
- summary / sync / feedback / trades / settlement tabları kalabilir
- mobile admin kullanımı ikincil; responsive card/table dönüşümü yeterli

---

## 11. Component Mimari Planı

### Foundation

- `AppShell`
- `PageHeader`
- `SectionCard`
- `Surface`
- `ThemeToggle`
- `StatusBadge`
- `IconButton`
- `PrimaryButton`
- `SecondaryButton`
- `DangerButton`
- `InlineAlert`
- `EmptyState`
- `TechnicalDetailsDisclosure`

### Navigation

- `DesktopNavRail`
- `MobileTopBar`
- `MobileBottomNav`
- `ContextFilterPanel`
- `SystemStatusBar`

### Trade

- `TradeRoomPage`
- `TradeRoomHeader`
- `StateGuidancePanel`
- `PrimaryActionPanel`
- `CountdownCard`
- `TradeSummaryCard`
- `TradeTimeline`
- `ActiveTradeCard`
- `TradeStateFilterBar`
- `SettlementActionCard`

### Market

- `MarketPage`
- `MarketOrderCard`
- `MarketFilterBar`
- `OrderSideBadge`
- `PaymentRiskSummary`
- `TrustHint`

### Profile

- `ProfilePage`
- `AccountPanel`
- `PaymentProfileForm`
- `ReputationPanel`
- `MyOrdersPanel`
- `HistoryPanel`

### Security / PII

- `PIIRevealPanel`
- `SecureCopyButton`
- `SensitiveDataNotice`
- `ContactActionButton`

---

## 12. Sprint Planı

### Sprint 1 — Foundation ve theme

- `tailwind.config.js` token extend
- `index.css` theme variables
- `bootstrapState.js` theme storage helper
- `ThemeToggle`
- `StatusBadge`
- `SectionCard`
- `PrimaryButton`
- `InlineAlert`
- enum/user-label dictionary

### Sprint 2 — Navigation ve responsive shell

- `AppShell`
- `DesktopNavRail`
- `MobileTopBar`
- `MobileBottomNav`
- `SystemStatusBar`
- sidebar auto-close kaldırma
- Active Trades nav entry

### Sprint 3 — Market ve Maker Order

- `MarketOrderCard`
- `MarketFilterBar`
- `PaymentRiskSummary`
- raw enum labels kaldırma
- Maker order section layout
- mobile bottom sheet style

### Sprint 4 — Trade Room

- `TradeRoomPage`
- `StateGuidancePanel`
- `PrimaryActionPanel`
- `CountdownCard`
- `TradeTimeline`
- mobile sticky primary CTA
- LOCKED/PAID/CHALLENGED copy standardı

### Sprint 5 — Active Trades ve Profile

- `ActiveTradesPage`
- `ActiveTradeCard`
- `TradeStateFilterBar`
- `/profile/*` route hazırlığı
- Profile modal sadeleştirme

### Sprint 6 — PII / Settlement / Rewards

- `PIIRevealPanel`
- `SettlementActionCard`
- `SettlementPreviewSheet`
- `RewardsExplainerCard`
- `ClaimableRewardCard`
- technical detail collapse

### Sprint 7 — QA ve regresyon

- mobile QA
- theme contrast QA
- accessibility pass
- route smoke
- existing tests
- visual state matrix
- performance check

---

## 13. Performans Guardrails

Yeni tasarım şu kuralları ihlal etmemeli:

1. Yeni sürekli polling yok.
2. Tema değişiminde API yok.
3. Heavy UI library yok.
4. Büyük animasyon yok.
5. `App.jsx` daha da büyütülmeyecek.
6. `AppViews.jsx` ve `AppModals.jsx` component’lere bölünecek.
7. Hidden tab polling guard korunacak.
8. `useCountdown` visibility sync korunacak.
9. PII cache yapılmayacak.
10. Settlement preview non-authoritative kalacak.

---

## 14. Kabul Kriterleri

Revizyon başarılı sayılacaksa:

1. Kullanıcı ilk 10 saniyede ürünün ne yaptığını anlar.
2. Mobilde ana CTA ilk ekranda görünür.
3. Trade Room her state için net karar sunar.
4. `LOCKED / PAID / CHALLENGED` aktif işlem hızlı erişimi korunur ve güçlenir.
5. Gündüz/gece/system tema çalışır.
6. Tema backend yükü üretmez.
7. Ham enum dili kullanıcı yüzeyinden kalkar.
8. Payment risk counterparty judgment gibi görünmez.
9. Reference ticker escrow authority gibi görünmez.
10. Rewards cashback gibi sunulmaz.
11. PII güvenlik davranışı bozulmaz.
12. Existing test alanları korunur.
13. Global ürün dili premium, sakin ve açıklayıcı olur.

---

## 15. En Kritik Tasarım Kararı

Araf frontend’i artık yalnız “işlem yapılacak ekran” değil, **state-driven güvenli işlem rehberi** olarak tasarlanmalıdır.

Bu yüzden tasarımın merkezi şu üçlüdür:

```txt
Ne oldu?
Şimdi ne yapmalıyım?
Süre/risk devam ederse ne olur?
```

Her ekran, her kart, her modal bu üçlüye hizmet etmelidir.
