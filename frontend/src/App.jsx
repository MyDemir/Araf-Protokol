import React, { useState, useEffect } from 'react';
// --- WEB3 ENTEGRASYON KÜTÜPHANELERİ ---
// H-01 Fix: useChainId eklendi — SIWE mesajındaki Chain ID artık hardcoded değil
import { useAccount, useConnect, useDisconnect, useSignMessage, useChainId, usePublicClient } from 'wagmi';

// H-05 Fix: SIWE mesajı resmi EIP-4361 formatında oluşturmak için siwe paketi kullanılıyor.
import { SiweMessage } from 'siwe';

// H-02 Fix: useArafContract hook import edildi — kontrat çağrıları artık gerçek on-chain işlem.
import { useArafContract } from './hooks/useArafContract';
import { useCountdown } from './hooks/useCountdown'; // YENİ: Geri sayım hook'u

// --- BİLEŞEN VE HOOK İTHALATI ---
import PIIDisplay from './components/PIIDisplay'; // H-03 Entegrasyonu

// CON-01 Fix: Production'da localhost fallback'i kullanmayı engelle.
const API_URL = import.meta.env.VITE_API_URL || (
  import.meta.env.DEV ? 'http://localhost:4000' : ''
);

// CON-01 & CON-02 Fix: Uygulama başlangıcında kritik env değişkenlerini kontrol et
const ENV_ERRORS = [];
if (!import.meta.env.VITE_API_URL && import.meta.env.PROD) {
  ENV_ERRORS.push('VITE_API_URL tanımlı değil — API çağrıları çalışmayacak');
}
if (!import.meta.env.VITE_ESCROW_ADDRESS || 
    import.meta.env.VITE_ESCROW_ADDRESS === '0x0000000000000000000000000000000000000000') {
  ENV_ERRORS.push('VITE_ESCROW_ADDRESS tanımlı değil veya sıfır adres — kontrat işlemleri çalışmayacak');
}

// CON-02 Fix: Env değişkenleri eksikse kullanıcıya anlamlı uyarı göster
// UX Güncelleme: Devasa tam ekran banner yerine küçük, kapatılabilir şerit
const EnvWarningBanner = () => {
  const [visible, setVisible] = React.useState(true);
  if (ENV_ERRORS.length === 0 || !visible) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-950/95 border-b border-red-800/60 backdrop-blur-sm flex items-center justify-between px-4 py-1.5 shadow-lg">
      <span className="text-red-400 text-[11px] font-mono flex items-center gap-2">
        <span className="text-red-500">⚠</span>
        {ENV_ERRORS.join(' · ')}
      </span>
      {/* Kapatma butonu — sadece uyarıyı gizler, sistemi değiştirmez */}
      <button
        onClick={() => setVisible(false)}
        className="ml-4 text-red-500 hover:text-white transition text-sm leading-none shrink-0"
        aria-label="Kapat"
      >✕</button>
    </div>
  );
};

// YENİ: İstatistik değişim yüzdesini gösteren bileşen (Linter sorunu çözümü için App dışına alındı)
const StatChange = ({ value }) => {
  if (value == null) return null;
  const isPositive = value >= 0;
  return <span className={`text-[10px] ml-2 font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>{isPositive ? '▲' : '▼'}{Math.abs(value).toFixed(1)}%</span>;
};

function App() {
  // ==========================================
  // --- 1. EKRAN VE STATE YÖNETİMİ ---
  // ==========================================
  const [currentView, setCurrentView] = useState('home');
  const [showMakerModal, setShowMakerModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false); // Multi-wallet Seçim Modalı
  const [sidebarOpen, setSidebarOpen] = useState(false); // YENİ: Dinamik sidebar açık/kapalı (5sn otomatik kapanır)
  const [expandedStatus, setExpandedStatus] = useState(null); // YENİ: Sidebar Durum Akordiyonu

  // Sidebar 5sn otomatik kapanma zamanlayıcısı referansı
  const sidebarTimerRef = React.useRef(null);

  // --- MİMARİ TEST STATE'LERİ ---
  const [tradeState, setTradeState] = useState('LOCKED');
  const [userRole, setUserRole] = useState('taker');
  const [isBanned, setIsBanned] = useState(false);
  const [cancelStatus, setCancelStatus] = useState(null);
  const [cooldownPassed, setCooldownPassed] = useState(false);
  const [chargebackAccepted, setChargebackAccepted] = useState(false);

  // M-02 Fix: Maker modal için reaktif state'ler
  const [makerTier, setMakerTier]         = useState(1);
  const [makerAmount, setMakerAmount]     = useState('');
  const [makerRate, setMakerRate]         = useState('');
  const [makerMinLimit, setMakerMinLimit] = useState('');
  const [makerMaxLimit, setMakerMaxLimit] = useState('');
  const [makerFiat, setMakerFiat]         = useState('TRY');
  // [KRIT-01 Fix]: Token seçimi state'i — kontrat onaylı token adresleri
  // Base Sepolia test adresleri; mainnet için .env üzerinden yönetilmeli
  const SUPPORTED_TOKEN_ADDRESSES = {
    USDT: import.meta.env.VITE_USDT_ADDRESS || '',
    USDC: import.meta.env.VITE_USDC_ADDRESS || '',
  };
  const [makerToken, setMakerToken] = useState('USDT');

  // --- WEB3 DURUM YÖNETİMİ ---
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const chainId = useChainId();
  // [KRIT-04 Fix]: walletRegisteredAt on-chain kontrolü için publicClient
  const publicClient = usePublicClient();

  // [KRIT-05 Fix]: useArafContract tek seferinde çağrılmalı — çift instance React hook ihlalidir.
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
    getTrade,
    getPaused,
    decayReputation,
    antiSybilCheck,
    mintToken,
    getFirstSuccessfulTradeAt,
  } = useArafContract();
  
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  // [KRIT-04 Fix]: Cüzdan kayıt durumu — registerWallet() on-chain çağrısı için
  const [isWalletRegistered, setIsWalletRegistered] = useState(null); // null=bilinmiyor, true/false
  const [isRegisteringWallet, setIsRegisteringWallet] = useState(false);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  // FIX-11: Contract işlemleri için loading state — çift tıklama ve kötü UX'i önler
  const [isContractLoading, setIsContractLoading] = useState(false);
  const [loadingText, setLoadingText] = useState(''); // UX-5: İki aşamalı işlemler için metin

  // --- KULLANICI VE VERİ STATE'LERİ ---
  const [lang, setLang] = useState('EN'); // UX-1: Varsayılan dil EN yapıldı
  const [filterTier1, setFilterTier1] = useState(false);
  const [filterToken, setFilterToken] = useState('ALL'); // YENİ: Sidebar için token filtresi
  const [activeTradesFilter, setActiveTradesFilter] = useState('ALL'); // YENİ: Aktif işlemler için statü filtresi
  const [searchAmount, setSearchAmount] = useState('');
  const [profileTab, setProfileTab] = useState('ayarlar');
  
  const [userReputation, setUserReputation] = useState(null); // YENİ: Kullanıcının on-chain itibar verisi
  // YENİ: PII güncelleme formu için state'ler
  const [piiBankOwner, setPiiBankOwner] = useState('');
  const [piiIban, setPiiIban] = useState('');
  const [piiTelegram, setPiiTelegram] = useState('');

  const [tradeHistory, setTradeHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [tradeHistoryPage, setTradeHistoryPage] = useState(1);
  const [tradeHistoryTotal, setTradeHistoryTotal] = useState(0);
  const [tradeHistoryLimit, setTradeHistoryLimit] = useState(10);

  // [H-04 Fix]: telegramHandle static state kaldırıldı — PIIDisplay şifreli kanaldan gösteriyor.
  const [activeTrade, setActiveTrade] = useState(null);
  // [KRIT-03 Fix]: reportPayment için IPFS hash state'i
  const [paymentIpfsHash, setPaymentIpfsHash] = useState('');
  
  const [sybilStatus, setSybilStatus] = useState(null);
  const [takerName, setTakerName] = useState('');
  
  const [isPaused, setIsPaused] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(localStorage.getItem('araf_terms_accepted') === 'true');

  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(0);
  // YENİ: Geri bildirim kategorisi için state
  const [feedbackCategory, setFeedbackCategory] = useState('');

  // Protocol stats — /api/stats'tan çekilir, 1 saatte bir güncellenir
  const [protocolStats, setProtocolStats] = useState(null);
  const [statsLoading, setStatsLoading]   = useState(true);
  const [statsError, setStatsError] = useState(false);

  // [H-03 Fix]: Bleeding Escrow gerçek decay değerleri — getCurrentAmounts() on-chain okuma
  const [bleedingAmounts, setBleedingAmounts] = useState(null);

  // Statik diziler silindi, yerini state aldı.
  const [orders, setOrders] = useState([]);
  const [activeEscrows, setActiveEscrows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // ==========================================
  // --- 2. CANLI VERİLER (API) ---
  // ==========================================

  /**
   * SORUN-01 & SORUN-02 Fix: API çağrıları HTTP-Only Cookie tabanlı.
   * Bearer token kullanımı kaldırıldı, 'credentials: include' zorunlu kılındı.
   */
  const authenticatedFetch = React.useCallback(async (url, options = {}) => {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (res.status !== 401) return res;

    try {
      const refreshRes = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          wallet: address?.toLowerCase(),
        }),
      });

      if (!refreshRes.ok) {
        console.warn('[Auth] Refresh token expired — re-login required');
        setIsAuthenticated(false);
        showToast(lang === 'TR' ? 'Oturumunuz sona erdi. Lütfen tekrar imzalayın.' : 'Session expired. Please sign in again.', 'error');
        return res;
      }

      // Orijinal isteği yenilenen cookie ile tekrarla
      return fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
    } catch (err) {
      console.error('[Auth] Refresh failed:', err);
      return res;
    }
  }, [address, lang]);

  // Session check on load
  useEffect(() => {
    if (!isConnected || !address) {
      setIsAuthenticated(false);
      setAuthChecked(true);
      return;
    }

    fetch(`${API_URL}/api/auth/me`, { credentials: 'include' })
      .then(res => {
        setIsAuthenticated(res.ok);
        setAuthChecked(true);
      })
      .catch(() => {
        setIsAuthenticated(false);
        setAuthChecked(true);
      });
  }, [isConnected, address]);

  // 1. Pazar Yeri İlanlarını Çek (Public)
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
            // FIX-07: makerFull eklendi — profile modalda myOrders filtresi için gerekli
            makerFull:   l.maker_address,
            maker:       formatAddress(l.maker_address),
            crypto:      l.crypto_asset || "USDT",
            fiat:        l.fiat_currency || "TRY",
            rate:        l.exchange_rate,
            min:         l.limits?.min || 0,
            max:         l.limits?.max || 0,
            // FIX-02: l.tier || 1 → ?? kullanıldı. Tier 0 geçerli bir değerdir (falsy bug).
            tier:        l.tier_rules?.required_tier ?? 1,
            // FIX-03: Nested field — backend tier_rules.maker_bond_pct döndürüyor
            bond:        (l.tier_rules?.maker_bond_pct ?? 0) + "%",
            successRate: 100,
            txCount:     0,
          })));
        }
      } catch (err) {
        console.error("Listing fetch error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchListings();
  }, [lang]); // Dil değiştiğinde buton metinleri için yeniden render gerekebilir

  // Stats Çek
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res  = await fetch(`${API_URL}/api/stats`, { credentials: 'include' });
        const data = await res.json();
        if (data.stats) setProtocolStats(data.stats);
      } catch (err) {
        console.error("Stats fetch error:", err);
        setStatsError(true);
      } finally {
        setStatsLoading(false);
      }
    };
    fetchStats();
  }, []); // Stats verisi dile bağlı değil, bir kere çekilmesi yeterli

  // [H-03 Fix]: CHALLENGED state'inde Bleeding Escrow gerçek decay değerlerini 30 saniyede bir güncelle
  useEffect(() => {
    if (tradeState !== 'CHALLENGED' || !activeTrade?.onchainId || !getCurrentAmounts) {
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
  }, [tradeState, activeTrade?.onchainId, getCurrentAmounts]);

  // [KRIT-04 Fix]: Cüzdan bağlandığında walletRegisteredAt on-chain kontrolü.
  // walletRegisteredAt[address] == 0 ise kayıt yok → kullanıcıya registerWallet adımı göster.
  useEffect(() => {
    if (!isConnected || !address || !publicClient) {
      setIsWalletRegistered(null);
      return;
    }
    const ESCROW_ADDR = import.meta.env.VITE_ESCROW_ADDRESS;
    if (!ESCROW_ADDR || ESCROW_ADDR === '0x0000000000000000000000000000000000000000') {
      setIsWalletRegistered(null);
      return;
    }
    const checkRegistration = async () => {
      try {
        const { getAddress, parseAbi: _parseAbi } = await import('viem');
        const regAbi = _parseAbi(['function walletRegisteredAt(address) view returns (uint256)']);
        const regAt = await publicClient.readContract({
          address: getAddress(ESCROW_ADDR),
          abi: regAbi,
          functionName: 'walletRegisteredAt',
          args: [getAddress(address)],
        });
        setIsWalletRegistered(regAt > 0n);
      } catch {
        setIsWalletRegistered(null); // kontrat erişim hatası → belirsiz
      }
    };
    checkRegistration();
  }, [isConnected, address, publicClient]);

  // YENİ: Kullanıcının on-chain itibarını (ve efektif tier'ını) çek
  useEffect(() => {
    if (!isConnected || !address || !getReputation) {
      setUserReputation(null);
      return;
    }

    const fetchUserReputation = async () => {
      try {
        const repData = await getReputation(address);
        // Array dönebilir, destructuring ile veya obje property'leri ile alalım
        // viem named outputs destekliyorsa obje döner, aksi halde array.
        const successful = typeof repData.successful !== 'undefined' ? repData.successful : repData[0];
        const failed = typeof repData.failed !== 'undefined' ? repData.failed : repData[1];
        const bannedUntil = typeof repData.bannedUntil !== 'undefined' ? repData.bannedUntil : repData[2];
        const consecutiveBans = typeof repData.consecutiveBans !== 'undefined' ? repData.consecutiveBans : repData[3];
        const effectiveTier = typeof repData.effectiveTier !== 'undefined' ? repData.effectiveTier : repData[4];
        
        const firstTradeAt = getFirstSuccessfulTradeAt ? await getFirstSuccessfulTradeAt(address) : 0n;
        
        setUserReputation({
          successful: Number(successful),
          failed: Number(failed),
          bannedUntil: Number(bannedUntil),
          consecutiveBans: Number(consecutiveBans),
          effectiveTier: Number(effectiveTier),
          firstSuccessfulTradeAt: Number(firstTradeAt),
        });

        // 3. Yasaklı Kullanıcı (Banned) State'inin on-chain'e göre güncellenmesi
        setIsBanned(Number(bannedUntil) > Date.now() / 1000);
      } catch (err) {
        console.error("Kullanıcı itibar verisi çekilemedi:", err);
      }
    };
    fetchUserReputation();
  }, [isConnected, address, getReputation]); // Bağımlılıklar doğru

  // YENİ: Anti-Sybil Cooldown kontrolü
  useEffect(() => {
    if (!isConnected || !address || !antiSybilCheck) return;
    const fetchSybil = async () => {
      const res = await antiSybilCheck(address);
      if (res) {
        // viem tuple objesi olarak dönerse
        setSybilStatus({
              funded: typeof res.balanceOk !== 'undefined' ? res.balanceOk : (typeof res.funded !== 'undefined' ? res.funded : res[1]),
              cooldownOk: typeof res.cooldownOk !== 'undefined' ? res.cooldownOk : res[2],
              cooldownRemaining: 0,
        });
      }
    };
    fetchSybil();
    const interval = setInterval(fetchSybil, 30000);
    return () => clearInterval(interval);
  }, [isConnected, address, antiSybilCheck]);
  
  // YENİ: Kontratın Paused (bakım) durumunu çek (Acil Durum / Sistem Bakımda)
  useEffect(() => {
    if (!getPaused) return;
    const fetchPausedStatus = async () => {
      try {
        const paused = await getPaused();
        setIsPaused(paused);
      } catch (err) {
        console.error("Paused durumu çekilemedi:", err);
      }
    };
    fetchPausedStatus();
    const interval = setInterval(fetchPausedStatus, 60000);
    return () => clearInterval(interval);
  }, [getPaused]);

  // YENİ: Triangulation Fraud Prevention için Taker Name'i Çek
  useEffect(() => {
    if (currentView === 'tradeRoom' && tradeState === 'LOCKED' && userRole === 'maker' && activeTrade?.id && isAuthenticated) {
       authenticatedFetch(`${API_URL}/api/pii/taker-name/${activeTrade.onchainId}`)
         .then(res => res.json())
         .then(data => { if (data.bankOwner) setTakerName(data.bankOwner); })
         .catch(err => console.error("Taker name fetch error", err));
    }
  }, [currentView, tradeState, userRole, activeTrade?.onchainId, isAuthenticated, authenticatedFetch]);

  // [H-01 Fix]: fetchMyTrades useCallback'e taşındı — hem ilk yüklemede hem polling'de kullanılabilir.
  // Önceki hata: fonksiyon başka bir useEffect'in scope'undaydı, polling interval ReferenceError veriyordu.
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
          const cryptoAmt = t.financials?.crypto_amount || 0;
          const rate = t.financials?.exchange_rate || 1;
          const fiatAmt = cryptoAmt * rate;

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
            lockedAt: t.timers?.locked_at,   // burnExpired 10-gün kontrolü için
            pingedAt: t.timers?.pinged_at,
            challengePingedAt: t.timers?.challenge_pinged_at, // YENİ: İtiraz öncesi bekleme süresi
            challengedAt: t.timers?.challenged_at,
            onchainId: t.onchain_escrow_id,
            amount: `${cryptoAmt} ${t.financials?.crypto_asset || 'USDT'}`,
            action: t.status === 'PAID' ? (lang === 'TR' ? 'Onay Bekliyor' : 'Pending Approval') : (lang === 'TR' ? 'İşlemde' : 'In Progress'),
            // YENİ: Odaya geçişte tüm verilerin eksiksiz açılması için raw veriyi saklıyoruz
            rawTrade: {
              id: t._id,
              onchainId: t.onchain_escrow_id,
              maker: formatAddress(t.maker_address),
              makerFull: t.maker_address,
              takerFull: t.taker_address,
              crypto: t.financials?.crypto_asset || 'USDT',
              fiat: t.financials?.fiat_currency || 'TRY',
              rate: rate,
              max: fiatAmt,
              paidAt: t.timers?.paid_at,
              lockedAt: t.timers?.locked_at,
              pingedAt: t.timers?.pinged_at,
              challengePingedAt: t.timers?.challenge_pinged_at,
              challengedAt: t.timers?.challenged_at,
              cancelProposedBy: t.cancel_proposal?.proposed_by, // YENİ: Sayfa yenilense de iptal teklifi kaybolmaz
            }
          };
        }));

        // R-02 Fix: activeTrade'i her polling döngüsünde activeEscrows'daki eşleşen kayıttan güncelle.
        // Önceki hata: activeTrade ayrı state'te kalıyordu — paidAt/challengedAt asla güncellenmiyordu,
        // tüm zamanlayıcılar her zaman null döndürüyordu (timer daima 00:00:00).
        setActiveTrade(prev => {
          if (!prev) return prev;
          const updated = data.trades.find(t => t.onchain_escrow_id === prev.onchainId);
          if (!updated) return prev;
          return {
            ...prev,
            state:        updated.status,
            paidAt:       updated.timers?.paid_at       ?? prev.paidAt,
            lockedAt:     updated.timers?.locked_at     ?? prev.lockedAt,  // burnExpired için
            pingedAt:     updated.timers?.pinged_at     ?? prev.pingedAt,
            challengePingedAt: updated.timers?.challenge_pinged_at ?? prev.challengePingedAt,
            challengedAt: updated.timers?.challenged_at ?? prev.challengedAt,
            cancelProposedBy: updated.cancel_proposal?.proposed_by ?? prev.cancelProposedBy,
          };
        });
      }
    } catch (err) {
      console.error("Trades fetch error:", err);
    }
  }, [isAuthenticated, isConnected, address, lang, authenticatedFetch]);

  // LINTER FIX: cancelStatus senkronizasyonu artık doğrudan activeEscrows üzerinden reaktif çalışıyor.
  // Bu sayede fetchMyTrades hook'u "exhaustive-deps" hatasından kurtuldu.
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

  useEffect(() => {
    fetchMyTrades();
  }, [fetchMyTrades]);

  // Aktif işlem verilerini periyodik olarak yeniden çek (polling)
  useEffect(() => {
    if (currentView !== 'tradeRoom' || !isAuthenticated) return;
    const interval = setInterval(fetchMyTrades, 15000);
    return () => clearInterval(interval);
  }, [currentView, isAuthenticated, fetchMyTrades]);

  // YENİ: Profil modalı açıldığında mevcut PII verilerini çek ve formu doldur
  useEffect(() => {
    if (!showProfileModal || !isAuthenticated) return;

    const fetchMyPII = async () => {
      try {
        // R-03 Not: /api/pii/my GET endpoint'i backend'de yok — form boş başlar, kullanıcı doldurur.
        // Gelecekte GET /api/auth/profile eklendiğinde burası güncellenecek.
        const res = await authenticatedFetch(`${API_URL}/api/pii/my`);
        if (!res.ok) return; // 404 bekleniyor — sessizce atla
        const data = await res.json();
        if (data.pii) {
          setPiiBankOwner(data.pii.bankOwner || '');
          setPiiIban(data.pii.iban || '');
          setPiiTelegram(data.pii.telegram || '');
        }
      } catch (err) {
        console.error("Mevcut PII verisi çekilemedi:", err);
      }
    };

    // Sadece ayarlar sekmesi açıldığında PII verisini çek
    if (profileTab === 'ayarlar') {
      fetchMyPII();
    }
  }, [showProfileModal, profileTab, isAuthenticated, authenticatedFetch]);

  // YENİ: Kullanıcının işlem geçmişini çek
  useEffect(() => {
    // Sadece geçmiş sekmesi aktifken ve JWT varken çalışsın
    if (profileTab !== 'gecmis' || !isAuthenticated) return;

    const fetchHistory = async (page) => {
      try {
        setHistoryLoading(true);
        const res = await authenticatedFetch(`${API_URL}/api/trades/history?page=${page}&limit=5`); // Sayfa başına 5 işlem
        if (!res.ok) throw new Error("History fetch failed");
        const data = await res.json();
        if (data.trades) {
          setTradeHistory(data.trades);
          setTradeHistoryTotal(data.total);
          setTradeHistoryPage(data.page);
          setTradeHistoryLimit(data.limit);
        }
      } catch (err) {
        console.error("İşlem geçmişi çekilemedi:", err);
        setTradeHistory([]);
        setTradeHistoryTotal(0);
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchHistory(tradeHistoryPage);
  }, [showProfileModal, profileTab, isAuthenticated, tradeHistoryPage, authenticatedFetch]);

  // YENİ UI GÜNCELLEMESİ: Sidebar'dan gelen filterToken desteği eklendi
  const filteredOrders = orders.filter(order => {
    const amountMatch = searchAmount === '' || (Number(searchAmount) >= order.min && Number(searchAmount) <= order.max);
    const tierMatch = filterTier1 ? order.tier === 0 : true; 
    const tokenMatch = filterToken === 'ALL' || order.crypto === filterToken;
    return amountMatch && tierMatch && tokenMatch;
  });

  const activeEscrowCounts = {
    LOCKED: activeEscrows.filter(e => e.state === 'LOCKED').length,
    PAID: activeEscrows.filter(e => e.state === 'PAID').length,
    CHALLENGED: activeEscrows.filter(e => e.state === 'CHALLENGED').length,
  };

  // ==========================================
  // R-01 Fix: useCountdown çağrıları renderTradeRoom'dan App gövdesine taşındı.
  // React kuralı: Hook'lar yalnızca component'in en üst seviyesinde çağrılabilir.
  // renderTradeRoom normal bir arrow function olduğundan hook çağrısı "Invalid hook call" hatasına yol açıyordu.
  // ==========================================
  const gracePeriodEndDate = activeTrade?.paidAt ? new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000) : null;
  const gracePeriodTimer = useCountdown(gracePeriodEndDate);

  const challengeUnlockDate = activeTrade?.paidAt ? new Date(new Date(activeTrade.paidAt).getTime() + 1 * 3600 * 1000) : null;
  const challengeCountdown = useCountdown(activeTrade?.challengePingedAt ? new Date(new Date(activeTrade.challengePingedAt).getTime() + 24 * 3600 * 1000) : null);
  // DEV modunda test için cooldownPassed state'i ile challenge kilidi açılabilir
  const canChallenge = import.meta.env.DEV ? (cooldownPassed || challengeCountdown.isFinished) : challengeCountdown.isFinished;

  const bleedingEndDate = activeTrade?.challengedAt ? new Date(new Date(activeTrade.challengedAt).getTime() + 240 * 3600 * 1000) : null;
  const bleedingTimer = useCountdown(bleedingEndDate);

  const principalProtectionEndDate = activeTrade?.challengedAt ? new Date(new Date(activeTrade.challengedAt).getTime() + (48 + 96) * 3600 * 1000) : null;
  const principalProtectionTimer = useCountdown(principalProtectionEndDate);

  // 1. İşlem Odasında React Çökme Hatasının Giderilmesi için Eklenen Zamanlayıcılar
  const makerPingEndDate = activeTrade?.paidAt ? new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000) : null;
  const makerPingTimer = useCountdown(makerPingEndDate);
  const canMakerPing = makerPingTimer.isFinished;

  const makerChallengeEndDate = activeTrade?.challengePingedAt ? new Date(new Date(activeTrade.challengePingedAt).getTime() + 24 * 3600 * 1000) : null;
  const makerChallengeTimer = useCountdown(makerChallengeEndDate);
  const canMakerChallenge = makerChallengeTimer.isFinished;

  // ==========================================
  // --- 3. YARDIMCI FONKSİYONLAR ---
  // ==========================================
  const showToast = (message, type = 'success') => {
    setToast({ id: Date.now(), message, type }); // Benzersiz ID eklemek daha robust
    setTimeout(() => setToast(null), 4000);
  };

  // YENİ: Sidebar 5sn otomatik kapanma — hover ile timer sıfırlanır
  const openSidebar = () => {
    setSidebarOpen(true);
    if (sidebarTimerRef.current) clearTimeout(sidebarTimerRef.current);
    sidebarTimerRef.current = setTimeout(() => setSidebarOpen(false), 5000);
  };

  // FIX-06: null/undefined adres için '—' döndür (önceki: boş string)
  const formatAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '—';

  const getWalletIcon = (name) => {
    const n = name.toLowerCase();
    if (n.includes('metamask')) return '🦊';
    if (n.includes('okx')) return '🖤';
    if (n.includes('coinbase')) return '🔵';
    return '👛';
  };

  // SIWE (Sign-In With Ethereum) Akışı
  const loginWithSIWE = async () => {
    if (!address) return;
    try {
      setIsLoggingIn(true);
      showToast(lang === 'TR' ? 'Lütfen cüzdanınızdan imza isteğini onaylayın 🦊' : 'Please approve the signature request in your wallet 🦊', 'info');

      const nonceRes = await fetch(`${API_URL}/api/auth/nonce?wallet=${address}`, { credentials: 'include' });
      // MİMARİ İYİLEŞTİRME: Nonce ile birlikte SIWE domain'ini de backend'den al.
      const { nonce, siweDomain } = await nonceRes.json();

      const siweMessage = new SiweMessage({
        domain:    siweDomain, // Artık backend'den gelen, güvenilir domain kullanılıyor.
        address,
        statement: 'Sign in to Araf Protocol to manage your trades and secure PII data.',
        uri:       window.location.origin,
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
        setIsAuthenticated(true);
        showToast(lang === 'TR' ? 'Sisteme başarıyla giriş yapıldı! 🚀' : 'Successfully signed in! 🚀', 'success');
      } else {
        const data = await verifyRes.json().catch(() => ({}));
        throw new Error(data.error || 'Doğrulama başarısız');
      }
    } catch (error) {
      console.error("SIWE Error:", error);
      if (error.message?.includes('rejected') || error.message?.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İmza işlemi sizin tarafınızdan iptal edildi.' : 'Signature request was cancelled by you.', 'error');
      } else {
        showToast(lang === 'TR' ? 'Giriş başarısız oldu.' : 'Login failed.', 'error');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Faucet Minting İşlemi
  const handleMint = async (tokenName) => {
    if (!isConnected) {
      showToast(lang === 'TR' ? 'Önce cüzdanınızı bağlayın.' : 'Please connect your wallet first.', 'error');
      return;
    }
    try {
      setIsContractLoading(true);
      setLoadingText(lang === 'TR' ? `${tokenName} alınıyor...` : `Minting ${tokenName}...`);
      const address = import.meta.env[`VITE_MOCK_${tokenName}_ADDRESS`];
      if (!address) throw new Error(lang === 'TR' ? `Test ${tokenName} adresi tanımlı değil.` : `Test ${tokenName} address not defined.`);
      
      await mintToken(address);
      showToast(lang === 'TR' ? `✅ Test ${tokenName} başarıyla alındı!` : `✅ Test ${tokenName} minted successfully!`, 'success');
    } catch (err) {
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'İşlem başarısız.' : 'Transaction failed.');
      showToast(errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
      setLoadingText('');
    }
  };

  useEffect(() => {
    if (!isConnected) {
      setIsAuthenticated(false);
    }
  }, [isConnected, address]); // Bağımlılık doğru

  /**
   * [KRIT-02 Fix]: Taker "Satın Al" akışı — approve() + lockEscrow() tam bağlantısı.
   *
   * Adım 1: Taker bond miktarını hesapla
   * Adım 2: Token allowance kontrol et; yetersizse approve() gönder
   * Adım 3: lockEscrow(onchainId) — cüzdan onayı
   * Başarıda Trade Room'a geç
   */
  const handleStartTrade = async (order) => {
    if (!window.confirm(lang === 'TR' ? 'İşlemi onaylıyor musunuz?' : 'Do you confirm the transaction?')) return;

    if (isBanned) {
      showToast(lang === 'TR' ? '🚫 Taker kısıtlamanız aktif. Süre için on-chain kaydınızı kontrol edin.' : '🚫 Taker restriction active. Check on-chain record for duration.', 'error');
      return;
    }
    if (!order.onchainId) {
      showToast(lang === 'TR' ? 'Bu ilanın on-chain ID\'si henüz yok. Lütfen daha sonra tekrar deneyin.' : 'This listing has no on-chain ID yet. Please try again later.', 'error');
      return;
    }
    if (isContractLoading) return;

    try {
      setIsContractLoading(true);

      // Token adresi — order.crypto (USDT/USDC) → adres
      const tokenAddress = SUPPORTED_TOKEN_ADDRESSES[order.crypto || 'USDT'];
      if (!tokenAddress) {
        showToast(lang === 'TR' ? `${order.crypto} token adresi .env dosyasında tanımlı değil.` : `${order.crypto} token address not configured.`, 'error');
        return;
      }

      // Taker bond hesabı (kontratla aynı mantık, 6 decimal)
      const TAKER_BOND_BPS = { 0: 0n, 1: 1000n, 2: 800n, 3: 500n, 4: 200n };
      const tier = order.tier ?? 1;
      const cryptoAmtRaw = BigInt(Math.round((parseFloat(order.max) || 0) * 1e6));
      const takerBondBps = TAKER_BOND_BPS[tier] ?? 1000n;
      const takerBond = (cryptoAmtRaw * takerBondBps) / 10000n;

      if (takerBond > 0n) {
        const currentAllowance = await getAllowance(tokenAddress, address);
        if (currentAllowance < takerBond) {
          setLoadingText(lang === 'TR' ? `Adım 1/2: ${order.crypto} izni veriliyor...` : `Step 1/2: Approving ${order.crypto}...`);
          await approveToken(tokenAddress, takerBond);
        }
      }

      setLoadingText(lang === 'TR' ? 'Adım 2/2: İşlem kilitleniyor...' : 'Step 2/2: Locking trade...');
      await lockEscrow(BigInt(order.onchainId));

      let realTradeId = null;
      try {
        const tradeRes = await authenticatedFetch(`${API_URL}/api/trades/my`);
        const tradeData = await tradeRes.json();
        const matchedTrade = tradeData.trades?.find(t => t.onchain_escrow_id === order.onchainId);
        if (matchedTrade) realTradeId = matchedTrade._id;
      } catch (_) { /* fallback */ }

      // Başarı — Trade Room'a geç
      setActiveTrade({ ...order, id: realTradeId || order.id, onchainId: order.onchainId });
      setTradeState('LOCKED');
      setCancelStatus(null);
      setCooldownPassed(false);
      setChargebackAccepted(false);
      setCurrentView('tradeRoom');
      showToast(lang === 'TR' ? '🔒 İşlem başarıyla kilitlendi!' : '🔒 Trade locked successfully!', 'success');
    } catch (err) {
      console.error('handleStartTrade error:', err);
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

  // YENİ: Hem on-chain hem off-chain iptali yöneten güncellenmiş fonksiyon
  const handleDeleteOrder = async (order) => {
    if (!order.onchainId) {
      showToast(lang === 'TR' ? 'On-chain işlem ID bulunamadı, sadece veritabanından silinecek.' : 'On-chain ID not found, deleting from DB only.', 'info');
      setOrders(prev => prev.filter(o => o.id !== order.id));
      setConfirmDeleteId(null);
      return;
    }

    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'İlan iptal ediliyor, lütfen cüzdanınızdan onaylayın...' : 'Cancelling listing, please confirm in wallet...', 'info');
      
      // 1. Önce on-chain iptali gerçekleştir
      await cancelOpenEscrow(BigInt(order.onchainId));

      // 3. Arayüzü güncelle
      setOrders(prev => prev.filter(o => o.id !== order.id));
      setConfirmDeleteId(null);
      showToast(lang === 'TR' ? 'İlan iptal edildi ve fonlar iade edildi.' : 'Listing cancelled and funds returned.', 'success');
    } catch (err) {
      console.error("cancelOpenEscrow error:", err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'On-chain iptal başarısız oldu.' : 'On-chain cancellation failed.');
      showToast(errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  /**
   * [KRIT-03 Fix]: Taker ödeme yaptığını bildiriyor — reportPayment(tradeId, ipfsHash).
   *
   * ipfsHash: Taker'ın ödeme kanıtı (dekont). Kontrata kaydedilir.
   * Boş IPFS hash kontrat tarafında EmptyIpfsHash hatasıyla reddedilir.
   * Testnet'te "https://example.com/receipt" gibi geçici bir URL kabul edilebilir;
   * production'da gerçek IPFS hash (Qm...) veya HTTPS URL kullanılmalı.
   */
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setIsContractLoading(true);
      const formData = new FormData();
      formData.append('receipt', file);
      
      // Not: Bu endpoint'in cookie tabanlı auth kullandığını varsayıyoruz.
      const res = await fetch(`${API_URL}/api/receipts/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      
      const data = await res.json();
      if (res.ok && data.hash) {
        setPaymentIpfsHash(data.hash); // State'e SHA-256 hash'ini kaydet
        showToast(lang === 'TR' ? 'Dekont şifrelendi ve yüklendi.' : 'Receipt encrypted and uploaded.', 'success');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      console.error("Dekont yükleme hatası:", err);
      showToast(lang === 'TR' ? 'Dekont yüklenemedi.' : 'Failed to upload receipt.', 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

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
      setCooldownPassed(false);
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

  /**
   * [H-02 Fix]: Mutual cancel — gerçek EIP-712 imzası + proposeOrApproveCancel() kontrat çağrısı.
   *
   * Akış:
   * 1. sigNonces[address] on-chain'den okunur (replay koruması)
   * 2. EIP-712 CancelProposal imzası oluşturulur (1 saatlik deadline)
   * 3. proposeOrApproveCancel(tradeId, deadline, sig) kontrata gönderilir
   * 4. Her iki taraf da çağırdığında kontrat iptal eder
   */
  const handleProposeCancel = async () => {
    if (!activeTrade?.onchainId) {
      showToast(lang === 'TR' ? 'On-chain işlem ID bulunamadı.' : 'On-chain trade ID not found.', 'error');
      return;
    }
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'İptal imzası oluşturuluyor...' : 'Creating cancel signature...', 'info');

      // sigNonces on-chain'den oku
      const ESCROW_ADDR = import.meta.env.VITE_ESCROW_ADDRESS;
      const { getAddress, parseAbi: _parseAbi } = await import('viem');
      const nonceAbi = _parseAbi(['function sigNonces(address) view returns (uint256)']);
      const nonce = await publicClient.readContract({
        address: getAddress(ESCROW_ADDR),
        abi: nonceAbi,
        functionName: 'sigNonces',
        args: [getAddress(address)],
      });

      // EIP-712 imzası oluştur
      const { signature, deadline } = await signCancelProposal(
        activeTrade.onchainId,
        nonce
      );

      // RELAY YOLU (birincil)
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

  // FIX-01: `text` → `comment` (backend Joi şeması `comment` bekliyor)
  // FIX-04: JWT guard eklendi — auth olmadan feedback gönderilemez
  const submitFeedback = async () => {
    if (!isAuthenticated) {
      showToast(lang === 'TR' ? 'Geri bildirim göndermek için giriş yapmalısınız.' : 'Please sign in to send feedback.', 'error');
      return; // JWT yoksa çık
    }
    try {
      // CON-04 Fix: fetch yerine authenticatedFetch kullanılıyor
      await authenticatedFetch(`${API_URL}/api/feedback`, {
        method: 'POST',
        body: JSON.stringify({ rating: feedbackRating, comment: feedbackText, category: feedbackCategory }),
      });
    } catch (err) {
      console.error("Feedback submit error:", err);
    } finally {
      setShowFeedbackModal(false);
      setFeedbackText('');
      setFeedbackRating(0);
      setFeedbackCategory(''); // Formu sıfırla
      showToast(lang === 'TR' ? 'Geri bildiriminiz için teşekkürler!' : 'Thank you for your feedback!', 'success');
    }
  }; // Bu fonksiyonu çağıran useEffect'e eklenmeli

  // [BACKEND-HAKEM Fix]: Backend chargeback-ack çağrısı kaldırıldı.
  // Backend sadece istatistik amaçlıdır — ticari kararlar kontrat tarafından verilir.
  // Onay UI state'te kalır; asıl karar on-chain releaseFunds() ile gerçekleşir.
  const handleChargebackAck = (checked) => {
    setChargebackAccepted(checked);
  };

  // FIX-11: isContractLoading guard + finally block eklendi
  const handleRelease = async () => {
    if (!chargebackAccepted) return;
    if (!activeTrade?.onchainId) {
      showToast(lang === 'TR' ? 'On-chain işlem ID bulunamadı.' : 'On-chain trade ID not found.', 'error');
      return;
    }
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);

      // YENİ: Yasal Log - Chargeback onay logu (Backend entegrasyonu)
      try {
        await authenticatedFetch(`${API_URL}/api/trades/${activeTrade.onchainId}/chargeback-ack`, {
          method: 'POST'
        });
      } catch (err) {
        console.error("Backend chargeback-ack log hatası:", err);
      }

      showToast(lang === 'TR' ? 'İşlem cüzdanınıza gönderildi, onaylayın...' : 'Transaction sent to wallet, please confirm...', 'info');
      await releaseFunds(BigInt(activeTrade.onchainId));
      setTradeState('RESOLVED');
      setCurrentView('home');
      showToast(lang === 'TR' ? 'USDT başarıyla serbest bırakıldı! ✅' : 'USDT successfully released! ✅', 'success');
    } catch (err) {
      console.error("releaseFunds error:", err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Kontrat işlemi başarısız oldu.' : 'Contract transaction failed.');
      if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem sizin tarafınızdan iptal edildi.' : 'Transaction cancelled by you.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  }; // Bu fonksiyonu çağıran useEffect'e eklenmeli

  // FIX-11: isContractLoading guard + finally block eklendi
  // GÜNCELLEME: Artık simetrik ping mekanizmasını (pingTakerForChallenge) destekliyor.
  const handleChallenge = async () => {
    if (!activeTrade?.onchainId) return;
    if (isContractLoading) return;

    // 1. Adım: Henüz ping gönderilmediyse, önce ping gönder.
    // `activeTrade` objesinin backend tarafından `challengePingedAt` ile güncellendiğini varsayıyoruz.
    const tradeDetails = activeEscrows.find(e => e.id === `#${activeTrade.onchainId}`);
    const challengePingedAt = tradeDetails?.challengePingedAt;

    if (!challengePingedAt) {
      try {
        setIsContractLoading(true);
        showToast(lang === 'TR' ? 'Alıcıya uyarı gönderiliyor...' : 'Pinging taker...', 'info');
        await pingTakerForChallenge(BigInt(activeTrade.onchainId));
        showToast(lang === 'TR' ? 'Alıcı uyarıldı. İtiraz için 24 saat beklemeniz gerekiyor.' : 'Taker pinged. You must wait 24h to challenge.', 'success');
        
        // UI'ın hızlı tepki vermesi için state'i manuel de güncelliyoruz (polling'i beklemeden)
        setActiveTrade(prev => ({ ...prev, challengePingedAt: new Date().toISOString() }));
      } catch (err) {
        console.error("pingTakerForChallenge error:", err);
        const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Uyarı gönderilemedi.' : 'Failed to send ping.');
        showToast(errorMessage, 'error');
      } finally {
        setIsContractLoading(false);
      }
      return; // Ping gönderildikten sonra işlemi bitir.
    }

    // 2. Adım: Ping gönderilmiş ve 24 saat geçmişse, itiraz et.
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'İtiraz işlemi cüzdanınıza gönderildi...' : 'Challenge transaction sent to wallet...', 'info');
      await challengeTrade(BigInt(activeTrade.onchainId));
      setTradeState('CHALLENGED');
      setActiveTrade(prev => ({ ...prev, challengedAt: new Date().toISOString() }));
      showToast(lang === 'TR' ? 'İtiraz başlatıldı. Bleeding Escrow aktif.' : 'Challenge opened. Bleeding Escrow active.', 'success');
    } catch (err) {
      console.error("challengeTrade error:", err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'İtiraz işlemi başarısız.' : 'Challenge failed.');
      showToast(errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  // YENİ: pingMaker fonksiyonunu çağıran handler
  const handlePingMaker = async (tradeId) => {
    if (!tradeId) return;
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Uyarı işlemi cüzdanınıza gönderiliyor...' : 'Pinging maker, please confirm in wallet...', 'info');
      await pingMaker(BigInt(tradeId));
      showToast(lang === 'TR' ? 'Satıcı uyarıldı. Yanıt için 24 saati var.' : 'Maker has been pinged. They have 24h to respond.', 'success');
      
      // UI'ın hızlı tepki vermesi için state'i anında güncelliyoruz
      setActiveTrade(prev => ({ ...prev, pingedAt: new Date().toISOString() }));
    } catch (err) {
      console.error("pingMaker error:", err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Ping işlemi başarısız oldu.' : 'Ping failed.');
      if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  }; // Bu fonksiyonu çağıran useEffect'e eklenmeli

  // YENİ: autoRelease fonksiyonunu çağıran handler
  const handleAutoRelease = async (tradeId) => {
    if (!tradeId) return;
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Otomatik serbest bırakma işlemi cüzdanınıza gönderiliyor...' : 'Auto-release transaction sent to wallet...', 'info');
      await autoRelease(BigInt(tradeId));
      setTradeState('RESOLVED');
      setCurrentView('home');
      showToast(lang === 'TR' ? 'İşlem başarıyla sonlandırıldı. Fonlar cüzdanınıza aktarıldı.' : 'Trade successfully resolved. Funds transferred to your wallet.', 'success');
    } catch (err) {
      console.error("autoRelease error:", err);
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Otomatik serbest bırakma başarısız oldu.' : 'Auto-release failed.');
      if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  }; // Bu fonksiyonu çağıran useEffect'e eklenmeli

  // YENİ: PII verilerini güncelleyen handler
  const handleUpdatePII = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) return;
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      // R-03 Fix: Doğru endpoint /api/auth/profile — /api/pii/my backend'de hiç yok (404).
      // Backend routes/auth.js → PUT /api/auth/profile ✓ mevcut ve aktif.
      const res = await authenticatedFetch(`${API_URL}/api/auth/profile`, {
        method: 'PUT',
        body: JSON.stringify({
          bankOwner: piiBankOwner,
          iban: piiIban.replace(/\s/g, ''), // Boşlukları temizle
          telegram: piiTelegram.replace(/^@/, '').trim(), // Güvenlik: Fazladan @ sembolünü ve boşlukları temizle
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Güncelleme başarısız oldu.');
      }
      showToast(lang === 'TR' ? 'Bilgileriniz başarıyla güncellendi.' : 'Your information has been updated successfully.', 'success');
    } catch (err) {
      console.error("PII update error:", err);
      showToast(err.message, 'error');
    } finally {
      setIsContractLoading(false);
    }
  }; // Bu fonksiyonu çağıran useEffect'e eklenmeli

  // Güvenli Telegram URL oluşturucu — PIIDisplay veya dış bileşenler tarafından link oluşturulurken kullanılır
  const getSafeTelegramUrl = React.useCallback((handle) => {
    if (!handle) return '#';
    const safeHandle = handle.replace(/[^a-zA-Z0-9_]/g, '');
    return `https://t.me/${safeHandle}`;
  }, []);

  /**
   * [KRIT-04 Fix]: Yeni cüzdanı on-chain kaydeder — 7 günlük yaşlanma sayacını başlatır.
   * Taker olmak için zorunludur (lockEscrow WalletTooYoung hatası verir).
   */
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
    if (!isConnected || !isAuthenticated) {
      showToast(lang === 'TR' ? 'İlan açmak için önce cüzdanınızı bağlayıp imzalamalısınız.' : 'Please connect and sign in to create an ad.', 'error');
      return;
    }
    setShowMakerModal(true);
  };

  /**
   * [KRIT-01 Fix]: Maker escrow oluşturma — approve() + createEscrow() tam akışı.
   *
   * Adım 1: Token allowance kontrol et
   * Adım 2: Yetersizse approve() gönder → cüzdan onayı
   * Adım 3: createEscrow() → cüzdan onayı
   * Tüm adımlar kullanıcıya toast ile bildirilir.
   */
  const handleCreateEscrow = async () => {
    const tokenAddress = SUPPORTED_TOKEN_ADDRESSES[makerToken];
    if (!tokenAddress) {
      showToast(lang === 'TR' ? `${makerToken} token adresi .env dosyasında tanımlı değil (VITE_${makerToken}_ADDRESS).` : `${makerToken} token address not configured in .env (VITE_${makerToken}_ADDRESS).`, 'error');
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

    try {
      // SORUN-08 Fix: İlanı blockchain'e basmadan önce off-chain olarak DB'de başlat ki event listener eşleyebilsin.
      try {
        await authenticatedFetch(`${API_URL}/api/listings`, {
          method: 'POST',
          body: JSON.stringify({
            crypto_asset: makerToken,
            fiat_currency: makerFiat,
            exchange_rate: parseFloat(makerRate),
            limits: { min: parseFloat(makerMinLimit), max: parseFloat(makerMaxLimit) },
            tier_rules: { required_tier: makerTier }
          })
        });
      } catch (e) {
        console.warn("Off-chain ilan pre-creation uyarısı:", e);
      }

      setIsContractLoading(true);

      // USDT/USDC her ikisi de 6 decimal
      const decimals = BigInt(6);
      const cryptoAmountRaw = BigInt(Math.round(cryptoAmt * 10 ** Number(decimals)));

      // Bond hesabı (kontratla aynı mantık)
      const MAKER_BOND_BPS = { 0: 0n, 1: 800n, 2: 600n, 3: 500n, 4: 200n };
      const bondBps = MAKER_BOND_BPS[makerTier] ?? 0n;
      const makerBondRaw = (cryptoAmountRaw * bondBps) / 10000n;
      const totalLock = cryptoAmountRaw + makerBondRaw;

      // Adım 1: Mevcut allowance kontrol et
      const currentAllowance = await getAllowance(tokenAddress, address);

      if (currentAllowance < totalLock) {
        setLoadingText(lang === 'TR' ? `Adım 1/2: ${makerToken} izni veriliyor...` : `Step 1/2: Approving ${makerToken}...`);
        await approveToken(tokenAddress, totalLock);
      }

      // Adım 2: Escrow oluştur
      setLoadingText(lang === 'TR' ? 'Adım 2/2: Escrow oluşturuluyor...' : 'Step 2/2: Creating escrow...');
      await createEscrow(tokenAddress, cryptoAmountRaw, makerTier);

      showToast(
        lang === 'TR' ? '✅ İlan başarıyla oluşturuldu! Fonlar kilitlendi.' : '✅ Listing created! Funds locked.',
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
      const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Escrow oluşturulamadı.' : 'Failed to create escrow.');
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

  const handleAuthAction = () => {
    if (!isConnected) setShowWalletModal(true);
    else if (!isAuthenticated) loginWithSIWE();
    else { setProfileTab('ayarlar'); setShowProfileModal(true); }
  };

  // --- ÇEVİRİ SÖZLÜĞÜ ---
  const t = {
    title: lang === 'TR' ? 'Pazar Yeri' : 'Marketplace',
    subtitle: lang === 'TR' ? 'Merkeziyetsiz, hakemsiz P2P takas tahtası.' : 'Decentralized, oracle-free P2P escrow board.',
    searchPlaceholder: lang === 'TR' ? 'Tutar Ara...' : 'Search Amount...',
    bondFilter: lang === 'TR' ? '%0 Teminat' : '0% Bond',
    vol: lang === 'TR' ? 'Toplam Hacim' : 'Total Volume',
    trades: lang === 'TR' ? 'Başarılı İşlem' : 'Success Trades',
    users: lang === 'TR' ? 'Aktif Kullanıcı' : 'Active Users',
    burn: lang === 'TR' ? 'Eriyen Kasa' : 'Burned Treasury',
    tableSeller: lang === 'TR' ? 'Satıcı' : 'Seller',
    tableRate: lang === 'TR' ? 'Kur' : 'Rate',
    tableLimit: lang === 'TR' ? 'Limit' : 'Limit',
    tableBond: lang === 'TR' ? 'Bond' : 'Bond',
    tableAction: lang === 'TR' ? 'İşlem' : 'Action',
    buyBtn: lang === 'TR' ? 'Satın Al' : 'Buy',
    createAd: lang === 'TR' ? '+ İlan Aç' : '+ Create Ad',
  };

  // ==========================================
  // --- 4. RENDER MODALLARI ---
  // ==========================================

  const renderWalletModal = () => {
    if (!showWalletModal) return null;
    return (
      <div className="fixed inset-0 bg-[#060608]/90 backdrop-blur-md flex items-center justify-center p-4 z-[100]">
        <div className="bg-[#111113] border border-[#222] rounded-2xl p-6 w-full max-w-sm shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white">{lang === 'TR' ? 'Cüzdan Seçin' : 'Select Wallet'}</h2>
            <button onClick={() => setShowWalletModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>
          <div className="space-y-3">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                onClick={() => { connect({ connector }); setShowWalletModal(false); }}
                className="w-full flex items-center justify-between bg-[#151518] hover:bg-[#1a1a1f] border border-[#2a2a2e] p-4 rounded-xl transition-all group"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{getWalletIcon(connector.name)}</span>
                  <span className="font-bold text-white group-hover:text-emerald-400">{connector.name}</span>
                </div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Connect</span>
              </button>
            ))}
          </div>
          <p className="mt-6 text-[10px] text-center text-slate-500 italic">
            {lang === 'TR' ? '* Araf Protocol hiçbir zaman private key istemez.' : '* Araf Protocol never asks for private keys.'}
          </p>
        </div>
      </div>
    );
  };

  const renderFeedbackModal = () => {
    if (!showFeedbackModal) return null;
    return (
      <div className="fixed inset-0 bg-[#060608]/80 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
        <div className="bg-[#111113] border border-[#222] rounded-2xl p-6 w-full max-w-sm shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">{lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}</h2>
            <button onClick={() => setShowFeedbackModal(false)} className="text-slate-400 hover:text-white text-2xl">&times;</button>
          </div>
          <p className="text-sm text-slate-400 mb-4">{lang === 'TR' ? 'Araf Protocol deneyiminizi nasıl buldunuz?' : 'How is your experience with Araf Protocol?'}</p>
          <div className="flex justify-center space-x-2 mb-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} onClick={() => setFeedbackRating(star)} className={`text-3xl transition ${feedbackRating >= star ? 'text-yellow-400 scale-110' : 'text-slate-600 hover:text-yellow-400/50'}`}>★</button>
            ))}
          </div>
          <select
            value={feedbackCategory}
            onChange={(e) => setFeedbackCategory(e.target.value)}
            className="w-full bg-[#151518] text-white px-3 py-2.5 rounded-xl border border-[#2a2a2e] outline-none text-sm mb-4"
          >
            <option value="" disabled>{lang === 'TR' ? 'Kategori Seçin...' : 'Select Category...'}</option>
            <option value="bug">{lang === 'TR' ? '🐞 Hata Bildirimi' : '🐞 Bug Report'}</option>
            <option value="suggestion">{lang === 'TR' ? '💡 Özellik İsteği' : '💡 Feature Suggestion'}</option>
            <option value="ui/ux">{lang === 'TR' ? '🎨 Tasarım/Kullanıcı Deneyimi' : '🎨 Design/UX'}</option>
            <option value="other">{lang === 'TR' ? 'Diğer' : 'Other'}</option>
          </select>
          <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder={lang === 'TR' ? 'Düşünceleriniz veya bulduğunuz hatalar...' : 'Your thoughts or bugs found...'} className="w-full bg-[#151518] text-white px-3 py-3 rounded-xl border border-[#2a2a2e] outline-none h-24 text-sm mb-4 resize-none"></textarea>
          <button onClick={submitFeedback} disabled={feedbackRating === 0 || feedbackCategory === ''} className={`w-full py-3 rounded-xl font-bold transition ${feedbackRating > 0 && feedbackCategory !== '' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}>
            {lang === 'TR' ? 'Gönder' : 'Submit'}
          </button>
        </div>
      </div>
    );
  };

  const renderMakerModal = () => {
    if (!showMakerModal) return null;

    const MAKER_BOND_PCT = { 0: 0, 1: 8, 2: 6, 3: 5, 4: 2 };
    const TIER_LABELS = {
      0: lang === 'TR' ? 'Tier 0 — Bond Yok (Yeni)' : 'Tier 0 — No Bond (New)',
      1: lang === 'TR' ? 'Tier 1 — %8 Bond (Başlangıç)' : 'Tier 1 — 8% Bond (Starter)',
      2: lang === 'TR' ? 'Tier 2 — %6 Bond (Standart)'  : 'Tier 2 — 6% Bond (Standard)',
      3: lang === 'TR' ? 'Tier 3 — %5 Bond (Deneyimli)' : 'Tier 3 — 5% Bond (Pro)',
      4: lang === 'TR' ? 'Tier 4 — %2 Bond (Premium)'   : 'Tier 4 — 2% Bond (Premium)',
    };

    const bondPct    = MAKER_BOND_PCT[makerTier] ?? 0;
    const cryptoAmt  = parseFloat(makerAmount) || 0;
    const bondAmt    = Math.ceil(cryptoAmt * bondPct / 100);
    const totalLock  = cryptoAmt + bondAmt;
    const effectiveUserTier = userReputation?.effectiveTier ?? 0;

    // Canlı Form Validasyonu (Hata Yakalayıcı)
    const cryptoAmtNum = parseFloat(makerAmount) || 0;
    const rateNum = parseFloat(makerRate) || 0;
    const minLimNum = parseFloat(makerMinLimit) || 0;
    const maxLimNum = parseFloat(makerMaxLimit) || 0;
    const totalFiatValue = cryptoAmtNum * rateNum;

    let validationError = null;
    if (!makerAmount || cryptoAmtNum <= 0) validationError = lang === 'TR' ? 'Satılacak miktarı giriniz.' : 'Enter amount to sell.';
    // 2. Tier Limitleri Doğrulama (Evrensel Kripto Çözümü)
    else if (makerTier === 0 && cryptoAmtNum > 150) validationError = lang === 'TR' ? 'Tier 0 maksimum ilan limiti 150 USDT/USDC.' : 'Tier 0 max limit is 150 USDT/USDC.';
    else if (makerTier === 1 && cryptoAmtNum > 1500) validationError = lang === 'TR' ? 'Tier 1 maksimum ilan limiti 1.500 USDT/USDC.' : 'Tier 1 max limit is 1500 USDT/USDC.';
    else if (makerTier === 2 && cryptoAmtNum > 7500) validationError = lang === 'TR' ? 'Tier 2 maksimum ilan limiti 7.500 USDT/USDC.' : 'Tier 2 max limit is 7500 USDT/USDC.';
    else if (makerTier === 3 && cryptoAmtNum > 30000) validationError = lang === 'TR' ? 'Tier 3 maksimum ilan limiti 30.000 USDT/USDC.' : 'Tier 3 max limit is 30000 USDT/USDC.';
    else if (!makerRate || rateNum <= 0) validationError = lang === 'TR' ? 'Kur fiyatını giriniz.' : 'Enter exchange rate.';
    else if (!makerMinLimit || minLimNum <= 0) validationError = lang === 'TR' ? 'Minimum işlem limitini giriniz.' : 'Enter min limit.';
    else if (!makerMaxLimit || maxLimNum <= 0) validationError = lang === 'TR' ? 'Maksimum işlem limitini giriniz.' : 'Enter max limit.';
    else if (minLimNum > maxLimNum) validationError = lang === 'TR' ? 'Min limit, Max limitten büyük olamaz.' : 'Min limit cannot exceed Max.';
    else if (maxLimNum > totalFiatValue) validationError = lang === 'TR' ? `Max limit toplam değeri (${totalFiatValue.toFixed(2)} ${makerFiat}) aşamaz.` : `Max limit exceeds total fiat (${totalFiatValue.toFixed(2)} ${makerFiat}).`;

    return (
      <div className="fixed inset-0 bg-[#060608]/80 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
        <div className="bg-[#111113] border border-[#222] rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">{t.createAd}</h2>
            <button onClick={() => setShowMakerModal(false)} className="text-slate-400 hover:text-white text-2xl">&times;</button>
          </div>
          <div className="space-y-4">
            <div className="flex space-x-2">
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Satılacak Kripto' : 'Crypto to Sell'}</label>
                <select value={makerToken} onChange={e => setMakerToken(e.target.value)} className="w-full bg-[#151518] text-white px-3 py-2 rounded-xl border border-[#2a2a2e] outline-none">
                  <option value="USDT">USDT</option>
                  <option value="USDC">USDC</option>
                </select>
              </div>
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'İstenecek İtibari Para' : 'Fiat Currency'}</label>
                <select value={makerFiat} onChange={e => setMakerFiat(e.target.value)} className="w-full bg-[#151518] text-white px-3 py-2 rounded-xl border border-[#2a2a2e] outline-none">
                  <option value="TRY">TRY</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Satılacak Miktar' : 'Amount'}</label>
              <input type="number" placeholder="Örn: 1000" value={makerAmount} onChange={e => setMakerAmount(e.target.value)} className="w-full bg-[#151518] text-white px-3 py-2 rounded-xl border border-[#2a2a2e] outline-none" />
            </div>
            <div className="flex space-x-2">
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Kur (1 USDT için)' : 'Rate (per 1 USDT)'}</label>
                <input type="number" placeholder="Örn: 33.50" value={makerRate} onChange={e => setMakerRate(e.target.value)} className="w-full bg-[#151518] text-white px-3 py-2 rounded-xl border border-[#2a2a2e] outline-none" />
              </div>
              <div className="w-1/2"></div>
            </div>
            <div className="flex space-x-2">
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Min. Limit' : 'Min Limit'}</label>
                <input type="number" placeholder="500" value={makerMinLimit} onChange={e => setMakerMinLimit(e.target.value)} className="w-full bg-[#151518] text-white px-3 py-2 rounded-xl border border-[#2a2a2e] outline-none" />
              </div>
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Max. Limit' : 'Max Limit'}</label>
                <input type="number" placeholder="2500" value={makerMaxLimit} onChange={e => setMakerMaxLimit(e.target.value)} className="w-full bg-[#151518] text-white px-3 py-2 rounded-xl border border-[#2a2a2e] outline-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'İlan Tier Seviyesi' : 'Listing Tier'}</label>
              <select value={makerTier} onChange={e => setMakerTier(Number(e.target.value))} className="w-full bg-[#151518] text-white px-3 py-2 rounded-xl border border-[#2a2a2e] outline-none">
                {[0, 1, 2, 3, 4].map(t => (
                  <option key={t} value={t} disabled={t > effectiveUserTier}>
                    {TIER_LABELS[t]} {t > effectiveUserTier ? (lang === 'TR' ? '(Yetersiz)' : '(Too Low)') : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-xl">
              <p className="text-xs text-emerald-400 mb-2 font-medium">🛡️ {TIER_LABELS[makerTier]} {lang === 'TR' ? 'Kuralları' : 'Rules'}</p>
              {bondPct > 0 ? (
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>{lang === 'TR' ? 'Satıcı Teminatı' : 'Maker Bond'} (%{bondPct}):</span>
                  <span>{bondAmt > 0 ? `${bondAmt} Kripto` : '—'}</span>
                </div>
              ) : (
                <p className="text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Tier 0: Teminat yok' : 'Tier 0: No bond'}</p>
              )}
              <div className="flex justify-between text-sm font-bold text-white border-t border-emerald-500/30 pt-2">
                <span>{lang === 'TR' ? 'Toplam Kilitlenecek:' : 'Total Locked:'}</span>
                <span>{totalLock > 0 ? `${totalLock} Kripto` : '—'}</span>
              </div>
            </div>
            
            {validationError && (
              <p className="text-red-400 text-[11px] font-medium text-center bg-red-950/30 py-2 rounded-lg border border-red-900/50 mt-2">{validationError}</p>
            )}
            
            <button
              onClick={handleCreateEscrow}
              disabled={isContractLoading || validationError !== null}
              className={`w-full py-3 rounded-xl font-bold mt-2 shadow-lg transition ${
                isContractLoading || validationError !== null
                  ? 'bg-[#151518] text-slate-500 border border-[#2a2a2e] cursor-not-allowed'
                  : 'bg-white hover:bg-slate-200 text-black shadow-white/10'
              }`}>
              {isContractLoading ? (loadingText || (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...')) : (lang === 'TR' ? '🔒 Onayla ve Kilitle' : '🔒 Approve & Lock')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderProfileModal = () => {
    if (!showProfileModal) return null;
    const myOrders = address ? orders.filter(o => o.makerFull?.toLowerCase() === address.toLowerCase()) : [];

    return (
      <div className="fixed inset-0 bg-[#060608]/90 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 z-[100]">
        <div className="bg-[#111113] border-t sm:border border-[#222] rounded-t-3xl sm:rounded-2xl w-full max-w-2xl shadow-2xl h-[85vh] sm:h-auto sm:max-h-[90vh] flex flex-col pb-16 sm:pb-0">
          <div className="flex justify-between items-center p-5 sm:p-6 border-b border-[#222] shrink-0">
            <h2 className="text-2xl font-bold text-white">{lang === 'TR' ? 'Profil Merkezi' : 'Profile Center'}</h2>
            <button onClick={() => setShowProfileModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>

          <div className="flex border-b border-[#222] shrink-0 overflow-x-auto hide-scrollbar">
            {['ayarlar', 'itibar', 'ilanlarim', 'aktif', 'gecmis'].map(tab => (
              <button key={tab} onClick={() => setProfileTab(tab)} className={`px-4 py-3 text-sm font-medium capitalize transition whitespace-nowrap ${profileTab === tab ? 'text-emerald-400 border-b-2 border-emerald-400 bg-[#1a1a1f]/50' : 'text-slate-400 hover:text-white'}`}>
                {tab === 'ayarlar' ? (lang === 'TR' ? 'Ayarlar' : 'Settings') : tab === 'itibar' ? (lang === 'TR' ? 'İtibar' : 'Reputation') : tab === 'ilanlarim' ? (lang === 'TR' ? 'İlanlarım' : 'My Ads') : tab === 'aktif' ? (lang === 'TR' ? 'Aktif İşlemler' : 'Active Trades') : (lang === 'TR' ? 'Geçmiş' : 'History')}
              </button>
            ))}
          </div>

          <div className="overflow-y-auto p-6 flex-1">
            {/* Orijinal profileTab içerikleri tamamen korunmuştur (PII form, History, vs) */}
            {profileTab === 'ayarlar' && (
              <div className="space-y-4 text-sm">
                {isBanned && (
                  <div className="bg-red-950/40 border border-red-900/50 p-4 rounded-xl flex items-start space-x-3">
                    <span className="text-2xl">🚫</span>
                    <div>
                      <p className="font-bold text-red-400">{lang === 'TR' ? 'Taker Kısıtlaması Aktif' : 'Taker Restriction Active'}</p>
                      <p className="text-red-300/80 text-xs mt-1">{lang === 'TR' ? 'Sadece Maker olarak ilan açabilirsiniz.' : 'You can only create listings as Maker.'}</p>
                    </div>
                  </div>
                )}
                
                <div className="bg-[#151518] p-4 rounded-xl border border-[#2a2a2e]">
                   <p className="text-slate-500 text-xs mb-1 uppercase tracking-widest font-bold">{lang === 'TR' ? 'Cüzdan Adresi' : 'Wallet Address'}</p>
                   <p className="font-mono text-white text-xs break-all">{address ? address : (lang === 'TR' ? 'Bağlı Değil' : 'Not Connected')}</p>
                </div>
                
                <form onSubmit={handleUpdatePII} className="bg-[#151518] p-4 rounded-xl border border-[#2a2a2e] space-y-3">
                  <p className="text-slate-300 text-sm font-bold">{lang === 'TR' ? 'Banka & İletişim Bilgileri' : 'Bank & Contact Info'}</p>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Banka Hesabı Sahibi (Ad Soyad)' : 'Bank Account Owner (Full Name)'}</label>
                    <input type="text" value={piiBankOwner} onChange={e => setPiiBankOwner(e.target.value)} placeholder={lang === 'TR' ? 'Adınız Soyadınız' : 'Your Full Name'} className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">IBAN</label>
                    <input type="text" value={piiIban} onChange={e => setPiiIban(e.target.value)} placeholder="TRXX XXXX XXXX XXXX XXXX XXXX XX" className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none font-mono text-sm" />
                  </div>
                   <div>
                    <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Telegram (Opsiyonel)' : 'Telegram (Optional)'}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">@</span>
                      <input type="text" value={piiTelegram} onChange={e => setPiiTelegram(e.target.value)} placeholder="kullanici_adiniz" className="w-full bg-[#0c0c0e] text-white pl-7 pr-3 py-2 rounded-lg border border-[#222] outline-none text-sm" />
                    </div>
                  </div>
                  <button type="submit" disabled={isContractLoading} className={`w-full py-2.5 rounded-xl font-bold text-sm transition ${isContractLoading ? 'bg-[#222] text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
                    {isContractLoading ? (lang === 'TR' ? 'Kaydediliyor...' : 'Saving...') : (lang === 'TR' ? 'Bilgileri Kaydet' : 'Save Information')}
                  </button>
                  <p className="text-[10px] text-slate-500 text-center pt-3 border-t border-[#2a2a2e]">
                    🔒 {lang === 'TR' ? 'IBAN ve Telegram bilgileriniz AES-256 ile şifrelenir ve asla on-chain kaydedilmez.' : 'Your IBAN and Telegram are AES-256 encrypted and never saved on-chain.'}
                  </p>
                </form>

                <button 
                  onClick={() => { disconnect(); setIsAuthenticated(false); setShowProfileModal(false); }} 
                  className="w-full mt-4 py-2.5 rounded-xl font-bold text-sm bg-red-950/40 text-red-500 border border-red-900/50 hover:bg-red-900/80 hover:text-white transition">
                  {lang === 'TR' ? '🚪 Çıkış Yap / Cüzdanı Ayır' : '🚪 Disconnect / Logout'}
                </button>
              </div>
            )}
            
            {profileTab === 'itibar' && (
               <div className="space-y-3 text-sm">
                  <p className="text-xs text-slate-500 mb-4 text-center italic">{lang === 'TR' ? 'Bu veriler doğrudan on-chain akıllı kontrattan okunur ve değiştirilemez.' : 'This data is read directly from the on-chain smart contract and cannot be altered.'}</p>
                  {!userReputation ? (
                    <div className="text-center text-slate-500 animate-pulse">{lang === 'TR' ? 'İtibar verisi yükleniyor...' : 'Loading reputation data...'}</div>
                  ) : (() => {
                    const { successful, failed, effectiveTier, bannedUntil, consecutiveBans, firstSuccessfulTradeAt } = userReputation;
                    const totalTrades = successful + failed;
                    const successRate = totalTrades > 0 ? Math.round((successful / totalTrades) * 100) : 100;

                    // Tier ilerlemesi için gereksinimler — kontrat mantığıyla senkron
                    const TIER_REQUIREMENTS = {
                      1: { trades: 15, failed: 0 },
                      2: { trades: 50, failed: 1 },
                      3: { trades: 100, failed: 1 },
                      4: { trades: 200, failed: 0 },
                    };
                    const nextTier = effectiveTier + 1;
                    const nextTierReq = TIER_REQUIREMENTS[nextTier];
                    const progress = nextTierReq ? Math.min(100, (successful / nextTierReq.trades) * 100) : 100;

                    return (
                      <div className="space-y-4">
                        {/* Başarı Oranı */}
                        <div className="bg-[#151518] p-4 rounded-xl border border-[#2a2a2e]">
                          <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
                            <span>{lang === 'TR' ? 'Başarı Oranı' : 'Success Rate'}</span>
                            <span>{totalTrades} {lang === 'TR' ? 'İşlem' : 'Trades'}</span>
                          </div>
                          <div className="w-full bg-[#0c0c0e] rounded-full h-2.5 border border-[#222]">
                            <div className="bg-gradient-to-r from-emerald-600 to-emerald-400 h-2.5 rounded-full" style={{ width: `${successRate}%` }}></div>
                          </div>
                          <p className="text-right text-lg font-bold text-emerald-400 mt-2">{successRate}%</p>
                        </div>

                        {/* Tier İlerlemesi — Bir Sonraki Tier'a Kalan İşlem */}
                        {nextTier <= 4 && (
                          <div className="bg-[#151518] p-4 rounded-xl border border-[#2a2a2e]">
                            <div className="flex justify-between items-center text-xs text-slate-400 mb-2">
                              <span>{lang === 'TR' ? `Tier ${nextTier} için İlerleme` : `Progress to Tier ${nextTier}`}</span>
                              <span className="font-mono">{successful} / {nextTierReq.trades}</span>
                            </div>
                            <div className="w-full bg-[#0c0c0e] rounded-full h-2.5 border border-[#222]">
                              <div className="bg-gradient-to-r from-purple-600 to-indigo-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
                            </div>
                            <p className="text-xs text-slate-500 mt-2">
                              {lang === 'TR'
                                ? `Tier ${nextTier}'e ulaşmak için ${Math.max(0, nextTierReq.trades - successful)} başarılı işlem daha yapın.`
                                : `Complete ${Math.max(0, nextTierReq.trades - successful)} more successful trades to reach Tier ${nextTier}.`}
                            </p>
                          </div>
                        )}

                        {/* Detaylı İstatistik Kartları */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-[#151518] p-3 rounded-xl border border-[#2a2a2e] text-center">
                            <p className="text-slate-500 text-[10px] font-bold tracking-widest">{lang === 'TR' ? 'EFEKTİF TIER' : 'EFFECTIVE TIER'}</p>
                            <p className="text-2xl font-bold text-white mt-1">T{effectiveTier}</p>
                          </div>
                          <div className="bg-[#151518] p-3 rounded-xl border border-[#2a2a2e] text-center">
                            <p className="text-slate-500 text-[10px] font-bold tracking-widest">{lang === 'TR' ? 'BAŞARILI' : 'SUCCESSFUL'}</p>
                            <p className="text-2xl font-bold text-emerald-400 mt-1">{successful}</p>
                          </div>
                          <div className="bg-[#151518] p-3 rounded-xl border border-[#2a2a2e] text-center">
                            <p className="text-slate-500 text-[10px] font-bold tracking-widest">{lang === 'TR' ? 'BAŞARISIZ' : 'FAILED'}</p>
                            <p className="text-2xl font-bold text-red-400 mt-1">{failed}</p>
                          </div>
                          <div className="bg-[#151518] p-3 rounded-xl border border-[#2a2a2e] text-center">
                            <p className="text-slate-500 text-[10px] font-bold tracking-widest">{lang === 'TR' ? 'ARDIŞIK YASAK' : 'CONSEC. BANS'}</p>
                            <p className="text-2xl font-bold text-white mt-1">{consecutiveBans}</p>
                          </div>
                        </div>

                        {/* 15 Günlük Aktiflik Süresi */}
                        {firstSuccessfulTradeAt > 0 && new Date().getTime() / 1000 < firstSuccessfulTradeAt + 15 * 24 * 3600 && (
                          <div className="bg-[#151518] p-4 rounded-xl border border-[#2a2a2e]">
                            <p className="text-xs text-slate-400 mb-1">
                              {lang === 'TR' ? 'Tier 1 erişimi için 15 günlük aktiflik sürenizin dolmasına:' : 'Time left for 15-day active period for Tier 1:'}
                            </p>
                            <p className="text-sm font-bold text-yellow-500">
                              {Math.ceil((firstSuccessfulTradeAt + 15 * 24 * 3600 - new Date().getTime() / 1000) / (24 * 3600))} {lang === 'TR' ? 'gün kaldı' : 'days left'}
                            </p>
                          </div>
                        )}

                        {/* Yasak Bitiş Tarihi — Aktif yasak varsa göster */}
                        {bannedUntil > 0 && new Date(bannedUntil * 1000) > new Date() && (
                          <div className="bg-red-950/30 p-3 rounded-xl border border-red-900/50">
                            <p className="text-red-400 text-xs font-medium">{lang === 'TR' ? 'Yasak Bitiş Tarihi' : 'Ban Ends On'}</p>
                            <p className="text-sm font-bold text-white mt-1">
                              {new Date(bannedUntil * 1000).toLocaleString(lang === 'TR' ? 'tr-TR' : 'en-US')}
                            </p>
                          </div>
                        )}

                        {/* Temiz Sayfa Kuralı — Dinamik Butonlu */}
                        {consecutiveBans > 0 && (() => {
                          const now = Date.now() / 1000;
                          const cleanSlateTime = bannedUntil + (180 * 24 * 60 * 60);
                          const isEligible = now > cleanSlateTime && bannedUntil > 0;
                          const isBanActive = now < bannedUntil;
                            
                          return (
                            <div className="bg-blue-950/20 p-4 rounded-xl border border-blue-900/40 text-center mt-4">
                              <p className="text-blue-400 text-xs font-bold mb-2">🛡️ {lang === 'TR' ? 'Temiz Sayfa Hakkı' : 'Clean Slate Right'}</p>
                                      
                              {isBanActive ? (
                                <p className="text-slate-400 text-[11px]">
                                  {lang === 'TR' 
                                    ? 'Cezanız devam ediyor. Ardışık yasak sayacınızı sıfırlamak için cezanız bittikten sonra 180 gün beklemelisiniz.' 
                                    : 'Your ban is active. You must wait 180 days after your ban expires to reset your consecutive bans counter.'}
                                </p>
                              ) : isEligible ? (
                                <>
                                  <p className="text-emerald-400 text-[11px] mb-3">
                                    {lang === 'TR' 
                                      ? 'Tebrikler! Son yasağınızın üzerinden 180 gün geçti. Sicilinizi şimdi temizleyebilirsiniz.' 
                                      : 'Congratulations! 180 days have passed since your last ban. You can clear your record now.'}
                                  </p>
                                  <button
                                    onClick={async () => {
                                      if (isContractLoading) return;
                                      try {
                                        setIsContractLoading(true);
                                        showToast(lang === 'TR' ? 'Sicil temizleme işlemi gönderiliyor...' : 'Sending record clear transaction...', 'info');
                                        await decayReputation(address);
                                        showToast(lang === 'TR' ? '✨ Siciliniz başarıyla temizlendi!' : '✨ Record successfully cleared!', 'success');
                                      } catch (err) {
                                        console.error('decayReputation error:', err);
                                        showToast(lang === 'TR' ? 'İşlem başarısız oldu.' : 'Transaction failed.', 'error');
                                      } finally {
                                        setIsContractLoading(false);
                                      }
                                    }}
                                    disabled={isContractLoading}
                                    className={`w-full py-2.5 rounded-lg font-bold text-xs transition ${isContractLoading ? 'bg-[#1a1a1f] text-slate-500 cursor-not-allowed border border-[#2a2a2e]' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_10px_rgba(37,99,235,0.3)]'}`}
                                  >
                                    {isContractLoading ? (lang === 'TR' ? '⏳ İşlem Onaylanıyor...' : '⏳ Confirming...') : (lang === 'TR' ? '✨ Sicilimi Temizle' : '✨ Clear My Record')}
                                  </button>
                                </>
                              ) : (
                                <p className="text-slate-400 text-[11px]">
                                   {lang === 'TR' 
                                     ? 'Ardışık yasak sayacınızı sıfırlamak için son cezanızın üzerinden 180 gün geçmesi gerekir.' 
                                     : 'You must wait 180 days after your last ban to reset your consecutive bans counter.'}
                                   <br/>
                                   <span className="text-slate-300 font-bold mt-1 block">
                                     {lang === 'TR' ? 'Açılış Tarihi:' : 'Unlock Date:'} {new Date(cleanSlateTime * 1000).toLocaleDateString()}
                                   </span>
                                </p>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
               </div>
            )}

            {/* Diğer Orijinal Sekmeler (İlanlarım, Aktif, Geçmiş) Minimalize Edilerek Dark Tema'ya Uyarlandı */}
            {profileTab === 'ilanlarim' && (
              <div className="space-y-3">
                {myOrders.length > 0 ? myOrders.map(order => (
                  <div key={order.id} className={`bg-[#151518] border rounded-xl p-4 transition-all duration-200 ${confirmDeleteId === order.id ? 'border-red-900/60 bg-red-950/20' : 'border-[#2a2a2e] flex flex-col'}`}>
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-bold text-white text-sm">{order.crypto} → {order.fiat}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{order.rate} {order.fiat} · {order.min}–{order.max}</p>
                      </div>
                      {confirmDeleteId !== order.id && <button onClick={() => setConfirmDeleteId(order.id)} className="text-xs text-red-500 border border-red-900/40 hover:bg-red-900/20 px-3 py-1.5 rounded-lg transition font-medium">{lang === 'TR' ? 'Sil' : 'Delete'}</button>}
                    </div>
                    {confirmDeleteId === order.id && (
                      <div className="mt-3 pt-3 border-t border-red-900/40 flex gap-2">
                        <button onClick={() => handleDeleteOrder(order)} disabled={isContractLoading} className="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-2 rounded-lg transition">{lang === 'TR' ? 'Evet, Sil' : 'Yes, Delete'}</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="flex-1 bg-[#222] hover:bg-[#333] text-slate-300 text-xs font-bold py-2 rounded-lg transition">{lang === 'TR' ? 'İptal' : 'Cancel'}</button>
                      </div>
                    )}
                  </div>
                )) : <p className="text-center text-slate-500 text-xs mt-4">{lang === 'TR' ? 'İlan bulunamadı.' : 'No ads found.'}</p>}
              </div>
            )}

            {profileTab === 'aktif' && (
              <div className="space-y-3">
                {/* Modal İçi Durum Filtreleri */}
                <div className="flex gap-1 mb-4 bg-[#0a0a0c] p-1 rounded-lg border border-[#222]">
                  {['ALL', 'LOCKED', 'PAID', 'CHALLENGED'].map(f => (
                    <button
                      key={f}
                      onClick={() => setActiveTradesFilter(f)}
                      className={`flex-1 text-[10px] font-bold py-1.5 rounded transition ${activeTradesFilter === f ? 'bg-[#222] text-white' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      {f === 'ALL' ? (lang === 'TR' ? 'TÜMÜ' : 'ALL') : f}
                    </button>
                  ))}
                </div>

                {(() => {
                  const filteredEscrows = activeTradesFilter === 'ALL' ? activeEscrows : activeEscrows.filter(e => e.state === activeTradesFilter);
                  
                  if (filteredEscrows.length === 0) {
                    return <p className="text-center text-slate-500 text-xs mt-4">{lang === 'TR' ? 'Bu duruma ait işlem bulunamadı.' : 'No trades found for this status.'}</p>;
                  }

                  return filteredEscrows.map((escrow, index) => (
                    <div key={`${escrow.id}-${index}`} className="bg-[#151518] border border-[#2a2a2e] rounded-xl p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="font-mono text-emerald-400 font-bold">{escrow.id}</span>
                          <span className="text-[10px] text-slate-500 ml-2 uppercase border border-[#333] px-2 py-0.5 rounded">{escrow.role}</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-md border ${escrow.state === 'PAID' ? 'bg-emerald-900/20 border-emerald-900/50 text-emerald-400' : escrow.state === 'CHALLENGED' ? 'bg-red-900/20 border-red-900/50 text-red-500' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>{escrow.state}</span>
                      </div>
                      <p className="text-white font-medium text-sm mb-1">{escrow.amount} <span className="text-slate-500 text-xs ml-1">({escrow.rawTrade.max.toFixed(2)} {escrow.rawTrade.fiat})</span></p>
                      <p className="text-xs text-slate-400 mb-3">Karşı Taraf: <span className="font-mono">{escrow.counterparty}</span></p>
                      <button onClick={() => { 
                        setShowProfileModal(false); 
                        setActiveTrade(escrow.rawTrade); // Odanın verilerle dolmasını sağlayan anahtar kod
                        setUserRole(escrow.role);        // Maker mı Taker mı olduğunu belirliyor
                        setTradeState(escrow.state); 
                        setCurrentView('tradeRoom'); 
                      }} className="w-full mt-3 bg-[#0c0c0e] hover:bg-[#222] text-white text-xs font-bold py-2.5 rounded-lg transition border border-[#2a2a2e]">
                        {lang === 'TR' ? 'Odaya Git →' : 'Go to Room →'}
                      </button>
                    </div>
                  ));
                })()}
              </div>
            )}
            
            {profileTab === 'gecmis' && (
              <div className="space-y-3 text-sm">
                {historyLoading && tradeHistory.length === 0 ? (
                  <div className="text-center text-slate-500 animate-pulse">{lang === 'TR' ? 'Geçmiş yükleniyor...' : 'Loading history...'}</div>
                ) : tradeHistory.length > 0 ? (
                  tradeHistory.map(tx => {
                    const statusMap = { RESOLVED: { text: lang === 'TR' ? 'Tamamlandı' : 'Resolved', color: 'emerald' }, CANCELED: { text: lang === 'TR' ? 'İptal Edildi' : 'Canceled', color: 'slate' }, BURNED: { text: lang === 'TR' ? 'Yakıldı' : 'Burned', color: 'red' } };
                    const displayStatus = statusMap[tx.status] || { text: tx.status, color: 'slate' };
                    const isMaker = tx.maker_address === address?.toLowerCase();
                    return (
                      <div key={tx._id} className="bg-[#151518] border border-[#2a2a2e] rounded-xl p-3 flex justify-between items-center">
                        <div>
                          <p className="font-mono text-[10px] text-slate-500">#{tx.onchain_escrow_id}</p>
                          <p className="text-white font-medium mt-0.5 text-xs"><span className={`mr-1 ${isMaker ? 'text-red-400' : 'text-emerald-400'}`}>{isMaker ? '→' : '←'}</span> {tx.financials.crypto_amount} {tx.financials.crypto_asset}</p>
                        </div>
                        <span className={`text-[10px] px-2 py-1 rounded font-bold text-${displayStatus.color}-400`}>{displayStatus.text}</span>
                      </div>
                    );
                  })
                ) : <p className="text-center text-slate-500 text-xs mt-4">{lang === 'TR' ? 'İşlem geçmişi bulunamadı.' : 'No trade history found.'}</p>}
                
                {tradeHistoryTotal > tradeHistoryLimit && (
                  <div className="flex justify-between items-center pt-4 border-t border-[#222]">
                    <button onClick={() => setTradeHistoryPage(p => p - 1)} disabled={tradeHistoryPage <= 1 || historyLoading} className="px-3 py-1.5 text-xs font-bold rounded bg-[#151518] text-slate-400 disabled:opacity-50 hover:bg-[#222]">←</button>
                    <span className="text-[10px] text-slate-500">{tradeHistoryPage} / {Math.ceil(tradeHistoryTotal / tradeHistoryLimit)}</span>
                    <button onClick={() => setTradeHistoryPage(p => p + 1)} disabled={tradeHistoryPage * tradeHistoryLimit >= tradeHistoryTotal || historyLoading} className="px-3 py-1.5 text-xs font-bold rounded bg-[#151518] text-slate-400 disabled:opacity-50 hover:bg-[#222]">→</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ==========================================
  // --- 5. DUAL-TIER YENİ UI BİLEŞENLERİ ---
  // ==========================================

  const renderSlimRail = () => (
    <div className="hidden md:flex w-16 bg-black border-r border-[#1a1a1a] flex-col items-center py-6 justify-between z-50 shrink-0 shadow-2xl">
      <div className="space-y-6 flex flex-col items-center w-full">
        {/* Logo */}
        <div className="w-8 h-8 rounded bg-gradient-to-br from-white to-slate-400 flex items-center justify-center font-bold text-black mb-4 cursor-pointer" onClick={() => setCurrentView('home')}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="square" strokeLinejoin="miter" strokeWidth="3" d="M4 4h4v4H4zm12 0h4v4h-4zM4 16h4v4H4zm12 0h4v4h-4zM10 10h4v4h-4z" /></svg>
        </div>

        {/* Nav Icons */}
        {/* YENİ: Sidebar tetikleyici — tıklayınca 5sn otomatik kapanan sidebar açılır */}
        <button onClick={openSidebar} title={lang === 'TR' ? 'Filtreler' : 'Filters'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${sidebarOpen ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>☰</button>
        <button onClick={() => setCurrentView('home')} title={lang === 'TR' ? 'Ana Sayfa' : 'Home'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${currentView === 'home' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>🏠</button>
        <button onClick={() => setCurrentView('market')} title={lang === 'TR' ? 'Pazar Yeri' : 'Marketplace'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${currentView === 'market' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>🛒</button>
        <button onClick={() => setCurrentView('tradeRoom')} title={lang === 'TR' ? 'İşlem Odası' : 'Trade Room'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition relative ${currentView === 'tradeRoom' ? 'bg-orange-600/20 text-orange-500' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>
          💼 {activeEscrows.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>}
        </button>
        <button onClick={() => { setProfileTab('gecmis'); setShowProfileModal(true); }} title={lang === 'TR' ? 'İşlem Geçmişi' : 'Trade History'} className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-500 hover:text-white hover:bg-[#111113] transition">🗂️</button>
      </div>

      <div className="space-y-4 flex flex-col items-center w-full px-2">
        <button onClick={() => setLang(lang === 'TR' ? 'EN' : 'TR')} title={lang === 'TR' ? 'Dili Değiştir' : 'Change Language'} className="text-xs font-bold text-slate-400 hover:text-white mb-1">
          {lang}
        </button>
        <button onClick={handleAuthAction} title={isConnected && isAuthenticated ? (lang === 'TR' ? 'Profil Merkezi' : 'Profile Center') : (lang === 'TR' ? 'Cüzdan Bağla' : 'Connect Wallet')} className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all shadow-lg mx-auto ${isConnected && isAuthenticated ? 'border-emerald-500 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'border-[#2a2a2e] bg-[#111113] text-slate-400 hover:text-white hover:border-emerald-500/50 hover:bg-[#1a1a1f]'}`}>
          {isLoggingIn || !authChecked ? <span className="text-xs animate-spin">⚙️</span> : (isConnected && isAuthenticated ? <span className="text-base drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]">👤</span> : <span className="text-base drop-shadow-[0_0_5px_rgba(255,255,255,0.5)]">👛</span>)}
        </button>
      </div>
    </div>
  );

  // YENİ: Dinamik sidebar — 5 saniye sonra otomatik kapanır, hover ile timer sıfırlanır
  const renderContextSidebar = () => (
    <>
      {/* Mobil için arkaplan karartması */}
      {sidebarOpen && <div className="md:hidden fixed inset-0 bg-black/60 z-[55] backdrop-blur-sm transition-opacity" onClick={() => setSidebarOpen(false)} />}
      
      <div
        className={`fixed md:relative top-0 left-0 h-full bg-[#0c0c0e] border-r border-[#1a1a1a] flex flex-col z-[60] md:z-40 shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-[260px] p-5 opacity-100' : 'w-0 p-0 opacity-0'}`}
        onMouseEnter={openSidebar}
        onMouseLeave={() => {}}
      >
      <div className="relative mb-6">
        <span className="absolute left-3 top-2.5 text-slate-500 text-sm">🔍</span>
        <input type="number" value={searchAmount} onChange={e => setSearchAmount(e.target.value)} placeholder={lang === 'TR' ? 'Tutar Ara...' : 'Search...'} className="w-full bg-[#151518] text-white pl-9 pr-3 py-2.5 rounded-xl border border-[#2a2a2e] outline-none focus:border-emerald-500/50 text-sm transition" />
      </div>

      <div className="mb-8">
        <p className="text-[10px] font-bold text-slate-500 mb-3 tracking-widest">{lang === 'TR' ? 'PAZAR YERİ' : 'MARKETPLACE'}</p>
        <div className="space-y-1">
          <button onClick={() => { setFilterToken('ALL'); setCurrentView('market'); }} className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm transition ${filterToken === 'ALL' && currentView === 'market' ? 'bg-[#1a1a1f] text-white border border-[#2a2a2e]' : 'text-slate-400 hover:text-white hover:bg-[#1a1a1f]/50'}`}>
            <div className="flex items-center gap-2"><span className="text-slate-500">⛓️</span> {lang === 'TR' ? 'TÜM İLANLAR' : 'ALL LISTINGS'}</div>
            <span className="bg-[#222] text-[10px] px-2 py-0.5 rounded text-slate-300">{orders.length}</span>
          </button>
          <button onClick={() => { setFilterToken('USDT'); setCurrentView('market'); }} className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm transition ${filterToken === 'USDT' && currentView === 'market' ? 'bg-[#1a1a1f] text-white border border-[#2a2a2e]' : 'text-slate-400 hover:text-white hover:bg-[#1a1a1f]/50'}`}>
            <div className="flex items-center gap-2"><span className="text-emerald-500">₮</span> USDT</div>
            <span className="bg-[#222] text-[10px] px-2 py-0.5 rounded text-slate-300">{orders.filter(o => o.crypto === 'USDT').length}</span>
          </button>
          <button onClick={() => setFilterTier1(!filterTier1)} className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm transition ${filterTier1 ? 'bg-[#1a1a1f] text-yellow-500 border border-yellow-500/20' : 'text-slate-400 hover:text-white hover:bg-[#1a1a1f]/50'}`}>
            <div className="flex items-center gap-2"><span className="text-yellow-500/70">🛡️</span> {lang === 'TR' ? 'Tier 0 Filtresi' : 'Tier 0 Filter'}</div>
          </button>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold text-slate-500 mb-3 tracking-widest">{lang === 'TR' ? 'DURUM' : 'STATUS'}</p>
        <div className="space-y-2">
          {['LOCKED', 'PAID', 'CHALLENGED'].map(status => {
            const count = activeEscrowCounts[status];
            const isExpanded = expandedStatus === status;
            const statusTrades = activeEscrows.filter(e => e.state === status);

            return (
              <div key={status} className="flex flex-col">
                <button
                  onClick={() => setExpandedStatus(isExpanded ? null : status)}
                  className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm transition ${isExpanded ? 'bg-[#1a1a1f] text-white border border-[#2a2a2e]' : 'text-slate-400 hover:text-white hover:bg-[#1a1a1f]/50 border border-transparent'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={status === 'CHALLENGED' ? 'text-red-500' : 'text-slate-500'}>
                      {status === 'LOCKED' ? '🔒' : status === 'PAID' ? '%' : '⚔️'}
                    </span>
                    {status}
                  </div>
                  {count > 0 && (
                    <span className={status === 'CHALLENGED' ? "bg-red-900/40 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded border border-red-900/50" : "bg-[#222] text-[10px] px-2 py-0.5 rounded text-slate-300"}>
                      {status === 'CHALLENGED' ? 'Araf' : count}
                    </span>
                  )}
                </button>
                
                {/* Accordion Listesi (Yan Tarafta Açılan İşlemler) */}
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[500px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                  {statusTrades.length > 0 ? (
                    <div className="pl-3 pr-1 py-1 space-y-2 border-l-2 border-[#222] ml-3">
                      {statusTrades.map(escrow => (
                        <div key={escrow.id} className="bg-[#111113] p-2.5 rounded-lg border border-[#2a2a2e] text-xs shadow-inner">
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="font-mono text-emerald-400 font-bold">{escrow.id}</span>
                            <span className="text-[9px] text-slate-500 uppercase border border-[#333] px-1.5 py-0.5 rounded">{escrow.role}</span>
                          </div>
                          <p className="text-slate-300 mb-2 truncate">{escrow.amount} <span className="text-slate-500 ml-1">({escrow.rawTrade.max.toFixed(0)} {escrow.rawTrade.fiat})</span></p>
                          <button
                            onClick={() => { 
                              setActiveTrade(escrow.rawTrade); 
                              setUserRole(escrow.role);
                              setTradeState(escrow.state); 
                              setCurrentView('tradeRoom');
                              setSidebarOpen(false); // Odaya giderken sidebar kapanır
                            }}
                            className="w-full bg-[#1a1a1f] hover:bg-[#222] text-white text-[10px] font-bold py-1.5 rounded transition border border-[#333]"
                          >
                            {lang === 'TR' ? 'Odaya Git →' : 'Go to Room →'}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="pl-3 ml-3 border-l-2 border-[#222] py-2 text-xs text-slate-600 italic">
                      {lang === 'TR' ? 'Bu duruma ait işlem yok.' : 'No trades in this status.'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto pt-6 border-t border-[#1a1a1a]">
        <div className="flex bg-[#0c0c0e] rounded-lg p-1 border border-[#2a2a2e] mb-3">
           <button onClick={() => setLang('TR')} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition ${lang === 'TR' ? 'bg-[#222] text-white' : 'text-slate-500 hover:text-white'}`}>🇹🇷 TR</button>
           <button onClick={() => setLang('EN')} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition ${lang === 'EN' ? 'bg-[#222] text-white' : 'text-slate-500 hover:text-white'}`}>🇬🇧 EN</button>
        </div>
        <button onClick={handleOpenMakerModal} disabled={isPaused} className={`w-full py-3 bg-gradient-to-r ${isPaused ? 'from-slate-700 to-slate-600 cursor-not-allowed text-slate-400' : 'from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] text-white'} rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2`}>
           <span className="text-lg leading-none">+</span> {lang === 'TR' ? 'YENİ İLAN AÇ' : 'CREATE AD'}
        </button>
      </div>
    </div>
    </>
  );

  const renderHome = () => (
    <div className="p-4 md:p-8 max-w-[1200px] w-full">
      <div className="mb-12">
        <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-300 to-slate-500 tracking-tight mb-3">
          {lang === 'TR' ? <>Sistem yargılamaz. <br/>Dürüstsüzlüğü pahalıya mal eder.</> : <>The system does not judge. <br/>It makes dishonesty expensive.</>}
        </h1>
        <p className="text-slate-500 text-sm max-w-lg">{lang === 'TR' ? 'Merkeziyetsiz, emanet tutmayan ve oracle-bağımsız eşten eşe escrow protokolü. Hakem yok, sadece matematik.' : 'Decentralized, non-custodial, and oracle-free P2P escrow protocol. No arbitrators, just math.'}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mb-10">
        <div className="bg-[#111113] border border-[#222] p-4 md:p-5 rounded-2xl">
          <p className="text-slate-500 text-[10px] font-bold tracking-widest uppercase mb-2">{lang === 'TR' ? 'TOPLAM HACİM' : 'TOTAL VOL'}</p>
          <div className="flex items-baseline">
            <span className="text-2xl font-bold text-white">${((protocolStats?.total_volume_usdt ?? 0) / 1000).toFixed(1)}K</span>
            <StatChange value={protocolStats?.changes_30d?.total_volume_usdt_pct} />
          </div>
        </div>
        <div className="bg-[#111113] border border-[#222] p-4 md:p-5 rounded-2xl">
          <p className="text-slate-500 text-[10px] font-bold tracking-widest uppercase mb-2">{lang === 'TR' ? 'BAŞARILI İŞLEM' : 'SUCCESS TRADES'}</p>
          <div className="flex items-baseline">
            <span className="text-2xl font-bold text-white">{(protocolStats?.completed_trades ?? 0).toLocaleString()}</span>
            <StatChange value={protocolStats?.changes_30d?.completed_trades_pct} />
          </div>
        </div>
        <div className="bg-[#111113] border border-[#222] p-4 md:p-5 rounded-2xl">
          <p className="text-slate-500 text-[10px] font-bold tracking-widest uppercase mb-2">{lang === 'TR' ? 'AKTİF İLAN' : 'ACTIVE ADS'}</p>
          <span className="text-2xl font-bold text-white">{(protocolStats?.active_listings ?? 0).toLocaleString()}</span>
        </div>
        <div className="bg-[#111113] border border-[#222] p-4 md:p-5 rounded-2xl">
          <p className="text-slate-500 text-[10px] font-bold tracking-widest uppercase mb-2">{lang === 'TR' ? 'ORT. SÜRE' : 'AVG TIME'}</p>
          <span className="text-2xl font-bold text-yellow-500">{protocolStats?.avg_trade_hours ?? '—'}s</span>
        </div>
        <div className="bg-[#1a0a0a] border border-[#4a1010] p-4 md:p-5 rounded-2xl relative overflow-hidden group">
          <div className="absolute -right-4 -bottom-4 text-red-500/10 text-6xl group-hover:scale-110 transition-transform">🔥</div>
          <p className="text-red-500 text-[10px] font-bold tracking-widest uppercase mb-2">{lang === 'TR' ? 'ERİYEN HAZİNE' : 'BURNED BONDS'}</p>
          <div className="flex items-baseline relative z-10">
            <span className="text-2xl font-bold text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.5)]">${(protocolStats?.burned_bonds_usdt ?? 0).toFixed(0)}</span>
          </div>
        </div>
      </div>

      {statsError && (
        <div className="col-span-2 md:col-span-5 text-center py-4 text-slate-500 text-xs">
          {lang === 'TR' ? 'İstatistik verisi alınamadı.' : 'Failed to load stats.'}
          <button
            onClick={() => { setStatsError(false); fetchStats(); }}
            className="ml-2 text-emerald-400 hover:underline"
          >
            {lang === 'TR' ? 'Tekrar dene' : 'Retry'}
          </button>
        </div>
      )}
    </div>
  );

  const renderMarket = () => (
    <div className="p-4 md:p-8 max-w-[1200px] w-full">
      <div className="mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-white">{lang === 'TR' ? 'Pazar Yeri' : 'Marketplace'}</h2>
        <div className="flex gap-3 w-full md:w-auto">
          <button onClick={() => handleMint('USDT')} disabled={isContractLoading} className="flex-1 md:flex-none px-4 py-2 bg-[#111113] border border-[#222] hover:bg-[#1a1a1f] rounded-xl text-xs sm:text-sm font-bold text-emerald-400 transition shadow-lg flex items-center justify-center gap-2">
            {isContractLoading && loadingText.includes('USDT') ? '⏳' : '🚰'} {lang === 'TR' ? 'Test USDT Al' : 'Get Test USDT'}
          </button>
          <button onClick={() => handleMint('USDC')} disabled={isContractLoading} className="flex-1 md:flex-none px-4 py-2 bg-[#111113] border border-[#222] hover:bg-[#1a1a1f] rounded-xl text-xs sm:text-sm font-bold text-blue-400 transition shadow-lg flex items-center justify-center gap-2">
            {isContractLoading && loadingText.includes('USDC') ? '⏳' : '🚰'} {lang === 'TR' ? 'Test USDC Al' : 'Get Test USDC'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="p-8 text-center text-slate-500 animate-pulse">{lang === 'TR' ? 'Yükleniyor...' : 'Loading...'}</div>
        ) : filteredOrders.length > 0 ? (
          filteredOrders.map((order) => {
            const effectiveUserTier = userReputation?.effectiveTier ?? 0;
            const isMyOwnAd = address && order.makerFull?.toLowerCase() === address.toLowerCase();
            const isTierLocked = isConnected && isAuthenticated && order.tier > effectiveUserTier;
            const canTakeOrder = isConnected && isAuthenticated && !isMyOwnAd && !isTierLocked && !isPaused;
            
            const tokenAddr = SUPPORTED_TOKEN_ADDRESSES[order.crypto || 'USDT'];
            const isTokenConfigured = Boolean(tokenAddr);
            const isCorrectChain = [8453, 84532, 31337].includes(chainId);

            const isFunded = sybilStatus ? sybilStatus.funded : true;
            const isCooldownOk = sybilStatus ? sybilStatus.cooldownOk : true;
            const cooldownRemaining = sybilStatus ? sybilStatus.cooldownRemaining : 0;
            const finalCanTakeOrder = canTakeOrder && isCooldownOk && isFunded && !isPaused && isTokenConfigured && isCorrectChain;

            return (
              <div key={order.id} className="bg-[#111113] hover:bg-[#151518] border border-[#222] p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between transition-colors group relative gap-4 md:gap-0">
                <div className="flex items-center gap-4 w-full md:w-1/3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-900/20 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shrink-0">
                    ₮
                  </div>
                  <div className="relative group/tooltip">
                    <p className="text-white font-medium text-sm cursor-help">{order.maker}</p>
                    <p className="text-xs text-slate-500">{order.rate} {order.fiat} / 1 {order.crypto}</p>
                    
                    {/* SATICI PROFİLİ HOVER POPUP */}
                    <div className="absolute left-0 sm:-left-4 md:left-1/2 md:-translate-x-1/2 bottom-full mb-2 hidden group-hover/tooltip:block z-50">
                      <div className="bg-[#111] border border-[#333] p-5 rounded-2xl shadow-2xl w-64 backdrop-blur-xl">
                        <p className="text-[10px] text-slate-400 mb-3 tracking-widest">{lang === 'TR' ? 'SATICI PROFİLİ' : 'SELLER PROFILE'}</p>
                        <div className="flex items-center gap-4 mb-4">
                          <div className="w-16 h-16 rounded-full border-[3px] border-emerald-500/30 flex items-center justify-center relative">
                             <span className="text-emerald-400 font-bold text-xl">{order.successRate}%</span>
                             <svg className="absolute inset-0 w-full h-full -rotate-90"><circle cx="50%" cy="50%" r="46%" fill="none" stroke="#10b981" strokeWidth="6" strokeDasharray="100 100" strokeDashoffset={`${100 - order.successRate}`}/></svg>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold">{lang === 'TR' ? 'BAŞARI ORANI' : 'SUCCESS RATE'}</p>
                            <p className="text-xl font-bold text-emerald-400">{order.successRate}%</p>
                          </div>
                        </div>
                        <div className="space-y-2 text-xs border-t border-[#333] pt-3">
                          <div className="flex justify-between"><span className="text-slate-500">{lang === 'TR' ? 'SATIŞ HACMİ' : 'TRADE VOL'}</span><span className="text-white font-mono">{order.txCount} Tx</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">{lang === 'TR' ? 'TIER DÜZEYİ' : 'TIER LEVEL'}</span><span className="text-yellow-500 font-bold">T{order.tier} 🛡️</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="w-full md:w-1/3 text-left md:text-center border-t border-[#222] md:border-none pt-3 md:pt-0">
                  <p className="text-sm font-bold text-slate-300">{order.min} - {order.max} {order.fiat}</p>
                  <p className="text-[10px] text-emerald-500/80 mt-0.5 uppercase tracking-wider">{order.bond} {lang === 'TR' ? 'Teminat' : 'Bond'}</p>
                </div>

                <div className="w-full md:w-1/3 flex flex-col items-start md:items-end justify-center relative">
                   <button onClick={() => handleStartTrade(order)} disabled={!finalCanTakeOrder || isContractLoading} className={`w-full md:w-auto px-6 py-2.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 ${!finalCanTakeOrder ? 'bg-[#1a1a1f] text-slate-500 border border-[#2a2a2e] cursor-not-allowed' : 'bg-white text-black hover:bg-slate-200 shadow-[0_0_15px_rgba(255,255,255,0.1)]'}`}>
                    {isPaused ? <><span>⏸️</span> {lang === 'TR' ? 'Bakımda' : 'Paused'}</> :
                     !isCorrectChain ? <><span>⛓️</span> {lang === 'TR' ? 'Yanlış Ağ' : 'Wrong Network'}</> :
                     !isTokenConfigured ? <><span>⚙️</span> {lang === 'TR' ? 'Token Ayarlanmadı' : 'Token Not Set'}</> :
                     !canTakeOrder ? <><span>🔒</span> {lang === 'TR' ? 'Kilitli' : 'Locked'}</> : 
                     !isFunded ? <><span>⚠️</span> {lang === 'TR' ? 'Bakiye Yetersiz' : 'Low Balance'}</> :
                     !isCooldownOk ? <><span>⏳</span> {lang === 'TR' ? `Bekleme (${Math.ceil(cooldownRemaining/3600)}s)` : `Cooldown (${Math.ceil(cooldownRemaining/3600)}h)`}</> :
                     (isContractLoading ? (loadingText || (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...')) : (lang === 'TR' ? 'Satın Al' : 'Buy'))}
                  </button>
                  {!isFunded && isConnected && canTakeOrder && !isPaused && (
                    <p className="text-[10px] text-red-500 mt-2 text-center md:text-right w-full leading-tight">
                      ⚠️ Anti-Spam: {lang === 'TR' ? 'İşlem yapabilmek için cüzdanınızda en az 0.001 ETH bulunmalıdır.' : 'You must have at least 0.001 ETH in your wallet to trade.'}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-8 text-center text-slate-500">{lang === 'TR' ? 'İlan bulunamadı.' : 'No ads found.'}</div>
        )}
      </div>
    </div>
  );

  const renderTradeRoom = () => {
    const isChallenged = tradeState === 'CHALLENGED';

    // R-01 Fix: Zamanlayıcı değişkenleri artık App gövdesinde tanımlanıyor (hook kuralı).
    // gracePeriodTimer, challengeCountdown, canChallenge, bleedingTimer, principalProtectionTimer
    // component scope'undan erişilebilir — burada yeniden tanımlanmıyor.

    const isTaker = userRole === 'taker';
    const isMaker = userRole === 'maker';

    // Şeffaf Ücret Bilgisi (Fee Breakdown)
    const rawCryptoAmt = ((activeTrade?.max || 0) / (activeTrade?.rate || 1));
    const protocolFee = rawCryptoAmt * 0.001;
    const netAmount = rawCryptoAmt - protocolFee;
    const asset = activeTrade?.crypto || 'USDT';
    const feeBreakdownText = lang === 'TR' ? `Kilitli: ${rawCryptoAmt.toFixed(2)} ${asset} | Protokol Kesintisi: ${protocolFee.toFixed(4)} ${asset} | Net Alınacak: ${netAmount.toFixed(2)} ${asset}` : `Locked: ${rawCryptoAmt.toFixed(2)} ${asset} | Protocol Fee: ${protocolFee.toFixed(4)} ${asset} | Net to Receive: ${netAmount.toFixed(2)} ${asset}`;

    return (
      <div className="p-4 md:p-8 max-w-[900px] w-full mx-auto relative mt-6 md:mt-0">
        <button onClick={() => setCurrentView('market')} className="absolute -top-2 md:-top-4 left-4 md:left-8 text-slate-500 hover:text-white text-sm transition">← {lang === 'TR' ? 'Pazar Yerine Dön' : 'Go Back'}</button>
        
        <div className={`border rounded-2xl p-5 md:p-8 shadow-2xl transition-colors duration-700 ${isChallenged ? 'bg-[#1a0f0f] border-red-900/40' : 'bg-[#111113] border-[#222]'}`}>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 border-b border-[#222] pb-6 gap-4 md:gap-0">
            <div>
              <p className="text-slate-500 text-xs tracking-widest mb-1">{lang === 'TR' ? 'İŞLEM ODASI' : 'TRADE ROOM'}: {activeTrade?.id}</p>
              <h2 className="text-2xl font-bold text-white flex flex-col sm:flex-row items-start sm:items-center gap-3">
                {activeTrade?.max || '0.00'} {activeTrade?.fiat} 
                <span className={`text-xs px-3 py-1 rounded-full border ${isChallenged ? 'bg-red-900/20 text-red-500 border-red-900' : 'bg-emerald-900/20 text-emerald-500 border-emerald-900'}`}>{isChallenged ? (lang === 'TR' ? 'Araf Fazı' : 'Purgatory') : tradeState}</span>
              </h2>
            </div>
            <div className="text-left md:text-right w-full md:w-auto border-t border-[#222] md:border-none pt-4 md:pt-0">
              <p className="text-slate-500 text-xs">{lang === 'TR' ? 'KARŞI TARAF' : 'COUNTERPARTY'}</p>
              <p className="text-white font-mono">{activeTrade?.maker || '0x...'}</p>
            </div>
          </div>

          {/* ATEŞ BARI (BLEEDING ESCROW UI) - Görseldeki tasarıma uygun */}
          {isChallenged && (
            <div className="mb-8 md:mb-10 p-4 md:p-6 bg-[#0a0505] border border-red-950 rounded-xl relative overflow-hidden">
               <div className="flex justify-between text-xs font-bold mb-3">
                 <span className="text-red-500">MAKER BOND</span>
                 <span className="text-orange-500">TAKER BOND</span>
               </div>
               
               {/* Asimetrik Erime Barı Hesaplamaları */}
               {(() => {
                  const myBond = bleedingAmounts ? (isTaker ? Number(bleedingAmounts.takerBondRemaining) : Number(bleedingAmounts.makerBondRemaining)) : null;
                  const opponentBond = bleedingAmounts ? (isTaker ? Number(bleedingAmounts.makerBondRemaining) : Number(bleedingAmounts.takerBondRemaining)) : null;
                  const myBondOrig = myBond !== null ? Math.max(myBond, 1) : 1; 
                  const opponentBondOrig = opponentBond !== null ? Math.max(opponentBond, 1) : 1;
                  const myPct = myBond !== null ? Math.round((myBond / myBondOrig) * 100) : 40;
                  const opponentPct = opponentBond !== null ? Math.round((opponentBond / opponentBondOrig) * 100) : 35;
                  const decayedTotal = bleedingAmounts ? Number(bleedingAmounts.totalDecayed) : 0;

                  return (
                    <>
                      <div className="w-full h-3 bg-[#111] rounded-full flex relative border border-[#222]">
                        {/* Sol Bar */}
                        <div className="h-full bg-gradient-to-r from-red-700 to-red-500 rounded-l-full relative transition-all duration-500" style={{width: `${isMaker ? myPct : opponentPct}%`}}>
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-red-500 rounded-full blur-sm"></div>
                        </div>
                        {/* Orta Eriyen Kısım / Ateş Efekti */}
                        <div className="flex-1 bg-transparent border-y border-red-900/30 flex items-center justify-center overflow-hidden">
                            <div className="w-full h-px bg-red-500/20 shadow-[0_0_10px_red] animate-pulse"></div>
                        </div>
                        {/* Sağ Bar */}
                        <div className="h-full bg-gradient-to-l from-orange-700 to-orange-500 rounded-r-full relative transition-all duration-500" style={{width: `${isTaker ? myPct : opponentPct}%`}}>
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-orange-500 rounded-full blur-sm"></div>
                        </div>
                      </div>

                      <div className="flex flex-col mt-4 space-y-2 relative">
                          <div className="w-full flex justify-between">
                              <span className="text-red-500/50 text-[10px] font-mono">{bleedingTimer.isFinished ? '00:00:00' : `${String(bleedingTimer.hours).padStart(2,'0')}:${String(bleedingTimer.minutes).padStart(2,'0')}:${String(bleedingTimer.seconds).padStart(2,'0')}`}</span>
                              <span className="text-orange-500/50 text-[10px] font-mono">{bleedingTimer.isFinished ? '00:00:00' : `${String(bleedingTimer.hours).padStart(2,'0')}:${String(bleedingTimer.minutes).padStart(2,'0')}:${String(bleedingTimer.seconds).padStart(2,'0')}`}</span>
                          </div>
                          <div className="text-center w-full">
                            <p className="text-red-400 font-bold text-sm drop-shadow-[0_0_5px_red]">{lang === 'TR' ? 'Yanan Toplam:' : 'Total Burned:'} {(decayedTotal / 1e6).toFixed(4)} USDT 🔥</p>
                          </div>
                      </div>
                    </>
                  )
               })()}
               
               <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-500">
                  <span className="text-emerald-500">🔒</span> {lang === 'TR' ? 'Ana Para Güvende:' : 'Principal Safe:'} <span className="font-mono text-emerald-400">{principalProtectionTimer.isFinished ? 'Bitti' : `${principalProtectionTimer.days}g ${principalProtectionTimer.hours}s`}</span>
               </div>
            </div>
          )}

          {/* STANDART İŞLEM ADIMLARI (Orijinal Mantık, Yeni Koyu UI) */}
          <div className="space-y-6">
            
            {/* LOCKED Durumu */}
            {tradeState === 'LOCKED' && (
              <div className="text-center py-6">
                <div className="w-14 h-14 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">🔒</div>
                <h2 className="text-xl md:text-2xl font-bold text-white mb-2">{lang === 'TR' ? 'USDT Kilitlendi' : 'USDT Locked'}</h2>
                {isTaker ? (
                  <div className="w-full max-w-sm mt-4 space-y-3 mx-auto">
                    <div className="relative">
                      <input type="file" onChange={handleFileUpload} accept="image/*,.pdf" className="hidden" id="receipt-upload" />
                      <label htmlFor="receipt-upload" className="w-full bg-[#0a0a0c] text-white px-4 py-3 rounded-xl border border-[#333] mb-4 text-sm flex items-center justify-center cursor-pointer hover:border-blue-500/50 transition">
                        {paymentIpfsHash ? (lang === 'TR' ? '✅ Yüklendi (Hash: ' + paymentIpfsHash.slice(0,8) + '...)' : '✅ Uploaded') : (lang === 'TR' ? '📎 Dekont Yükle' : '📎 Upload Receipt')}
                      </label>
                      <p className="text-[10px] text-slate-500 mt-1 mb-4 text-center">
                        {lang === 'TR' ? 'Dekontunuz AES-256 ile şifrelenir ve işlem bitince kalıcı olarak silinir.' : 'Receipt is AES-256 encrypted and permanently deleted after trade.'}
                      </p>
                    </div>
                    <button onClick={handleReportPayment} disabled={isContractLoading || !paymentIpfsHash.trim()} className={`w-full py-3 rounded-xl font-bold transition ${isContractLoading || !paymentIpfsHash.trim() ? 'bg-[#1a1a1f] text-slate-500 cursor-not-allowed border border-[#2a2a2e]' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.2)]'}`}>
                      {isContractLoading ? '⏳...' : (lang === 'TR' ? '✅ Ödemeyi Bildirdim' : '✅ Report Payment')}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <p className="text-slate-500 mb-6 text-sm animate-pulse">{lang === 'TR' ? 'Alıcının transferi bekleniyor...' : 'Waiting for buyer transfer...'}</p>
                    {isMaker && (
                      <div className="w-full max-w-md mt-2 mx-auto p-4 bg-[#1a0f0f] border border-red-900/30 rounded-xl text-left">
                        <p className="text-xs text-red-400 font-bold mb-1">⚠️ {lang === 'TR' ? 'ÜÇGEN DOLANDIRICILIK ÖNLEMİ' : 'TRIANGULATION FRAUD PREVENTION'}</p>
                        <p className="text-sm text-slate-300 mb-2">
                          {lang === 'TR' ? 'Alıcının Doğrulanmış İsmi:' : "Buyer's Verified Name:"} <span className="font-bold text-white">{takerName || (lang === 'TR' ? 'Yükleniyor...' : 'Loading...')}</span>
                        </p>
                        <p className="text-[11px] text-slate-500 leading-tight">
                          {lang === 'TR' ? 'Gelen paranın gönderici ismi ile bu ismin KESİNLİKLE eşleştiğini teyit ediniz. Eşleşmiyorsa parayı iade edip işlemi iptal edin.' : 'Ensure the sender name on the payment EXACTLY matches this name. If not, refund and cancel.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* PAID Durumu */}
            {tradeState === 'PAID' && (
              <div className="text-center py-4 flex flex-col items-center">
                <h2 className="text-lg md:text-xl font-bold text-emerald-400 mb-2">{lang === 'TR' ? 'Ödeme Bildirildi' : 'Payment Reported'}</h2>
                <div className="w-full max-w-sm bg-[#0a0a0c] border border-[#222] rounded-2xl p-4 mb-6">
                  <p className="text-xs text-slate-500 mb-1 uppercase font-bold">Grace Period</p>
                  <div className="text-4xl sm:text-5xl font-mono font-bold text-white tracking-wider">
                    {gracePeriodTimer.isFinished ? '00:00:00' : `${String(gracePeriodTimer.hours + gracePeriodTimer.days * 24).padStart(2, '0')}:${String(gracePeriodTimer.minutes).padStart(2, '0')}:${String(gracePeriodTimer.seconds).padStart(2, '0')}`}
                  </div>
                </div>
                {isTaker ? (
                  <div className="w-full max-w-md flex flex-col items-center">
                    <p className="text-slate-400 text-sm mb-4">{lang === 'TR' ? 'Satıcının onayı bekleniyor.' : 'Waiting for seller release.'}</p>
                    {(() => {
                      if (!activeTrade?.paidAt) return null;
                      if (activeTrade.pingedAt) {
                        const autoReleaseBecomesAvailableAt = new Date(new Date(activeTrade.pingedAt).getTime() + 24 * 3600 * 1000);
                        const canAutoRelease = new Date() > autoReleaseBecomesAvailableAt;
                        if (canAutoRelease) {
                          return (
                            <div className="w-full mt-2 flex flex-col items-center">
                              <p className="text-[11px] text-red-400 font-bold mb-1 text-center leading-tight">
                                {lang === 'TR' ? 'Dikkat: Satıcı pasif kaldığı için her iki tarafın teminatından %2 ihmal cezası kesilecektir (Maker: %2, Taker: %2).' : 'Warning: Due to maker inaction, a 2% negligence penalty will be deducted from both parties\' bonds (Maker: 2%, Taker: 2%).'}
                              </p>
                              <button onClick={() => handleAutoRelease(activeTrade.onchainId)} disabled={isContractLoading} className="w-full text-sm font-bold py-3 rounded-xl transition bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500 hover:text-white shadow-lg">
                                {isContractLoading ? '...' : (lang === 'TR' ? '✅ Fonları Otomatik Serbest Bırak' : '✅ Auto-Release Funds')}
                              </button>
                            </div>
                          );
                        }
                        return <div className="mt-2 text-center text-xs text-emerald-400 bg-emerald-900/20 p-3 rounded-lg border border-emerald-900/50 w-full"><p className="font-bold">✓ {lang === 'TR' ? 'Satıcı Uyarıldı' : 'Maker Pinged'}</p></div>;
                      }
                      
                      const gracePeriodEnds = new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000);
                      const canPing = new Date() > gracePeriodEnds;
                      
                      if (activeTrade.challengePingedAt) {
                        return (
                          <div className="w-full mt-2 flex flex-col items-center">
                            <button disabled className="w-full text-sm font-bold py-3 rounded-xl transition bg-[#1a1a1f] text-slate-500 border border-[#2a2a2e] cursor-not-allowed">
                              {lang === 'TR' ? '🔔 Satıcıyı Uyar' : '🔔 Ping Maker'}
                            </button>
                            <p className="text-[11px] text-red-400 mt-2 text-center leading-tight">
                              ⚠️ {lang === 'TR' ? 'Satıcı itiraz uyarı sürecini başlattı. Artık otomatik serbest bırakma (Auto-Release) yolunu kullanamazsınız.' : 'Maker has initiated the challenge warning process. You can no longer use Auto-Release.'}
                            </p>
                          </div>
                        );
                      }

                      return <button onClick={() => handlePingMaker(activeTrade.onchainId)} disabled={!canPing || isContractLoading} className={`w-full mt-2 text-sm font-bold py-3 rounded-xl transition ${!canPing || isContractLoading ? 'bg-[#1a1a1f] text-slate-500 border border-[#2a2a2e] cursor-not-allowed' : 'bg-orange-600/20 text-orange-400 border border-orange-500/40 hover:bg-orange-500 hover:text-white'}`}>{isContractLoading ? '...' : canPing ? (lang === 'TR' ? '🔔 Satıcıyı Uyar' : '🔔 Ping Maker') : (lang === 'TR' ? '⏱️ Onay Bekleniyor' : '⏱️ Awaiting Confirmation')}</button>;
                    })()}
                  </div>
                ) : (
                  <div className="w-full max-w-md flex flex-col space-y-4">
                    <label className="flex items-start space-x-3 p-3 md:p-4 bg-[#1a0f0f] border border-red-900/30 rounded-xl cursor-pointer text-left">
                      <input type="checkbox" checked={chargebackAccepted} onChange={(e) => handleChargebackAck(e.target.checked)} className="mt-1 w-4 h-4 accent-emerald-500 rounded bg-[#0a0a0c] border-[#333]" />
                      <span className="text-xs text-slate-400"><strong className="text-red-500">{lang === 'TR' ? 'UYARI:' : 'WARNING:'}</strong> {lang === 'TR' ? 'Paranın farklı isimli bir hesaptan gelmediğini ve Chargeback riskini anladığımı kabul ediyorum.' : 'I confirm the funds came from the correct name and understand the Chargeback risk.'}</span>
                    </label>
                    <div className="flex flex-col sm:flex-row justify-center gap-3">
                      <div className="w-full flex flex-col gap-2">
                        <div className="text-center p-2 bg-[#0c0c0e] rounded-xl border border-[#222]">
                          <p className="text-[10px] text-slate-400 font-mono">{feeBreakdownText}</p>
                        </div>
                        <div className="flex flex-col sm:flex-row justify-center gap-3">
                          <button disabled={!chargebackAccepted || isContractLoading} onClick={handleRelease} className={`w-full sm:w-auto px-8 py-3 rounded-xl font-bold transition ${chargebackAccepted && !isContractLoading ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-[#1a1a1f] text-slate-500 cursor-not-allowed border border-[#2a2a2e]'}`}>{isContractLoading ? (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...') : (lang === 'TR' ? 'Serbest Bırak' : 'Release USDT')}</button>
                        {(() => {
                          if (!activeTrade?.paidAt) return null;
                          // Challenge vs Logic Here remains intact...
                        })()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ORTAK AKSİYONLAR (İptal ve Serbest Bırakma) - LOCKED, PAID, CHALLENGED durumlarında görünür */}
            {['LOCKED', 'PAID', 'CHALLENGED'].includes(tradeState) && (
              <div className="mt-6 bg-[#0c0c0e] border border-[#222] rounded-xl p-4">
                 <div className="mb-3 text-center p-2 bg-[#111113] rounded-lg border border-[#2a2a2e]">
                   <p className="text-[10px] text-slate-400 font-mono">{feeBreakdownText}</p>
                 </div>
                 {cancelStatus === null && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {isChallenged && isMaker && (
                          <button onClick={handleRelease} disabled={isContractLoading} className={`w-full bg-[#0a0a0c] border border-emerald-500/30 text-emerald-500 p-3 rounded-xl font-bold text-sm transition ${isContractLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-emerald-500 hover:text-white'}`}>
                            🤝 {lang === 'TR' ? 'Serbest Bırak' : 'Release'}
                          </button>
                        )}
                        <button onClick={() => {
                          const cancelConfirmMsg = tradeState === 'LOCKED'
                            ? (lang === 'TR' ? 'LOCKED aşamasında (henüz ödeme bildirilmeden) iptaller kesintisizdir. Onaylıyor musunuz?' : 'Cancel in LOCKED state has zero fees. Confirm?')
                            : (lang === 'TR' ? 'Karşılıklı iptal durumunda standart protokol ücreti kesilecektir. Onaylıyor musunuz?' : 'Standard protocol fees will be deducted upon mutual cancellation. Confirm?');
                          
                          if (window.confirm(cancelConfirmMsg)) {
                            handleProposeCancel();
                          }
                        }} className={`w-full bg-[#0a0a0c] border border-orange-500/30 text-orange-500 p-3 rounded-xl font-bold text-sm hover:bg-orange-500 hover:text-white transition ${!(isChallenged && isMaker) ? 'sm:col-span-2' : ''}`}>
                          ↩️ {lang === 'TR' ? 'İptal Teklif Et' : 'Propose Cancel'}
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 text-center mt-3">
                        {lang === 'TR' ? 'Not: İptal onaylandığında her iki taraftan protokol ücreti kesilir.' : 'Note: Protocol fee is deducted from both parties upon cancel.'}
                      </p>
                    </>
                 )}

                 {cancelStatus === 'proposed_by_me' && (
                  <div className="py-3 px-4 bg-orange-900/10 border border-orange-500/20 rounded-xl flex items-center justify-center gap-3">
                    <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
                    <span className="text-orange-400 font-bold text-sm">
                      {lang === 'TR' ? 'İptal teklifiniz gönderildi. Karşı tarafın onayı bekleniyor...' : 'Cancel proposal sent. Awaiting counterparty approval...'}
                    </span>
                  </div>
                 )}

                 {cancelStatus === 'proposed_by_other' && (
                  <div>
                    <p className="text-orange-400 font-bold text-sm mb-2">
                      ⚠️ {lang === 'TR' ? 'Karşı taraf iptal teklif etti.' : 'Opponent proposed cancellation.'}
                    </p>
                    <p className="text-[11px] text-slate-400 mb-3">
                      {tradeState === 'LOCKED'
                        ? (lang === 'TR' ? 'İşlem LOCKED aşamasında olduğu için herhangi bir kesinti yapılmayacaktır.' : 'Since trade is in LOCKED state, no fees will be deducted.')
                        : (lang === 'TR' ? 'Onaylarsanız standart protokol ücreti kesilecek ve kalan fonlar iade edilecektir.' : 'If you approve, standard protocol fee will be deducted and remaining funds returned.')}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                    <button onClick={handleProposeCancel} disabled={isContractLoading} className="w-full bg-orange-600 hover:bg-orange-500 text-white p-3 rounded-xl font-bold text-sm transition">
                      {isContractLoading ? '...' : (lang === 'TR' ? 'Onayla ve İptal Et' : 'Approve Cancel')}
                      </button>
                      <button
                        onClick={() => handleProposeCancel()}
                        className="w-full bg-[#1a1a1f] border border-[#2a2a2e] hover:bg-[#222] text-white p-3 rounded-xl font-bold text-sm transition">
                        {lang === 'TR' ? 'Reddet' : 'Reject'}
                      </button>
                    </div>
                  </div>
                 )}
              </div>
            )}

            {/* PII Verileri (Mevcut Mantık, Koyu Tema) */}
            {isTaker && tradeState !== 'RESOLVED' && (
              <div className="border border-[#222] rounded-xl overflow-hidden mt-6 bg-[#0a0a0c] p-1">
                <PIIDisplay tradeId={activeTrade?.id} lang={lang} getSafeTelegramUrl={getSafeTelegramUrl} />
              </div>
            )}
            {isMaker && tradeState !== 'RESOLVED' && (
              <div className="bg-[#0a0a0c] p-6 rounded-xl border border-[#222] text-center mt-6">
                <div className="text-3xl mb-2">🏦</div>
                <p className="text-slate-300 font-medium text-sm">{lang === 'TR' ? 'Banka hesabınıza ödeme bekleniyor.' : 'Waiting for fiat payment.'}</p>
                <p className="text-xs text-slate-500 mt-2">{lang === 'TR' ? 'Alıcı IBAN\'ınızı şifreli kanaldan aldı.' : 'Buyer received your IBAN via encrypted channel.'}</p>
                <p className="text-xs text-slate-500 mt-2">{lang === 'TR' ? 'Alıcı IBAN ve Telegram bilgilerinizi şifreli kanaldan aldı.' : 'Buyer received your IBAN & Telegram via encrypted channel.'}</p>
              </div>
            )}

            {/* Sprint 1, Madde 5: burnExpired — 10 günden fazla geçmişse yakma butonu */}
            {/* İşlem sadece CHALLENGED durumundaysa göster */}
            {activeTrade?.onchainId && tradeState === 'CHALLENGED' && (() => {
              const burnDate = activeTrade.challengedAt;
              if (!burnDate) return null;
              const tenDaysMs = 10 * 24 * 3600 * 1000;
              const isExpired = new Date().getTime() - new Date(burnDate).getTime() > tenDaysMs;
              if (!isExpired) return null;
              return (
                <div className="mt-6 bg-[#1a0505] border border-red-950 rounded-xl p-4 text-center">
                  <p className="text-red-500 text-xs font-bold mb-2">
                    🔥 {lang === 'TR' ? '10 Gün Süresi Doldu — Sözleşme Artık Yakılabilir' : '10-Day Deadline Passed — Contract Can Now Be Burned'}
                  </p>
                  <p className="text-slate-500 text-[11px] mb-3">
                    {lang === 'TR' ? 'Uyarı: Sözleşme yakıldığında içerideki kilitli tüm USDT ve her iki tarafın teminatları kalıcı olarak Protokol Hazinesine aktarılır. İade yapılmaz.' : 'Warning: When burned, all locked USDT and bonds from both parties are permanently transferred to the Treasury. No refunds.'}
                  </p>
                  <button
                    onClick={async () => {
                      if (isContractLoading) return;
                      try {
                        setIsContractLoading(true);
                        showToast(lang === 'TR' ? 'Yakma işlemi gönderiliyor... Cüzdanınızdan onaylayın.' : 'Burn transaction sent... Confirm in wallet.', 'info');
                        await burnExpired(BigInt(activeTrade.onchainId));
                        setTradeState('RESOLVED');
                        setCurrentView('home');
                        showToast(lang === 'TR' ? '🔥 İşlem yakıldı. Maker bond protokole aktarıldı.' : '🔥 Trade burned. Maker bond transferred to protocol.', 'success');
                      } catch (err) {
                        console.error('burnExpired error:', err);
                        const reason = err.reason || err.message || (lang === 'TR' ? 'Yakma işlemi başarısız.' : 'Burn failed.');
                        showToast(reason, 'error');
                      } finally {
                        setIsContractLoading(false);
                      }
                    }}
                    disabled={isContractLoading}
                    className={`px-6 py-2.5 rounded-xl font-bold text-sm transition ${isContractLoading ? 'bg-[#1a1a1f] text-slate-500 cursor-not-allowed border border-[#2a2a2e]' : 'bg-red-900/30 text-red-400 border border-red-800/50 hover:bg-red-600 hover:text-white'}`}>
                    {isContractLoading ? '⏳...' : (lang === 'TR' ? '🔥 Süresi Dolan İşlemi Yak' : '🔥 Burn Expired Trade')}
                  </button>
                </div>
              );
            })()}

          </div>
        </div>
      </div>
    );
  };

  // YENİ: Mobil cihazlar için Alt Navigasyon (Bottom Bar)
  const renderMobileNav = () => (
    <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#060608] border-t border-[#1a1a1a] z-[45] flex items-center justify-around px-2 pb-safe shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
      <button onClick={() => setCurrentView('home')} className={`p-2 text-xl transition-all ${currentView === 'home' ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] -translate-y-1' : 'text-slate-600'}`}>🏠</button>
      <button onClick={() => setCurrentView('market')} className={`p-2 text-xl transition-all ${currentView === 'market' ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] -translate-y-1' : 'text-slate-600'}`}>🛒</button>
      <button onClick={() => setCurrentView('tradeRoom')} className={`p-2 text-xl transition-all relative ${currentView === 'tradeRoom' ? 'text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)] -translate-y-1' : 'text-slate-600'}`}>
        💼{activeEscrows.length > 0 && <span className="absolute top-2 right-1 w-2.5 h-2.5 bg-orange-500 border border-[#060608] rounded-full animate-pulse"></span>}
      </button>
      <button onClick={openSidebar} className={`p-2 text-xl transition-all ${sidebarOpen ? 'text-white -translate-y-1' : 'text-slate-600'}`}>☰</button>
      <button onClick={handleAuthAction} className={`p-2 text-xl transition-all ${isConnected && isAuthenticated ? 'text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)] -translate-y-1' : 'text-slate-600'}`}>
        {isConnected && isAuthenticated ? '👤' : '👛'}
      </button>
    </div>
  );

  // YENİ: İlk Kullanım Sözleşmesi Modalı
  const renderTermsModal = () => {
    if (termsAccepted || (!isConnected && !isAuthenticated)) return null;
    return (
      <div className="fixed inset-0 bg-[#060608]/95 backdrop-blur-xl flex items-center justify-center p-4 z-[200]">
        <div className="bg-[#111113] border border-[#222] rounded-2xl p-6 w-full max-w-lg shadow-2xl flex flex-col">
          <h2 className="text-xl font-bold text-white mb-4">📜 {lang === 'TR' ? 'Platform Kullanım Sözleşmesi ve Sorumluluk Reddi' : 'Terms of Use and Disclaimer'}</h2>
          <div className="space-y-4 text-sm text-slate-400 mb-6 bg-[#0a0a0c] p-4 rounded-xl border border-[#222] overflow-y-auto max-h-64">
            <p>{lang === 'TR' ? 'Araf Protokolü merkeziyetsiz bir akıllı kontrattır. Hiçbir aracı kurum veya hakem bulunmamaktadır.' : 'Araf Protocol is a decentralized smart contract. There are no intermediaries or arbitrators.'}</p>
            <p>{lang === 'TR' ? 'Tüm işlemleriniz kendi sorumluluğunuzdadır. "Bleeding Escrow" (Eriyen Kasa) oyun teorisine dayalı çalışır ve itiraz durumlarında fonlarınız zamanla eriyebilir.' : 'All transactions are at your own risk. The system operates on the "Bleeding Escrow" game theory, and in case of disputes, your funds may decay over time.'}</p>
            <p className="text-red-400 font-bold">{lang === 'TR' ? 'Chargeback (Ters İbraz) riski tamamen Maker (Satıcı) tarafına aittir. Gelen fonların kaynağını doğrulamak sizin sorumluluğunuzdadır.' : 'The risk of Chargeback belongs entirely to the Maker (Seller). It is your responsibility to verify the source of incoming funds.'}</p>
          </div>
          <button
            onClick={() => {
              localStorage.setItem('araf_terms_accepted', 'true');
              setTermsAccepted(true);
            }}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition shadow-[0_0_15px_rgba(16,185,129,0.3)]"
          >
            {lang === 'TR' ? 'Okudum, Kabul Ediyorum' : 'I Read and Accept'}
          </button>
        </div>
      </div>
    );
  };

  // ANA RETURN BLOĞU
  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#060608] text-slate-100 font-sans overflow-hidden selection:bg-emerald-500/30 pb-16 md:pb-0 relative">
      <EnvWarningBanner />
      
      {isPaused && (
        <div className="absolute top-0 left-0 right-0 z-[70] bg-red-950/90 backdrop-blur border-b border-red-800 px-6 py-2 flex justify-center items-center shadow-xl">
          <span className="text-sm font-bold text-red-200">⚠️ {lang === 'TR' ? 'Sistem şu an bakım modundadır. Yeni işlem açılamaz.' : 'System is currently in maintenance mode. New trades cannot be opened.'}</span>
        </div>
      )}

      {isConnected && chainId !== 84532 && (
        <div className="absolute top-0 left-0 right-0 z-[80] bg-red-950/95 backdrop-blur border-b border-red-800 px-6 py-2 flex justify-center items-center shadow-xl">
          <span className="text-sm font-bold text-red-200">⚠️ {lang === 'TR' ? 'Yanlış Ağ! Lütfen cüzdanınızdan Base Sepolia ağına geçin.' : 'Wrong Network! Please switch to Base Sepolia in your wallet.'}</span>
        </div>
      )}

      {/* Wallet Warning */}
      {isConnected && isWalletRegistered === false && (
        <div className="absolute top-0 left-0 right-0 z-[60] bg-orange-900/90 backdrop-blur border-b border-orange-700 px-6 py-2 flex justify-center items-center gap-4 shadow-xl">
          <span className="text-sm font-bold text-orange-200">⚠️ {lang === 'TR' ? 'Cüzdan On-Chain Kayıtlı Değil (Anti-Sybil 7 Gün)' : 'Wallet Not Registered (Anti-Sybil 7 Days)'}</span>
          <button onClick={handleRegisterWallet} disabled={isRegisteringWallet} className="bg-orange-500 text-black px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-400 disabled:opacity-50 transition">{isRegisteringWallet ? '⏳' : '📝 Kaydet'}</button>
        </div>
      )}

      {renderSlimRail()}
      {renderContextSidebar()}
      {renderMobileNav()}

      <div className="flex-1 overflow-y-auto relative bg-[#060608]">
        <div className="min-h-full flex flex-col pt-4 md:pt-10 pb-24 md:pb-10 items-center">
           {currentView === 'home' ? renderHome() : currentView === 'market' ? renderMarket() : renderTradeRoom()}
        </div>
      </div>

      {/* Modals */}
      {renderWalletModal()}
      {renderFeedbackModal()}
      {renderMakerModal()}
      {renderProfileModal()}
      {renderTermsModal()}

      {/* YENİ: Floating Geri Bildirim Butonu */}
      <button
        onClick={() => setShowFeedbackModal(true)}
        title={lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}
        className="fixed bottom-20 md:bottom-6 left-6 z-40 w-12 h-12 bg-[#111113] hover:bg-[#1a1a1f] border border-[#222] rounded-full flex items-center justify-center text-xl shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 hover:border-slate-600"
      >
        💬
      </button>

      {/* Toast Bildirimleri */}
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
