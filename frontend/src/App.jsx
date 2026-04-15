import React, { useState, useEffect, useMemo } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage, useChainId, usePublicClient } from 'wagmi';
import { SiweMessage } from 'siwe';
import { formatUnits } from 'viem';
import { useArafContract } from './hooks/useArafContract';
import { useCountdown } from './hooks/useCountdown';
import PIIDisplay from './components/PIIDisplay';
import { buildAppViews } from './app/AppViews';
import { EnvWarningBanner, buildAppModals } from './app/AppModals';

// ─────────────────────────────────────────────
// [TR] API URL: DEV modunda localhost, prod'da VITE_API_URL zorunlu
// [EN] API URL: localhost in DEV, VITE_API_URL required in prod
// ─────────────────────────────────────────────
const API_URL = import.meta.env.VITE_API_URL || (
  import.meta.env.DEV ? 'http://localhost:4000' : ''
);

// [TR] Uygulama başlangıcında kritik env değişkenlerini doğrula
// [EN] Validate critical env variables on app start
const ENV_ERRORS = [];
if (!import.meta.env.VITE_API_URL && import.meta.env.PROD) {
  ENV_ERRORS.push('VITE_API_URL tanımlı değil — API çağrıları çalışmayacak');
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

const DEFAULT_TOKEN_DECIMALS = 6;

// [TR] Otoritatif raw base-unit değerini UI için normalize eder (display-only).
// [EN] Normalizes authoritative raw base-unit values for UI display only.
const formatTokenAmountFromRaw = (rawAmount, decimals = DEFAULT_TOKEN_DECIMALS, maxFractionDigits = 4) => {
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

  // [TR] Geliştirme / demo amaçlı trade state toggle'ları
  // [EN] Dev/demo trade state toggles
  const [tradeState, setTradeState] = useState('LOCKED');
  const [userRole, setUserRole] = useState('taker');
  const [isBanned, setIsBanned] = useState(false);
  const [cancelStatus, setCancelStatus] = useState(null);
  const [chargebackAccepted, setChargebackAccepted] = useState(false);


  // [TR] Maker ilan formu state'leri
  // [EN] Maker listing form states
  const [makerTier, setMakerTier]         = useState(1);
  const [makerAmount, setMakerAmount]     = useState('');
  const [makerRate, setMakerRate]         = useState('');
  const [makerMinLimit, setMakerMinLimit] = useState('');
  const [makerMaxLimit, setMakerMaxLimit] = useState('');
  const [makerFiat, setMakerFiat]         = useState('TRY');

  // [TR] Desteklenen token adresleri — .env üzerinden yönetilir
  // [EN] Supported token addresses — managed via .env
  const SUPPORTED_TOKEN_ADDRESSES = {
    USDT: import.meta.env.VITE_USDT_ADDRESS || '',
    USDC: import.meta.env.VITE_USDC_ADDRESS || '',
  };
  const [makerToken, setMakerToken] = useState('USDT');

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

  // [TR] Tüm kontrat metodları tek bir hook instance'ından alınır
  // [EN] All contract methods come from a single hook instance
  const {
    releaseFunds,
    challengeTrade,
    autoRelease,
    pingMaker,
    pingTakerForChallenge,
    lockEscrow,
    cancelOpenEscrow,
    signCancelProposal,
    proposeOrApproveCancel,
    getReputation,
    getCurrentAmounts,
    createEscrow,
    registerWallet,
    reportPayment,
    burnExpired,
    approveToken,
    getAllowance,
    getTokenDecimals,
    getTrade,
    getPaused,
    decayReputation,
    antiSybilCheck,
    getCooldownRemaining,
    getWalletRegisteredAt,
    getTakerFeeBps,
    mintToken,
    getFirstSuccessfulTradeAt,
  } = useArafContract();

  // ═══════════════════════════════════════════
  // 3. KİMLİK DOĞRULAMA STATE'LERİ
  //    Auth + wallet registration status
  // ═══════════════════════════════════════════
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticatedWallet, setAuthenticatedWallet] = useState(null);

  // [TR] Cüzdan on-chain kayıt durumu — null: bilinmiyor, true/false: kayıtlı/değil
  // [EN] Wallet on-chain registration status — null: unknown, true/false: registered/not
  const [isWalletRegistered, setIsWalletRegistered] = useState(null);
  const [isRegisteringWallet, setIsRegisteringWallet] = useState(false);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const authenticatedWalletRef = React.useRef(null);
  const pendingTxCheckedRef = React.useRef(false);
  const autoTradeResumeRef = React.useRef(false);
  const connectedWallet = address?.toLowerCase() || null;

  // [TR] Kontrat işlemleri sırasında çift tıklamayı önleme ve iki aşamalı UX için
  // [EN] Prevents double-clicks during contract tx; shows two-phase loading text
  const [isContractLoading, setIsContractLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  // ═══════════════════════════════════════════
  // 4. KULLANICI TERCİHLERİ VE VERİ STATE'LERİ
  //    Language, filters, PII form, reputation
  // ═══════════════════════════════════════════
  const [lang, setLang] = useState('EN');
  const [filterTier1, setFilterTier1] = useState(false);
  const [filterToken, setFilterToken] = useState('ALL');
  const [activeTradesFilter, setActiveTradesFilter] = useState('ALL');
  const [searchAmount, setSearchAmount] = useState('');
  const [profileTab, setProfileTab] = useState('ayarlar');

  const [userReputation, setUserReputation] = useState(null);
  const [piiBankOwner, setPiiBankOwner] = useState('');
  const [piiIban, setPiiIban] = useState('');
  const [piiTelegram, setPiiTelegram] = useState('');

  const [tradeHistory, setTradeHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [tradeHistoryPage, setTradeHistoryPage] = useState(1);
  const [tradeHistoryTotal, setTradeHistoryTotal] = useState(0);
  const [tradeHistoryLimit, setTradeHistoryLimit] = useState(10);

  // [TR] Aktif işlem ve ödeme kanıtı hash state'leri
  // [EN] Active trade and payment proof hash states
  const [activeTrade, setActiveTrade] = useState(null);
  // [TR] Trade room render state'i için tekil kaynak:
  //      activeTrade.state varsa önceliklidir; yoksa local tradeState kullanılır.
  // [EN] Single source for trade-room render state:
  //      prefer activeTrade.state, fallback to local tradeState.
  const resolvedTradeState = activeTrade?.state || tradeState;
  const [paymentIpfsHash, setPaymentIpfsHash] = useState('');

  const [sybilStatus, setSybilStatus] = useState(null);
  const [walletAgeRemainingDays, setWalletAgeRemainingDays] = useState(null);
  const [takerName, setTakerName] = useState('');

  const [isPaused, setIsPaused] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(localStorage.getItem('araf_terms_accepted') === 'true');

  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackCategory, setFeedbackCategory] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  // [TR] Protokol istatistikleri — /api/stats endpoint'inden çekilir
  // [EN] Protocol stats — fetched from /api/stats endpoint
  const [protocolStats, setProtocolStats] = useState(null);
  const [statsLoading, setStatsLoading]   = useState(true);
  const [statsError, setStatsError] = useState(false);

  // [TR] On-chain bond oranları — tier bazında maker/taker BPS değerleri
  // [EN] On-chain bond rates — maker/taker BPS values per tier
  const [onchainBondMap, setOnchainBondMap] = useState(null);
  const [takerFeeBps, setTakerFeeBps] = useState(10);
  const [tokenDecimalsMap, setTokenDecimalsMap] = useState({ USDT: DEFAULT_TOKEN_DECIMALS, USDC: DEFAULT_TOKEN_DECIMALS });

  // [TR] CHALLENGED aşamasında teminat erime miktarları
  // [EN] Collateral decay amounts in CHALLENGED phase
  const [bleedingAmounts, setBleedingAmounts] = useState(null);

  const [orders, setOrders] = useState([]);
  const [activeEscrows, setActiveEscrows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // ═══════════════════════════════════════════
  // 5. VERİ ÇEKME: API ÇAĞRILARI VE POLLİNG
  //    All data fetching effects and callbacks
  // ═══════════════════════════════════════════

  // [TR] Protokol yapılandırması (bond oranları) — uygulama başlangıcında bir kez çekilir
  // [EN] Protocol config (bond rates) — fetched once on app start
  useEffect(() => {
    fetch(`${API_URL}/api/listings/config`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.bondMap) setOnchainBondMap(data.bondMap);
      })
      .catch(err => console.error('[ProtocolConfig] fetch failed:', err));
  }, []);

  // [TR] Protokol ücretini kontrattan dinamik okur (fee drift önleme)
  // [EN] Reads protocol fee dynamically from contract (prevents fee drift)
  useEffect(() => {
    if (!getTakerFeeBps) return;
    const fetchFeeBps = async () => {
      try {
        const fee = await getTakerFeeBps();
        setTakerFeeBps(Number(fee));
      } catch (_) {}
    };
    fetchFeeBps();
  }, [getTakerFeeBps]);

  useEffect(() => {
    const loadTokenDecimals = async () => {
      try {
        const [usdtDecimals, usdcDecimals] = await Promise.all([
          SUPPORTED_TOKEN_ADDRESSES.USDT ? getTokenDecimals(SUPPORTED_TOKEN_ADDRESSES.USDT) : DEFAULT_TOKEN_DECIMALS,
          SUPPORTED_TOKEN_ADDRESSES.USDC ? getTokenDecimals(SUPPORTED_TOKEN_ADDRESSES.USDC) : DEFAULT_TOKEN_DECIMALS,
        ]);
        setTokenDecimalsMap({
          USDT: Number.isFinite(usdtDecimals) ? usdtDecimals : DEFAULT_TOKEN_DECIMALS,
          USDC: Number.isFinite(usdcDecimals) ? usdcDecimals : DEFAULT_TOKEN_DECIMALS,
        });
      } catch {
        setTokenDecimalsMap({ USDT: DEFAULT_TOKEN_DECIMALS, USDC: DEFAULT_TOKEN_DECIMALS });
      }
    };
    if (getTokenDecimals) loadTokenDecimals();
  }, [getTokenDecimals, SUPPORTED_TOKEN_ADDRESSES.USDT, SUPPORTED_TOKEN_ADDRESSES.USDC]);

  // [TR] CHALLENGED aşamasında bleeding escrow decay miktarlarını her 30 sn'de günceller
  // [EN] Updates bleeding escrow decay amounts every 30s during CHALLENGED phase
  useEffect(() => {
    if (resolvedTradeState !== 'CHALLENGED' || !activeTrade?.onchainId || !getCurrentAmounts) {
      setBleedingAmounts(null);
      return;
    }
    const fetchAmounts = async () => {
      const result = await getCurrentAmounts(activeTrade.onchainId);
      if (result) setBleedingAmounts(result);
    };
    fetchAmounts();
    const interval = setInterval(fetchAmounts, 30000);
    return () => clearInterval(interval);
  }, [resolvedTradeState, activeTrade?.onchainId, getCurrentAmounts]);

  const clearLocalSessionState = React.useCallback(() => {
    setIsAuthenticated(false);
    setAuthenticatedWallet(null);
    authenticatedWalletRef.current = null;
    setShowMakerModal(false);
    setShowProfileModal(false);
    setCurrentView('home');
    setActiveTrade(null);
    setActiveEscrows([]);
    setCancelStatus(null);
    setChargebackAccepted(false);
    setPaymentIpfsHash('');
    setIsLoggingIn(false);
    setIsContractLoading(false);
    setLoadingText('');
    pendingTxCheckedRef.current = false;
    autoTradeResumeRef.current = false;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('araf_pending_tx');
    }
  }, []);

  const bestEffortBackendLogout = React.useCallback(async () => {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (_) {}
  }, []);

  // [TR] HTTP-Only Cookie tabanlı kimlik doğrulamalı fetch wrapper.
  //      401 alırsa refresh token ile yeniler, başarısızsa oturumu sona erdirir.
  // [EN] Cookie-based authenticated fetch wrapper.
  //      On 401, attempts token refresh; on failure, ends the session.
  const authenticatedFetch = React.useCallback(async (url, options = {}) => {
  const walletHeader = connectedWallet ? { 'x-wallet-address': connectedWallet } : {};
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      ...walletHeader,
    },
    credentials: 'include',
  });

  // Wallet mismatch yalnız UI temizliği değildir.
  // Önce backend session'ı kapatmayı dener, sonra local state temizlenir.
  if (res.status === 409) {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (_) {
      // Logout başarısız olsa bile local session yine temizlenir.
    }

    clearLocalSessionState();
    showToast(
      lang === 'TR'
        ? 'Oturum cüzdan uyuşmazlığı nedeniyle sonlandırıldı. Lütfen yeniden giriş yapın.'
        : 'Session ended due to wallet mismatch. Please sign in again.',
      'error'
    );
    return res;
  }

  if (res.status !== 401) return res;

  try {
    const refreshRes = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ wallet: address?.toLowerCase() }),
    });

    if (!refreshRes.ok) {
      console.warn('[Auth] Refresh token expired — re-login required');
      clearLocalSessionState();
      showToast(
        lang === 'TR'
          ? 'Oturumunuz sona erdi. Lütfen tekrar imzalayın.'
          : 'Session expired. Please sign in again.',
        'error'
      );
      return res;
    }

    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        ...walletHeader,
      },
      credentials: 'include',
    });
  } catch (err) {
    console.error('[Auth] Refresh failed:', err);
    return res;
  }
}, [connectedWallet, address, lang, clearLocalSessionState]);

  // [TR] Sayfa yüklendiğinde mevcut oturumu kontrol eder
  // [EN] Checks existing session on page load
  useEffect(() => {
  if (!isConnected || !connectedWallet) {
    clearLocalSessionState();
    setAuthChecked(true);
    return;
  }

  fetch(`${API_URL}/api/auth/me`, {
    credentials: 'include',
    headers: { 'x-wallet-address': connectedWallet },
  })
    .then(async (res) => {
      // Backend mismatch'i açıkça 409 ile bildirirse bunu sessizce restore etmeyiz.
      if (res.status === 409) {
        clearLocalSessionState();
        setAuthChecked(true);
        showToast(
          lang === 'TR'
            ? 'Oturum cüzdanınızla eşleşmiyor. Lütfen yeniden giriş yapın.'
            : 'Session does not match your wallet. Please sign in again.',
          'info'
        );
        return;
      }

      if (!res.ok) {
        clearLocalSessionState();
        setAuthChecked(true);
        return;
      }

      const data = await res.json().catch(() => ({}));
      const sessionWallet = data?.wallet?.toLowerCase?.() || null;

      // Session yalnız exact wallet match varsa geçerli kabul edilir.
      if (!sessionWallet) {
        await bestEffortBackendLogout();
        clearLocalSessionState();
        setAuthChecked(true);
        return;
      }

      if (sessionWallet !== connectedWallet) {
        await bestEffortBackendLogout();
        clearLocalSessionState();
        showToast(
          lang === 'TR'
            ? 'Bağlı cüzdan oturumla eşleşmiyor. Lütfen yeniden imzalayın.'
            : 'Connected wallet does not match session. Please sign in again.',
          'info'
        );
        setAuthChecked(true);
        return;
      }

      setIsAuthenticated(true);
      setAuthenticatedWallet(sessionWallet);
      authenticatedWalletRef.current = sessionWallet;
      setAuthChecked(true);
    })
    .catch(() => {
      clearLocalSessionState();
      setAuthChecked(true);
    });
}, [isConnected, connectedWallet, clearLocalSessionState, bestEffortBackendLogout, lang]);

  // [TR] Pazar yeri ilanlarını çeker — herkese açık endpoint
  // [EN] Fetches marketplace listings — public endpoint
  useEffect(() => {
    const fetchListings = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/listings`, { credentials: 'include' });
        const data = await res.json();
        if (data.listings) {
          setOrders(data.listings.map(l => ({
            id:          l._id,
            onchainId:   l.onchain_escrow_id || null,
            makerFull:   l.maker_address,
            maker:       formatAddress(l.maker_address),
            crypto:      l.crypto_asset || 'USDT',
            fiat:        l.fiat_currency || 'TRY',
            rate:        l.exchange_rate,
            min:         l.limits?.min || 0,
            max:         l.limits?.max || 0,
            tier:        l.tier_rules?.required_tier ?? 1,
            bond:        (l.tier_rules?.maker_bond_pct ?? 0) + '%',
            successRate: 100,
            txCount:     0,
          })));
        }
      } catch (err) {
        console.error('Listing fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchListings();
  }, [lang]);

  // [TR] Protokol istatistiklerini çeker — retry butonu için useCallback ile sarıldı
  // [EN] Fetches protocol stats — wrapped in useCallback for retry button access
  const fetchStats = React.useCallback(async () => {
    try {
      setStatsError(false);
      setStatsLoading(true);
      const res  = await fetch(`${API_URL}/api/stats`, { credentials: 'include' });
      const data = await res.json();
      if (data.stats) setProtocolStats(data.stats);
      else setStatsError(true);
    } catch (err) {
      console.error('Stats fetch error:', err);
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // [TR] Cüzdan bağlandığında on-chain kayıt durumunu kontrol eder
  // [EN] Checks on-chain wallet registration status when wallet connects
  useEffect(() => {
    if (!isConnected || !address || !getWalletRegisteredAt) {
      setIsWalletRegistered(null);
      setWalletAgeRemainingDays(null);
      return;
    }
    const checkRegistration = async () => {
      try {
        const regAt = await getWalletRegisteredAt(address);
        setIsWalletRegistered(regAt > 0n);
        if (regAt > 0n) {
          const nowSec = Math.floor(Date.now() / 1000);
          const remainingSec = Math.max(0, Number(regAt) + 7 * 24 * 3600 - nowSec);
          setWalletAgeRemainingDays(Math.ceil(remainingSec / (24 * 3600)));
        } else {
          setWalletAgeRemainingDays(null);
        }
      } catch {
        setIsWalletRegistered(null);
        setWalletAgeRemainingDays(null);
      }
    };
    checkRegistration();
  }, [isConnected, address, getWalletRegisteredAt]);

  // [TR] Kullanıcının on-chain itibar verisini ve efektif tier'ını çeker
  // [EN] Fetches user's on-chain reputation data and effective tier
  useEffect(() => {
    if (!isConnected || !address || !getReputation) {
      setUserReputation(null);
      return;
    }
    const fetchUserReputation = async () => {
      try {
        const repData = await getReputation(address);
        const successful     = typeof repData.successful     !== 'undefined' ? repData.successful     : repData[0];
        const failed         = typeof repData.failed         !== 'undefined' ? repData.failed         : repData[1];
        const bannedUntil    = typeof repData.bannedUntil    !== 'undefined' ? repData.bannedUntil    : repData[2];
        const consecutiveBans= typeof repData.consecutiveBans!== 'undefined' ? repData.consecutiveBans: repData[3];
        const effectiveTier  = typeof repData.effectiveTier  !== 'undefined' ? repData.effectiveTier  : repData[4];
        const firstTradeAt   = getFirstSuccessfulTradeAt ? await getFirstSuccessfulTradeAt(address) : 0n;

        setUserReputation({
          successful: Number(successful),
          failed: Number(failed),
          bannedUntil: Number(bannedUntil),
          consecutiveBans: Number(consecutiveBans),
          effectiveTier: Number(effectiveTier),
          firstSuccessfulTradeAt: Number(firstTradeAt),
        });
        setIsBanned(Number(bannedUntil) > Date.now() / 1000);
      } catch (err) {
        console.error('Kullanıcı itibar verisi çekilemedi:', err);
      }
    };
    fetchUserReputation();
  }, [isConnected, address, getReputation, getFirstSuccessfulTradeAt]);

  // [TR] Anti-Sybil cooldown ve bakiye durumunu her 30 sn'de kontrol eder
  // [EN] Checks anti-sybil cooldown and balance status every 30s
  useEffect(() => {
    if (!isConnected || !address || !antiSybilCheck) return;
    const fetchSybil = async () => {
      const res = await antiSybilCheck(address);
      if (res) {
        const cooldownOk = typeof res.cooldownOk !== 'undefined' ? res.cooldownOk : res[2];
        const remaining = (!cooldownOk && getCooldownRemaining) ? await getCooldownRemaining(address) : 0n;
        setSybilStatus({
          aged:              typeof res.aged !== 'undefined' ? res.aged : res[0],
          funded:            typeof res.balanceOk   !== 'undefined' ? res.balanceOk   : (typeof res.funded       !== 'undefined' ? res.funded       : res[1]),
          cooldownOk,
          cooldownRemaining: Number(remaining),
        });
      }
    };
    fetchSybil();
    const interval = setInterval(fetchSybil, 30000);
    return () => clearInterval(interval);
  }, [isConnected, address, antiSybilCheck, getCooldownRemaining]);

  // [TR] Kontratın bakım/paused durumunu her 60 sn'de kontrol eder
  // [EN] Checks contract paused/maintenance status every 60s
  useEffect(() => {
    if (!getPaused) return;
    const fetchPausedStatus = async () => {
      try {
        const paused = await getPaused();
        setIsPaused(paused);
      } catch (err) {
        console.error('Paused durumu çekilemedi:', err);
      }
    };
    fetchPausedStatus();
    const interval = setInterval(fetchPausedStatus, 60000);
    return () => clearInterval(interval);
  }, [getPaused]);

  // [TR] Üçgen dolandırıcılık önlemi: trade odasında maker için taker'ın banka sahibi adını çeker
  // [EN] Triangulation fraud prevention: fetches taker's bank owner name for maker in trade room
  useEffect(() => {
    if (currentView === 'tradeRoom' && ['LOCKED', 'PAID', 'CHALLENGED'].includes(resolvedTradeState) && userRole === 'maker' && activeTrade?.id && isAuthenticated) {
      authenticatedFetch(`${API_URL}/api/pii/taker-name/${activeTrade.onchainId}`)
        .then(res => res.json())
        .then(data => { if (data.bankOwner) setTakerName(data.bankOwner); })
        .catch(err => console.error('Taker name fetch error', err));
    }
  }, [currentView, resolvedTradeState, userRole, activeTrade?.onchainId, activeTrade?.id, isAuthenticated, authenticatedFetch]);

  // [TR] Polling/geçiş yarışlarında tradeState ile activeTrade.state ayrışmasını kapatır.
  // [EN] Prevents drift between tradeState and activeTrade.state during polling/races.
  useEffect(() => {
    if (activeTrade?.state && activeTrade.state !== tradeState) {
      setTradeState(activeTrade.state);
    }
  }, [activeTrade?.state, tradeState]);

  // [TR] Kullanıcının aktif işlemlerini çeker. İlk yüklemede ve polling'de kullanılır.
  //      activeTrade'i her döngüde güncelleyerek zamanlayıcı tutarlılığını sağlar.
  // [EN] Fetches user's active trades. Used on initial load and polling.
  //      Updates activeTrade each cycle to keep timers consistent.
  const fetchMyTrades = React.useCallback(async () => {
  if (!isAuthenticated || !isConnected) {
    setActiveEscrows([]);
    return;
  }

  try {
    const res = await authenticatedFetch(`${API_URL}/api/trades/my`);
    const data = await res.json();

    if (data.trades) {
      setActiveEscrows(data.trades.map(t => {
        const cryptoAmtRaw = t.financials?.crypto_amount || "0";
        const cryptoAsset = t.financials?.crypto_asset || 'USDT';
        const tokenDecimals = tokenDecimalsMap[cryptoAsset] ?? DEFAULT_TOKEN_DECIMALS;
        const cryptoAmtNum = rawTokenToDisplayNumber(cryptoAmtRaw, tokenDecimals);
        const rate = t.financials?.exchange_rate || 1;
        const fiatAmt = cryptoAmtNum * rate;

        return {
          id: `#${t.onchain_escrow_id}`,
          role: t.maker_address.toLowerCase() === address?.toLowerCase() ? 'maker' : 'taker',
          counterparty: formatAddress(
            t.maker_address.toLowerCase() === address?.toLowerCase()
              ? (t.taker_address || '')
              : t.maker_address
          ),
          state: t.status,
          paidAt: t.timers?.paid_at,
          lockedAt: t.timers?.locked_at,
          pingedAt: t.timers?.pinged_at,
          challengePingedAt: t.timers?.challenge_pinged_at,
          challengedAt: t.timers?.challenged_at,
          onchainId: t.onchain_escrow_id,
          amount: `${formatTokenAmountFromRaw(cryptoAmtRaw, tokenDecimals)} ${cryptoAsset}`,
          action: t.status === 'PAID'
            ? (lang === 'TR' ? 'Onay Bekliyor' : 'Pending Approval')
            : (lang === 'TR' ? 'İşlemde' : 'In Progress'),
          rawTrade: {
            id: t._id,
            onchainId: t.onchain_escrow_id,
            maker: formatAddress(t.maker_address),
            makerFull: t.maker_address,
            takerFull: t.taker_address,
            crypto: cryptoAsset,
            cryptoAmountRaw: cryptoAmtRaw,
            cryptoAmountUi: cryptoAmtNum,
            fiat: t.financials?.fiat_currency || 'TRY',
            rate,
            max: fiatAmt,
            tokenDecimals,
            paidAt: t.timers?.paid_at,
            lockedAt: t.timers?.locked_at,
            pingedAt: t.timers?.pinged_at,
            challengePingedAt: t.timers?.challenge_pinged_at,
            challengedAt: t.timers?.challenged_at,
            cancelProposedBy: t.cancel_proposal?.proposed_by,
            chargebackAcked: t.chargeback_ack?.acknowledged === true,
          }
        };
      }));

      // activeTrade polling ile canlı kalır.
      // Pending-sync durumundaysa gerçek trade kaydı gelince canonical ID'ye geçilir.
      setActiveTrade(prev => {
        if (!prev) return prev;

        const updated = data.trades.find(t => t.onchain_escrow_id === prev.onchainId);
        if (!updated) return prev;

        const wasPendingSync = prev._pendingBackendSync && !prev.id;
        if (wasPendingSync && updated._id) {
          showToast(
            lang === 'TR' ? '✅ İşlem odası hazır!' : '✅ Trade room ready!',
            'success'
          );
        }

        if (updated.status !== prev.state) {
          setTradeState(updated.status);
        }
        setChargebackAccepted(updated.chargeback_ack?.acknowledged === true);

        return {
          ...prev,
          id: prev.id || updated._id,
          _pendingBackendSync: false,
          state: updated.status,
          paidAt: updated.timers?.paid_at ?? prev.paidAt,
          lockedAt: updated.timers?.locked_at ?? prev.lockedAt,
          pingedAt: updated.timers?.pinged_at ?? prev.pingedAt,
          challengePingedAt: updated.timers?.challenge_pinged_at ?? prev.challengePingedAt,
          challengedAt: updated.timers?.challenged_at ?? prev.challengedAt,
          cancelProposedBy: updated.cancel_proposal?.proposed_by ?? prev.cancelProposedBy,
          chargebackAcked: updated.chargeback_ack?.acknowledged === true,
        };
      });
    }
  } catch (err) {
    console.error('Trades fetch error:', err);
  }
}, [isAuthenticated, isConnected, address, lang, authenticatedFetch, tokenDecimalsMap]);

  // [TR] cancelStatus'u activeEscrows'dan reaktif olarak hesaplar
  // [EN] Reactively derives cancelStatus from activeEscrows
  useEffect(() => {
    if (!activeTrade?.onchainId || !activeEscrows.length) return;
    const currentTrade = activeEscrows.find(e => e.onchainId === activeTrade.onchainId);
    if (currentTrade?.rawTrade?.cancelProposedBy) {
      const isMyProposal = currentTrade.rawTrade.cancelProposedBy.toLowerCase() === address?.toLowerCase();
      setCancelStatus(isMyProposal ? 'proposed_by_me' : 'proposed_by_other');
    } else {
      setCancelStatus(prev => prev ? null : prev);
    }
  }, [activeTrade?.onchainId, activeEscrows, address]);

  useEffect(() => { fetchMyTrades(); }, [fetchMyTrades]);

  // [TR] Trade room açıkken aktif işlemleri 15 sn'de bir yeniler
  // [EN] Refreshes active trades every 15s while trade room is open
  useEffect(() => {
    if (currentView !== 'tradeRoom' || !isAuthenticated || isContractLoading || document.hidden) return;
    const interval = setInterval(fetchMyTrades, 15000);
    return () => clearInterval(interval);
  }, [currentView, isAuthenticated, isContractLoading, fetchMyTrades]);

  // [TR] Sekme tekrar görünür olduğunda trade poll'ü hemen tetiklenir.
  // [EN] Triggers immediate trade poll when the tab becomes visible again.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onVisibilityChange = () => {
      if (!document.hidden && currentView === "tradeRoom") {
        fetchMyTrades();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isAuthenticated, currentView, fetchMyTrades]);

  // [TR] Profil modalı açıldığında mevcut PII verilerini çekip formu doldurur
  // [EN] Pre-fills PII form when profile modal opens
  useEffect(() => {
    if (!showProfileModal || !isAuthenticated) return;
    const fetchMyPII = async () => {
      try {
        const res = await authenticatedFetch(`${API_URL}/api/pii/my`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.pii?.fields) {
          setPiiBankOwner(data.pii.fields.account_holder_name || '');
          setPiiIban(data.pii.fields.iban || '');
          setPiiTelegram(
            data.pii?.contact?.channel === 'telegram' ? (data.pii?.contact?.value || '') : ''
          );
        }
      } catch (err) {
        console.error('Mevcut PII verisi çekilemedi:', err);
      }
    };
    if (profileTab === 'ayarlar') fetchMyPII();
  }, [showProfileModal, profileTab, isAuthenticated, authenticatedFetch]);

  // [TR] Geçmiş sekmesi açıkken işlem geçmişini çeker ve sayfalandırır
  // [EN] Fetches and paginates trade history when history tab is active
  useEffect(() => {
    if (profileTab !== 'gecmis' || !isAuthenticated) return;
    const fetchHistory = async (page) => {
      try {
        setHistoryLoading(true);
        const res = await authenticatedFetch(`${API_URL}/api/trades/history?page=${page}&limit=5`);
        if (!res.ok) throw new Error('History fetch failed');
        const data = await res.json();
        if (data.trades) {
          setTradeHistory(data.trades);
          setTradeHistoryTotal(data.total);
          setTradeHistoryPage(data.page);
          setTradeHistoryLimit(data.limit);
        }
      } catch (err) {
        console.error('İşlem geçmişi çekilemedi:', err);
        setTradeHistory([]);
        setTradeHistoryTotal(0);
      } finally {
        setHistoryLoading(false);
      }
    };
    fetchHistory(tradeHistoryPage);
  }, [showProfileModal, profileTab, isAuthenticated, tradeHistoryPage, authenticatedFetch]);

  // [TR] Cüzdan bağlantısı kesildiğinde oturumu sona erdirir
  // [EN] Ends session when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      clearLocalSessionState();
    }
  }, [isConnected, clearLocalSessionState]);

  // [TR] Yenileme sonrası bekleyen tx hash'i varsa sonucu yakalamayı dener.
  // [EN] On refresh, tries to recover status of a pending tx hash from localStorage.
  useEffect(() => {
    if (!publicClient || !isConnected) return;
    if (pendingTxCheckedRef.current) return;
    pendingTxCheckedRef.current = true;
    const raw = localStorage.getItem('araf_pending_tx');
    if (!raw) return;

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      localStorage.removeItem('araf_pending_tx');
      return;
    }

    if (!parsed?.hash) {
      localStorage.removeItem('araf_pending_tx');
      return;
    }
    const isValidHash = /^0x[a-fA-F0-9]{64}$/.test(parsed.hash);
    if (!isValidHash) {
      localStorage.removeItem('araf_pending_tx');
      return;
    }
    if (parsed.createdAt && (Date.now() - Number(parsed.createdAt) > 24 * 3600 * 1000)) {
      localStorage.removeItem('araf_pending_tx');
      return;
    }
    if (parsed.chainId && Number(parsed.chainId) !== Number(chainId)) {
      return;
    }

    publicClient.getTransactionReceipt({ hash: parsed.hash })
      .then(() => {
        localStorage.removeItem('araf_pending_tx');
        fetchMyTrades();
        showToast(
          lang === 'TR'
            ? 'Bekleyen işlem bulundu ve onaylandı. Veriler yenilendi.'
            : 'Recovered pending transaction and confirmed it. Data refreshed.',
          'success'
        );
      })
      .catch(() => {});
  }, [publicClient, isConnected, fetchMyTrades, chainId, lang]);

  // [TR] SIWE yenilemesi/yeniden giriş sonrası tek aktif trade varsa odaya otomatik döndürür.
  // [EN] After SIWE refresh/re-login, auto-returns to trade room if exactly one active trade exists.
  useEffect(() => {
    if (!isAuthenticated) {
      autoTradeResumeRef.current = false;
      return;
    }
    if (autoTradeResumeRef.current) return;
    if (currentView !== 'home') return;
    if (activeEscrows.length !== 1) return;

    const escrow = activeEscrows[0];
    autoTradeResumeRef.current = true;
    setActiveTrade({ ...escrow.rawTrade, onchainId: escrow.onchainId, state: escrow.state });
    setTradeState(escrow.state);
    setUserRole(escrow.role);
    setChargebackAccepted(escrow.rawTrade?.chargebackAcked === true);
    setCurrentView('tradeRoom');
    showToast(
      lang === 'TR' ? 'Aktif işleminize otomatik geri dönüldü.' : 'Automatically returned to your active trade.',
      'info'
    );
  }, [isAuthenticated, currentView, activeEscrows, lang]);

  // [TR] Wallet / connector / chain event'lerinde auth drift'i güvenli şekilde sıfırlar.
  // [EN] On wallet / connector / chain events, resets auth drift safely.
  useEffect(() => {
    if (!isConnected || !connectedWallet || !isAuthenticated || !authenticatedWallet) return;
    if (authenticatedWallet !== connectedWallet) {
      bestEffortBackendLogout();
      clearLocalSessionState();
      showToast(
        lang === 'TR'
          ? 'Cüzdan değişikliği algılandı. Güvenlik için yeniden giriş yapmanız gerekiyor.'
          : 'Wallet change detected. For security, please sign in again.',
        'info'
      );
    }
  }, [isConnected, connectedWallet, isAuthenticated, authenticatedWallet, lang, bestEffortBackendLogout, clearLocalSessionState]);

  useEffect(() => {
    if (!connector?.getProvider) return undefined;
    let provider = null;
    const handleWalletRuntimeEvent = () => {
      if (!isAuthenticated || !authenticatedWallet) return;
      const runtimeWallet = provider?.selectedAddress?.toLowerCase?.() || connectedWallet;
      if (runtimeWallet && runtimeWallet !== authenticatedWallet) {
        bestEffortBackendLogout();
        clearLocalSessionState();
        showToast(
          lang === 'TR'
            ? 'Wallet oturumu değişti. Güvenlik için tekrar imza gerekli.'
            : 'Wallet session changed. Re-sign is required for security.',
          'info'
        );
      }
    };

    const bind = async () => {
      provider = await connector.getProvider();
      if (!provider?.on) return;
      provider.on('accountsChanged', handleWalletRuntimeEvent);
      provider.on('disconnect', handleWalletRuntimeEvent);
      provider.on('chainChanged', handleWalletRuntimeEvent);
    };
    bind().catch(() => {});

    return () => {
      if (!provider?.removeListener) return;
      provider.removeListener('accountsChanged', handleWalletRuntimeEvent);
      provider.removeListener('disconnect', handleWalletRuntimeEvent);
      provider.removeListener('chainChanged', handleWalletRuntimeEvent);
    };
  }, [connector, connectedWallet, isAuthenticated, authenticatedWallet, lang, bestEffortBackendLogout, clearLocalSessionState]);

  // ═══════════════════════════════════════════
  // 6. TÜRETILMIŞ STATE (COMPUTED VALUES)
  //    Filtered lists, countdown timers, counts
  // ═══════════════════════════════════════════

  const filteredOrders = orders.filter(order => {
    const amountMatch = searchAmount === '' || (Number(searchAmount) >= order.min && Number(searchAmount) <= order.max);
    const tierMatch   = filterTier1 ? order.tier === 0 : true;
    const tokenMatch  = filterToken === 'ALL' || order.crypto === filterToken;
    return amountMatch && tierMatch && tokenMatch;
  });

  const activeEscrowCounts = {
    LOCKED:    activeEscrows.filter(e => e.state === 'LOCKED').length,
    PAID:      activeEscrows.filter(e => e.state === 'PAID').length,
    CHALLENGED:activeEscrows.filter(e => e.state === 'CHALLENGED').length,
  };

  // [TR] Geri sayım hook'ları — React kuralı gereği component gövdesinde tanımlanır,
  //      renderTradeRoom gibi render fonksiyonlarının içinde çağrılamaz.
  // [EN] Countdown hooks — must be at component body level per React rules;
  //      cannot be called inside render helper functions like renderTradeRoom.
  const gracePeriodEndDate          = useMemo(() => activeTrade?.paidAt ? new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000) : null, [activeTrade?.paidAt]);
  const gracePeriodTimer            = useCountdown(gracePeriodEndDate);
  const bleedingEndDate             = useMemo(() => activeTrade?.challengedAt ? new Date(new Date(activeTrade.challengedAt).getTime() + 240 * 3600 * 1000) : null, [activeTrade?.challengedAt]);
  const bleedingTimer               = useCountdown(bleedingEndDate);
  const principalProtectionEndDate  = useMemo(() => activeTrade?.challengedAt ? new Date(new Date(activeTrade.challengedAt).getTime() + (48 + 96) * 3600 * 1000) : null, [activeTrade?.challengedAt]);
  const principalProtectionTimer    = useCountdown(principalProtectionEndDate);
  const makerPingEndDate            = useMemo(() => activeTrade?.paidAt ? new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000) : null, [activeTrade?.paidAt]);
  const makerPingTimer              = useCountdown(makerPingEndDate);
  const canMakerPing                = makerPingTimer.isFinished;
  const makerChallengePingEndDate   = useMemo(() => activeTrade?.paidAt ? new Date(new Date(activeTrade.paidAt).getTime() + 24 * 3600 * 1000) : null, [activeTrade?.paidAt]);
  const makerChallengePingTimer     = useCountdown(makerChallengePingEndDate);
  const canMakerStartChallengeFlow  = makerChallengePingTimer.isFinished;
  const makerChallengeEndDate       = useMemo(() => activeTrade?.challengePingedAt ? new Date(new Date(activeTrade.challengePingedAt).getTime() + 24 * 3600 * 1000) : null, [activeTrade?.challengePingedAt]);
  const makerChallengeTimer         = useCountdown(makerChallengeEndDate);
  const canMakerChallenge           = makerChallengeTimer.isFinished;

  // ═══════════════════════════════════════════
  // 7. YARDIMCI FONKSİYONLAR
  //    Utility helpers
  // ═══════════════════════════════════════════

  // [TR] Toast bildirimi gösterir — 4 sn sonra otomatik kapanır
  // [EN] Shows toast notification — auto-closes after 4s
  const showToast = (message, type = 'success') => {
    setToast({ id: Date.now(), message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // [TR] Sidebar'ı açar ve 5 sn sonra otomatik kapatır; hover timer'ı sıfırlar
  // [EN] Opens sidebar, auto-closes after 5s; hover resets the timer
  const openSidebar = () => {
    setSidebarOpen(true);
    if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
    sidebarTimerRef.current = setTimeout(() => setSidebarOpen(false), 5000);
  };

  const hasSignedSessionForActiveWallet =
    Boolean(isConnected && connectedWallet && isAuthenticated && authenticatedWallet === connectedWallet);

  const requireSignedSessionForActiveWallet = React.useCallback(() => {
    if (hasSignedSessionForActiveWallet) return true;
    showToast(
      lang === 'TR'
        ? 'Aktif cüzdan için imzalı oturum yok. Lütfen yeniden giriş yapın.'
        : 'No signed session for the active wallet. Please sign in again.',
      'error'
    );
    setShowMakerModal(false);
    setShowProfileModal(false);
    return false;
  }, [hasSignedSessionForActiveWallet, lang]);

  const handleLogoutAndDisconnect = async () => {
    await bestEffortBackendLogout();
    clearLocalSessionState();
    disconnect();
  };

  // [TR] Cüzdan adresini kısaltır (0x1234...5678 formatı)
  // [EN] Shortens wallet address to 0x1234...5678 format
  const formatAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '—';

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

      const nonceRes = await fetch(`${API_URL}/api/auth/nonce?wallet=${address}`, { credentials: 'include' });
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

      const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
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
        authenticatedWalletRef.current = verifiedWallet;
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

  // [TR] Taker "Satın Al" akışı: approve() → lockEscrow() iki adımı.
  //      Bond miktarı onchain bondMap'ten hesaplanır. İşlem sonrası realTradeId için
  //      retry loop eklendi (event listener gecikmesi 3-5 sn olabilir).
  //      (C-03: PIIDisplay 404 hatasını önleyen retry loop eklendi)
  // [EN] Taker "Buy" flow: approve() → lockEscrow() two-step.
  //      Bond amount calculated from onchain bondMap. Retry loop added for
  //      realTradeId after lockEscrow (event listener delay can be 3-5s).
  //      (C-03: Added retry loop to prevent PIIDisplay 404 error)
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
        ? 'Bu ilanın on-chain ID\'si henüz yok. Lütfen daha sonra tekrar deneyin.'
        : 'This listing has no on-chain ID yet. Please try again later.',
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

    if (!onchainBondMap) {
      showToast(lang === 'TR' ? 'Protokol ayarları yükleniyor...' : 'Loading protocol config...', 'info');
      setIsContractLoading(false);
      return;
    }

    const tier = order.tier ?? 1;
    let cryptoAmtRaw = 0n;

    // Öncelik on-chain trade verisinde.
    // Böylece fiat/crypto karışıklığında UI cache yerine contract state baz alınır.
    const onchainTrade = await getTrade(BigInt(order.onchainId));
    if (onchainTrade) {
      const amountFromChain = typeof onchainTrade.cryptoAmount !== 'undefined' ? onchainTrade.cryptoAmount : onchainTrade[4];
      const tokenFromChain = typeof onchainTrade.tokenAddress !== 'undefined' ? onchainTrade.tokenAddress : onchainTrade[3];

      if (amountFromChain && BigInt(amountFromChain) > 0n) {
        cryptoAmtRaw = BigInt(amountFromChain);
      }
      if (tokenFromChain && tokenFromChain !== '0x0000000000000000000000000000000000000000') {
        tokenAddress = tokenFromChain;
      }
    }

    if (cryptoAmtRaw === 0n) {
      showToast(
        lang === 'TR'
          ? 'On-chain işlem tutarı okunamadı. Lütfen daha sonra tekrar deneyin.'
          : 'Failed to read on-chain trade amount. Please try again.',
        'error'
      );
      return;
    }

    const takerBondBps = BigInt(onchainBondMap[tier]?.takerBps ?? 0);
    const takerBond = (cryptoAmtRaw * takerBondBps) / 10000n;

    if (takerBond > 0n) {
      const currentAllowance = await getAllowance(tokenAddress, address);
      if (currentAllowance < takerBond) {
        setLoadingText(
          lang === 'TR'
            ? `Adım 1/2: ${order.crypto} izni veriliyor...`
            : `Step 1/2: Approving ${order.crypto}...`
        );
        await approveToken(tokenAddress, takerBond);
        didIncreaseAllowance = true;
      }
    }

    setLoadingText(
      lang === 'TR'
        ? 'Adım 2/2: İşlem kilitleniyor...'
        : 'Step 2/2: Locking trade...'
    );
    await lockEscrow(BigInt(order.onchainId));

    // Backend trade kaydı listener gecikmesiyle gelebilir.
    // Bu yüzden birkaç deneme yapılır; gerçek trade ID yoksa sahte/fallback ID ile devam edilmez.
    let realTradeId = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await authenticatedFetch(`${API_URL}/api/trades/by-escrow/${order.onchainId}`);
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
        onchainId: order.onchainId,
        _pendingBackendSync: true,
      });
      setTradeState('LOCKED');
      setCancelStatus(null);
      setChargebackAccepted(false);
      setCurrentView('tradeRoom');
      return;
    }

    setActiveTrade({ ...order, id: realTradeId, onchainId: order.onchainId });
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
      const res = await fetch(`${API_URL}/api/receipts/upload`, {
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

      const ESCROW_ADDR = import.meta.env.VITE_ESCROW_ADDRESS;
      const { getAddress, parseAbi: _parseAbi } = await import('viem');
      const nonceAbi = _parseAbi(['function sigNonces(address) view returns (uint256)']);
      const nonce = await publicClient.readContract({
        address: getAddress(ESCROW_ADDR),
        abi: nonceAbi,
        functionName: 'sigNonces',
        args: [getAddress(address)],
      });

      const { signature, deadline } = await signCancelProposal(activeTrade.onchainId, nonce);

      try {
        const relayRes = await authenticatedFetch(`${API_URL}/api/trades/propose-cancel`, {
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
      await authenticatedFetch(`${API_URL}/api/feedback`, {
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
        await authenticatedFetch(`${API_URL}/api/trades/${activeTrade.id}/chargeback-ack`, { method: 'POST' });
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
      showToast(lang === 'TR' ? 'Satıcı uyarıldı. Yanıt için 24 saati var.' : 'Maker has been pinged. They have 24h to respond.', 'success');
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

  // [TR] Kullanıcının banka/IBAN/Telegram bilgilerini günceller (AES-256 şifreli, off-chain)
  // [EN] Updates user's bank/IBAN/Telegram info (AES-256 encrypted, off-chain)
  const handleUpdatePII = async (e) => {
    e.preventDefault();
    if (isContractLoading) return;
    if (!requireSignedSessionForActiveWallet()) return;
    try {
      setIsContractLoading(true);
      const res = await authenticatedFetch(`${API_URL}/api/auth/profile`, {
        method: 'PUT',
        body: JSON.stringify({
          rail: 'TR_IBAN',
          country: 'TR',
          contactChannel: 'telegram',
          contactValue: piiTelegram.replace(/^@/, '').trim(),
          bankOwner: piiBankOwner,
          iban:      piiIban.replace(/\s/g, ''),
          telegram:  piiTelegram.replace(/^@/, '').trim(),
          routingNumber: '',
          accountNumber: '',
          accountType: '',
          bic: '',
          bankName: '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Güncelleme başarısız oldu.');
      showToast(lang === 'TR' ? 'Bilgileriniz başarıyla güncellendi.' : 'Your information has been updated successfully.', 'success');
    } catch (err) {
      console.error('PII update error:', err);
      showToast(err.message, 'error');
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
      showToast(lang === 'TR' ? 'Sistem şu an bakım modundadır. Yeni ilan açılamaz.' : 'System is paused. Cannot create ad.', 'error');
      return;
    }
    if (!requireSignedSessionForActiveWallet()) return;
    setShowMakerModal(true);
  };

  // [TR] Maker escrow oluşturma: allowance kontrol → approve() → createEscrow() iki adım.
  //      Bond miktarı onchain bondMap'ten dinamik hesaplanır.
  //      İlan önce off-chain DB'ye kaydedilir; backend listing_ref üretir ve
  //      on-chain createEscrow çağrısına authoritative referans olarak taşınır.
  // [EN] Maker escrow creation: check allowance → approve() → createEscrow() two-step.
  //      Bond amount dynamically calculated from onchain bondMap.
  //      Listing is pre-saved so backend can generate listing_ref and pass it
  //      to createEscrow as authoritative linkage reference.
const handleCreateEscrow = async () => {
  if (!requireSignedSessionForActiveWallet()) return;

  let tokenAddress = SUPPORTED_TOKEN_ADDRESSES[makerToken];
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
  let pendingListingId = null;
  let pendingListingRef = null;

  try {
    const preCreateRes = await authenticatedFetch(`${API_URL}/api/listings`, {
      method: 'POST',
      body: JSON.stringify({
        crypto_asset: makerToken,
        fiat_currency: makerFiat,
        exchange_rate: parseFloat(makerRate),
        limits: { min: parseFloat(makerMinLimit), max: parseFloat(makerMaxLimit) },
        tier: makerTier,
        token_address: SUPPORTED_TOKEN_ADDRESSES[makerToken],
      }),
    });

    const preCreateData = await preCreateRes.json().catch(() => ({}));
    if (!preCreateRes.ok) {
      throw new Error(preCreateData?.error || 'İlan hazırlığı başarısız.');
    }

    pendingListingId = preCreateData?.listing?._id || null;
    pendingListingRef = preCreateData?.listing?.listing_ref || null;

    // Contract artık canonical listingRef bekliyor.
    // Ref yoksa on-chain create'e gitmek yerine hazırlanan ilan temizlenir.
    if (!pendingListingRef || !/^0x[a-f0-9]{64}$/.test(pendingListingRef)) {
      if (pendingListingId) {
        authenticatedFetch(`${API_URL}/api/listings/${pendingListingId}`, { method: 'DELETE' })
          .catch(() => {});
      }

      throw new Error(
        lang === 'TR'
          ? 'Listing referansı alınamadı. İlan tekrar oluşturulamadı.'
          : 'Failed to get listing reference. Please try again.'
      );
    }

    setIsContractLoading(true);

    const tokenDecimals = getTokenDecimals ? await getTokenDecimals(tokenAddress) : 6;
    const { parseUnits } = await import('viem');
    const cryptoAmountRaw = parseUnits(String(cryptoAmt), tokenDecimals);

    if (!onchainBondMap) {
      showToast(lang === 'TR' ? 'Protokol ayarları yükleniyor...' : 'Loading protocol config...', 'info');
      setIsContractLoading(false);
      return;
    }

    const bondBps = BigInt(onchainBondMap[makerTier]?.makerBps ?? 0);
    const makerBondRaw = (cryptoAmountRaw * bondBps) / 10000n;
    const totalLock = cryptoAmountRaw + makerBondRaw;

    const currentAllowance = await getAllowance(tokenAddress, address);
    if (currentAllowance < totalLock) {
      setLoadingText(
        lang === 'TR'
          ? `Adım 1/2: ${makerToken} izni veriliyor...`
          : `Step 1/2: Approving ${makerToken}...`
      );
      await approveToken(tokenAddress, totalLock);
      didIncreaseAllowance = true;
    }

    setLoadingText(
      lang === 'TR'
        ? 'Adım 2/2: Escrow oluşturuluyor...'
        : 'Step 2/2: Creating escrow...'
    );
    await createEscrow(tokenAddress, cryptoAmountRaw, makerTier, pendingListingRef);

    showToast(
      lang === 'TR'
        ? '✅ İlan başarıyla oluşturuldu! Fonlar kilitlendi.'
        : '✅ Listing created! Funds locked.',
      'success'
    );

    setShowMakerModal(false);
    setMakerAmount('');
    setMakerRate('');
    setMakerMinLimit('');
    setMakerMaxLimit('');
    setMakerFiat('TRY');
  } catch (err) {
    console.error('handleCreateEscrow error:', err);

    // On-chain create başarısızsa hazırlanmış listing'i temizlemeyi deneriz.
    if (pendingListingId) {
      try {
        await authenticatedFetch(`${API_URL}/api/listings/${pendingListingId}`, { method: 'DELETE' });
      } catch (_) {}
    }

    if (didIncreaseAllowance && tokenAddress) {
      try { await approveToken(tokenAddress, 0n); } catch (_) {}
    }

    let errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Escrow oluşturulamadı.' : 'Failed to create escrow.');
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

  // [TR] "İlanlarım" ekranından maker ilanını siler.
  //      Parity-safe yaklaşım: on-chain escrow id varsa önce cancelOpenEscrow çağrılır,
  //      ardından backend listing kaydı silinir ve local UI listesi güncellenir.
  // [EN] Deletes maker listing from "My Listings".
  //      Parity-safe approach: if on-chain escrow id exists, call cancelOpenEscrow first,
  //      then delete backend listing record and update local UI list.
  const handleDeleteOrder = async (order) => {
    if (!order?.id || isContractLoading) return;
    if (!requireSignedSessionForActiveWallet()) return;

    try {
      setIsContractLoading(true);

      if (order.onchainId != null) {
        showToast(
          lang === 'TR'
            ? 'İlan zincirden kaldırılıyor... Cüzdanınızdan onaylayın.'
            : 'Removing listing on-chain... Confirm in wallet.',
          'info'
        );
        await cancelOpenEscrow(BigInt(order.onchainId));
      }

      const res = await authenticatedFetch(`${API_URL}/api/listings/${order.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || (lang === 'TR' ? 'İlan silinemedi.' : 'Failed to delete listing.'));
      }

      setOrders(prev => prev.filter(o => o.id !== order.id));
      setConfirmDeleteId(null);

      showToast(
        lang === 'TR' ? '✅ İlan silindi.' : '✅ Listing deleted.',
        'success'
      );
    } catch (err) {
      console.error('handleDeleteOrder error:', err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'İlan silinemedi.' : 'Failed to delete listing.');
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
    tableSeller:     lang === 'TR' ? 'Satıcı' : 'Seller',
    tableRate:       lang === 'TR' ? 'Kur' : 'Rate',
    tableLimit:      lang === 'TR' ? 'Limit' : 'Limit',
    tableBond:       lang === 'TR' ? 'Bond' : 'Bond',
    tableAction:     lang === 'TR' ? 'İşlem' : 'Action',
    buyBtn:          lang === 'TR' ? 'Satın Al' : 'Buy',
    createAd:        lang === 'TR' ? '+ İlan Aç' : '+ Create Ad',
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
    getSafeTelegramUrl,
    showToast,
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
    userReputation,
    SUPPORTED_TOKEN_ADDRESSES,
    handleCreateEscrow,
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
    piiBankOwner,
    setPiiBankOwner,
    piiIban,
    setPiiIban,
    piiTelegram,
    setPiiTelegram,
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
          {currentView === 'home' ? renderHome() : currentView === 'market' ? renderMarket() : renderTradeRoom()}
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
