# Context Architecture Discovery Report

Repository: `MyDemir/Araf-Protokol`  
Date: 2026-05-04  
Scope: Read-only discovery for frontend context architecture migration

## 0) Scope confirmation
Inspected files:
- `frontend/src/App.jsx`
- `frontend/src/app/AppViews.jsx`
- `frontend/src/app/AppModals.jsx`
- `frontend/src/app/useAppSessionData.jsx`
- `frontend/src/app/orderUiModel.js`
- `frontend/src/app/apiConfig.js`
- `frontend/src/app/chainPolicy.js`
- `frontend/src/app/fillAmountPolicy.js`
- `frontend/src/app/bootstrapState.js`
- `frontend/src/components/PIIDisplay.jsx`
- `frontend/src/components/PaymentRiskBadge.jsx`
- `frontend/src/components/ReferenceRateTicker.jsx`
- `frontend/src/components/RewardsDashboard.jsx`
- `frontend/src/components/SettlementProposalCard.jsx`
- `frontend/src/components/SettlementPreviewModal.jsx`
- `frontend/src/AdminPanel.jsx`
- `frontend/tailwind.config.js`
- `frontend/src/index.css`
- `frontend/package.json`
- `frontend/src/test/*`

---

## 1) `App.jsx` state inventory by domain

### Route / view state
- `currentView`, `setCurrentView`
- `lang`, `setLang`
- `filterTier1`, `setFilterTier1`
- `filterToken`, `setFilterToken`
- `searchAmount`, `setSearchAmount`

### Modal state
- `showMakerModal`, `setShowMakerModal`
- `showProfileModal`, `setShowProfileModal`
- `showFeedbackModal`, `setShowFeedbackModal`
- `showWalletModal`, `setShowWalletModal`
- `confirmDeleteId`, `setConfirmDeleteId`
- `termsAccepted`, `setTermsAccepted`

### Sidebar / context state
- `sidebarOpen`, `setSidebarOpen`
- `expandedStatus`, `setExpandedStatus`
- `sidebarTimerRef`

### Maker order state
- `makerTier`, `setMakerTier`
- `makerAmount`, `setMakerAmount`
- `makerRate`, `setMakerRate`
- `makerMinLimit`, `setMakerMinLimit`
- `makerMaxLimit`, `setMakerMaxLimit`
- `makerFiat`, `setMakerFiat`
- `makerToken`, `setMakerToken`
- `makerSide`, `setMakerSide`

### Profile state
- `profileTab`, `setProfileTab`
- `connectedWallet`, `setConnectedWallet`

### Trade room state (owned by `useAppSessionData`, consumed in `App.jsx`)
- `activeTrade`, `setActiveTrade`
- `tradeState`, `setTradeState`
- `userRole`, `setUserRole`
- `resolvedTradeState`
- `cancelStatus`, `setCancelStatus`
- `chargebackAccepted`, `setChargebackAccepted`
- `paymentIpfsHash`, `setPaymentIpfsHash`
- `takerName`
- timers/flags passed to UI: `gracePeriodTimer`, `bleedingTimer`, `principalProtectionTimer`, `makerPingTimer`, `canMakerPing`, `makerChallengePingTimer`, `canMakerStartChallengeFlow`, `makerChallengeTimer`, `canMakerChallenge`

### Feedback / toast state
- `toast`, `setToast`
- `feedbackRating`, `setFeedbackRating`
- `feedbackCategory`, `setFeedbackCategory`
- `feedbackText`, `setFeedbackText`
- `feedbackError`, `setFeedbackError`
- `isSubmittingFeedback`, `setIsSubmittingFeedback`
- `showToast` callback

---

## 2) `App.jsx` function migration candidates

### ContractActionProvider
- `handleMint`
- `handleStartTrade`
- `handleReportPayment`
- `handleProposeCancel`
- `handleRelease`
- `handleChallenge`
- `handlePingMaker`
- `handleAutoRelease`
- `handleCreateOrder`
- `handleDeleteOrder`
- `handleRegisterWallet`
- `handleUpdatePII` (hybrid: authenticated backend + contract-adjacent profile flow)

### ToastProvider
- `showToast`

### RouteStateProvider
- `openSidebar`
- route guard effect closing modals on auth loss
- `handleOpenMakerModal` (guard + route/modal intent)

### Profile actions
- `loginWithSIWE`
- `handleLogoutAndDisconnect`
- `handleAuthAction`
- `getWalletIcon` (UI helper, optional colocate with wallet modal)
- `getSafeTelegramUrl`

### Order actions
- `handleCreateOrder`
- `handleDeleteOrder`
- `handleStartTrade`

### Trade navigation actions
- any “go to room” inline lambdas should become shared action (currently duplicated in `AppViews`/`AppModals`)
- route transition parts inside `handleStartTrade` (`setActiveTrade` + `setCurrentView('tradeRoom')`)

### Settlement actions
- `handleProposeCancel`
- `handleRelease`
- `handleChallenge`
- `handlePingMaker`
- `handleAutoRelease`

---

## 3) `AppViews.jsx` required locations

- `renderSlimRail`: declared near top of `buildAppViews`, first renderer block.
- `renderContextSidebar`: follows `renderSlimRail`.
- `renderHome`: mid-file renderer section.
- `renderMarket`: mid-file renderer section after home.
- Trade Room render section: `renderTradeRoom` block (contains status/timer/actions/PII/settlement cards).
- Active escrow quick access:
  - status accordion list inside `renderContextSidebar` (`['LOCKED','PAID','CHALLENGED']` mapping)
  - mobile/nav quick indicator also references `activeEscrows.length`.
- Settlement quick access:
  - settlement counters block in sidebar using `activeEscrowCounts?.settlement?.*`
  - list of `activeEscrows` filtered by `normalizeSettlementState(...)= 'PROPOSED'`.

### Duplicated “Odaya Git / Go to Room” handlers
Found multiple inline handlers with same behavior (`setActiveTrade`, `setUserRole`, `setTradeState`, `setChargebackAccepted`, `setCurrentView('tradeRoom')`, `setSidebarOpen(false)`):
1. Status accordion trade cards in `renderContextSidebar`
2. Settlement quick-access cards in `renderContextSidebar`

---

## 4) `AppModals.jsx` required locations

- `EnvWarningBanner`: exported component at file top.
- `renderWalletModal`: first inner renderer in `buildAppModals`.
- `renderFeedbackModal`: second inner renderer.
- `renderMakerModal`: third inner renderer.
- `renderProfileModal`: lower half of file (profile center modal with tabs).

### Profile tab render blocks
Inside `renderProfileModal`, tab content includes:
- settings/account tab (`ayarlar`)
- active trades tab (`aktif`)
- history tab (`gecmis`)
- my orders tab (`orderlar`)

### Active trades tab logic
- `activeTradesFilter` selector + filtered list:
  - `const filteredEscrows = activeTradesFilter === 'ALL' ? activeEscrows : activeEscrows.filter(e => e.state === activeTradesFilter);`
- includes inline room navigation handler similar to `AppViews` duplicates.

### Payment profile form logic
In profile settings tab:
- payout rail/country/contact/fields form bound to `payoutProfileDraft`
- canonicalization + submit via `handleUpdatePII`
- SEPA/ACH/TR rail-specific field rendering and validation messaging

---

## 5) `useAppSessionData.jsx` required locations

- `mapSettlementProposalFromApi`: exported utility near top.
- `buildSettlementQuickCounts`: exported utility near top.
- `fetchMyTrades`: `React.useCallback` around line ~383.
- Active escrows mapping:
  - API trade rows mapped into normalized escrow entries with `timers.*`, `settlement_proposal` mapping, decimals-safe amount formatting.
- Active trade refresh logic:
  - inside `fetchMyTrades`, `setActiveTrade(prev => ...)` branch updates current trade from refreshed list.
- Pending backend sync handling:
  - `_pendingBackendSync` reconciliation in `fetchMyTrades`
  - pending tx recovery flow via `localStorage['araf_pending_tx']` and `publicClient.getTransactionReceipt`.
- Timers:
  - timers parsed from backend (`paid_at`, `locked_at`, `pinged_at`, `challenge_pinged_at`, `challenged_at`)
  - polling intervals: `fetchAmounts` (30s), sybil (30s), paused status (60s), trades refresh (15s while in trade room)
  - visibility-change trigger to refresh on foreground.
- Session/auth refresh logic:
  - `authenticatedFetch` handles `409` (wallet mismatch) and `401` refresh via `POST auth/refresh`
  - deduped auth toast behavior using `sessionToastShownRef`
  - `clearLocalSessionState` + `bestEffortBackendLogout`.

---

## 6) Tests likely impacted by AppViews/AppModals split refactors

Most likely to fail first (direct coupling to render structure/handlers/props):
- `frontend/src/test/AppViews.test.jsx`
- `frontend/src/test/AppViews.referenceTicker.test.jsx`
- `frontend/src/test/AppModals.test.jsx`
- `frontend/src/test/AppRouting.test.js`
- `frontend/src/test/AppSmoke.test.jsx`

Potential secondary breakage (if action wiring/prop contracts shift):
- `frontend/src/test/SettlementProposalCard.test.js`
- `frontend/src/test/ReferenceRateTicker.test.jsx`
- `frontend/src/test/AdminPanelPolling.test.jsx`
- `frontend/src/test/useAppSessionDataAuthToastDedup.test.jsx`
- `frontend/src/test/useAppSessionDataAuthChecked.test.jsx`
- `frontend/src/test/sessionGuardRegression.test.js`

---

## 7) Migration map (old -> new)

> Proposed target paths are for migration planning; no behavioral changes implied.

- `App.jsx::showToast` -> `frontend/src/context/toast/ToastProvider.jsx::showToast`
- `App.jsx::openSidebar + sidebar state` -> `frontend/src/context/route/RouteStateProvider.jsx::{openSidebar, route/ui state}`
- `App.jsx::handleAuthAction/loginWithSIWE/handleLogoutAndDisconnect` -> `frontend/src/context/profile/ProfileActionsProvider.jsx::{handleAuthAction, loginWithSIWE, logout}`
- `App.jsx::handleOpenMakerModal` -> `frontend/src/context/order/OrderUiActionsProvider.jsx::openMakerModalWithGuards`
- `App.jsx::handleCreateOrder/handleDeleteOrder` -> `frontend/src/context/order/OrderActionsProvider.jsx::{createOrder, deleteOrder}`
- `App.jsx::handleStartTrade` -> `frontend/src/context/trade/TradeActionsProvider.jsx::startTrade`
- `App.jsx::handleReportPayment` -> `frontend/src/context/trade/TradeActionsProvider.jsx::reportPayment`
- `App.jsx::handleRelease/handleChallenge/handlePingMaker/handleAutoRelease` -> `frontend/src/context/settlement/SettlementActionsProvider.jsx::{release, challenge, pingMaker, autoRelease}`
- `App.jsx::handleProposeCancel` -> `frontend/src/context/settlement/SettlementActionsProvider.jsx::proposeOrApproveCancel`
- `App.jsx::handleMint/handleRegisterWallet` -> `frontend/src/context/contract/ContractActionProvider.jsx::{mintToken, registerWallet}`
- `App.jsx::handleUpdatePII/getSafeTelegramUrl/canonicalizePayoutProfileDraft` -> `frontend/src/context/profile/ProfilePiiActionsProvider.jsx::{updatePii, getSafeTelegramUrl, canonicalizeDraft}`

### View-layer extraction map
- `AppViews.jsx::duplicated go-to-room inline handlers` -> `frontend/src/app/navigation/tradeNavigation.js::goToTradeRoomFromEscrow`
- `AppViews.jsx::renderContextSidebar settlement+status quick access` -> `frontend/src/app/views/sidebar/ContextSidebar.jsx`
- `AppViews.jsx::renderSlimRail` -> `frontend/src/app/views/navigation/SlimRail.jsx`
- `AppViews.jsx::renderHome/renderMarket/renderTradeRoom` -> `frontend/src/app/views/screens/{HomeView,MarketView,TradeRoomView}.jsx`
- `AppModals.jsx::renderWalletModal/renderFeedbackModal/renderMakerModal/renderProfileModal` -> `frontend/src/app/views/modals/*`

### Data/session ownership map (keep authority behavior unchanged)
- `useAppSessionData.jsx::authenticatedFetch + refresh` -> `frontend/src/context/session/SessionProvider.jsx`
- `useAppSessionData.jsx::fetchMyTrades + activeEscrows mapping + pending sync` -> `frontend/src/context/trade/TradeSessionProvider.jsx`
- `useAppSessionData.jsx::mapSettlementProposalFromApi/buildSettlementQuickCounts` -> `frontend/src/app/settlement/settlementMappers.js`

---

## 8) Guardrails to keep during migration
- Preserve `currentView` behavior exactly (no route semantic changes).
- Preserve all contract write handlers’ call signatures and sequencing.
- Preserve PII flow behavior (`handleUpdatePII`, masking/display contracts, and safe telegram handling).
- Preserve settlement authority behavior and action gating (`SettlementProposalCard`, proposal state mapping, action-required computation).
- Keep existing TR/EN comment intent and explanatory comments.
