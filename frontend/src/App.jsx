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
import DevScenarioController from './dev/ui-lab/DevScenarioController';
import { isUiLabEnabled } from './dev/ui-lab/isUiLabEnabled';
import { createMockAdminFetch } from './dev/mocks/mockAdminFetch';
import { createMockDevScenarioFetch } from './dev/mocks/mockDevScenarioFetch';
import { createSetterAction, createTradeRoomActionCallbacks } from './dev/mocks/mockActions';
import { getInitialLang, getInitialTermsAccepted, APP_LANG_STORAGE_KEY } from './app/bootstrapState';
import { buildApiUrl, resolveApiPolicyDiagnostics } from './app/apiConfig';
import { getSupportedChainsMap, isMintTokenEnabled, isSupportedChainId } from './app/chainPolicy';
import { useMakerOrderForm } from './app/contexts/marketplace/useMakerOrderForm';
import { buildMintAction, buildOrderActions, buildProfileActions, buildStartTradeAction, buildTradeRoomActions } from './app/actions/contractLifecycleActions';

// [TR] Uygulama başlangıcında kritik env değişkenlerini doğrula
// [EN] Validate critical env variables on app start

const createDevScenarioFetch = (categoryKey, scenario, fallbackFetch) => {
  if (categoryKey === 'admin') return createMockAdminFetch(scenario);
  if (categoryKey) return createMockDevScenarioFetch(scenario);
  return fallbackFetch;
};


const buildDevScenarioEscrowCounts = (activeEscrows = []) => ({
  LOCKED: activeEscrows.filter((escrow) => escrow.state === 'LOCKED').length,
  PAID: activeEscrows.filter((escrow) => escrow.state === 'PAID').length,
  CHALLENGED: activeEscrows.filter((escrow) => escrow.state === 'CHALLENGED').length,
  settlement: {
    PROPOSED: activeEscrows.filter((escrow) => escrow.settlementProposal?.state === 'PROPOSED').length,
    ACTION_REQUIRED: activeEscrows.filter((escrow) => escrow.settlementProposal?.state === 'PROPOSED' && String(escrow.settlementProposal.proposer || '').toLowerCase() !== String(escrow.viewerAddress || escrow.takerFull || '').toLowerCase()).length,
    WAITING: activeEscrows.filter((escrow) => escrow.settlementProposal?.state === 'PROPOSED' && String(escrow.settlementProposal.proposer || '').toLowerCase() === String(escrow.viewerAddress || escrow.takerFull || '').toLowerCase()).length,
  },
});

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
  const initialView = 'home';
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
  const [devScenario, setDevScenario] = useState(null);
  const devScenarioSnapshotRef = React.useRef(null);
  const [profileContextTab, setProfileContextTab] = useState('account');
  const devScenarioActive = Boolean(uiLabEnabled && devScenario);

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
    setActiveEscrows,
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
    devScenarioActive,
  });

  const devScenarioActions = React.useMemo(() => {
    if (!devScenario) return null;
    const appendLog = devScenario.appendLog;
    const setter = (key) => createSetterAction({ scenarioId: devScenario.scenario.id, appendLog, actionKey: key });
    return {
      tradeRoom: createTradeRoomActionCallbacks({ scenarioId: devScenario.scenario.id, appendLog }),
      setter,
      noop: (actionKey) => (...args) => setter(actionKey)(...args),
    };
  }, [devScenario]);

  const activeScenarioCategory = devScenarioActive ? devScenario?.categoryKey : null;
  const activeScenarioPayload = devScenario?.scenario || null;

  const effectiveActiveEscrows = React.useMemo(() => {
    if (activeScenarioCategory === 'activeTrades' || activeScenarioCategory === 'operations') {
      return activeScenarioPayload?.activeEscrows || [];
    }
    return activeEscrows;
  }, [activeScenarioCategory, activeScenarioPayload, activeEscrows]);

  const effectiveActiveEscrowCounts = React.useMemo(() => {
    if (activeScenarioCategory === 'activeTrades' || activeScenarioCategory === 'operations') {
      return activeScenarioPayload?.activeEscrowCounts || buildDevScenarioEscrowCounts(effectiveActiveEscrows);
    }
    return activeEscrowCounts;
  }, [activeScenarioCategory, activeScenarioPayload, effectiveActiveEscrows, activeEscrowCounts]);

  const effectiveAuthenticatedFetch = React.useMemo(() => (
    devScenarioActive
      ? createDevScenarioFetch(devScenario.categoryKey, devScenario.scenario, authenticatedFetch)
      : authenticatedFetch
  ), [devScenarioActive, devScenario, authenticatedFetch]);
  const activeAdminFetch = effectiveAuthenticatedFetch;

  const effectiveIsAuthenticated = activeScenarioCategory === 'admin' ? true : isAuthenticated;
  const effectiveAuthChecked = activeScenarioCategory === 'admin' ? true : authChecked;

  const effectiveTradeScenarioInput = activeScenarioCategory === 'tradeRoom'
    ? (activeScenarioPayload?.decisionInput || {})
    : {};
  const effectiveActiveTrade = activeScenarioCategory === 'tradeRoom'
    ? (effectiveTradeScenarioInput.trade || activeTrade)
    : activeTrade;
  const effectiveResolvedTradeState = activeScenarioCategory === 'tradeRoom'
    ? (effectiveTradeScenarioInput.tradeState || effectiveTradeScenarioInput.trade?.state || resolvedTradeState)
    : resolvedTradeState;
  const effectiveUserRole = activeScenarioCategory === 'tradeRoom'
    ? (effectiveTradeScenarioInput.userRole || effectiveTradeScenarioInput.trade?.role || userRole)
    : userRole;
  const effectiveChargebackAccepted = activeScenarioCategory === 'tradeRoom'
    ? (effectiveTradeScenarioInput.chargebackAccepted ?? effectiveTradeScenarioInput.trade?.chargebackAcked ?? chargebackAccepted)
    : chargebackAccepted;
  const effectiveTradeTimers = activeScenarioCategory === 'tradeRoom'
    ? (effectiveTradeScenarioInput.timers || {})
    : {};
  const effectivePaymentIpfsHash = activeScenarioCategory === 'tradeRoom'
    ? (effectiveTradeScenarioInput.paymentIpfsHash || '')
    : paymentIpfsHash;

  const effectiveTradeDecisionInput = React.useMemo(() => {
    if (activeScenarioCategory !== 'tradeRoom') return null;
    const input = activeScenarioPayload?.decisionInput || {};
    return {
      trade: input.trade || activeTrade,
      tradeState: input.tradeState || input.trade?.state || resolvedTradeState,
      userRole: input.userRole || input.trade?.role || userRole,
      chargebackAccepted: input.chargebackAccepted ?? input.trade?.chargebackAcked ?? chargebackAccepted,
      paymentIpfsHash: input.paymentIpfsHash ?? paymentIpfsHash,
      timers: {
        gracePeriod: input.timers?.gracePeriod || gracePeriodTimer,
        makerPing: input.timers?.makerPing || makerPingTimer,
        makerChallengePing: input.timers?.makerChallengePing || makerChallengePingTimer,
        makerChallenge: input.timers?.makerChallenge || makerChallengeTimer,
        bleeding: input.timers?.bleeding || bleedingTimer,
        principalProtection: input.timers?.principalProtection || principalProtectionTimer,
      },
      isConnected: input.isConnected ?? isConnected,
      isAuthenticated: input.isAuthenticated ?? isAuthenticated,
      isSupportedChain: input.isSupportedChain ?? isSupportedChainId(chainId),
      isPaused: input.isPaused ?? isPaused,
      lang: input.lang || lang,
      canBurnExpired: input.canBurnExpired ?? false,
    };
  }, [activeScenarioCategory, activeScenarioPayload, activeTrade, resolvedTradeState, userRole, chargebackAccepted, paymentIpfsHash, gracePeriodTimer, makerPingTimer, makerChallengePingTimer, makerChallengeTimer, bleedingTimer, principalProtectionTimer, isConnected, isAuthenticated, chainId, isPaused, lang]);

  const effectiveActionCallbacks = activeScenarioCategory === 'tradeRoom'
    ? devScenarioActions?.tradeRoom
    : null;

  const operationsActionSetters = React.useMemo(() => {
    if (activeScenarioCategory !== 'operations' || !devScenarioActions) return null;
    return {
      setActiveTrade: devScenarioActions.setter('operations_set_active_trade'),
      setUserRole: devScenarioActions.setter('operations_set_user_role'),
      setTradeState: devScenarioActions.setter('operations_set_trade_state'),
      setChargebackAccepted: devScenarioActions.setter('operations_set_chargeback_accepted'),
      setCurrentView: devScenarioActions.setter('operations_set_current_view'),
      setSidebarOpen: devScenarioActions.setter('operations_set_sidebar_open'),
      setShowProfileModal: devScenarioActions.setter('operations_set_show_profile_modal'),
    };
  }, [activeScenarioCategory, devScenarioActions]);

  const applyDevScenario = React.useCallback((scenario) => {
    if (!uiLabEnabled || !scenario) return;
    const categoryKey = scenario.categoryKey || scenario.category;
    const appendLog = scenario.appendLog;
    if (!devScenarioSnapshotRef.current) {
      devScenarioSnapshotRef.current = {
        currentView,
        activeTrade,
        activeEscrows,
        tradeState,
        userRole,
        paymentIpfsHash,
        chargebackAccepted,
        activeTradesFilter,
        profileContextTab,
      };
    }
    setDevScenario({ categoryKey, scenarioId: scenario.id, scenario, appendLog });
    setShowProfileModal(false);
    setShowMakerModal(false);
    setSidebarOpen(false);

    if (categoryKey === 'tradeRoom') {
      const input = scenario.decisionInput || {};
      setActiveTrade(input.trade || null);
      setTradeState(input.tradeState || input.trade?.state || 'LOCKED');
      setUserRole(input.userRole || input.trade?.role || 'taker');
      setChargebackAccepted(Boolean(input.trade?.chargebackAcked ?? true));
      setCurrentView('tradeRoom');
      return;
    }

    if (categoryKey === 'activeTrades') {
      setActiveTradesFilter(scenario.initialFilter || 'ALL');
      setProfileContextTab('active');
      setCurrentView('profile');
      return;
    }

    if (categoryKey === 'operations') {
      setActiveTrade(null);
      setCurrentView('operations');
      return;
    }

    if (categoryKey === 'admin') {
      setCurrentView('admin');
    }
  }, [uiLabEnabled, currentView, activeTrade, activeEscrows, tradeState, userRole, paymentIpfsHash, chargebackAccepted, activeTradesFilter, profileContextTab, setActiveTrade, setTradeState, setUserRole, setChargebackAccepted, setCurrentView, setActiveTradesFilter, setProfileContextTab]);

  const clearDevScenario = React.useCallback(() => {
    const snapshot = devScenarioSnapshotRef.current;
    setDevScenario(null);
    if (snapshot) {
      setCurrentView(snapshot.currentView);
      setActiveTrade(snapshot.activeTrade);
      setActiveEscrows(snapshot.activeEscrows);
      setTradeState(snapshot.tradeState);
      setUserRole(snapshot.userRole);
      setPaymentIpfsHash(snapshot.paymentIpfsHash);
      setChargebackAccepted(snapshot.chargebackAccepted);
      setActiveTradesFilter(snapshot.activeTradesFilter);
      setProfileContextTab(snapshot.profileContextTab);
      devScenarioSnapshotRef.current = null;
    }
    showToast(lang === 'TR' ? 'Mock scenario kapatıldı.' : 'Mock scenario cleared.', 'info');
  }, [lang, showToast, setActiveTrade, setActiveEscrows, setTradeState, setUserRole, setPaymentIpfsHash, setChargebackAccepted, setCurrentView, setActiveTradesFilter, setProfileContextTab]);

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
    fillSellOrder: devScenarioActive ? devScenarioActions?.noop('fill_sell_order') : fillSellOrder,
    fillBuyOrder: devScenarioActive ? devScenarioActions?.noop('fill_buy_order') : fillBuyOrder,
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
    activeAdminFetch,
    showToast,
    setActiveTrade,
    setTradeState,
    setCancelStatus,
    setChargebackAccepted,
    devScenarioActive,
    devScenarioActions,
  ]);

  const tradeRoomActions = React.useMemo(() => buildTradeRoomActions({
    lang,
    activeTrade,
    activeEscrows: effectiveActiveEscrows,
    paymentIpfsHash: effectivePaymentIpfsHash,
    resolvedTradeState,
    chargebackAccepted,
    isContractLoading,
    canMakerStartChallengeFlow,
    canMakerChallenge,
    reportPayment: devScenarioActive ? devScenarioActions?.noop('report_payment') : reportPayment,
    signCancelProposal: devScenarioActive ? devScenarioActions?.noop('propose_cancel') : signCancelProposal,
    proposeOrApproveCancel: devScenarioActive ? devScenarioActions?.noop('propose_cancel') : proposeOrApproveCancel,
    releaseFunds: devScenarioActive ? devScenarioActions?.noop('release_funds') : releaseFunds,
    pingTakerForChallenge: devScenarioActive ? devScenarioActions?.noop('ping_taker_for_challenge') : pingTakerForChallenge,
    challengeTrade: devScenarioActive ? devScenarioActions?.noop('start_challenge') : challengeTrade,
    pingMaker: devScenarioActive ? devScenarioActions?.noop('ping_maker') : pingMaker,
    autoRelease: devScenarioActive ? devScenarioActions?.noop('auto_release') : autoRelease,
    burnExpired: devScenarioActive ? devScenarioActions?.noop('burn_expired') : burnExpired,
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
    setLoadingText,
  }), [
    lang,
    activeTrade,
    effectiveActiveEscrows,
    effectivePaymentIpfsHash,
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
    activeAdminFetch,
    showToast,
    fetchMyTrades,
    setActiveTrade,
    setTradeState,
    setPaymentIpfsHash,
    setCancelStatus,
    setChargebackAccepted,
    devScenarioActive,
    devScenarioActions,
  ]);

  const profileActions = React.useMemo(() => buildProfileActions({
    lang,
    isContractLoading,
    isRegisteringWallet,
    isWalletRegistered,
    payoutProfileDraft,
    requireSignedSessionForActiveWallet,
    authenticatedFetch: activeAdminFetch,
    canonicalizePayoutProfileDraft,
    registerWallet: devScenarioActive ? devScenarioActions?.noop('register_wallet') : registerWallet,
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
    activeAdminFetch,
    registerWallet,
    showToast,
    setIsRegisteringWallet,
    setIsWalletRegistered,
    devScenarioActive,
    devScenarioActions,
  ]);

  const orderActions = React.useMemo(() => buildOrderActions({
    lang,
    address,
    isContractLoading,
    requireSignedSessionForActiveWallet,
    fillSellOrder: devScenarioActive ? devScenarioActions?.noop('fill_sell_order') : fillSellOrder,
    fillBuyOrder: devScenarioActive ? devScenarioActions?.noop('fill_buy_order') : fillBuyOrder,
    createSellOrder: devScenarioActive ? devScenarioActions?.noop('create_sell_order') : createSellOrder,
    createBuyOrder: devScenarioActive ? devScenarioActions?.noop('create_buy_order') : createBuyOrder,
    cancelSellOrder: devScenarioActive ? devScenarioActions?.noop('cancel_sell_order') : cancelSellOrder,
    cancelBuyOrder: devScenarioActive ? devScenarioActions?.noop('cancel_buy_order') : cancelBuyOrder,
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
    devScenarioActive,
    devScenarioActions,
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
    activeEscrows: effectiveActiveEscrows,
    setActiveEscrows,
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
    activeEscrowCounts: effectiveActiveEscrowCounts,
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
    activeTrade: effectiveActiveTrade,
    setActiveTrade,
    userRole: effectiveUserRole,
    setUserRole,
    tradeState: effectiveResolvedTradeState,
    setTradeState,
    resolvedTradeState: effectiveResolvedTradeState,
    setCancelStatus,
    setChargebackAccepted,
    paymentIpfsHash: effectivePaymentIpfsHash,
    setPaymentIpfsHash,
    handleFileUpload,
    handleReportPayment,
    handleProposeCancel,
    cancelStatus,
    chargebackAccepted: effectiveChargebackAccepted,
    handleChargebackAck,
    handleRelease,
    handleChallenge,
    handlePingMaker,
    handleAutoRelease,
    handleBurnExpired,
    canMakerPing,
    makerPingTimer: effectiveTradeTimers.makerPing || makerPingTimer,
    canMakerStartChallengeFlow,
    makerChallengePingTimer: effectiveTradeTimers.makerChallengePing || makerChallengePingTimer,
    canMakerChallenge,
    makerChallengeTimer: effectiveTradeTimers.makerChallenge || makerChallengeTimer,
    gracePeriodTimer: effectiveTradeTimers.gracePeriod || gracePeriodTimer,
    bleedingTimer: effectiveTradeTimers.bleeding || bleedingTimer,
    principalProtectionTimer: effectiveTradeTimers.principalProtection || principalProtectionTimer,
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
    authenticatedFetch: effectiveAuthenticatedFetch,
    showToast,
    settlementContractFns,
    uiLabEnabled,
    devTradeDecisionInput: effectiveTradeDecisionInput,
    devTradeActionCallbacks: effectiveActionCallbacks,
    operationsActionSetters,
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
    activeEscrows: effectiveActiveEscrows,
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
    isAuthenticated: effectiveIsAuthenticated,
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
                    : currentView === 'admin'
                    ? (
                      <AdminPanel
                        lang={lang}
                        authenticatedFetch={effectiveAuthenticatedFetch}
                        isAuthenticated={effectiveIsAuthenticated}
                        authChecked={effectiveAuthChecked}
                        showToast={showToast}
                        initialTab={devScenarioActive && devScenario.categoryKey === 'admin' ? devScenario.scenario.initialTab : undefined}
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

      {uiLabEnabled && (
        <DevScenarioController
          activeScenario={devScenario}
          onApplyScenario={applyDevScenario}
          onClearScenario={clearDevScenario}
        />
      )}

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
