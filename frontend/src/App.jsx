import React, { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage, useChainId, usePublicClient } from 'wagmi';
import { SiweMessage } from 'siwe';
import { formatUnits } from 'viem';
import { useArafContract } from './hooks/useArafContract';
import PIIDisplay from './components/PIIDisplay';
import { buildAppViews } from './app/AppViews';
import { EnvWarningBanner, buildAppModals } from './app/AppModals';
import { useAppSessionData } from './app/useAppSessionData';
import AdminPanel from './AdminPanel';
import { getInitialLang, getInitialTermsAccepted, APP_LANG_STORAGE_KEY } from './app/bootstrapState';
import { resolveOrderActionFns, normalizeOrderSide, removeOrderByOnchainId, resolvePaymentRiskEntry } from './app/orderUiModel';
import { buildApiUrl } from './app/apiConfig';

// [TR] Uygulama başlangıcında kritik env değişkenlerini doğrula
// [EN] Validate critical env variables on app start
const ENV_ERRORS = [];
if (!import.meta.env.VITE_API_URL && import.meta.env.PROD) {
  ENV_ERRORS.push('VITE_API_URL tanımlı değil — yalnızca aynı origin /api proxy (frontend/vercel.json) varsa çağrılar çalışır');
}
if (import.meta.env.PROD && /^https?:\/\//i.test((import.meta.env.VITE_API_URL || '').trim())) {
  ENV_ERRORS.push('Production policy: external VITE_API_URL kapalı. Aynı origin /api proxy kullanın.');
}
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
const FEE_ON_TRANSFER_WARNING = {
  TR: 'Not: Fee-on-transfer / deflasyonist tokenlar desteklenmez.',
  EN: 'Note: Fee-on-transfer / deflationary tokens are not supported.',
};

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
  const [currentView, setCurrentView] = useState('home');
  const [showMakerModal, setShowMakerModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedStatus, setExpandedStatus] = useState(null);

  // [TR] Sidebar 5 sn otomatik kapanma timer referansı
  // [EN] Sidebar auto-close timer ref (resets on hover)
  const sidebarTimerRef = React.useRef(null);

  // [TR] Maker order formu state'leri (SELL/BUY side-aware)
  // [EN] Maker order form states (SELL/BUY side-aware)
  const [makerTier, setMakerTier]         = useState(1);
  const [makerAmount, setMakerAmount]     = useState('');
  const [makerRate, setMakerRate]         = useState('');
  const [makerMinLimit, setMakerMinLimit] = useState('');
  const [makerMaxLimit, setMakerMaxLimit] = useState('');
  const [makerFiat, setMakerFiat]         = useState('TRY');

  // [TR] Desteklenen token adresleri — .env üzerinden yönetilir
  // [EN] Supported token addresses — managed via .env
  const SUPPORTED_TOKENS = {
    USDT: { address: import.meta.env.VITE_USDT_ADDRESS || '', decimalsRequired: true },
    USDC: { address: import.meta.env.VITE_USDC_ADDRESS || '', decimalsRequired: true },
  };
  const SUPPORTED_TOKEN_ADDRESSES = Object.fromEntries(
    Object.entries(SUPPORTED_TOKENS).map(([symbol, meta]) => [symbol, meta.address])
  );
  const [makerToken, setMakerToken] = useState('USDT');
  const [makerSide, setMakerSide] = useState('SELL_CRYPTO');
  const [profileTab, setProfileTab] = useState('ayarlar');
  const [lang, setLang] = useState(getInitialLang);
  const [loadingText, setLoadingText] = useState('');
  const [isContractLoading, setIsContractLoading] = useState(false);
  const [connectedWallet, setConnectedWallet] = useState(null);
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

  React.useEffect(() => {
    setConnectedWallet(address?.toLowerCase?.() || null);
  }, [address]);

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

  // [TR] Sidebar'ı açar ve 5 sn sonra otomatik kapatır; hover timer'ı sıfırlar
  // [EN] Opens sidebar, auto-closes after 5s; hover resets the timer
  const openSidebar = () => {
    setSidebarOpen(true);
    if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
    sidebarTimerRef.current = setTimeout(() => setSidebarOpen(false), 5000);
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

  const hasSignedSessionForActiveWallet =
    Boolean(isConnected && connectedWallet && isAuthenticated && authenticatedWallet === connectedWallet);

  const requireSignedSessionForActiveWallet = React.useCallback(() => {
    if (!authChecked) {
      showToast(
        lang === 'TR'
          ? 'Oturum doğrulanıyor. Lütfen 1-2 saniye sonra tekrar deneyin.'
          : 'Session check in progress. Please try again in a moment.',
        'info'
      );
      return false;
    }
    if (hasSignedSessionForActiveWallet) return true;
    showToast(
      lang === 'TR'
        ? 'Aktif cüzdan için imzalı oturum yok. Lütfen yeniden giriş yapın.'
        : 'No signed session for the active wallet. Please sign in again.',
      'error'
    );
    return false;
  }, [authChecked, hasSignedSessionForActiveWallet, lang]);

  const handleLogoutAndDisconnect = async () => {
    await bestEffortBackendLogout();
    clearLocalSessionState({ navigateHome: true, closeModals: true });
    disconnect();
  };

  const getWalletIcon = (name) => {
    const n = name.toLowerCase();
    if (n.includes('metamask')) return '🦊';
    if (n.includes('okx')) return '🖤';
    if (n.includes('coinbase')) return '🔵';
    return '👛';
  };

  // ═══════════════════════════════════════════
  // 8. KİMLİK DOĞRULAMA FONKSİYONLARI
  //    SIWE login flow
  // ═══════════════════════════════════════════

  // [TR] EIP-4361 SIWE akışı: backend'den nonce alır, mesajı imzalar, doğrular.
  //      Domain ve nonce backend'den gelir — frontend'de hardcode edilmez.
  // [EN] EIP-4361 SIWE flow: fetches nonce from backend, signs message, verifies.
  //      Domain and nonce come from backend — never hardcoded on frontend.
  const loginWithSIWE = async () => {
    if (!address) return;
    try {
      setIsLoggingIn(true);
      showToast(lang === 'TR' ? 'Lütfen cüzdanınızdan imza isteğini onaylayın 🦊' : 'Please approve the signature request in your wallet 🦊', 'info');

      const nonceRes = await fetch(buildApiUrl(`auth/nonce?wallet=${address}`), { credentials: 'include' });
      if (!nonceRes.ok) {
        throw new Error('Nonce alınamadı');
      }
      const { nonce, siweDomain, siweUri } = await nonceRes.json();
      if (!siweDomain || !siweUri) {
        throw new Error('Backend SIWE konfigürasyonu eksik');
      }
      const resolvedSiweUri = siweUri;
      const resolvedSiweDomain = siweDomain;

      const siweMessage = new SiweMessage({
        domain:    resolvedSiweDomain,
        address,
        statement: 'Sign in to Araf Protocol to manage your trades and secure PII data.',
        uri:       resolvedSiweUri,
        version:   '1',
        chainId,
        nonce,
        issuedAt:  new Date().toISOString(),
      });
      const message = siweMessage.prepareMessage();
      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch(buildApiUrl('auth/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, signature }),
      });

      if (verifyRes.ok) {
        const verifyData = await verifyRes.json().catch(() => ({}));
        const verifiedWallet = verifyData?.wallet?.toLowerCase?.() || null;
        if (!verifiedWallet || verifiedWallet !== connectedWallet) {
          await bestEffortBackendLogout();
          clearLocalSessionState();
          throw new Error('Aktif cüzdan ile oturum cüzdanı eşleşmiyor');
        }
        setIsAuthenticated(true);
        setAuthenticatedWallet(verifiedWallet);
        showToast(lang === 'TR' ? 'Sisteme başarıyla giriş yapıldı! 🚀' : 'Successfully signed in! 🚀', 'success');
      } else {
        const data = await verifyRes.json().catch(() => ({}));
        throw new Error(data.error || 'Doğrulama başarısız');
      }
    } catch (error) {
      console.error('SIWE Error:', error);
      if (error.message?.includes('rejected') || error.message?.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İmza işlemi sizin tarafınızdan iptal edildi.' : 'Signature request was cancelled by you.', 'error');
      } else {
        showToast(lang === 'TR' ? 'Giriş başarısız oldu.' : 'Login failed.', 'error');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // ═══════════════════════════════════════════
  // 9. KONTRAT İŞLEM FONKSİYONLARI
  //    All on-chain transaction handlers
  // ═══════════════════════════════════════════

  // [TR] Test faucet'ı — SUPPORTED_TOKEN_ADDRESSES üzerinden token adresi alır
  //      (C-01: Variable shadowing ve yanlış env key düzeltildi)
  // [EN] Test faucet — resolves token address via SUPPORTED_TOKEN_ADDRESSES
  //      (C-01: Fixed variable shadowing and wrong env key)
  const handleMint = async (tokenName) => {
    if (!isConnected) {
      showToast(lang === 'TR' ? 'Önce cüzdanınızı bağlayın.' : 'Please connect your wallet first.', 'error');
      return;
    }
    try {
      setIsContractLoading(true);
      setLoadingText(lang === 'TR' ? `${tokenName} alınıyor...` : `Minting ${tokenName}...`);
      const tokenAddr = SUPPORTED_TOKEN_ADDRESSES[tokenName];
      if (!tokenAddr) throw new Error(lang === 'TR' ? `Test ${tokenName} adresi tanımlı değil.` : `Test ${tokenName} address not defined.`);
      await mintToken(tokenAddr);
      showToast(lang === 'TR' ? `✅ Test ${tokenName} başarıyla alındı!` : `✅ Test ${tokenName} minted successfully!`, 'success');
    } catch (err) {
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'İşlem başarısız.' : 'Transaction failed.');
      showToast(errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
      setLoadingText('');
    }
  };

  // [TR] Taker fill akışı (V3): order side'a göre fillSellOrder / fillBuyOrder seçilir.
  //      Frontend trade authority üretmez; parent order verisini kontrattan okur
  //      ve child trade kimliğini yalnız OrderFilled event'inden alır.
  // [EN] Taker fill flow (V3): select fillSellOrder / fillBuyOrder by order side.
  //      Frontend never authors trade authority; it reads parent order state from
  //      chain and derives child trade id only from OrderFilled event.
  const handleStartTrade = async (order) => {
  if (!window.confirm(lang === 'TR' ? 'İşlemi onaylıyor musunuz?' : 'Do you confirm the transaction?')) return;
  if (isBanned) {
    showToast(
      lang === 'TR'
        ? '🚫 Taker kısıtlamanız aktif. Süre için on-chain kaydınızı kontrol edin.'
        : '🚫 Taker restriction active. Check on-chain record for duration.',
      'error'
    );
    return;
  }
  if (!order.onchainId) {
    showToast(
      lang === 'TR'
          ? 'Bu order için on-chain ID henüz yok. Lütfen daha sonra tekrar deneyin.'
          : 'This order has no on-chain ID yet. Please try again later.',
      'error'
    );
    return;
  }
  if (isContractLoading) return;

  let tokenAddress = null;
  let didIncreaseAllowance = false;

  try {
    setIsContractLoading(true);
    tokenAddress = SUPPORTED_TOKEN_ADDRESSES[order.crypto || 'USDT'];

    if (!tokenAddress) {
      showToast(
        lang === 'TR'
          ? `${order.crypto} token adresi .env dosyasında tanımlı değil.`
          : `${order.crypto} token address not configured.`,
        'error'
      );
      return;
    }

    const onchainOrder = await getOrder(BigInt(order.onchainId));
    const orderRemaining = onchainOrder
      ? (typeof onchainOrder.remainingAmount !== 'undefined' ? onchainOrder.remainingAmount : onchainOrder[5])
      : 0n;
    const tokenFromChain = onchainOrder
      ? (typeof onchainOrder.tokenAddress !== 'undefined' ? onchainOrder.tokenAddress : onchainOrder[3])
      : null;

    const remainingAmountRaw = BigInt(orderRemaining || 0n);
    if (remainingAmountRaw <= 0n) {
      showToast(
        lang === 'TR'
          ? 'Order dolu veya geçersiz görünüyor. Lütfen listeyi yenileyin.'
          : 'Order appears filled/invalid. Please refresh order feed.',
        'error'
      );
      return;
    }
    // [TR] Minimal partial-fill altyapısı: order nesnesi fillAmountRaw sağlarsa kullan,
    //      yoksa mevcut davranışla remaining amount doldur.
    // [EN] Minimal partial-fill support: use order.fillAmountRaw if provided, else fill remaining.
    let fillAmountRaw = remainingAmountRaw;
    if (order.fillAmountRaw !== undefined && order.fillAmountRaw !== null && order.fillAmountRaw !== '') {
      try {
        const requested = BigInt(order.fillAmountRaw);
        if (requested > 0n && requested <= remainingAmountRaw) {
          fillAmountRaw = requested;
        }
      } catch (_) {
        // Geçersiz partial miktarda fail-closed yerine remaining fallback.
      }
    }

    const side = normalizeOrderSide(String(order.side || '').toUpperCase());
    if (side === 'UNKNOWN') {
      throw new Error(lang === 'TR' ? 'Geçersiz order side. İşlem başlatılamadı.' : 'Invalid order side. Cannot start trade.');
    }
    const { fillFn: fillOrderFn } = resolveOrderActionFns(side, { fillBuyOrder, fillSellOrder, createBuyOrder, createSellOrder, cancelBuyOrder, cancelSellOrder });
    if (tokenFromChain && tokenFromChain !== '0x0000000000000000000000000000000000000000') {
      tokenAddress = tokenFromChain;
    }

    // [TR] Frontend taker bond authority üretmez; bu hesap kontrata aittir.
    //      Approve için konservatif üst sınır kullanırız: fill amount * 2.
    // [EN] Frontend does not author taker-bond authority; contract does.
    //      For approve we use a conservative upper bound: fill amount * 2.
    const requiredAllowance = fillAmountRaw * 2n;

    const currentAllowance = await getAllowance(tokenAddress, address);
    if (currentAllowance < requiredAllowance) {
      setLoadingText(
        lang === 'TR'
          ? `Adım 1/2: ${order.crypto} izni veriliyor...`
          : `Step 1/2: Approving ${order.crypto}...`
      );
      await approveToken(tokenAddress, requiredAllowance);
      didIncreaseAllowance = true;
    }

    setLoadingText(
      lang === 'TR'
        ? 'Adım 2/2: Order fill işlemi gönderiliyor...'
        : 'Step 2/2: Submitting order fill...'
    );
    const childListingRef = `fill:${order.onchainId}:${Date.now()}:${Math.random()}`;
    const { keccak256, stringToHex } = await import('viem');
    const childRefHash = keccak256(stringToHex(childListingRef));
    const fillResult = await fillOrderFn(BigInt(order.onchainId), fillAmountRaw, childRefHash);
    const onchainTradeId = fillResult?.tradeId ? Number(fillResult.tradeId) : null;

    // [TR] Trade odası state'i order id ile değil child trade id ile açılmalıdır.
    //      Event decode edilemediyse belirsiz state ile devam etmeyip güvenli hata veririz.
    // [EN] Trade room state must be initialized with child trade id, not parent order id.
    //      If event decode fails, fail closed instead of continuing with ambiguous authority.
    if (!onchainTradeId) {
      throw new Error(
        lang === 'TR'
          ? 'OrderFilled eventinden child trade id okunamadı. Lütfen tekrar deneyin.'
          : 'Failed to read child trade id from OrderFilled event. Please retry.'
      );
    }

    // Backend trade kaydı listener gecikmesiyle gelebilir.
    // Bu yüzden birkaç deneme yapılır; gerçek trade ID yoksa sahte/fallback ID ile devam edilmez.
    let realTradeId = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await authenticatedFetch(buildApiUrl(`trades/by-escrow/${onchainTradeId}`));
        if (res.ok) {
          const data = await res.json();
          realTradeId = data.trade?._id;
          if (realTradeId) break;
        }
      } catch (_) {}
      if (attempt < 5) await new Promise(r => setTimeout(r, 2000));
    }

    if (!realTradeId) {
      showToast(
        lang === 'TR'
          ? '⚠️ İşlem zincire yazıldı ancak backend kaydı henüz oluşmadı. Birkaç saniye sonra "Aktif İşlemler" ekranını kontrol edin.'
          : '⚠️ Trade was written on-chain but backend record is not ready yet. Check "Active Trades" in a few seconds.',
        'info'
      );

      setActiveTrade({
        ...order,
        id: null,
        onchainId: onchainTradeId,
        _pendingBackendSync: true,
      });
      setTradeState('LOCKED');
      setCancelStatus(null);
      setChargebackAccepted(false);
      setCurrentView('tradeRoom');
      return;
    }

    setActiveTrade({ ...order, id: realTradeId, onchainId: onchainTradeId });
    setTradeState('LOCKED');
    setCancelStatus(null);
    setChargebackAccepted(false);
    setCurrentView('tradeRoom');
    showToast(lang === 'TR' ? '🔒 İşlem başarıyla kilitlendi!' : '🔒 Trade locked successfully!', 'success');
  } catch (err) {
    console.error('handleStartTrade error:', err);

    if (didIncreaseAllowance && tokenAddress) {
      try { await approveToken(tokenAddress, 0n); } catch (_) {}
    }

    const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'İşlem kilitlenemedi.' : 'Failed to lock trade.');
    if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
      showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
    } else {
      showToast(errorMessage, 'error');
    }
  } finally {
    setIsContractLoading(false);
    setLoadingText('');
  }
};

  // [TR] Dekont dosyasını backend'e yükler, dönen SHA-256 hash'ini paymentIpfsHash state'ine kaydeder.
  //      activeTrade.onchainId zorunlu — backend hangi trade'e ait olduğunu belirler.
  //      "ipfsHash" adı tarihsel; gerçekte AES-256-GCM şifreli verinin SHA-256 hash'idir.
  // [EN] Uploads receipt to backend, saves returned SHA-256 hash to paymentIpfsHash state.
  //      activeTrade.onchainId required — backend identifies which trade it belongs to.
  //      "ipfsHash" name is historical; actually SHA-256 of AES-256-GCM encrypted data.
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!activeTrade?.onchainId) {
      showToast(lang === 'TR' ? 'Aktif işlem bulunamadı.' : 'No active trade found.', 'error');
      return;
    }
    try {
      setIsContractLoading(true);
      const formData = new FormData();
      formData.append('receipt', file);
      // [TR] Backend'in doğru trade'i bulması için on-chain ID'yi gönder
      // [EN] Send on-chain ID so backend can identify the correct trade
      formData.append('onchainEscrowId', String(activeTrade.onchainId));
      const res = await fetch(buildApiUrl('receipts/upload'), {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.hash) {
        setPaymentIpfsHash(data.hash);
        showToast(lang === 'TR' ? 'Dekont şifrelendi ve yüklendi.' : 'Receipt encrypted and uploaded.', 'success');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Dekont yükleme hatası:', err);
      showToast(lang === 'TR' ? 'Dekont yüklenemedi.' : 'Failed to upload receipt.', 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  // [TR] Taker ödeme bildirimi: ipfsHash zorunlu, kontrata reportPayment() gönderilir
  // [EN] Taker payment report: ipfsHash required, calls reportPayment() on contract
  const handleReportPayment = async () => {
    if (!activeTrade?.onchainId) {
      showToast(lang === 'TR' ? 'On-chain işlem ID bulunamadı.' : 'On-chain trade ID not found.', 'error');
      return;
    }
    if (!paymentIpfsHash.trim()) {
      showToast(lang === 'TR' ? 'Önce bir dekont yüklemelisiniz.' : 'You must upload a receipt first.', 'error');
      return;
    }
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Ödeme bildirimi gönderiliyor... Cüzdanınızdan onaylayın.' : 'Reporting payment... Confirm in wallet.', 'info');
      await reportPayment(BigInt(activeTrade.onchainId), paymentIpfsHash.trim());
      setTradeState('PAID');
      setPaymentIpfsHash('');
      showToast(lang === 'TR' ? '✅ Ödeme bildirildi! 48 saatlik grace period başladı.' : '✅ Payment reported! 48h grace period started.', 'success');
    } catch (err) {
      console.error('handleReportPayment error:', err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Ödeme bildirimi başarısız.' : 'Payment report failed.');
      if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  };

  // [TR] Karşılıklı iptal akışı: EIP-712 imzası oluşturulur → backend relay → kontrat.
  //      sigNonces on-chain okunarak replay koruması sağlanır.
  //      Backend erişilemezse doğrudan kontrat çağrısına fallback yapılır.
  // [EN] Mutual cancel flow: creates EIP-712 signature → backend relay → contract.
  //      sigNonces read on-chain for replay protection.
  //      Falls back to direct contract call if backend is unreachable.
  const handleProposeCancel = async () => {
    if (!activeTrade?.onchainId) {
      showToast(lang === 'TR' ? 'On-chain işlem ID bulunamadı.' : 'On-chain trade ID not found.', 'error');
      return;
    }
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'İptal imzası oluşturuluyor...' : 'Creating cancel signature...', 'info');

      const { signature, deadline } = await signCancelProposal(activeTrade.onchainId);

      try {
        const relayRes = await authenticatedFetch(buildApiUrl('trades/propose-cancel'), {
          method: 'POST',
          body: JSON.stringify({ tradeId: activeTrade.id, signature, deadline }),
        });
        const relayData = await relayRes.json();
        if (relayData.bothSigned) {
          showToast(lang === 'TR' ? 'Her iki taraf imzaladı. Kontrata gönderiliyor...' : 'Both signed. Sending to contract...', 'info');
          await proposeOrApproveCancel(BigInt(activeTrade.onchainId), deadline, signature);
          setCancelStatus(null);
          setTradeState('CANCELED');
          setCurrentView('home');
          showToast(lang === 'TR' ? '✅ İşlem iptal edildi.' : '✅ Trade cancelled.', 'success');
        } else {
          setCancelStatus('proposed_by_me');
          showToast(lang === 'TR' ? '✅ İptal teklifi gönderildi. Karşı tarafın onayı bekleniyor.' : '✅ Cancel proposal sent. Awaiting counterparty.', 'success');
        }
      } catch (relayErr) {
        console.warn('[Cancel] Backend relay başarısız, direkt on-chain fallback:', relayErr.message);
        showToast(lang === 'TR' ? 'Backend erişilemez. Kontrata direkt gönderiliyor...' : 'Backend unreachable. Sending directly to contract...', 'info');
        await proposeOrApproveCancel(BigInt(activeTrade.onchainId), deadline, signature);
        setCancelStatus('proposed_by_me');
        showToast(lang === 'TR' ? '✅ İptal teklifi kontrata gönderildi (direkt).' : '✅ Cancel proposal sent directly to contract.', 'success');
      }
    } catch (err) {
      console.error('handleProposeCancel error:', err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'İptal teklifi başarısız.' : 'Cancel proposal failed.');
      if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  };

  // [TR] Geri bildirim gönderimi — JWT zorunlu, form sıfırlanır
  // [EN] Feedback submission — JWT required, form resets on success
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

  const handleChargebackAck = (checked) => { setChargebackAccepted(checked); };

  // [TR] Maker USDT'yi serbest bırakır (releaseFunds). PAID state'te chargeback onayı zorunlu.
  //      CHALLENGED state'te bu kontrol atlanır — sessiz başarısızlığı önler.
  //      (C-02: CHALLENGED state'te chargebackAccepted guard atlatılıyor)
  // [EN] Maker releases USDT (releaseFunds). Chargeback ack required in PAID state.
  //      Skipped in CHALLENGED state — prevents silent failure.
  //      (C-02: chargebackAccepted guard bypassed in CHALLENGED state)
  const handleRelease = async () => {
    if (resolvedTradeState === 'PAID' && !chargebackAccepted) {
      showToast(lang === 'TR' ? 'Lütfen ters ibraz riskini kabul edin.' : 'Please acknowledge the chargeback risk.', 'error');
      return;
    }
    if (!activeTrade?.onchainId) {
      showToast(lang === 'TR' ? 'On-chain işlem ID bulunamadı.' : 'On-chain trade ID not found.', 'error');
      return;
    }
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      try {
        await authenticatedFetch(buildApiUrl(`trades/${activeTrade.id}/chargeback-ack`), { method: 'POST' });
      } catch (err) {
        console.error('Backend chargeback-ack log hatası:', err);
      }
      showToast(lang === 'TR' ? 'İşlem cüzdanınıza gönderildi, onaylayın...' : 'Transaction sent to wallet, please confirm...', 'info');
      await releaseFunds(BigInt(activeTrade.onchainId));
      setTradeState('RESOLVED');
      setActiveTrade(null);
      setCancelStatus(null);
      setChargebackAccepted(false);
      setCurrentView('home');
      showToast(lang === 'TR' ? 'USDT başarıyla serbest bırakıldı! ✅' : 'USDT successfully released! ✅', 'success');
    } catch (err) {
      console.error('releaseFunds error:', err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Kontrat işlemi başarısız oldu.' : 'Contract transaction failed.');
      if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem sizin tarafınızdan iptal edildi.' : 'Transaction cancelled by you.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  };

  // [TR] İtiraz akışı iki adımlı: önce taker'a ping (pingTakerForChallenge), 24 saat
  //      sonra challengeTrade çağrısı yapılabilir. Her iki adım sonrası fetchMyTrades çağrılır.
  //      (H-04: fetchMyTrades eklendi — 15 sn polling beklenmeden UI güncellenir)
  // [EN] Two-step challenge flow: ping taker first (pingTakerForChallenge), then
  //      challengeTrade after 24h. fetchMyTrades called after both steps.
  //      (H-04: Added fetchMyTrades — UI updates without waiting for 15s polling)
  const handleChallenge = async () => {
    if (!activeTrade?.onchainId) return;
    if (isContractLoading) return;

    const tradeDetails = activeEscrows.find(e => e.id === `#${activeTrade.onchainId}`);
    const challengePingedAt = activeTrade?.challengePingedAt || tradeDetails?.challengePingedAt;

    if (!challengePingedAt && !canMakerStartChallengeFlow) {
      showToast(
        lang === 'TR'
          ? 'Ping için 24 saat dolmadan işlem gönderemezsiniz.'
          : 'You cannot ping before the 24-hour cooldown ends.',
        'error'
      );
      return;
    }
    if (challengePingedAt && !canMakerChallenge) {
      showToast(
        lang === 'TR'
          ? 'Resmi itiraz için ping sonrası 24 saat beklenmeli.'
          : 'You must wait 24h after ping before opening a challenge.',
        'error'
      );
      return;
    }

    if (!challengePingedAt) {
      try {
        setIsContractLoading(true);
        showToast(lang === 'TR' ? 'Alıcıya uyarı gönderiliyor...' : 'Pinging taker...', 'info');
        await pingTakerForChallenge(BigInt(activeTrade.onchainId));
        setActiveTrade(prev => ({ ...prev, challengePingedAt: new Date().toISOString() }));
        await fetchMyTrades();
        showToast(lang === 'TR' ? 'Alıcı uyarıldı. İtiraz için 24 saat beklemeniz gerekiyor.' : 'Taker pinged. You must wait 24h to challenge.', 'success');
      } catch (err) {
        console.error('pingTakerForChallenge error:', err);
        const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Uyarı gönderilemedi.' : 'Failed to send ping.');
        if (errorMessage.includes('ConflictingPingPath')) {
          showToast(lang === 'TR' ? 'Karşı taraf farklı bir uyarı/itiraz akışı başlattı. Bu yolu artık kullanamazsınız.' : 'Counterparty already started another ping/challenge path. This flow is no longer available.', 'error');
        } else {
          showToast(errorMessage, 'error');
        }
      } finally {
        setIsContractLoading(false);
      }
      return;
    }

    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'İtiraz işlemi cüzdanınıza gönderildi...' : 'Challenge transaction sent to wallet...', 'info');
      await challengeTrade(BigInt(activeTrade.onchainId));
      setTradeState('CHALLENGED');
      setActiveTrade(prev => ({ ...prev, challengedAt: new Date().toISOString() }));
      await fetchMyTrades();
      showToast(lang === 'TR' ? 'İtiraz başlatıldı. Bleeding Escrow aktif.' : 'Challenge opened. Bleeding Escrow active.', 'success');
    } catch (err) {
      console.error('challengeTrade error:', err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'İtiraz işlemi başarısız.' : 'Challenge failed.');
      if (errorMessage.includes('ConflictingPingPath')) {
        showToast(lang === 'TR' ? 'Karşı taraf farklı bir uyarı/itiraz akışı başlattı. Bu yolu artık kullanamazsınız.' : 'Counterparty already started another ping/challenge path. This flow is no longer available.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  };

  // [TR] Maker'a 48 saat sonra uyarı gönderir — taker tarafından çağrılır
  // [EN] Sends ping to maker after 48h — called by taker
  const handlePingMaker = async (tradeId) => {
    if (!tradeId || isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Uyarı işlemi cüzdanınıza gönderiliyor...' : 'Pinging maker, please confirm in wallet...', 'info');
      await pingMaker(BigInt(tradeId));
      setActiveTrade(prev => ({ ...prev, pingedAt: new Date().toISOString() }));
      showToast(lang === 'TR' ? 'Maker uyarıldı. Yanıt için 24 saati var.' : 'Maker has been pinged. They have 24h to respond.', 'success');
    } catch (err) {
      console.error('pingMaker error:', err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Ping işlemi başarısız oldu.' : 'Ping failed.');
      if (errorMessage.includes('ConflictingPingPath')) {
        showToast(lang === 'TR' ? 'Karşı taraf farklı bir uyarı/itiraz akışı başlattı. Bu yolu artık kullanamazsınız.' : 'Counterparty already started another ping/challenge path. This flow is no longer available.', 'error');
      } else if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  };

  // [TR] Maker pasif kalırsa taker 24 saat sonra autoRelease çağırabilir (%2 ihmal cezası kesilir)
  // [EN] If maker is passive, taker can call autoRelease after 24h (2% negligence penalty deducted)
  const handleAutoRelease = async (tradeId) => {
    if (!tradeId || isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Otomatik serbest bırakma işlemi cüzdanınıza gönderiliyor...' : 'Auto-release transaction sent to wallet...', 'info');
      await autoRelease(BigInt(tradeId));
      setTradeState('RESOLVED');
      setActiveTrade(null);
      setCancelStatus(null);
      setChargebackAccepted(false);
      setCurrentView('home');
      showToast(lang === 'TR' ? 'İşlem başarıyla sonlandırıldı. Fonlar cüzdanınıza aktarıldı.' : 'Trade successfully resolved. Funds transferred to your wallet.', 'success');
    } catch (err) {
      console.error('autoRelease error:', err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Otomatik serbest bırakma başarısız oldu.' : 'Auto-release failed.');
      if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  };

  // [TR] Kullanıcının payout profile + contact bilgisini V3 nested contract ile günceller.
  // [EN] Updates payout profile + contact with V3 nested contract payload.
  const handleUpdatePII = async (e) => {
    e.preventDefault();
    if (isContractLoading) return;
    if (!requireSignedSessionForActiveWallet()) return;
    try {
      setIsContractLoading(true);
      const res = await authenticatedFetch(buildApiUrl('auth/profile'), {
        method: 'PUT',
        body: JSON.stringify({
          payoutProfile: canonicalizePayoutProfileDraft(payoutProfileDraft),
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        throw new Error(lang === 'TR'
          ? 'Aktif trade varken payout profili değiştirilemez.'
          : 'Payout profile cannot be changed during active trades.');
      }
      if (!res.ok) throw new Error(data.error || 'Güncelleme başarısız oldu.');
      showToast(lang === 'TR' ? 'Ödeme profili güncellendi.' : 'Payout profile updated.', 'success');
    } catch (err) {
      console.error('PII update error:', err);
      showToast(err.message || (lang === 'TR' ? 'Profil güncelleme başarısız.' : 'Profile update failed.'), 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  // [TR] Telegram handle'ından güvenli URL oluşturur — özel karakter injection'ını önler
  // [EN] Builds safe Telegram URL from handle — prevents special character injection
  const getSafeTelegramUrl = React.useCallback((handle) => {
    if (!handle) return '#';
    const safeHandle = handle.replace(/[^a-zA-Z0-9_]/g, '');
    return `https://t.me/${safeHandle}`;
  }, []);

  // [TR] Yeni cüzdanı on-chain'e kaydeder — taker olabilmek için 7 günlük bekleme başlar
  // [EN] Registers new wallet on-chain — starts 7-day waiting period for taker eligibility
  const handleRegisterWallet = async () => {
    if (isRegisteringWallet || isWalletRegistered) return;
    try {
      setIsRegisteringWallet(true);
      showToast(lang === 'TR' ? 'Cüzdan kaydediliyor... Cüzdanınızdan onaylayın.' : 'Registering wallet... Confirm in wallet.', 'info');
      await registerWallet();
      setIsWalletRegistered(true);
      showToast(
        lang === 'TR'
          ? '✅ Cüzdan kaydedildi! 7 gün sonra Taker olarak işlem başlatabilirsiniz.'
          : '✅ Wallet registered! You can start as Taker after 7 days.',
        'success'
      );
    } catch (err) {
      console.error('handleRegisterWallet error:', err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Kayıt başarısız.' : 'Registration failed.');
      if (errorMessage.includes('AlreadyRegistered')) {
        setIsWalletRegistered(true);
        showToast(lang === 'TR' ? 'Cüzdan zaten kayıtlı.' : 'Wallet already registered.', 'info');
      } else if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsRegisteringWallet(false);
    }
  };

  const handleOpenMakerModal = () => {
    if (isPaused) {
      showToast(lang === 'TR' ? 'Sistem şu an bakım modundadır. Yeni order açılamaz.' : 'System is paused. Cannot create orders.', 'error');
      return;
    }
    if (!requireSignedSessionForActiveWallet()) return;
    setShowMakerModal(true);
    showToast(lang === 'TR' ? FEE_ON_TRANSFER_WARNING.TR : FEE_ON_TRANSFER_WARNING.EN, 'info');
  };

  // [TR] Maker order oluşturma (V3): approve() → createSellOrder().
  //      Backend hakemlik yapmaz; order authority kontrattadır.
  //      orderRef frontend tarafından deterministik/audit dostu hash olarak üretilir.
  // [EN] Maker order creation (V3): approve() -> createSellOrder().
  //      Backend is not an arbiter; order authority is on-chain.
  //      orderRef is generated client-side as an auditable deterministic hash.
const handleCreateOrder = async () => {
  if (!requireSignedSessionForActiveWallet()) return;

  const tokenMeta = SUPPORTED_TOKENS[makerToken];
  let tokenAddress = tokenMeta?.address;
  if (!tokenMeta?.decimalsRequired) {
    showToast(
      lang === 'TR'
        ? 'Token metadata eksik: decimals bilgisi zorunludur.'
        : 'Token metadata missing: decimals is required.',
      'error'
    );
    return;
  }
  if (!tokenAddress) {
    showToast(
      lang === 'TR'
        ? `${makerToken} token adresi .env dosyasında tanımlı değil (VITE_${makerToken}_ADDRESS).`
        : `${makerToken} token address not configured in .env (VITE_${makerToken}_ADDRESS).`,
      'error'
    );
    return;
  }

  const cryptoAmt = parseFloat(makerAmount);
  if (!cryptoAmt || cryptoAmt <= 0) {
      showToast(lang === 'TR' ? 'Geçerli bir miktar girin.' : 'Enter a valid amount.', 'error');
    return;
  }

  if (!makerRate || parseFloat(makerRate) <= 0) {
    showToast(lang === 'TR' ? 'Kur fiyatı girilmeli.' : 'Enter an exchange rate.', 'error');
    return;
  }

  if (isContractLoading) return;

  let didIncreaseAllowance = false;

  try {
    setIsContractLoading(true);

    const tokenDecimals = await getTokenDecimals(tokenAddress);
    const { parseUnits, keccak256, stringToHex } = await import('viem');
    const cryptoAmountRaw = parseUnits(String(cryptoAmt), tokenDecimals);

    // [TR] Frontend maker bond authority üretmez; kontrat authoritative hesap yapar.
    //      Approve aşamasında conservative upper-bound kullanırız: amount * 2.
    // [EN] Frontend does not author maker-bond authority; contract computes it.
    //      Use conservative upper-bound for approve: amount * 2.
    const requiredAllowance = cryptoAmountRaw * 2n;
    const rateNum = parseFloat(makerRate);
    const minFiat = parseFloat(makerMinLimit) || 0;
    const minFillUi = minFiat > 0 && rateNum > 0 ? (minFiat / rateNum) : cryptoAmt;
    const minFillAmountRaw = parseUnits(String(Math.max(0, minFillUi)), tokenDecimals);
    const boundedMinFill = minFillAmountRaw > cryptoAmountRaw ? cryptoAmountRaw : minFillAmountRaw;
    const orderRefSeed = `order:${address}:${makerToken}:${makerTier}:${cryptoAmountRaw.toString()}:${Date.now()}`;
    const orderRef = keccak256(stringToHex(orderRefSeed));

    const currentAllowance = await getAllowance(tokenAddress, address);
    if (currentAllowance < requiredAllowance) {
      setLoadingText(
        lang === 'TR'
          ? `Adım 1/2: ${makerToken} izni veriliyor...`
          : `Step 1/2: Approving ${makerToken}...`
      );
      await approveToken(tokenAddress, requiredAllowance);
      didIncreaseAllowance = true;
    }

    const normalizedSide = normalizeOrderSide(makerSide);
    if (normalizedSide === 'UNKNOWN') {
      throw new Error(lang === 'TR' ? 'Geçersiz order side. Order oluşturulamadı.' : 'Invalid order side. Order creation blocked.');
    }
    const { createFn } = resolveOrderActionFns(normalizedSide, { fillBuyOrder, fillSellOrder, createBuyOrder, createSellOrder, cancelBuyOrder, cancelSellOrder });
    const createLabel = normalizedSide === 'BUY_CRYPTO' ? 'Buy' : 'Sell';

    const canonicalPayoutProfile = canonicalizePayoutProfileDraft(payoutProfileDraft || {});
    const selectedRiskEntry = resolvePaymentRiskEntry({
      paymentRiskConfig: paymentRiskConfig || {},
      rail: canonicalPayoutProfile?.rail,
      country: canonicalPayoutProfile?.country,
    });
    const selectedPaymentRiskLevel = String(selectedRiskEntry?.riskLevel || 'MEDIUM').toUpperCase();

    setLoadingText(
      lang === 'TR'
        ? `Adım 2/2: ${createLabel} order oluşturuluyor...`
        : `Step 2/2: Creating ${createLabel.toLowerCase()} order...`
    );
    await createFn(tokenAddress, cryptoAmountRaw, boundedMinFill, makerTier, orderRef, selectedPaymentRiskLevel);

    showToast(
      lang === 'TR'
        ? `✅ ${createLabel} order başarıyla oluşturuldu.`
        : `✅ ${createLabel} order created successfully.`,
      'success'
    );

    setShowMakerModal(false);
    setMakerAmount('');
    setMakerRate('');
    setMakerMinLimit('');
    setMakerMaxLimit('');
    setMakerFiat('TRY');
    setMakerSide('SELL_CRYPTO');
  } catch (err) {
    console.error('handleCreateOrder error:', err);

    if (didIncreaseAllowance && tokenAddress) {
      try { await approveToken(tokenAddress, 0n); } catch (_) {}
    }

    let errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Order oluşturulamadı.' : 'Failed to create order.');
    if (errorMessage.includes('Efektif tier') || errorMessage.includes('effective tier')) {
      errorMessage += lang === 'TR'
        ? ' Not: Tier 1+ için ilk başarılı işlemden sonra 15 gün aktif dönem şartı da aranır.'
        : ' Note: Tier 1+ also requires a 15-day active period after first successful trade.';
    }

    if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
      showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
    } else {
      showToast(errorMessage, 'error');
    }
  } finally {
    setIsContractLoading(false);
    setLoadingText('');
  }
};

  // [TR] "Orderlarım" ekranından maker order'ını iptal eder.
  //      İptal authority'si kontrattadır; frontend yalnız side-aware cancel çağrısını tetikler.
  // [EN] Cancels maker order from "My Orders".
  //      Cancellation authority lives on-chain; frontend only triggers side-aware cancel calls.
  const handleDeleteOrder = async (order) => {
    if (order?.onchainId == null || isContractLoading) return;
    if (!requireSignedSessionForActiveWallet()) return;

    try {
      setIsContractLoading(true);

      showToast(
        lang === 'TR'
          ? 'Order zincirde iptal ediliyor... Cüzdanınızdan onaylayın.'
          : 'Cancelling order on-chain... Confirm in wallet.',
        'info'
      );
      const normalizedSide = normalizeOrderSide(order?.side);
      if (normalizedSide === 'UNKNOWN') {
        throw new Error(lang === 'TR' ? 'Geçersiz order side. İptal işlemi durduruldu.' : 'Invalid order side. Cancel blocked.');
      }
      const { cancelFn } = resolveOrderActionFns(normalizedSide, { fillBuyOrder, fillSellOrder, createBuyOrder, createSellOrder, cancelBuyOrder, cancelSellOrder });
      await cancelFn(BigInt(order.onchainId));

      setOrders(prev => removeOrderByOnchainId(prev, order.onchainId));
      setMyOrders(prev => removeOrderByOnchainId(prev, order.onchainId));
      setConfirmDeleteId(null);

      showToast(
        lang === 'TR' ? '✅ Order iptal edildi.' : '✅ Order canceled.',
        'success'
      );
    } catch (err) {
      console.error('handleDeleteOrder error:', err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Order iptal edilemedi.' : 'Failed to cancel order.');
      if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  };

  // [TR] Navbar auth butonu: bağlı değilse wallet modal, imzasızsa SIWE, imzalıysa profil açar
  // [EN] Navbar auth button: opens wallet modal if not connected, SIWE if unsigned, profile if signed
  const handleAuthAction = () => {
    if (isConnected && !authChecked) {
      showToast(
        lang === 'TR'
          ? 'Cüzdan oturumu doğrulanıyor. Lütfen bekleyin.'
          : 'Validating wallet session. Please wait.',
        'info'
      );
      return;
    }
    if (!isConnected) setShowWalletModal(true);
    else if (!isAuthenticated) loginWithSIWE();
    else { setProfileTab('ayarlar'); setShowProfileModal(true); }
  };

  // ─────────────────────────────────────────────
  // [TR] Çeviri sözlüğü — yalnızca pazar yeri ana metinleri
  // [EN] Translation dictionary — marketplace main labels only
  // ─────────────────────────────────────────────
  const FEEDBACK_MIN_LENGTH = 12;

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
    renderTradeRoom,
    renderSlimRail,
    renderContextSidebar,
    renderMobileNav,
    renderFooter,
  } = buildAppViews({
    lang,
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
    openSidebar,
    handleAuthAction,
    formatAddress,
    address,
    chainId,
    sidebarOpen,
    setSidebarOpen,
    setExpandedStatus,
    expandedStatus,
    sidebarTimerRef,
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
    handleOpenMakerModal,
    activeEscrowCounts,
    setShowProfileModal,
    setProfileTab,
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
    proposeSettlement,
    rejectSettlement,
    withdrawSettlement,
    expireSettlement,
    acceptSettlement,
  });

  const {
    renderWalletModal,
    renderFeedbackModal,
    renderMakerModal,
    renderProfileModal,
    renderTermsModal,
  } = buildAppModals({
    lang,
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
    <div className="flex flex-col md:flex-row h-screen bg-[#060608] text-slate-100 font-sans overflow-hidden selection:bg-emerald-500/30 pb-16 md:pb-0 relative">
      <EnvWarningBanner envErrors={ENV_ERRORS} />

      {isPaused && (
        <div className="absolute top-0 left-0 right-0 z-[70] bg-red-950/90 backdrop-blur border-b border-red-800 px-6 py-2 flex justify-center items-center shadow-xl">
          <span className="text-sm font-bold text-red-200">⚠️ {lang === 'TR' ? 'Sistem şu an bakım modundadır. Yeni işlem açılamaz.' : 'System is currently in maintenance mode. New trades cannot be opened.'}</span>
        </div>
      )}

      {isConnected && ![8453, 84532, 31337].includes(chainId) && (
        <div className="absolute top-0 left-0 right-0 z-[80] bg-red-950/95 backdrop-blur border-b border-red-800 px-6 py-2 flex justify-center items-center shadow-xl">
          <span className="text-sm font-bold text-red-200">⚠️ {lang === 'TR' ? 'Yanlış Ağ! Lütfen cüzdanınızdan Base Sepolia ağına geçin.' : 'Wrong Network! Please switch to Base Sepolia in your wallet.'}</span>
        </div>
      )}

      {isConnected && isWalletRegistered === false && (
        <div className="absolute top-0 left-0 right-0 z-[60] bg-orange-900/90 backdrop-blur border-b border-orange-700 px-6 py-2 flex justify-center items-center gap-4 shadow-xl">
          <span className="text-sm font-bold text-orange-200">⚠️ {lang === 'TR' ? 'Cüzdan On-Chain Kayıtlı Değil (Anti-Sybil 7 Gün)' : 'Wallet Not Registered (Anti-Sybil 7 Days)'}</span>
          <button onClick={handleRegisterWallet} disabled={isRegisteringWallet} className="bg-orange-500 text-black px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-400 disabled:opacity-50 transition">{isRegisteringWallet ? '⏳' : '📝 Kaydet'}</button>
        </div>
      )}
      {isConnected && isWalletRegistered === true && sybilStatus && sybilStatus.aged === false && (
        <div className="absolute top-0 left-0 right-0 z-[59] bg-orange-900/80 backdrop-blur border-b border-orange-700 px-6 py-2 flex justify-center items-center shadow-xl">
          <span className="text-xs font-bold text-orange-100">
            ⏳ {lang === 'TR'
              ? `Cüzdan kayıtlı ancak 7 günlük yaş şartı henüz dolmadı. Kalan süre: ~${walletAgeRemainingDays ?? '?'} gün.`
              : `Wallet is registered but the 7-day age requirement is not met yet. Remaining: ~${walletAgeRemainingDays ?? '?'} day(s).`}
          </span>
        </div>
      )}

      {renderSlimRail()}
      {renderContextSidebar()}
      {renderMobileNav()}

      <div className="flex-1 overflow-y-auto relative bg-[#060608]">
        <div className="min-h-full flex flex-col pt-4 md:pt-10 pb-24 md:pb-10 items-center">
          {currentView === 'home'
            ? renderHome()
            : currentView === 'market'
              ? renderMarket()
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

      {renderWalletModal()}
      {renderFeedbackModal()}
      {renderMakerModal()}
      {renderProfileModal()}
      {renderTermsModal()}

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
