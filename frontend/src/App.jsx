import { CircleCheck, Info, MessageSquare, TriangleAlert, Wallet } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage, useChainId, usePublicClient } from 'wagmi';
import { canonicalizePayoutProfileDraft, formatTokenAmount as formatTokenAmountFromRaw, tokenToNumber as rawTokenToDisplayNumber } from './app/orderUiModel';
import { useArafContract } from './hooks/useArafContract';
import { buildAppViews } from './app/AppViews';
import { buildAppModals } from './app/AppModals';
import AppShell from './app/shell/AppShell';
import { useSessionActions } from './app/providers/SessionProvider';
import { useAppSessionData } from './app/useAppSessionData';
// [TR] Admin paneli yalnız yöneticiler içindir; ayrı chunk olarak ilk ihtiyaçta yüklenir.
// [EN] The admin panel is for admins only; loaded as a separate chunk on first use.
const AdminPanel = React.lazy(() => import('./AdminPanel'));
import useFullscreen from './app/shell/useFullscreen';
import { isUiLabEnabled, loadUiLab } from './app/uiLab';
import { SESSION_ONLY_VIEWS } from './app/viewRegistry';
import { getInitialLang, APP_LANG_STORAGE_KEY } from './app/bootstrapState';
import { markTermsAcceptedLocally } from './app/legal/terms';
import { buildApiUrl, resolveApiPolicyDiagnostics } from './app/apiConfig';
import { checkDeploymentAlignment, getSupportedChainsMap, isMintTokenEnabled, isSupportedChainId } from './app/chainPolicy';
import { useMakerOrderForm } from './app/contexts/marketplace/useMakerOrderForm';
import { useMarketFilters } from './app/contexts/marketplace/marketFilters';
import { buildMintAction, buildOrderActions, buildProfileActions, buildStartTradeAction, buildTradeRoomActions } from './app/actions/contractLifecycleActions';
import { buildNextActiveTrade, clearAppHashRoute, findEscrowByRouteTradeId, getEscrowRouteId, parseAppHashRoute, writeAppHashRoute } from './app/actions/tradeNavigationActions';

// [TR] Uygulama başlangıcında kritik env değişkenlerini doğrula
// [EN] Validate critical env variables on app start
const ENV_ERRORS = [];
const { errors: API_POLICY_ERRORS } = resolveApiPolicyDiagnostics(import.meta.env);
ENV_ERRORS.push(...API_POLICY_ERRORS);
if (!import.meta.env.VITE_ESCROW_ADDRESS ||
    import.meta.env.VITE_ESCROW_ADDRESS === '0x0000000000000000000000000000000000000000') {
  ENV_ERRORS.push('VITE_ESCROW_ADDRESS tanımlı değil veya sıfır adres — kontrat işlemleri çalışmayacak');
}

// [TR] Desteklenen token adresleri — .env üzerinden yönetilir
// [EN] Supported token addresses — managed via .env
const SUPPORTED_TOKENS = {
  USDT: { address: import.meta.env.VITE_USDT_ADDRESS || '', decimalsRequired: true },
  USDC: { address: import.meta.env.VITE_USDC_ADDRESS || '', decimalsRequired: true },
};
const SUPPORTED_TOKEN_ADDRESSES = Object.fromEntries(
  Object.entries(SUPPORTED_TOKENS).map(([symbol, meta]) => [symbol, meta.address])
);
// [TR] Admin gelir tablosu token adresini sembole çevirir. [EN] Admin revenue rows map token address → symbol.
const ADMIN_TOKEN_SYMBOLS = Object.fromEntries(
  Object.entries(SUPPORTED_TOKEN_ADDRESSES).filter(([, a]) => a).map(([sym, a]) => [String(a).toLowerCase(), sym])
);

function App() {
  // ═══════════════════════════════════════════
  // 1. EKRAN VE UI STATE YÖNETİMİ
  //    View routing + modal open/close flags
  // ═══════════════════════════════════════════
  const uiLabEnabled = isUiLabEnabled();
  // [TR] Lab kodu yalnız etkinse ve ilk ihtiyaçta yüklenir. [EN] Lab code loads only when enabled.
  const [uiLab, setUiLab] = useState(null);
  useEffect(() => {
    if (!uiLabEnabled) return undefined;
    let alive = true;
    loadUiLab().then((mod) => { if (alive) setUiLab(mod); }).catch(() => {});
    return () => { alive = false; };
  }, [uiLabEnabled]);
  const fullscreen = useFullscreen();
  const initialView = 'home';
  const [currentView, setCurrentView] = useState(initialView);
  const [showMakerModal, setShowMakerModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedStatus, setExpandedStatus] = useState(null);

  const [lang, setLang] = useState(getInitialLang);
  const [loadingText, setLoadingText] = useState('');
  const [isContractLoading, setIsContractLoading] = useState(false);
  const { marketFilters, setMarketFilter, resetMarketFilters } = useMarketFilters();
  const [toast, setToast] = useState(null);
  const [termsPromptWallet, setTermsPromptWallet] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [activeTradesFilter, setActiveTradesFilter] = useState('ALL');
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackCategory, setFeedbackCategory] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [devScenario, setDevScenario] = useState(null);
  const devScenarioSnapshotRef = React.useRef(null);
  const [profileContextTab, setProfileContextTab] = useState('account');
  const devScenarioActive = Boolean(uiLabEnabled && devScenario);
  // [TR] Tüm profil girişleri (cüzdan butonu, geçmiş kısayolları) aynı sayfaya ve sekmeye gider.
  const openProfilePage = React.useCallback((tab = 'account') => {
    setProfileContextTab(tab);
    setCurrentView('profile');
  }, [setCurrentView]);

  // [TR] Toast bildirimi gösterir — 4 sn sonra otomatik kapanır
  // [EN] Shows toast notification — auto-closes after 4s
  // [TR] Her toast kendi id'si ile kapanır; eski zamanlayıcı yeni toast'ı erken silmez.
  // [EN] Each toast closes by its own id so an older timer never clears a newer toast.
  const showToast = React.useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random();
    setToast({ id, message, type });
    setTimeout(() => setToast((current) => (current?.id === id ? null : current)), type === 'error' ? 6000 : 4000);
  }, []);

  // ═══════════════════════════════════════════
  // 2. WEB3 BAĞLANTI VE KONTRAT HOOK'LARI
  //    Wallet connection + all contract methods
  // ═══════════════════════════════════════════
  const { address, isConnected, connector, chainId: walletChainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const configChainId = useChainId();
  // [TR] Ağ kontrolü cüzdanın gerçek zincirine (useAccount().chainId) bakar; useChainId() config zinciridir (F11).
  const chainId = walletChainId ?? configChainId;
  const publicClient = usePublicClient();
  const supportedChains = getSupportedChainsMap();
  const isFaucetEnabled = isMintTokenEnabled();
  // [TR] Backend deployment zinciri /orders/config'ten gelir; hook'tan sonra bilindiği için state ile taşınır.
  const [deploymentChainId, setDeploymentChainId] = useState(null);
  const isSupportedChain = isSupportedChainId(chainId) && (!deploymentChainId || Number(chainId) === deploymentChainId);

  const connectedWallet = address?.toLowerCase?.() || null;

  // [TR] Dil değişimlerini kalıcılaştır; refresh sonrası aynı dil açılsın.
  // [EN] Persist language changes so refresh keeps the same locale.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(APP_LANG_STORAGE_KEY, lang);
  }, [lang]);

  // [TR] Tüm kontrat metodları tek bir hook instance'ından alınır
  // [EN] All contract methods come from a single hook instance
  const {
    releaseFunds,
    challengeTrade,
    autoRelease,
    pingMaker,
    pingTakerForChallenge,
    fillSellOrder,
    fillBuyOrder,
    cancelSellOrder,
    cancelBuyOrder,
    proposeOrApproveCancel,
    expirePaymentWindow,
    getReputation,
    getCurrentAmounts,
    createSellOrder,
    createBuyOrder,
    registerWallet,
    reportPayment,
    burnExpired,
    proposeSettlement,
    rejectSettlement,
    withdrawSettlement,
    expireSettlement,
    acceptSettlement,
    approveToken,
    getAllowance,
    getTokenDecimals,
    getOrder,
    getPaused,
    decayReputation,
    antiSybilCheck,
    getCooldownRemaining,
    getWalletRegisteredAt,
    getTakerFeeBps,
    mintToken,
    getFirstSuccessfulTradeAt,
    getTrade,
  } = useArafContract({ expectedChainId: deploymentChainId });

  const {
    isAuthenticated,
    setIsAuthenticated,
    authChecked,
    authenticatedWallet,
    setAuthenticatedWallet,
    isWalletRegistered,
    setIsWalletRegistered,
    isRegisteringWallet,
    setIsRegisteringWallet,
    isLoggingIn,
    setIsLoggingIn,
    userReputation,
    payoutProfileDraft,
    setPayoutProfileDraft,
    tradeHistory,
    historyLoading,
    tradeHistoryPage,
    setTradeHistoryPage,
    tradeHistoryTotal,
    tradeHistoryLimit,
    activeTrade,
    setActiveTrade,
    resolvedTradeState,
    paymentIpfsHash,
    setPaymentIpfsHash,
    sybilStatus,
    walletAgeRemainingDays,
    takerName,
    isPaused,
    protocolStats,
    statsLoading,
    statsError,
    onchainBondMap,
    onchainTokenMap,
    protocolFeeConfig,
    reputationPolicy,
    backendDeployment,
    paymentRiskConfig,
    takerFeeBps,
    tokenDecimalsMap,
    bleedingAmounts,
    orders,
    ordersFeedError,
    myOrders,
    setMyOrders,
    setOrders,
    activeEscrows,
    setActiveEscrows,
    loading,
    clearLocalSessionState,
    bestEffortBackendLogout,
    authenticatedFetch,
    fetchStats,
    fetchMyTrades,
    tradeState,
    setTradeState,
    userRole,
    setUserRole,
    isBanned,
    refreshReputation,
    pinTradeState,
    cancelStatus,
    setCancelStatus,
    chargebackAccepted,
    setChargebackAccepted,
    formatAddress,
    filteredOrders,
    marketOrdersTotal,
    activeEscrowCounts,
    tradeTimers,
    chainNowMs,
    chainOffsetMs,
    canMakerStartChallengeFlow,
    canMakerChallenge,
  } = useAppSessionData({
    address,
    isConnected,
    connector,
    chainId,
    publicClient,
    currentView,
    lang,
    isContractLoading,
    connectedWallet,
    setShowMakerModal,
    setCurrentView,
    showToast,
    getTakerFeeBps,
    getTokenDecimals,
    getCurrentAmounts,
    getWalletRegisteredAt,
    getReputation,
    getFirstSuccessfulTradeAt,
    antiSybilCheck,
    getCooldownRemaining,
    getPaused,
    SUPPORTED_TOKEN_ADDRESSES,
    marketFilters,
    devScenarioActive,
  });

  // [TR] UI Lab kaplaması: senaryo başına bir kez kurulur; alanlar yalnız ilgili kategoride doludur.
  //      Kategoriye özgü mantık test/ui-lab/appOverlay.js içindedir ve production paketine girmez.
  // [EN] UI Lab overlay, built once per scenario; category-specific logic lives in test/ui-lab/appOverlay.js.
  const lab = React.useMemo(() => (
    devScenarioActive && uiLab ? uiLab.createLabRuntime(devScenario, { authenticatedFetch }) : null
  ), [devScenarioActive, devScenario, uiLab, authenticatedFetch]);
  // [TR] Lab'da kontrat çağrısı yapılmaz, yalnız günlüğe yazılır. [EN] In the lab contract calls are only logged.
  const labOr = (actionKey, fn) => (lab ? lab.noop(actionKey) : fn);
  const effectiveActiveEscrows = lab?.activeEscrows ?? activeEscrows;
  const effectiveActiveEscrowCounts = lab?.activeEscrowCounts ?? activeEscrowCounts;
  const effectiveAuthenticatedFetch = lab?.authenticatedFetch ?? authenticatedFetch;
  const effectiveIsAuthenticated = lab?.forceSignedIn || isAuthenticated;
  const effectiveAuthChecked = lab?.forceSignedIn || authChecked;
  const effectiveAddress = lab?.viewerAddress || address;
  const effectiveCancelStatus = lab?.tradeRoom ? lab.tradeRoom.cancelStatus : cancelStatus;
  const labMaker = lab?.maker || null;
  const labTradeRoom = React.useMemo(() => (lab?.tradeRoom ? uiLab.deriveLabTradeRoom(lab, {
    activeTrade, resolvedTradeState, userRole, chargebackAccepted, paymentIpfsHash, isConnected, isAuthenticated,
    isSupportedChain: isSupportedChainId(chainId), isPaused, lang,
  }) : null), [lab, uiLab, activeTrade, resolvedTradeState, userRole, chargebackAccepted, paymentIpfsHash, isConnected, isAuthenticated, chainId, isPaused, lang]);
  const room = labTradeRoom || { activeTrade, tradeState: resolvedTradeState, userRole, chargebackAccepted, paymentIpfsHash, bleedingAmounts };

  // [TR] Hash rotası yalnız ilk yüklemede ve hashchange'de uygulanır (F5). Eskiden activeEscrows her değiştiğinde
  //      yeniden çalışıp kullanıcıyı odaya zorluyordu. Ref'ler callback kimliğini sabit tutar.
  const escrowsRef = React.useRef(effectiveActiveEscrows);
  escrowsRef.current = effectiveActiveEscrows;
  const activeTradeRef = React.useRef(activeTrade);
  activeTradeRef.current = activeTrade;
  const currentViewRef = React.useRef(currentView);
  currentViewRef.current = currentView;
  // Odası henüz çözülemeyen (escrow listesi gelmedi) rota; bulunursa bir kez uygulanıp bırakılır.
  const pendingTradeRouteRef = React.useRef(null);

  const openEscrowFromRoute = React.useCallback((escrow) => {
    setActiveTrade(buildNextActiveTrade(escrow));
    setUserRole(escrow.role);
    setTradeState(escrow.state);
    setChargebackAccepted(escrow.rawTrade?.chargebackAcked === true);
    setCurrentView('tradeRoom');
  }, [setActiveTrade, setUserRole, setTradeState, setChargebackAccepted, setCurrentView]);

  const applyHashRoute = React.useCallback(() => {
    if (devScenarioActive) return;
    const route = parseAppHashRoute(window.location.hash);
    if (!route) return;

    if (route.view === 'profile' && route.profileTab === 'active') {
      setProfileContextTab('active');
      setActiveTradesFilter('ALL');
      setCurrentView('profile');
      return;
    }

    if (route.view === 'tradeRoom') {
      // Uygulamanın kendi yazdığı hash (zaten bu oda açık): tekrar uygulama.
      const open = activeTradeRef.current;
      if (open && currentViewRef.current === 'tradeRoom'
        && String(open.onchainId ?? '') === String(route.tradeId ?? '').replace(/^#/, '')) return;
      const escrow = findEscrowByRouteTradeId(escrowsRef.current, route.tradeId);
      if (!escrow) {
        pendingTradeRouteRef.current = route.tradeId;
        setActiveTrade(null);
        setCurrentView('tradeRoom');
        return;
      }
      pendingTradeRouteRef.current = null;
      openEscrowFromRoute(escrow);
    }
  }, [devScenarioActive, openEscrowFromRoute, setActiveTrade, setCurrentView, setActiveTradesFilter, setProfileContextTab]);

  useEffect(() => {
    applyHashRoute();
    window.addEventListener('hashchange', applyHashRoute);
    return () => window.removeEventListener('hashchange', applyHashRoute);
  }, [applyHashRoute]);

  // Bekleyen derin bağlantı: escrow listesi yüklenince bir kez uygulanır.
  useEffect(() => {
    const pendingId = pendingTradeRouteRef.current;
    if (pendingId === null || devScenarioActive) return;
    const escrow = findEscrowByRouteTradeId(effectiveActiveEscrows, pendingId);
    if (!escrow) return;
    pendingTradeRouteRef.current = null;
    openEscrowFromRoute(escrow);
  }, [effectiveActiveEscrows, devScenarioActive, openEscrowFromRoute]);

  // Odadan/profilden çıkınca hash temizlenir (history.replaceState); bekleyen rota bırakılır.
  const prevViewRef = React.useRef(currentView);
  useEffect(() => {
    const prev = prevViewRef.current;
    prevViewRef.current = currentView;
    if (devScenarioActive || prev === currentView) return;
    if ((prev === 'tradeRoom' && currentView !== 'tradeRoom') || (prev === 'profile' && currentView !== 'profile')) {
      pendingTradeRouteRef.current = null;
      clearAppHashRoute();
    }
  }, [currentView, devScenarioActive]);

  useEffect(() => {
    if (devScenarioActive) return;
    if (currentView === 'profile' && profileContextTab === 'active') {
      writeAppHashRoute('#/profile/active-trades');
      return;
    }
    if (currentView === 'tradeRoom' && activeTrade) {
      const routeId = getEscrowRouteId({ rawTrade: activeTrade, onchainId: activeTrade?.onchainId, id: activeTrade?.id });
      if (routeId) writeAppHashRoute(`#/trade/${encodeURIComponent(String(routeId))}`);
    }
  }, [devScenarioActive, currentView, profileContextTab, activeTrade]);

  useEffect(() => {
    const id = Number(backendDeployment?.chainId);
    setDeploymentChainId(Number.isFinite(id) && id > 0 ? id : null);
  }, [backendDeployment]);

  // [TR] Admin "Kontrat" sekmesi zincirden okur; lab'da sahte okuyucu kullanılır.
  const readLiveProtocolConfig = React.useCallback(() => (
    import('./app/contexts/admin/adminChainConfig').then(({ readProtocolConfig }) => readProtocolConfig({
      publicClient,
      escrowAddress: import.meta.env.VITE_ESCROW_ADDRESS,
      vaultAddress: import.meta.env.VITE_REVENUE_VAULT_ADDRESS || import.meta.env.VITE_REWARDS_VAULT_ADDRESS,
      rewardsAddress: import.meta.env.VITE_REWARDS_ADDRESS,
      tokens: SUPPORTED_TOKEN_ADDRESSES,
    }))
  ), [publicClient]);

  // [TR] Lab'a girerken mevcut state saklanır, çıkarken geri yüklenir. [EN] Snapshot on enter, restore on exit.
  const labStateSetters = {
    currentView: setCurrentView,
    activeTrade: setActiveTrade,
    activeEscrows: setActiveEscrows,
    tradeState: setTradeState,
    userRole: setUserRole,
    paymentIpfsHash: setPaymentIpfsHash,
    chargebackAccepted: setChargebackAccepted,
    activeTradesFilter: setActiveTradesFilter,
    profileContextTab: setProfileContextTab,
  };
  const applyDevScenario = (scenario) => {
    if (!uiLab || !scenario) return;
    devScenarioSnapshotRef.current ??= {
      currentView, activeTrade, activeEscrows, tradeState, userRole, paymentIpfsHash, chargebackAccepted, activeTradesFilter, profileContextTab,
    };
    setDevScenario({ categoryKey: scenario.categoryKey || scenario.category, scenarioId: scenario.id, scenario, appendLog: scenario.appendLog });
    setShowMakerModal(false);
    setSidebarOpen(false);
    uiLab.enterScenario(scenario, labStateSetters);
  };
  const clearDevScenario = () => {
    const snapshot = devScenarioSnapshotRef.current;
    setDevScenario(null);
    if (snapshot) {
      Object.entries(snapshot).forEach(([key, value]) => labStateSetters[key](value));
      devScenarioSnapshotRef.current = null;
    }
    showToast(lang === 'TR' ? 'Mock scenario kapatıldı.' : 'Mock scenario cleared.', 'info');
  };

  // ═══════════════════════════════════════════
  // 7. YARDIMCI FONKSİYONLAR
  //    Utility helpers
  // ═══════════════════════════════════════════

  // [TR] Sidebar artık timer ile kapanmaz; rail/mobile butonları açık/kapalı durumu değiştirir.
  // [EN] Sidebar no longer auto-closes by timer; rail/mobile buttons explicitly toggle open/closed state.
  const toggleSidebar = () => {
    setSidebarOpen(prev => !prev);
  };

  // [TR] Emir modalı açıkken cüzdan/auth düşerse modalı effect katmanında kapat
  //      (render sırasında setter çağrısı yapılmaz).
  // [EN] Close the maker modal from an effect when auth disconnects.
  React.useEffect(() => {
    if (!authChecked) return;
    // Lab order-creation scenarios preview the modal without a wallet session.
    if (showMakerModal && (!isConnected || !isAuthenticated) && !labMaker) {
      setShowMakerModal(false);
    }
  }, [authChecked, showMakerModal, isConnected, isAuthenticated, labMaker]);

  // [TR] Oturum gerektiren görünümler (İşlem Odası, Takip, Profil) imzalı oturum yokken açık kalmaz:
  //      doğrudan link veya oturum düşmesi durumunda ana sayfaya dönülür. UI Lab senaryoları hariç.
  // [EN] Session-only views fall back to home without a signed session (deep links, expired sessions).
  React.useEffect(() => {
    if (!authChecked || devScenarioActive) return;
    if (isConnected && isAuthenticated) return;
    if (SESSION_ONLY_VIEWS.has(currentView)) setCurrentView('home');
  }, [authChecked, devScenarioActive, isConnected, isAuthenticated, currentView]);


  const handleTermsRequired = React.useCallback((wallet) => setTermsPromptWallet(String(wallet || '').toLowerCase()), []);

  const {
    loginWithSIWE,
    handleAuthAction,
    handleLogoutAndDisconnect,
    requireSignedSessionForActiveWallet,
  } = useSessionActions({
    address,
    connectedWallet,
    chainId,
    isConnected,
    isAuthenticated,
    authenticatedWallet,
    authChecked,
    lang,
    signMessageAsync,
    disconnect,
    showToast,
    setIsLoggingIn,
    setIsAuthenticated,
    setAuthenticatedWallet,
    bestEffortBackendLogout,
    clearLocalSessionState,
    setShowWalletModal,
    openProfilePage,
    onTermsRequired: handleTermsRequired,
  });


  // [TR] Koşullar cüzdan başına bir kez sorulur: backend, imza doğrulandıktan sonra saklı kabul yoksa
  //      TERMS_NOT_ACCEPTED döner ve modal yalnız o cüzdan için açılır. Kabul → beyanlı giriş imzası (kanıt).
  const termsAccepted = !(isConnected && termsPromptWallet && termsPromptWallet === String(address || '').toLowerCase());
  const handleAcceptTerms = React.useCallback(() => {
    markTermsAcceptedLocally(address);
    setTermsPromptWallet(null);
    loginWithSIWE();
  }, [address, loginWithSIWE]);
  const handleDeclineTerms = React.useCallback(() => {
    setTermsPromptWallet(null);
    handleLogoutAndDisconnect();
  }, [handleLogoutAndDisconnect]);

  const {
    makerTier,
    setMakerTier,
    makerToken,
    setMakerToken,
    makerSide,
    setMakerSide,
    makerAmount,
    setMakerAmount,
    makerRate,
    setMakerRate,
    makerMinLimit,
    setMakerMinLimit,
    makerFiat,
    setMakerFiat,
    validationError: makerValidationError,
    payoutRiskEntry: makerPayoutRiskEntry,
    isCreateTemporarilyDisabledByRisk,
    handleCreateOrder,
    handleOpenMakerModal,
  } = useMakerOrderForm({
    isPaused,
    requireSignedSessionForActiveWallet,
    setShowMakerModal,
    showToast,
    supportedTokens: labMaker ? labMaker.supportedTokens : SUPPORTED_TOKENS,
    address,
    lang,
    isContractLoading,
    setIsContractLoading,
    setLoadingText,
    getTokenDecimals,
    getAllowance,
    approveToken,
    createSellOrder,
    createBuyOrder,
    fillSellOrder,
    fillBuyOrder,
    cancelSellOrder,
    cancelBuyOrder,
    canonicalizePayoutProfileDraft,
    payoutProfileDraft,
    paymentRiskConfig,
    authenticatedFetch,
    onchainTokenMap: labMaker?.tokenMap || onchainTokenMap,
  });

  // [TR] Lab "Emir oluşturma": formu senaryo değerleriyle doldurup modalı açar (kontrat çağrısı yapılmaz).
  React.useEffect(() => {
    if (!labMaker) return;
    const f = labMaker.form;
    setMakerSide(f.makerSide); setMakerToken(f.makerToken); setMakerAmount(f.makerAmount); setMakerRate(f.makerRate);
    setMakerMinLimit(f.makerMinLimit); setMakerFiat(f.makerFiat); setMakerTier(f.makerTier);
    setShowMakerModal(true);
  }, [labMaker]); // eslint-disable-line react-hooks/exhaustive-deps

  // [TR] Cüzdanın kendi logosu (EIP-6963 connector.icon) kullanılır; yoksa nötr cüzdan ikonu.
  // [EN] Use the wallet's own logo (EIP-6963 connector.icon); fall back to a neutral wallet icon.
  const getWalletIcon = (connectorOrName) => {
    const icon = typeof connectorOrName === 'object' ? connectorOrName?.icon : null;
    if (icon) return <img src={icon} alt="" className="w-7 h-7 rounded-md" />;
    return <Wallet className="w-6 h-6 text-textSecondary" strokeWidth={1.8} aria-hidden="true" />;
  };

  // ═══════════════════════════════════════════
  // 9. ACTION WIRING
  //    Dedicated action modules own contract/business orchestration.
  // ═══════════════════════════════════════════

  const settlementContractFns = React.useMemo(() => ({
    proposeSettlement,
    acceptSettlement,
    rejectSettlement,
    withdrawSettlement,
    expireSettlement,
  }), [proposeSettlement, acceptSettlement, rejectSettlement, withdrawSettlement, expireSettlement]);
  const handleMint = React.useMemo(() => buildMintAction({
    lang,
    isConnected,
    isFaucetEnabled,
    supportedTokenAddresses: SUPPORTED_TOKEN_ADDRESSES,
    mintToken,
    showToast,
    setIsContractLoading,
    setLoadingText,
  }), [lang, isConnected, isFaucetEnabled, SUPPORTED_TOKEN_ADDRESSES, mintToken, showToast]);

  const handleStartTrade = React.useMemo(() => buildStartTradeAction({
    lang,
    address,
    isBanned,
    isContractLoading: () => isContractLoading,
    supportedTokenAddresses: SUPPORTED_TOKEN_ADDRESSES,
    getOrder,
    getAllowance,
    approveToken,
    fillSellOrder: labOr('fill_sell_order', fillSellOrder),
    fillBuyOrder: labOr('fill_buy_order', fillBuyOrder),
    createSellOrder,
    createBuyOrder,
    cancelSellOrder,
    cancelBuyOrder,
    authenticatedFetch: effectiveAuthenticatedFetch,
    showToast,
    setIsContractLoading,
    setLoadingText,
    setActiveTrade,
    setTradeState,
    setCancelStatus,
    setChargebackAccepted,
    setCurrentView,
    setUserRole,
    fetchMyTrades,
    bondMap: onchainBondMap,
    getReputation,
  }), [
    setUserRole,
    fetchMyTrades,
    onchainBondMap,
    getReputation,
    lang,
    address,
    isBanned,
    isContractLoading,
    SUPPORTED_TOKEN_ADDRESSES,
    getOrder,
    getAllowance,
    approveToken,
    fillSellOrder,
    fillBuyOrder,
    createSellOrder,
    createBuyOrder,
    cancelSellOrder,
    cancelBuyOrder,
    effectiveAuthenticatedFetch,
    showToast,
    setActiveTrade,
    setTradeState,
    setCancelStatus,
    setChargebackAccepted,
    lab,
  ]);

  const tradeRoomActions = React.useMemo(() => buildTradeRoomActions({
    lang,
    activeTrade,
    activeEscrows: effectiveActiveEscrows,
    paymentIpfsHash: room.paymentIpfsHash,
    resolvedTradeState,
    chargebackAccepted,
    isContractLoading,
    canMakerStartChallengeFlow,
    canMakerChallenge,
    reportPayment: labOr('report_payment', reportPayment),
    proposeOrApproveCancel: labOr('propose_cancel', proposeOrApproveCancel),
    expirePaymentWindow: labOr('expire_payment_window', expirePaymentWindow),
    cancelStatus,
    releaseFunds: labOr('release_funds', releaseFunds),
    pingTakerForChallenge: labOr('ping_taker_for_challenge', pingTakerForChallenge),
    challengeTrade: labOr('start_challenge', challengeTrade),
    pingMaker: labOr('ping_maker', pingMaker),
    autoRelease: labOr('auto_release', autoRelease),
    burnExpired: labOr('burn_expired', burnExpired),
    authenticatedFetch: effectiveAuthenticatedFetch,
    showToast,
    fetchMyTrades,
    setIsContractLoading,
    setActiveTrade,
    setTradeState,
    setPaymentIpfsHash,
    setCancelStatus,
    setChargebackAccepted,
    setCurrentView,
    getTrade,
    pinTradeState,
  }), [
    getTrade,
    pinTradeState,
    lang,
    activeTrade,
    effectiveActiveEscrows,
    room.paymentIpfsHash,
    resolvedTradeState,
    chargebackAccepted,
    isContractLoading,
    canMakerStartChallengeFlow,
    canMakerChallenge,
    reportPayment,
    proposeOrApproveCancel,
    expirePaymentWindow,
    cancelStatus,
    releaseFunds,
    pingTakerForChallenge,
    challengeTrade,
    pingMaker,
    autoRelease,
    burnExpired,
    effectiveAuthenticatedFetch,
    showToast,
    fetchMyTrades,
    setActiveTrade,
    setTradeState,
    setPaymentIpfsHash,
    setCancelStatus,
    setChargebackAccepted,
    lab,
  ]);

  const profileActions = React.useMemo(() => buildProfileActions({
    lang,
    isContractLoading,
    isRegisteringWallet,
    isWalletRegistered,
    payoutProfileDraft,
    requireSignedSessionForActiveWallet,
    authenticatedFetch: effectiveAuthenticatedFetch,
    canonicalizePayoutProfileDraft,
    registerWallet: labOr('register_wallet', registerWallet),
    showToast,
    setIsContractLoading,
    setIsRegisteringWallet,
    setIsWalletRegistered,
  }), [
    lang,
    isContractLoading,
    isRegisteringWallet,
    isWalletRegistered,
    payoutProfileDraft,
    requireSignedSessionForActiveWallet,
    effectiveAuthenticatedFetch,
    registerWallet,
    showToast,
    setIsRegisteringWallet,
    setIsWalletRegistered,
    lab,
  ]);

  const orderActions = React.useMemo(() => buildOrderActions({
    lang,
    isContractLoading,
    requireSignedSessionForActiveWallet,
    fillSellOrder: labOr('fill_sell_order', fillSellOrder),
    fillBuyOrder: labOr('fill_buy_order', fillBuyOrder),
    createSellOrder: labOr('create_sell_order', createSellOrder),
    createBuyOrder: labOr('create_buy_order', createBuyOrder),
    cancelSellOrder: labOr('cancel_sell_order', cancelSellOrder),
    cancelBuyOrder: labOr('cancel_buy_order', cancelBuyOrder),
    showToast,
    setIsContractLoading,
    setOrders,
    setMyOrders,
    setConfirmDeleteId,
  }), [
    lang,
    address,
    isContractLoading,
    requireSignedSessionForActiveWallet,
    fillSellOrder,
    fillBuyOrder,
    createSellOrder,
    createBuyOrder,
    cancelSellOrder,
    cancelBuyOrder,
    showToast,
    setOrders,
    setMyOrders,
    lab,
  ]);

  const {
    handleFileUpload,
    handleReportPayment,
    handleProposeCancel,
    handleChargebackAck,
    handleRelease,
    handleChallenge,
    handlePingMaker,
    handleAutoRelease,
    handleBurnExpired,
  } = tradeRoomActions;
  const { handleUpdatePII, handleRegisterWallet } = profileActions;
  const envErrors = React.useMemo(() => [
    ...ENV_ERRORS,
    ...checkDeploymentAlignment({ frontendEscrowAddress: import.meta.env.VITE_ESCROW_ADDRESS, backendDeployment }),
  ], [backendDeployment]);

  const systemStatus = React.useMemo(() => ({
    envErrors,
    isPaused,
    isConnected,
    isAuthenticated,
    authChecked,
    chainId,
    isSupportedChain,
    supportedChains,
    isWalletRegistered,
    isRegisteringWallet,
    onRegisterWallet: handleRegisterWallet,
    sybilStatus,
    walletAgeRemainingDays,
    activeTrade,
    ordersFeedError,
    lang,
  }), [envErrors, ordersFeedError, isPaused, isConnected, isAuthenticated, authChecked, chainId, isSupportedChain, supportedChains, isWalletRegistered, isRegisteringWallet, handleRegisterWallet, sybilStatus, walletAgeRemainingDays, activeTrade, lang]);

  // [TR] decayReputation sonrası itibar/ban/tier yeniden okunur (F9).
  const decayReputationAndRefresh = React.useCallback(async (...args) => {
    const result = await decayReputation(...args);
    if (typeof refreshReputation === 'function') await refreshReputation();
    return result;
  }, [decayReputation, refreshReputation]);

  const FEEDBACK_MIN_LENGTH = 12;

  const submitFeedback = async () => {
    if (!isAuthenticated) {
      showToast(lang === 'TR' ? 'Geri bildirim göndermek için giriş yapmalısınız.' : 'Please sign in to send feedback.', 'error');
      return;
    }

    const trimmedFeedback = feedbackText.trim();
    if (feedbackRating === 0 || !feedbackCategory) {
      setFeedbackError(lang === 'TR' ? 'Yıldız puanı ve kategori zorunludur.' : 'Rating and category are required.');
      return;
    }
    if (trimmedFeedback.length < FEEDBACK_MIN_LENGTH) {
      setFeedbackError(
        lang === 'TR'
          ? `Lütfen en az ${FEEDBACK_MIN_LENGTH} karakter detay verin (maliyetli revert'leri azaltmamıza yardımcı olur).`
          : `Please add at least ${FEEDBACK_MIN_LENGTH} characters (helps us reduce costly reverts).`
      );
      return;
    }

    try {
      setIsSubmittingFeedback(true);
      setFeedbackError('');
      const res = await authenticatedFetch(buildApiUrl('feedback'), {
        method: 'POST',
        body: JSON.stringify({ rating: feedbackRating, comment: trimmedFeedback, category: feedbackCategory }),
      });
      // [TR] authenticatedFetch hata durumunda throw etmez; 400/429/500 önceden "teşekkürler" gösteriyordu.
      // [EN] authenticatedFetch does not throw on HTTP errors; previously 400/429/500 showed "thank you".
      if (!res?.ok) throw new Error(`HTTP ${res?.status ?? 'network'}${res?.status === 429 ? ' Too many' : ''}`);

      setShowFeedbackModal(false);
      setFeedbackText('');
      setFeedbackRating(0);
      setFeedbackCategory('');
      showToast(lang === 'TR' ? 'Geri bildiriminiz için teşekkürler!' : 'Thank you for your feedback!', 'success');
    } catch (err) {
      console.error('Feedback submit error:', err);
      const raw = String(err?.message || '');
      const isRateLimit = raw.includes('Too many') || raw.includes('429') || raw.includes('çok fazla');
      const isAuthError = raw.includes('401') || raw.includes('403') || raw.toLowerCase().includes('unauthorized');
      const message = isRateLimit
        ? (lang === 'TR' ? 'Çok sık geri bildirim gönderdiniz. Lütfen biraz bekleyin.' : 'You are sending feedback too frequently. Please wait a bit.')
        : isAuthError
          ? (lang === 'TR' ? 'Oturumunuzun süresi dolmuş olabilir. Lütfen tekrar giriş yapın.' : 'Your session may have expired. Please sign in again.')
          : (lang === 'TR' ? 'Geri bildirim gönderilemedi. Lütfen tekrar deneyin.' : 'Failed to send feedback. Please try again.');
      setFeedbackError(message);
      showToast(message, 'error');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  // ═══════════════════════════════════════════
  // 10. MODAL RENDER FONKSİYONLARI
  //     Wallet, Feedback, Maker, Profile modals
  // ═══════════════════════════════════════════

  // [TR] View ve modal render katmanını App dışına taşıyan composition noktası.
  // [EN] Composition point that externalizes view/modal render layers from App.
  const {
    renderHome,
    renderMarket,
    renderOperations,
    renderProfileContext,
    renderTradeRoom,
    renderSlimRail,
    renderContextSidebar,
    renderMobileNav,
    renderFooter,
  } = buildAppViews({
    lang,
    orderActions,
    tradeRoomActions,
    setLang,
    isConnected,
    isAuthenticated: effectiveIsAuthenticated,
    isLoggingIn,
    isContractLoading,
    loadingText,
    isPaused,
    authChecked: effectiveAuthChecked,
    currentView,
    setCurrentView,
    toggleSidebar,
    handleAuthAction,
    formatAddress,
    address: effectiveAddress,
    chainId,
    sidebarOpen,
    setSidebarOpen,
    setExpandedStatus,
    expandedStatus,
    marketFilters,
    setMarketFilter,
    resetMarketFilters,
    marketOrdersTotal,
    filteredOrders,
    orders,
    ordersFeedError,
    fullscreen,
    activeEscrows: effectiveActiveEscrows,
    loading,
    SUPPORTED_TOKEN_ADDRESSES,
    handleStartTrade,
    handleMint,
    isFaucetEnabled,
    isSupportedChainId,
    handleOpenMakerModal,
    handleUpdatePII,
    handleLogoutAndDisconnect,
    activeEscrowCounts: effectiveActiveEscrowCounts,
    openProfilePage,
    setConfirmDeleteId,
    activeTradesFilter,
    setActiveTradesFilter,
    setShowFeedbackModal,
    protocolStats,
    statsLoading,
    statsError,
    fetchStats,
    userReputation,
    sybilStatus,
    walletAgeRemainingDays,
    takerFeeBps,
    protocolFeeConfig,
    activeTrade: room.activeTrade,
    setActiveTrade,
    userRole: room.userRole,
    setUserRole,
    tradeState: room.tradeState,
    setTradeState,
    resolvedTradeState: room.tradeState,
    setCancelStatus,
    setChargebackAccepted,
    paymentIpfsHash: room.paymentIpfsHash,
    handleFileUpload,
    handleReportPayment,
    handleProposeCancel,
    cancelStatus: effectiveCancelStatus,
    chargebackAccepted: room.chargebackAccepted,
    handleChargebackAck,
    handleRelease,
    handleChallenge,
    handlePingMaker,
    handleAutoRelease,
    handleBurnExpired,
    tradeTimers: labTradeRoom ? { ...tradeTimers, ...labTradeRoom.timers } : tradeTimers,
    chainNowMs,
    chainOffsetMs,
    canMakerStartChallengeFlow,
    canMakerChallenge,
    // [TR] Lab'da kontrat okuması yok; eriyen tutar kontrat formülünün aynasıyla tahmin edilir.
    bleedingAmounts: room.bleedingAmounts,
    takerName: lab?.tradeRoom?.takerName ?? takerName,
    tokenDecimalsMap,
    formatTokenAmountFromRaw,
    rawTokenToDisplayNumber,
    fetchMyTrades,
    setIsContractLoading,
    authenticatedFetch: effectiveAuthenticatedFetch,
    showToast,
    settlementContractFns: lab?.tradeRoom?.settlementFns ?? settlementContractFns,
    devScenarioCategory: lab?.category ?? null,
    devTradeDecisionInput: labTradeRoom?.decisionInput ?? null,
    devTradeHandlers: lab?.tradeRoom?.handlers ?? null,
    operationsActionSetters: lab?.operationsSetters ?? null,
    payoutProfileDraft,
    setPayoutProfileDraft,
    canonicalizePayoutProfileDraft,
    myOrders,
    confirmDeleteId,
    tradeHistory,
    profileContextTab,
    setProfileContextTab,
    labProfile: lab?.profile ?? null,
    reputationPolicy,
    isBanned,
    decayReputation: lab?.profile ? lab.setter('decay_reputation') : decayReputationAndRefresh,
    historyLoading,
    tradeHistoryPage,
    setTradeHistoryPage,
    tradeHistoryTotal,
    tradeHistoryLimit,
    authenticatedWallet,
  });

  const {
    renderWalletModal,
    renderFeedbackModal,
    renderMakerModal,
    renderTermsModal,
  } = buildAppModals({
    lang,
    onRequestSignIn: handleAuthAction,
    showWalletModal,
    setShowWalletModal,
    connectors,
    connect,
    getWalletIcon,
    showFeedbackModal,
    setShowFeedbackModal,
    feedbackRating,
    setFeedbackRating,
    feedbackCategory,
    setFeedbackCategory,
    setFeedbackError,
    feedbackText,
    setFeedbackText,
    feedbackError,
    FEEDBACK_MIN_LENGTH,
    submitFeedback,
    isSubmittingFeedback,
    showMakerModal,
    setShowMakerModal,
    makerTier,
    setMakerTier,
    makerToken,
    setMakerToken,
    makerSide,
    setMakerSide,
    makerAmount,
    setMakerAmount,
    makerRate,
    setMakerRate,
    makerMinLimit,
    setMakerMinLimit,
    makerFiat,
    setMakerFiat,
    // [TR] Lab "Emir oluşturma" senaryosunda kontrat verileri senaryodan gelir; gönderim yalnız günlüğe yazılır.
    onchainBondMap: labMaker ? labMaker.bondMap : onchainBondMap,
    onchainTokenMap: labMaker ? labMaker.tokenMap : onchainTokenMap,
    protocolFeeConfig: labMaker ? labMaker.feeConfig : protocolFeeConfig,
    userReputation: labMaker ? labMaker.reputation : userReputation,
    SUPPORTED_TOKEN_ADDRESSES: labMaker ? labMaker.tokenAddresses : SUPPORTED_TOKEN_ADDRESSES,
    handleCreateOrder: labMaker ? lab.setter('create_order') : handleCreateOrder,
    makerValidationError,
    makerPayoutRiskEntry,
    isCreateTemporarilyDisabledByRisk,
    isContractLoading,
    loadingText,
    address,
    isConnected,
    isAuthenticated: effectiveIsAuthenticated,
    termsAccepted,
    onAcceptTerms: handleAcceptTerms,
    onDeclineTerms: handleDeclineTerms,
    connector,
  });

  // ═══════════════════════════════════════════
  // 13. ANA RENDER
  //     Root layout: rail + sidebar + content + modals + toast
  // ═══════════════════════════════════════════
  return (
    <div className="flex h-dvh min-h-dvh max-h-dvh w-full max-w-full flex-col overflow-hidden bg-app text-textPrimary font-sans selection:bg-emerald-500/30 relative">
      <AppShell
        status={systemStatus}
        navigation={renderSlimRail()}
        panel={renderContextSidebar()}
        mobileBottom={renderMobileNav()}
        outlet={(
          <div className="flex-1 min-w-0 w-full max-w-full overflow-y-auto overflow-x-hidden relative bg-app">
            <div className="box-border min-h-full w-full max-w-full min-w-0 flex flex-col pt-4 md:pt-10 pb-[calc(4rem_+_env(safe-area-inset-bottom))] md:pb-10 items-center">
              {currentView === 'home'
                ? renderHome()
                : currentView === 'market'
                  ? renderMarket()
                  : currentView === 'operations'
                    ? renderOperations()
                    : currentView === 'profile'
                    ? renderProfileContext()
                    : currentView === 'admin'
                    ? (
                      <React.Suspense fallback={<div className="p-8 text-sm text-textMuted" role="status">{lang === 'TR' ? 'Yükleniyor…' : 'Loading…'}</div>}>
                      <AdminPanel
                        // [TR] Lab'da senaryo değişince panel yeniden kurulur; aksi halde önceki 403 durumu kalıyordu.
                        key={lab?.admin?.key || 'admin'}
                        lang={lang}
                        authenticatedFetch={effectiveAuthenticatedFetch}
                        isAuthenticated={effectiveIsAuthenticated}
                        authChecked={effectiveAuthChecked}
                        showToast={showToast}
                        initialTab={lab?.admin?.initialTab}
                        readProtocolConfig={lab?.admin?.readProtocolConfig || readLiveProtocolConfig}
                        tokenSymbols={lab?.admin?.tokenSymbols || ADMIN_TOKEN_SYMBOLS}
                      />
                      </React.Suspense>
                    )
                    : renderTradeRoom()}
              {currentView === 'home' && renderFooter()}
            </div>
          </div>
        )}
        modals={(
          <>
            {renderWalletModal()}
            {renderFeedbackModal()}
            {renderMakerModal()}
            {renderTermsModal()}
          </>
        )}
      />

      {uiLab && (
        <uiLab.DevScenarioController
          activeScenario={devScenario}
          onApplyScenario={applyDevScenario}
          onClearScenario={clearDevScenario}
        />
      )}

      {/* [TR] Mobilde yalnız ikon: içerik ve başlıkların üstüne binmez. [EN] Icon-only on mobile. */}
      <button
        onClick={() => setShowFeedbackModal(true)}
        title={lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}
        aria-label={lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}
        className="fixed top-[calc(0.75rem_+_env(safe-area-inset-top))] right-[calc(0.75rem_+_env(safe-area-inset-right))] md:top-6 md:right-6 z-40 h-10 w-10 md:w-auto md:px-4 bg-surface/90 hover:bg-elevated border border-borderSubtle rounded-full md:rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold text-textPrimary shadow-sm backdrop-blur transition hover:border-borderStrong"
      >
        <MessageSquare className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
        <span className="hidden md:inline">{lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}</span>
      </button>

      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          className="fixed bottom-[calc(5rem_+_env(safe-area-inset-bottom))] md:bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:-translate-x-0 md:right-6 z-[100] animate-bounce-in w-[90%] max-w-[calc(100vw_-_2rem)] sm:w-auto sm:max-w-md"
        >
          <div className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl border bg-surface text-sm font-semibold text-textPrimary ${toast.type === 'error' ? 'border-danger/60' : toast.type === 'info' ? 'border-info/60' : 'border-brand/60'}`}>
            <span aria-hidden="true" className={toast.type === 'error' ? 'text-danger' : toast.type === 'info' ? 'text-info' : 'text-brand'}>
              {toast.type === 'error' ? <TriangleAlert className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" /> : toast.type === 'info' ? <Info className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" /> : <CircleCheck className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />}
            </span>
            <span className="flex-1 leading-snug">{toast.message}</span>
            <button type="button" onClick={() => setToast(null)} aria-label={lang === 'TR' ? 'Kapat' : 'Close'} className="text-textMuted hover:text-textPrimary leading-none">×</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
