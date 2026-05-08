import React, { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage, useChainId, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { useArafContract } from './hooks/useArafContract';
import PIIDisplay from './components/PIIDisplay';
import { buildAppViews } from './app/AppViews';
import { buildAppModals } from './app/AppModals';
import AppShell from './app/shell/AppShell';
import { useSessionActions } from './app/providers/SessionProvider';
import { useAppSessionData } from './app/useAppSessionData';
import AdminPanel from './AdminPanel';
import UiLabPage from './dev/ui-lab/UiLabPage';
import { isUiLabEnabled } from './dev/ui-lab/isUiLabEnabled';
import { getInitialLang, getInitialTermsAccepted, APP_LANG_STORAGE_KEY } from './app/bootstrapState';
import { buildApiUrl, resolveApiPolicyDiagnostics } from './app/apiConfig';
import { getSupportedChainsMap, isMintTokenEnabled, isSupportedChainId } from './app/chainPolicy';
import { useMakerOrderForm } from './app/contexts/marketplace/useMakerOrderForm';
import { buildMintAction, buildOrderActions, buildProfileActions, buildStartTradeAction, buildTradeRoomActions } from './app/actions/contractLifecycleActions';

// [TR] Uygulama başlangıcında kritik env değişkenlerini doğrula
// [EN] Validate critical env variables on app start
const ENV_ERRORS = [];
const { errors: API_POLICY_ERRORS } = resolveApiPolicyDiagnostics(import.meta.env);
ENV_ERRORS.push(...API_POLICY_ERRORS);
if (!import.meta.env.VITE_ESCROW_ADDRESS ||
    import.meta.env.VITE_ESCROW_ADDRESS === '0x0000000000000000000000000000000000000000') {
  ENV_ERRORS.push('VITE_ESCROW_ADDRESS tanımlı değil veya sıfır adres — kontrat işlemleri çalışmayacak');
}

// [TR] İstatistik kartlarındaki 30 günlük değişim yüzdesi göstergesi
// [EN] 30-day change percentage indicator for stat cards
const StatChange = ({ value }) => {
  if (value == null) return null;
  const isPositive = value >= 0;
  return <span className={`text-[10px] ml-2 font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>{isPositive ? '▲' : '▼'}{Math.abs(value).toFixed(1)}%</span>;
};

const DEFAULT_TOKEN_DECIMALS = null;
const SEPA_COUNTRIES = ['DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'AT', 'PT', 'IE', 'LU', 'FI', 'GR'];
const RAIL_DEFAULT_COUNTRY = { TR_IBAN: 'TR', US_ACH: 'US', SEPA_IBAN: 'DE' };
// [TR] Frontend payload canonicalizer — backend authority korunur, kirli veri minimize edilir.
// [EN] Frontend payload canonicalizer — backend stays authoritative, payload quality is improved.
const canonicalizePayoutProfileDraft = (draft = {}) => {
  const rail = String(draft.rail || 'TR_IBAN').toUpperCase();
  const allowedCountries = rail === 'SEPA_IBAN'
    ? SEPA_COUNTRIES
    : [RAIL_DEFAULT_COUNTRY[rail] || 'TR'];
  const requestedCountry = String(draft.country || '').toUpperCase();
  const country = allowedCountries.includes(requestedCountry)
    ? requestedCountry
    : (RAIL_DEFAULT_COUNTRY[rail] || allowedCountries[0]);
  const rawChannel = draft?.contact?.channel || null;
  const channel = rawChannel ? String(rawChannel).toLowerCase() : null;
  let value = draft?.contact?.value == null ? null : String(draft.contact.value).trim();
  if (channel === 'telegram' && value) value = value.replace(/^@+/, '');
  if (channel === 'phone' && value) value = value.replace(/\s+/g, '');
  if (!channel) value = null;
  const fields = draft?.fields || {};
  const base = {
    account_holder_name: String(fields.account_holder_name || '').trim().replace(/\s+/g, ' '),
    iban: null,
    routing_number: null,
    account_number: null,
    account_type: null,
    bic: null,
    bank_name: fields.bank_name ? String(fields.bank_name).trim() : null,
  };
  if (rail === 'TR_IBAN') base.iban = fields.iban ? String(fields.iban).replace(/\s+/g, '').toUpperCase() : null;
  if (rail === 'SEPA_IBAN') {
    base.iban = fields.iban ? String(fields.iban).replace(/\s+/g, '').toUpperCase() : null;
    base.bic = fields.bic ? String(fields.bic).trim().toUpperCase() : null;
  }
  if (rail === 'US_ACH') {
    base.routing_number = fields.routing_number ? String(fields.routing_number).replace(/\s+/g, '') : null;
    base.account_number = fields.account_number ? String(fields.account_number).replace(/\s+/g, '') : null;
    base.account_type = fields.account_type || null;
  }
  return { rail, country, contact: { channel, value }, fields: base };
};

// [TR] Otoritatif raw base-unit değerini UI için normalize eder (display-only).
// [EN] Normalizes authoritative raw base-unit values for UI display only.
const formatTokenAmountFromRaw = (rawAmount, decimals = DEFAULT_TOKEN_DECIMALS, maxFractionDigits = 4) => {
  if (!Number.isInteger(decimals) || decimals <= 0 || decimals > 18) return '—';
  try {
    const normalized = formatUnits(BigInt(rawAmount ?? 0), decimals);
    return Number(normalized).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    });
  } catch {
    return '0';
  }
};

// [TR] UI/analytics hesapları için Number cache; enforcement için kullanılmaz.
// [EN] Number cache for UI/analytics math; never used for enforcement.
const rawTokenToDisplayNumber = (rawAmount, decimals = DEFAULT_TOKEN_DECIMALS) => {
  if (!Number.isInteger(decimals) || decimals <= 0 || decimals > 18) return 0;
  try {
    return Number(formatUnits(BigInt(rawAmount ?? 0), decimals));
  } catch {
    return 0;
  }
};

function App() {
  // ═══════════════════════════════════════════
  // 1. EKRAN VE UI STATE YÖNETİMİ
  //    View routing + modal open/close flags
  // ═══════════════════════════════════════════
  const uiLabEnabled = isUiLabEnabled();
  const initialView = uiLabEnabled && typeof window !== 'undefined' && window.location?.pathname === '/dev/ui-lab' ? 'uiLab' : 'home';
  const [currentView, setCurrentView] = useState(initialView);
  const [showMakerModal, setShowMakerModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedStatus, setExpandedStatus] = useState(null);

  // [TR] Desteklenen token adresleri — .env üzerinden yönetilir
  // [EN] Supported token addresses — managed via .env
  const SUPPORTED_TOKENS = {
    USDT: { address: import.meta.env.VITE_USDT_ADDRESS || '', decimalsRequired: true },
    USDC: { address: import.meta.env.VITE_USDC_ADDRESS || '', decimalsRequired: true },
  };
  const SUPPORTED_TOKEN_ADDRESSES = Object.fromEntries(
    Object.entries(SUPPORTED_TOKENS).map(([symbol, meta]) => [symbol, meta.address])
  );
  const [profileTab, setProfileTab] = useState('ayarlar');
  const [lang, setLang] = useState(getInitialLang);
  const [loadingText, setLoadingText] = useState('');
  const [isContractLoading, setIsContractLoading] = useState(false);
  const [filterTier1, setFilterTier1] = useState(false);
  const [filterToken, setFilterToken] = useState('ALL');
  const [searchAmount, setSearchAmount] = useState('');
  const [toast, setToast] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(getInitialTermsAccepted);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [activeTradesFilter, setActiveTradesFilter] = useState('ALL');
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackCategory, setFeedbackCategory] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  // [TR] Toast bildirimi gösterir — 4 sn sonra otomatik kapanır
  // [EN] Shows toast notification — auto-closes after 4s
  const showToast = React.useCallback((message, type = 'success') => {
    setToast({ id: Date.now(), message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ═══════════════════════════════════════════
  // 2. WEB3 BAĞLANTI VE KONTRAT HOOK'LARI
  //    Wallet connection + all contract methods
  // ═══════════════════════════════════════════
  const { address, isConnected, connector } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const supportedChains = getSupportedChainsMap();
  const isFaucetEnabled = isMintTokenEnabled();
  const isSupportedChain = isSupportedChainId(chainId);

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
    signCancelProposal,
    proposeOrApproveCancel,
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
  } = useArafContract();

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
    paymentRiskConfig,
    takerFeeBps,
    tokenDecimalsMap,
    bleedingAmounts,
    orders,
    myOrders,
    setMyOrders,
    setOrders,
    activeEscrows,
    loading,
    setLoading,
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
    setIsBanned,
    cancelStatus,
    setCancelStatus,
    chargebackAccepted,
    setChargebackAccepted,
    formatAddress,
    filteredOrders,
    activeEscrowCounts,
    gracePeriodTimer,
    bleedingTimer,
    principalProtectionTimer,
    makerPingTimer,
    canMakerPing,
    makerChallengePingTimer,
    canMakerStartChallengeFlow,
    makerChallengeTimer,
    canMakerChallenge,
  } = useAppSessionData({
    address,
    isConnected,
    connector,
    chainId,
    publicClient,
    currentView,
    showProfileModal,
    profileTab,
    lang,
    isContractLoading,
    connectedWallet,
    setShowMakerModal,
    setShowProfileModal,
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
    filterTier1,
    filterToken,
    searchAmount,
  });

  // ═══════════════════════════════════════════
  // 7. YARDIMCI FONKSİYONLAR
  //    Utility helpers
  // ═══════════════════════════════════════════

  // [TR] Sidebar artık timer ile kapanmaz; rail/mobile butonları açık/kapalı durumu değiştirir.
  // [EN] Sidebar no longer auto-closes by timer; rail/mobile buttons explicitly toggle open/closed state.
  const toggleSidebar = () => {
    setSidebarOpen(prev => !prev);
  };

  // [TR] Profil modalı açıkken cüzdan/auth düşerse modalı effect katmanında kapat.
  //      Böylece render sırasında setter çağrısı yapılmaz (regression crash fix).
  // [EN] Close profile modal from effect when auth disconnects to avoid
  //      setState during render.
  React.useEffect(() => {
    if (!authChecked) return;
    if (showProfileModal && (!isConnected || !isAuthenticated)) {
      setShowProfileModal(false);
    }
    if (showMakerModal && (!isConnected || !isAuthenticated)) {
      setShowMakerModal(false);
    }
  }, [authChecked, showProfileModal, showMakerModal, isConnected, isAuthenticated]);


  const {
    loginWithSIWE,
    handleAuthAction,
    handleLogoutAndDisconnect,
    requireSignedSessionForActiveWallet,
    hasSignedSessionForActiveWallet,
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
    setProfileTab,
    setShowProfileModal,
  });


  const sessionActions = React.useMemo(() => ({
    loginWithSIWE,
    handleAuthAction,
    handleLogoutAndDisconnect,
    requireSignedSessionForActiveWallet,
    hasSignedSessionForActiveWallet,
  }), [loginWithSIWE, handleAuthAction, handleLogoutAndDisconnect, requireSignedSessionForActiveWallet, hasSignedSessionForActiveWallet]);

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
    makerMaxLimit,
    setMakerMaxLimit,
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
    supportedTokens: SUPPORTED_TOKENS,
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
  });

  const orderForm = React.useMemo(() => ({
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
    makerMaxLimit,
    setMakerMaxLimit,
    makerFiat,
    setMakerFiat,
    makerValidationError,
    makerPayoutRiskEntry,
    isCreateTemporarilyDisabledByRisk,
    handleCreateOrder,
    handleOpenMakerModal,
  }), [
    makerTier,
    makerToken,
    makerSide,
    makerAmount,
    makerRate,
    makerMinLimit,
    makerMaxLimit,
    makerFiat,
    makerValidationError,
    makerPayoutRiskEntry,
    isCreateTemporarilyDisabledByRisk,
    handleCreateOrder,
    handleOpenMakerModal,
  ]);

  const getWalletIcon = (name) => {
    const n = name.toLowerCase();
    if (n.includes('metamask')) return '🦊';
    if (n.includes('okx')) return '🖤';
    if (n.includes('coinbase')) return '🔵';
    return '👛';
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
  const settlementActions = React.useMemo(() => ({ settlementContractFns }), [settlementContractFns]);

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
    fillSellOrder,
    fillBuyOrder,
    createSellOrder,
    createBuyOrder,
    cancelSellOrder,
    cancelBuyOrder,
    authenticatedFetch,
    showToast,
    setIsContractLoading,
    setLoadingText,
    setActiveTrade,
    setTradeState,
    setCancelStatus,
    setChargebackAccepted,
    setCurrentView,
  }), [
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
    authenticatedFetch,
    showToast,
    setActiveTrade,
    setTradeState,
    setCancelStatus,
    setChargebackAccepted,
  ]);

  const tradeRoomActions = React.useMemo(() => buildTradeRoomActions({
    lang,
    activeTrade,
    activeEscrows,
    paymentIpfsHash,
    resolvedTradeState,
    chargebackAccepted,
    isContractLoading,
    canMakerStartChallengeFlow,
    canMakerChallenge,
    reportPayment,
    signCancelProposal,
    proposeOrApproveCancel,
    releaseFunds,
    pingTakerForChallenge,
    challengeTrade,
    pingMaker,
    autoRelease,
    burnExpired,
    authenticatedFetch,
    showToast,
    fetchMyTrades,
    setIsContractLoading,
    setActiveTrade,
    setTradeState,
    setPaymentIpfsHash,
    setCancelStatus,
    setChargebackAccepted,
    setCurrentView,
    setLoadingText,
  }), [
    lang,
    activeTrade,
    activeEscrows,
    paymentIpfsHash,
    resolvedTradeState,
    chargebackAccepted,
    isContractLoading,
    canMakerStartChallengeFlow,
    canMakerChallenge,
    reportPayment,
    signCancelProposal,
    proposeOrApproveCancel,
    releaseFunds,
    pingTakerForChallenge,
    challengeTrade,
    pingMaker,
    autoRelease,
    burnExpired,
    authenticatedFetch,
    showToast,
    fetchMyTrades,
    setActiveTrade,
    setTradeState,
    setPaymentIpfsHash,
    setCancelStatus,
    setChargebackAccepted,
  ]);

  const profileActions = React.useMemo(() => buildProfileActions({
    lang,
    isContractLoading,
    isRegisteringWallet,
    isWalletRegistered,
    payoutProfileDraft,
    requireSignedSessionForActiveWallet,
    authenticatedFetch,
    canonicalizePayoutProfileDraft,
    registerWallet,
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
    authenticatedFetch,
    registerWallet,
    showToast,
    setIsRegisteringWallet,
    setIsWalletRegistered,
  ]);

  const orderActions = React.useMemo(() => buildOrderActions({
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
  const { handleDeleteOrder } = orderActions;

  const shellState = React.useMemo(() => ({
    currentView,
    setCurrentView,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar,
    expandedStatus,
    setExpandedStatus,
  }), [currentView, sidebarOpen, toggleSidebar, expandedStatus]);

  const systemStatus = React.useMemo(() => ({
    envErrors: ENV_ERRORS,
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
    lang,
  }), [isPaused, isConnected, isAuthenticated, authChecked, chainId, isSupportedChain, supportedChains, isWalletRegistered, isRegisteringWallet, handleRegisterWallet, sybilStatus, walletAgeRemainingDays, activeTrade, lang]);

  const getSafeTelegramUrl = React.useCallback((handle) => {
    if (!handle) return '#';
    const safeHandle = handle.replace(/[^a-zA-Z0-9_]/g, '');
    return `https://t.me/${safeHandle}`;
  }, []);

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
      await authenticatedFetch(buildApiUrl('feedback'), {
        method: 'POST',
        body: JSON.stringify({ rating: feedbackRating, comment: trimmedFeedback, category: feedbackCategory }),
      });

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

  // ─────────────────────────────────────────────
  // [TR] Çeviri sözlüğü — yalnızca pazar yeri ana metinleri
  // [EN] Translation dictionary — marketplace main labels only
  // ─────────────────────────────────────────────
  const faqItems = lang === 'TR'
    ? [
        { q: 'Araf Protokolü hakem kullanıyor mu?', a: 'Hayır. Uyuşmazlıklarda insan hakem yok. Süreç tamamen on-chain zamanlayıcılar ve ekonomik teşviklerle çalışır.' },
        { q: 'Platform fonlara erişebiliyor mu?', a: 'Hayır. Sistem non-custodial\'dır; fonlar akıllı kontratta kilitli kalır. Backend, serbest bırakma kararı veremez.' },
        { q: 'Neden Tier ve teminat var?', a: 'Tier sistemi yeni cüzdanların riskini sınırlar; teminatlar ise kötü niyetli davranışı ekonomik olarak pahalı hale getirir.' },
        { q: 'Neden feedback önemli?', a: 'Feedback verileri TX maliyeti, akış netliği ve hata tespitini iyileştirerek gereksiz revert ve zaman kaybını azaltır.' },
      ]
    : [
        { q: 'Does Araf Protocol use arbitrators?', a: 'No. There are no human arbitrators in disputes. The flow is enforced by on-chain timers and economic incentives.' },
        { q: 'Can the platform access user funds?', a: 'No. The system is non-custodial; funds stay locked in the smart contract. Backend cannot force release outcomes.' },
        { q: 'Why are tiers and bonds required?', a: 'Tiers limit cold-start risk for new wallets, while bonds make dishonest behavior economically expensive.' },
        { q: 'Why does feedback matter?', a: 'Feedback helps optimize TX flow clarity, reduce avoidable reverts, and improve cost-efficient UX.' },
      ];

  const socialLinks = {
    github: import.meta.env.VITE_SOCIAL_GITHUB || 'https://github.com/',
    twitter: import.meta.env.VITE_SOCIAL_TWITTER || 'https://x.com/',
    farcaster: import.meta.env.VITE_SOCIAL_FARCASTER || 'https://warpcast.com/',
  };

  const t = {
    title:           lang === 'TR' ? 'Pazar Yeri' : 'Marketplace',
    subtitle:        lang === 'TR' ? 'Merkeziyetsiz, hakemsiz P2P takas tahtası.' : 'Decentralized, oracle-free P2P escrow board.',
    searchPlaceholder: lang === 'TR' ? 'Tutar Ara...' : 'Search Amount...',
    bondFilter:      lang === 'TR' ? '%0 Teminat' : '0% Bond',
    vol:             lang === 'TR' ? 'Toplam Hacim' : 'Total Volume',
    trades:          lang === 'TR' ? 'Başarılı İşlem' : 'Success Trades',
    users:           lang === 'TR' ? 'Aktif Kullanıcı' : 'Active Users',
    burn:            lang === 'TR' ? 'Eriyen Kasa' : 'Burned Treasury',
    tableSeller:     lang === 'TR' ? 'Order Sahibi' : 'Order Owner',
    tableRate:       lang === 'TR' ? 'Kur' : 'Rate',
    tableLimit:      lang === 'TR' ? 'Limit' : 'Limit',
    tableBond:       lang === 'TR' ? 'Bond' : 'Bond',
    tableAction:     lang === 'TR' ? 'İşlem' : 'Action',
    buyBtn:          lang === 'TR' ? 'Satın Al' : 'Buy',
    createAd:        lang === 'TR' ? '+ Order Aç' : '+ Create Order',
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
    sessionActions,
    orderForm,
    orderActions,
    tradeRoomActions,
    settlementActions,
    shellState,
    systemStatus,
    t,
    setLang,
    isConnected,
    isAuthenticated,
    isLoggingIn,
    isContractLoading,
    loadingText,
    isPaused,
    authChecked,
    currentView,
    setCurrentView,
    toggleSidebar,
    handleAuthAction,
    formatAddress,
    address,
    chainId,
    sidebarOpen,
    setSidebarOpen,
    setExpandedStatus,
    expandedStatus,
    filterTier1,
    setFilterTier1,
    filterToken,
    setFilterToken,
    searchAmount,
    setSearchAmount,
    filteredOrders,
    orders,
    activeEscrows,
    loading,
    SUPPORTED_TOKEN_ADDRESSES,
    onchainTokenMap,
    paymentRiskConfig,
    handleStartTrade,
    handleMint,
    isFaucetEnabled,
    isSupportedChainId,
    handleOpenMakerModal,
    handleUpdatePII,
    handleLogoutAndDisconnect,
    activeEscrowCounts,
    setShowProfileModal,
    setProfileTab,
    setConfirmDeleteId,
    activeTradesFilter,
    setActiveTradesFilter,
    setShowFeedbackModal,
    protocolStats,
    statsLoading,
    statsError,
    fetchStats,
    StatChange,
    userReputation,
    sybilStatus,
    walletAgeRemainingDays,
    takerFeeBps,
    socialLinks,
    faqItems,
    activeTrade,
    setActiveTrade,
    userRole,
    setUserRole,
    tradeState,
    setTradeState,
    resolvedTradeState,
    setCancelStatus,
    setChargebackAccepted,
    paymentIpfsHash,
    setPaymentIpfsHash,
    handleFileUpload,
    handleReportPayment,
    handleProposeCancel,
    cancelStatus,
    chargebackAccepted,
    handleChargebackAck,
    handleRelease,
    handleChallenge,
    handlePingMaker,
    handleAutoRelease,
    handleBurnExpired,
    canMakerPing,
    makerPingTimer,
    canMakerStartChallengeFlow,
    makerChallengePingTimer,
    canMakerChallenge,
    makerChallengeTimer,
    gracePeriodTimer,
    bleedingTimer,
    principalProtectionTimer,
    bleedingAmounts,
    takerName,
    tokenDecimalsMap,
    DEFAULT_TOKEN_DECIMALS,
    formatTokenAmountFromRaw,
    rawTokenToDisplayNumber,
    fetchMyTrades,
    setIsContractLoading,
    setLoadingText,
    getSafeTelegramUrl,
    authenticatedFetch,
    showToast,
    settlementContractFns,
  });

  const {
    renderWalletModal,
    renderFeedbackModal,
    renderMakerModal,
    renderProfileModal,
    renderTermsModal,
  } = buildAppModals({
    lang,
    sessionActions,
    orderForm,
    orderActions,
    profileActions,
    systemStatus,
    t,
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
    makerMaxLimit,
    setMakerMaxLimit,
    makerFiat,
    setMakerFiat,
    onchainBondMap,
    onchainTokenMap,
    paymentRiskConfig,
    userReputation,
    SUPPORTED_TOKEN_ADDRESSES,
    handleCreateOrder,
    makerValidationError,
    makerPayoutRiskEntry,
    isCreateTemporarilyDisabledByRisk,
    isContractLoading,
    setIsContractLoading,
    loadingText,
    showProfileModal,
    setShowProfileModal,
    profileTab,
    setProfileTab,
    isBanned,
    tradeHistory,
    historyLoading,
    tradeHistoryPage,
    setTradeHistoryPage,
    tradeHistoryTotal,
    tradeHistoryLimit,
    orders,
    myOrders,
    address,
    confirmDeleteId,
    setConfirmDeleteId,
    handleDeleteOrder,
    activeTradesFilter,
    setActiveTradesFilter,
    activeEscrows,
    setActiveTrade,
    setUserRole,
    setTradeState,
    setChargebackAccepted,
    setCurrentView,
    handleUpdatePII,
    payoutProfileDraft,
    setPayoutProfileDraft,
    canonicalizePayoutProfileDraft,
    SEPA_COUNTRIES,
    getSafeTelegramUrl,
    handleLogoutAndDisconnect,
    isConnected,
    isAuthenticated,
    termsAccepted,
    setTermsAccepted,
    connector,
    isRegisteringWallet,
    handleRegisterWallet,
    isWalletRegistered,
    sybilStatus,
    walletAgeRemainingDays,
    tokenDecimalsMap,
    DEFAULT_TOKEN_DECIMALS,
    formatTokenAmountFromRaw,
    showToast,
  });

  // ═══════════════════════════════════════════
  // 13. ANA RENDER
  //     Root layout: rail + sidebar + content + modals + toast
  // ═══════════════════════════════════════════
  return (
    <div className="flex flex-col h-screen bg-[#060608] text-slate-100 font-sans overflow-hidden selection:bg-emerald-500/30 pb-16 md:pb-0 relative">
      <AppShell
        status={systemStatus}
        navigation={renderSlimRail()}
        panel={renderContextSidebar()}
        mobileBottom={renderMobileNav()}
        outlet={(
          <div className="flex-1 overflow-y-auto relative bg-[#060608]">
            <div className="min-h-full flex flex-col pt-4 md:pt-10 pb-24 md:pb-10 items-center">
              {currentView === 'home'
                ? renderHome()
                : currentView === 'market'
                  ? renderMarket()
                  : currentView === 'operations'
                    ? renderOperations()
                    : currentView === 'profile'
                    ? renderProfileContext()
                    : currentView === 'uiLab' && uiLabEnabled
                    ? <UiLabPage />
                    : currentView === 'admin'
                    ? (
                      <AdminPanel
                        lang={lang}
                        authenticatedFetch={authenticatedFetch}
                        isAuthenticated={isAuthenticated}
                        authChecked={authChecked}
                        showToast={showToast}
                      />
                    )
                    : renderTradeRoom()}
              {renderFooter()}
            </div>
          </div>
        )}
        modals={(
          <>
            {renderWalletModal()}
            {renderFeedbackModal()}
            {renderMakerModal()}
            {renderProfileModal()}
            {renderTermsModal()}
          </>
        )}
      />

      <button
        onClick={() => setShowFeedbackModal(true)}
        title={lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}
        className="fixed top-5 right-5 md:top-6 md:right-6 z-40 h-11 px-4 bg-[#111113] hover:bg-[#1a1a1f] border border-[#222] rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold text-white shadow-[0_0_15px_rgba(0,0,0,0.45)] transition-transform hover:scale-[1.02] hover:border-slate-600"
      >
        <span>💬</span>
        <span>{lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}</span>
      </button>

      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:-translate-x-0 md:right-6 z-[100] animate-bounce-in w-[90%] sm:w-auto">
          <div className={`px-4 md:px-6 py-3 md:py-4 rounded-xl shadow-2xl border text-sm font-bold backdrop-blur-md text-center md:text-left ${toast.type === 'error' ? 'bg-[#1a0f0f]/90 border-red-900/50 text-red-400' : toast.type === 'info' ? 'bg-[#0a1a2a]/90 border-blue-900/50 text-blue-400' : 'bg-[#0a1a10]/90 border-emerald-900/50 text-emerald-400'}`}>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
