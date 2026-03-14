import React, { useState, useEffect, useCallback } from 'react'; // AFS-003 Fix: useCallback eklendi
// --- WEB3 ENTEGRASYON KÜTÜPHANELERİ ---
// H-01 Fix: useChainId eklendi — SIWE mesajındaki Chain ID artık hardcoded değil
import { useAccount, useConnect, useDisconnect, useSignMessage, useChainId } from 'wagmi';
import { injected } from 'wagmi/connectors';

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
const EnvWarningBanner = () => {
  if (ENV_ERRORS.length === 0) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-900 text-white p-4 text-center">
      <p className="font-bold text-sm">⚠ Yapılandırma Hatası</p>
      {ENV_ERRORS.map((err, i) => (
        <p key={i} className="text-xs mt-1 text-red-200">{err}</p>
      ))}
      <p className="text-xs mt-2 text-red-300">Yönetici: .env dosyasını kontrol edin.</p>
    </div>
  );
};

function App() {
  // ==========================================
  // --- 1. EKRAN VE STATE YÖNETİMİ ---
  // ==========================================
  // YENİ UX: Başlangıç ekranı 'landing' yapıldı.
  const [currentView, setCurrentView] = useState('landing');
  const [showMakerModal, setShowMakerModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false); // Multi-wallet Seçim Modalı
  
  // YENİ UX: Satıcı Popover kartı için state
  const [activePopover, setActivePopover] = useState(null);

  // --- MİMARİ TEST STATE'LERİ ---
  const [tradeState, setTradeState] = useState('LOCKED');
  const [userRole, setUserRole] = useState('taker');
  const [isBanned, setIsBanned] = useState(false);
  const [cancelStatus, setCancelStatus] = useState(null);
  const [cooldownPassed, setCooldownPassed] = useState(false);
  const [chargebackAccepted, setChargebackAccepted] = useState(false);

  // M-02 Fix: Maker modal için reaktif state'ler
  const [makerTier, setMakerTier]     = useState(1);
  const [makerAmount, setMakerAmount] = useState('');
  // YENİ: Maker modal için eksik state'ler
  const [makerRate, setMakerRate] = useState('');
  const [makerMinLimit, setMakerMinLimit] = useState('');
  const [makerMaxLimit, setMakerMaxLimit] = useState('');

  // --- WEB3 DURUM YÖNETİMİ ---
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const chainId = useChainId();

  const {
    releaseFunds,
    challengeTrade,
    autoRelease,
    pingMaker, // YENİ: Hook'tan gelen fonksiyon
    pingTakerForChallenge, // YENİ: Simetrik ping için hook'tan gelen fonksiyon
    lockEscrow,
    cancelOpenEscrow,
    signCancelProposal,
    proposeOrApproveCancel,
    getReputation, // YENİ: İtibar verisini çekmek için
  } = useArafContract();
  
  // F-01 Fix: JWT artık React state'te saklanmıyor — httpOnly cookie üzerinden taşınıyor.
  // XSS saldırılarında token çalınmasını önler. isAuthenticated sadece oturum varlığını izler.
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // CON-04 Fix: Refresh token state — JWT expire olduğunda otomatik yenileme için
  // F-01 Fix: Refresh token da httpOnly cookie'de — burada saklanmıyor, sadece flag tutuluyor.
  const [refreshTokenState, setRefreshTokenState] = useState(null);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  // FIX-11: Contract işlemleri için loading state — çift tıklama ve kötü UX'i önler
  const [isContractLoading, setIsContractLoading] = useState(false);

  // --- KULLANICI VE VERİ STATE'LERİ ---
  const [lang, setLang] = useState('TR'); 
  const [filterTier1, setFilterTier1] = useState(false);
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
  const [tradeHistoryLimit] = useState(10);

  // NOT: bankOwner ve bankIBAN statik değişkenleri PII entegrasyonu ile artık dinamikleşti.
  const [telegramHandle] = useState('ahmet_tr'); 
  const [activeTrade, setActiveTrade] = useState(null);

  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(0);
  // YENİ: Geri bildirim kategorisi için state
  const [feedbackCategory, setFeedbackCategory] = useState('');

  // Protocol stats — /api/stats'tan çekilir, 1 saatte bir güncellenir
  const [protocolStats, setProtocolStats] = useState(null);
  const [statsLoading, setStatsLoading]   = useState(true);

  // ==========================================
  // --- 2. CANLI VERİLER (API) ---
  // ==========================================
  // Statik diziler silindi, yerini state aldı.
  const [orders, setOrders] = useState([]);
  const [activeEscrows, setActiveEscrows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [toast, setToast] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // ==========================================
  // AFS-003 Fix: useCountdown hook'larını App() üst seviyesine taşıdık.
  // ÖNCEKİ: renderTradeRoom() fonksiyonu içinde koşullu çağrılıyordu.
  // React hook'ları her render döngüsünde AYNI SIRADA ve SAYIDA çağrılmalıdır.
  // Koşullu render içinde hook çağırmak Rules of Hooks ihlalidir ve
  // production'da state karışması, crash ve undefined behavior'a yol açar.
  // ŞİMDİ: Her zaman çağrılır. targetDate null verildiğinde hook isFinished:true döner.
  // ==========================================
  const gracePeriodEndDate = activeTrade?.paidAt
    ? new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000) : null;
  const gracePeriodTimer = useCountdown(gracePeriodEndDate);

  const bleedingEndDate = activeTrade?.challengedAt
    ? new Date(new Date(activeTrade.challengedAt).getTime() + 240 * 3600 * 1000) : null;
  const bleedingTimer = useCountdown(bleedingEndDate);

  const principalProtectionEndDate = activeTrade?.challengedAt
    ? new Date(new Date(activeTrade.challengedAt).getTime() + (48 + 96) * 3600 * 1000) : null;
  const principalProtectionTimer = useCountdown(principalProtectionEndDate);

  /**
   * CON-04 Fix: API çağrıları için wrapper — 401 geldiğinde otomatik token yeniler.
   */
  // F-03 Fix: Eş zamanlı 401 yarış durumunu önlemek için refresh mutex.
  // Birden fazla istek aynı anda 401 alırsa hepsi aynı refresh promise'i paylaşır.
  const refreshPromiseRef = React.useRef(null);

  const authenticatedFetch = useCallback(async (url, options = {}) => {
    // F-01 Fix: Bearer header kaldırıldı — JWT httpOnly cookie olarak otomatik gönderilir.
    const res = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
      },
    });

    if (res.status !== 401) return res;

    // CON-04 Fix: JWT expired — refresh token ile yenile
    // F-03 Fix: Mutex — tek bir refresh isteği uçuşta olabilir
    try {
      if (!refreshPromiseRef.current) {
        refreshPromiseRef.current = fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include', // F-01 Fix: Refresh token httpOnly cookie'den okunur
          headers: { 'Content-Type': 'application/json' },
        }).finally(() => { refreshPromiseRef.current = null; });
      }
      const refreshRes = await refreshPromiseRef.current;

      if (!refreshRes.ok) {
        console.warn('[Auth] Refresh token expired — re-login required');
        setIsAuthenticated(false);
        setRefreshTokenState(null);
        return res; // Orijinal 401 response'u dön
      }

      // F-01 Fix: Yeni token cookie'ye yazıldı — state güncellemesi gerekmez
      // Orijinal isteği httpOnly cookie ile tekrarla
      return fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          ...options.headers,
          'Content-Type': 'application/json',
        },
      });
    } catch (err) {
      console.error('[Auth] Refresh failed:', err);
      return res;
    }
  }, [isAuthenticated, address]);

  // ==========================================
  // AFS-015 Fix: fetchMyTrades useCallback ile üst seviyede tanımlandı.
  // ÖNCEKİ: useEffect içinde anonim (anonymous) fonksiyon olarak tanımlıydı.
  // Polling useEffect'i bu fonksiyona erişemiyordu → ReferenceError.
  // ŞİMDİ: useCallback ile sarmalanarak hem ilk yükleme hem polling
  // useEffect'lerinden güvenli şekilde çağrılabilir.
  // ==========================================
  const fetchMyTrades = useCallback(async () => {
    if (!isAuthenticated || !isConnected) {
      setActiveEscrows([]);
      return;
    }
    try {
      const res = await authenticatedFetch(`${API_URL}/api/trades/my`);
      const data = await res.json();
      
      if (data.trades) {
        setActiveEscrows(data.trades.map(t => ({
          id: `#${t.onchain_escrow_id}`,
          tradeDbId: t._id,
          onchainId: t.onchain_escrow_id,
          role: t.maker_address.toLowerCase() === address?.toLowerCase() ? 'maker' : 'taker',
          // FIX-06: taker_address null olabilir (OPEN state) — null guard eklendi
          counterparty: formatAddress(
            t.maker_address.toLowerCase() === address?.toLowerCase()
              ? (t.taker_address || '')
              : t.maker_address
          ),
          state: t.status,
          paidAt: t.timers?.paid_at,
          pingedAt: t.timers?.pinged_at,
          challengePingedAt: t.timers?.challenge_pinged_at,
          amount: `${t.financials?.crypto_amount || 0} ${t.financials?.crypto_asset || 'USDT'}`,
          action: t.status === 'PAID' ? (lang === 'TR' ? 'Onay Bekliyor' : 'Pending Approval') : (lang === 'TR' ? 'İşlemde' : 'In Progress')
        })));
      }
    } catch (err) {
      console.error("Trades fetch error:", err);
    }
  }, [isAuthenticated, isConnected, address, lang, authenticatedFetch]);

  // 1. Pazar Yeri İlanlarını Çek (Public)
  // AFS-025 Fix: lang dependency kaldırıldı — lang sadece UI metinlerini etkiler, API çağrısı gereksizdi
  useEffect(() => {
    const fetchListings = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/listings`);
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
  }, []); // AFS-025 Fix: lang dependency kaldırıldı

  // Stats Çek
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res  = await fetch(`${API_URL}/api/stats`);
        const data = await res.json();
        if (data.stats) setProtocolStats(data.stats);
      } catch (err) {
        console.error("Stats fetch error:", err);
      } finally {
        setStatsLoading(false);
      }
    };
    fetchStats();
  }, []); // Stats verisi dile bağlı değil, bir kere çekilmesi yeterli

  // YENİ: Kullanıcının on-chain itibarını (ve efektif tier'ını) çek
  useEffect(() => {
    if (!isConnected || !address || !getReputation) {
      setUserReputation(null);
      return;
    }

    const fetchUserReputation = async () => {
      try {
        const repData = await getReputation(address);
        // Kontrat bir struct döndürür, bunu bir objeye dönüştürelim
        setUserReputation({
          successful: Number(repData.successful),
          failed: Number(repData.failed),
          bannedUntil: Number(repData.bannedUntil),
          consecutiveBans: Number(repData.consecutiveBans),
          effectiveTier: Number(repData.effectiveTier),
        });
      } catch (err) {
        console.error("Kullanıcı itibar verisi çekilemedi:", err);
      }
    };
    fetchUserReputation();
  }, [isConnected, address, getReputation]); // Bağımlılıklar doğru

  // AFS-015 Fix: Aktif işlemleri çek — fetchMyTrades artık useCallback ile tanımlı
  useEffect(() => {
    fetchMyTrades();
  }, [fetchMyTrades]);

  // AFS-015 Fix: Polling artık fetchMyTrades referansını kullanıyor
  // ÖNCEKİ: fetchMyTrades() — tanımsız referans, ReferenceError
  // ŞİMDİ: fetchMyTrades useCallback'ten geliyor, dependency array'de
  useEffect(() => {
    if (currentView !== 'tradeRoom' || !isAuthenticated) return;
    const interval = setInterval(fetchMyTrades, 15000); // 15 saniyede bir güncelle
    return () => clearInterval(interval);
  }, [currentView, isAuthenticated, fetchMyTrades]);

  // YENİ: Profil modalı açıldığında mevcut PII verilerini çek ve formu doldur
  // AFS-016 Not: GET /api/pii/my endpoint'i backend'de henüz mevcut değil.
  // Şimdilik form boş başlar. Backend'e GET endpoint eklendikten sonra güncellenecek.
  useEffect(() => {
    if (!showProfileModal || !isAuthenticated) return;
    if (profileTab === 'ayarlar') {
      setPiiBankOwner('');
      setPiiIban('');
      setPiiTelegram('');
    }
  }, [showProfileModal, profileTab, isAuthenticated]);

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

  const filteredOrders = orders.filter(order => {
    const amountMatch = searchAmount === '' || (Number(searchAmount) >= order.min && Number(searchAmount) <= order.max);
    const tierMatch = filterTier1 ? order.tier === 0 : true; // Düzeltme: Tier 0'ı filtrelemesi gerekiyordu
    return amountMatch && tierMatch;
  });

  // ==========================================
  // --- 3. YARDIMCI FONKSİYONLAR ---
  // ==========================================
  const showToast = (message, type = 'success') => {
    setToast({ id: Date.now(), message, type }); // Benzersiz ID eklemek daha robust
    setTimeout(() => setToast(null), 4000);
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

      const nonceRes = await fetch(`${API_URL}/api/auth/nonce?wallet=${address}`);
      // MİMARİ İYİLEŞTİRME: Nonce ile birlikte SIWE domain'ini de backend'den al.
      // AFS-010 Fix: Backend artık siweDomain alanını döndürüyor
      const { nonce, siweDomain } = await nonceRes.json();

      const siweMessage = new SiweMessage({
        // AFS-010 Fix: siweDomain undefined olursa hostname'e fallback
        domain:    siweDomain || window.location.hostname,
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

      // F-01 Fix: credentials:'include' ile sunucu httpOnly cookie'yi set eder
      const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });

      const data = await verifyRes.json();

      // F-01 Fix: Token'ı state'e kaydetme — cookie'de saklı. Sadece auth flag'i set et.
      if (data.success || data.token) {
        setIsAuthenticated(true);
        setRefreshTokenState(data.refreshToken); // CON-04 Fix: Refresh token kaydet
        showToast(lang === 'TR' ? 'Sisteme başarıyla giriş yapıldı! 🚀' : 'Successfully signed in! 🚀', 'success');
      } else {
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

  useEffect(() => {
    if (!isConnected) {
      setIsAuthenticated(false); // F-01 Fix: jwtToken → isAuthenticated
      setRefreshTokenState(null);
    }
  }, [isConnected, address]); // Bağımlılık doğru

  const handleStartTrade = (order) => {
    if (isBanned) {
      // FIX-05: Hardcoded "30 gün" kaldırıldı — consecutive ban 30/60/120/365 gün olabilir
      showToast(lang === 'TR' ? '🚫 Taker kısıtlamanız aktif. Süre için on-chain kaydınızı kontrol edin.' : '🚫 Taker restriction active. Check on-chain record for duration.', 'error');
      return;
    }
    setActiveTrade(order);
    setTradeState('LOCKED');
    setCancelStatus(null);
    setCooldownPassed(false);
    setChargebackAccepted(false);
    setCurrentView('tradeRoom');
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
      // F-04 Fix: BigInt(null) = 0n — yanlış trade'e müdahale riskini önlemek için explicit guard
      if (!order.onchainId || order.onchainId === 0) throw new Error('Invalid onchainId');
      await cancelOpenEscrow(BigInt(order.onchainId));

      // 3. Arayüzü güncelle
      setOrders(prev => prev.filter(o => o.id !== order.id));
      setConfirmDeleteId(null);
      showToast(lang === 'TR' ? 'İlan iptal edildi ve fonlar iade edildi.' : 'Listing cancelled and funds returned.', 'success');
    } catch (err) {
      console.error("cancelOpenEscrow error:", err);
      showToast(lang === 'TR' ? 'On-chain iptal başarısız oldu.' : 'On-chain cancellation failed.', 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  const handleProposeCancel = () => {
    setCancelStatus('proposed_by_me');
    showToast(lang === 'TR' ? 'İptal teklifi gönderildi. Onay bekleniyor...' : 'Cancel proposal sent. Waiting for approval...', 'info');
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
  };

  const getSafeTelegramUrl = (handle) => {
    const safeHandle = handle.replace(/[^a-zA-Z0-9_]/g, '');
    return `https://t.me/${safeHandle}`;
  };

  const handleChargebackAck = async (checked) => {
    setChargebackAccepted(checked);
    if (!checked || !activeTrade?.id || !isAuthenticated) return;
    try {
      // CON-04 Fix: fetch yerine authenticatedFetch kullanılıyor
      await authenticatedFetch(`${API_URL}/api/trades/${activeTrade.id}/chargeback-ack`, {
        method: 'POST',
      });
    } catch (err) {
      console.error("Chargeback ack error:", err);
    }
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
      showToast(lang === 'TR' ? 'İşlem cüzdanınıza gönderildi, onaylayın...' : 'Transaction sent to wallet, please confirm...', 'info');
      // F-04 Fix: BigInt(null) = 0n riski — explicit null & zero guard
      if (!activeTrade.onchainId || activeTrade.onchainId === 0) throw new Error('Invalid onchainId');
      await releaseFunds(BigInt(activeTrade.onchainId));
      setTradeState('RESOLVED');
      setCurrentView('dashboard');
      showToast(lang === 'TR' ? 'USDT başarıyla serbest bırakıldı! ✅' : 'USDT successfully released! ✅', 'success');
    } catch (err) {
      console.error("releaseFunds error:", err);
      if (err.message?.includes('rejected') || err.message?.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem sizin tarafınızdan iptal edildi.' : 'Transaction cancelled by you.', 'error');
      } else {
        showToast(lang === 'TR' ? 'Kontrat işlemi başarısız oldu.' : 'Contract transaction failed.', 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  };

  // FIX-11: isContractLoading guard + finally block eklendi
  // GÜNCELLEME: Artık simetrik ping mekanizmasını (pingTakerForChallenge) destekliyor.
  const handleChallenge = async () => {
    if (!activeTrade?.onchainId) return;
    if (isContractLoading) return;

    // 1. Adım: Henüz ping gönderilmediyse, önce ping gönder.
    const tradeDetails = activeEscrows.find(e => e.id === `#${activeTrade.onchainId}`);
    const challengePingedAt = tradeDetails?.challengePingedAt;

    if (!challengePingedAt) {
      try {
        setIsContractLoading(true);
        showToast(lang === 'TR' ? 'Alıcıya uyarı gönderiliyor...' : 'Pinging taker...', 'info');
        // F-04 Fix: BigInt(null) = 0n riski — explicit null & zero guard
        if (!activeTrade.onchainId || activeTrade.onchainId === 0) throw new Error('Invalid onchainId');
        await pingTakerForChallenge(BigInt(activeTrade.onchainId));
        showToast(lang === 'TR' ? 'Alıcı uyarıldı. İtiraz için 24 saat beklemeniz gerekiyor.' : 'Taker pinged. You must wait 24h to challenge.', 'success');
        // Arayüz polling ile güncellenecek
      } catch (err) {
        console.error("pingTakerForChallenge error:", err);
        const reason = err.reason || (lang === 'TR' ? 'Uyarı gönderilemedi.' : 'Failed to send ping.');
        showToast(reason, 'error');
      } finally {
        setIsContractLoading(false);
      }
      return; // Ping gönderildikten sonra işlemi bitir.
    }

    // 2. Adım: Ping gönderilmiş ve 24 saat geçmişse, itiraz et.
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'İtiraz işlemi cüzdanınıza gönderildi...' : 'Challenge transaction sent to wallet...', 'info');
      // F-04 Fix: BigInt(null) = 0n riski — explicit null & zero guard
      if (!activeTrade.onchainId || activeTrade.onchainId === 0) throw new Error('Invalid onchainId');
      await challengeTrade(BigInt(activeTrade.onchainId));
      setTradeState('CHALLENGED');
      showToast(lang === 'TR' ? 'İtiraz başlatıldı. Bleeding Escrow aktif.' : 'Challenge opened. Bleeding Escrow active.', 'success');
    } catch (err) {
      console.error("challengeTrade error:", err);
      // Kontrat revert mesajını göstermek daha faydalı
      const reason = err.reason || (lang === 'TR' ? 'İtiraz işlemi başarısız.' : 'Challenge failed.');
      showToast(reason, 'error');
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
      // F-04 Fix: BigInt(null) = 0n riski — explicit null & zero guard
      if (!tradeId || tradeId === 0) throw new Error('Invalid tradeId');
      await pingMaker(BigInt(tradeId));
      showToast(lang === 'TR' ? 'Satıcı uyarıldı. Yanıt için 24 saati var.' : 'Maker has been pinged. They have 24h to respond.', 'success');
    } catch (err) {
      console.error("pingMaker error:", err);
      if (err.message?.includes('rejected') || err.message?.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        const reason = err.reason || 'Ping işlemi başarısız oldu.';
        showToast(reason, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  };

  // YENİ: autoRelease fonksiyonunu çağıran handler
  const handleAutoRelease = async (tradeId) => {
    if (!tradeId) return;
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Otomatik serbest bırakma işlemi cüzdanınıza gönderiliyor...' : 'Auto-release transaction sent to wallet...', 'info');
      // F-04 Fix: BigInt(null) = 0n riski — explicit null & zero guard
      if (!tradeId || tradeId === 0) throw new Error('Invalid tradeId');
      await autoRelease(BigInt(tradeId));
      setTradeState('RESOLVED');
      setCurrentView('dashboard');
      showToast(lang === 'TR' ? 'İşlem başarıyla sonlandırıldı. Fonlar cüzdanınıza aktarıldı.' : 'Trade successfully resolved. Funds transferred to your wallet.', 'success');
    } catch (err) {
      console.error("autoRelease error:", err);
      if (err.message?.includes('rejected') || err.message?.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        const reason = err.reason || 'Otomatik serbest bırakma başarısız oldu.';
        showToast(reason, 'error');
      }
    } finally {
      setIsContractLoading(false);
    }
  };

  // AFS-016 Fix: PII güncelleme endpoint'i PUT /api/auth/profile olarak düzeltildi.
  // ÖNCEKİ: PUT /api/pii — backend'de bu endpoint mevcut değildi, 404 dönerdi.
  // Backend'deki doğru endpoint: PUT /api/auth/profile (auth.js route'u)
  const handleUpdatePII = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) return;
    if (isContractLoading) return;

    try {
      setIsContractLoading(true);
      // AFS-016 Fix: /api/pii → /api/auth/profile
      const res = await authenticatedFetch(`${API_URL}/api/auth/profile`, {
        method: 'PUT',
        body: JSON.stringify({
          bankOwner: piiBankOwner,
          iban: piiIban.replace(/\s/g, ''), // Boşlukları temizle
          telegram: piiTelegram,
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
  };

  const handleOpenMakerModal = () => {
    if (!isConnected || !isAuthenticated) {
      showToast(lang === 'TR' ? 'İlan açmak için önce cüzdanınızı bağlayıp imzalamalısınız.' : 'Please connect and sign in to create an ad.', 'error');
      return;
    }
    setShowMakerModal(true);
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

  // YENİ: İstatistik değişim yüzdesini gösteren bileşen
  const StatChange = ({ value }) => {
    if (value == null) return null;
    const isPositive = value >= 0;
    const colorClass = isPositive ? 'text-emerald-400' : 'text-red-400';
    const icon = isPositive ? '▲' : '▼';
    return (
      <span className={`text-xs font-bold ${colorClass} flex items-center`}>
        {icon}
        {Math.abs(value).toFixed(1)}%
      </span>
    );
  };

  // ==========================================
  // --- 4. RENDER MODALLARI ---
  // ==========================================

  const renderWalletModal = () => {
    if (!showWalletModal) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4 z-[100]">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white">{lang === 'TR' ? 'Cüzdan Seçin' : 'Select Wallet'}</h2>
            <button onClick={() => setShowWalletModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>
          <div className="space-y-3">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                onClick={() => { connect({ connector }); setShowWalletModal(false); }}
                className="w-full flex items-center justify-between bg-slate-900 hover:bg-slate-700 border border-slate-700 p-4 rounded-xl transition-all group"
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
      <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
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
          {/* YENİ: Kategori Dropdown */}
          <select
            value={feedbackCategory}
            onChange={(e) => setFeedbackCategory(e.target.value)}
            className="w-full bg-slate-900 text-white px-3 py-2.5 rounded-xl border border-slate-700 outline-none text-sm mb-4"
          >
            <option value="" disabled>{lang === 'TR' ? 'Kategori Seçin...' : 'Select Category...'}</option>
            <option value="bug">{lang === 'TR' ? '🐞 Hata Bildirimi' : '🐞 Bug Report'}</option>
            <option value="suggestion">{lang === 'TR' ? '💡 Özellik İsteği' : '💡 Feature Suggestion'}</option>
            <option value="ui/ux">{lang === 'TR' ? '🎨 Tasarım/Kullanıcı Deneyimi' : '🎨 Design/UX'}</option>
            <option value="other">{lang === 'TR' ? 'Diğer' : 'Other'}</option>
          </select>
          <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder={lang === 'TR' ? 'Düşünceleriniz veya bulduğunuz hatalar...' : 'Your thoughts or bugs found...'} className="w-full bg-slate-900 text-white px-3 py-3 rounded-xl border border-slate-700 outline-none h-24 text-sm mb-4 resize-none"></textarea>
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
      0: lang === 'TR' ? 'Tier 0 — Bond Yok (Yeni Kullanıcı)' : 'Tier 0 — No Bond (New User)',
      1: lang === 'TR' ? 'Tier 1 — %8 Bond (Başlangıç)'       : 'Tier 1 — 8% Bond (Starter)',
      2: lang === 'TR' ? 'Tier 2 — %6 Bond (Standart)'        : 'Tier 2 — 6% Bond (Standard)',
      3: lang === 'TR' ? 'Tier 3 — %5 Bond (Deneyimli)'       : 'Tier 3 — 5% Bond (Experienced)',
      4: lang === 'TR' ? 'Tier 4 — %2 Bond (Premium)'         : 'Tier 4 — 2% Bond (Premium)',
    };

    const bondPct    = MAKER_BOND_PCT[makerTier] ?? 0;
    const cryptoAmt  = parseFloat(makerAmount) || 0;
    const bondAmt    = Math.ceil(cryptoAmt * bondPct / 100);
    const totalLock  = cryptoAmt + bondAmt;

    // Kullanıcının izin verilen en yüksek tier'ını al. Veri henüz yüklenmediyse
    // en güvenli varsayılan olan 0'ı kullan.
    const effectiveUserTier = userReputation?.effectiveTier ?? 0;

    return (
      <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">{t.createAd}</h2>
            <button onClick={() => setShowMakerModal(false)} className="text-slate-400 hover:text-white text-2xl">&times;</button>
          </div>
          {/* F-05 Fix: userReputation henüz yüklenmediyse tier selector'ı loading state'de göster */}
          {isConnected && userReputation === null && (
            <div className="mb-4 p-3 bg-slate-700/50 border border-slate-600 rounded-xl flex items-center space-x-2 text-sm text-slate-400 animate-pulse">
              <svg className="animate-spin h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              <span>{lang === 'TR' ? 'İtibar verisi yükleniyor, tier seçenekleri güncelleniyor...' : 'Loading reputation data, tier options updating...'}</span>
            </div>
          )}
          <div className="space-y-4">
            <div className="flex space-x-2">
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Satılacak Kripto' : 'Crypto to Sell'}</label>
                <select className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none"><option>USDT</option><option>USDC</option></select>
              </div>
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'İstenecek İtibari Para' : 'Fiat Currency'}</label>
                <select className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none"><option>TRY</option><option>USD</option><option>EUR</option></select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Satılacak Miktar' : 'Amount'}</label>
              <input
                type="number" placeholder="Örn: 1000"
                value={makerAmount} onChange={e => setMakerAmount(e.target.value)}
                className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none" />
            </div>
            <div className="flex space-x-2">
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Kur Fiyatı (1 USDT için)' : 'Exchange Rate (per 1 USDT)'}</label>
                <input type="number" placeholder="Örn: 33.50" value={makerRate} onChange={e => setMakerRate(e.target.value)} className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none" />
              </div>
              <div className="w-1/2">
              </div>
            </div>
            <div className="flex space-x-2">
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Min. Limit' : 'Min Limit'}</label>
                <input type="number" placeholder="500" value={makerMinLimit} onChange={e => setMakerMinLimit(e.target.value)} className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none" />
              </div>
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Max. Limit' : 'Max Limit'}</label>
                <input type="number" placeholder="2500" value={makerMaxLimit} onChange={e => setMakerMaxLimit(e.target.value)} className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'İlan Tier Seviyesi' : 'Listing Tier'}</label>
              <select
                value={makerTier}
                onChange={e => setMakerTier(Number(e.target.value))}
                className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none">
                {[0, 1, 2, 3, 4].map(tierVal => (
                  <option
                    key={tierVal}
                    value={tierVal}
                    disabled={tierVal > effectiveUserTier}>
                    {TIER_LABELS[tierVal]} {tierVal > effectiveUserTier ? (lang === 'TR' ? '(Yetersiz İtibar)' : '(Reputation Too Low)') : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-xl">
              <p className="text-xs text-emerald-400 mb-2 font-medium">
                🛡️ {TIER_LABELS[makerTier]} {lang === 'TR' ? 'Kuralları Geçerlidir' : 'Rules Apply'}
              </p>
              {bondPct > 0 ? (
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>{lang === 'TR' ? 'Satıcı Teminatı' : 'Maker Bond'} (%{bondPct}):</span>
                  <span>{bondAmt > 0 ? `${bondAmt} Kripto` : '—'}</span>
                </div>
              ) : (
                <p className="text-xs text-slate-400 mb-1">
                  {lang === 'TR' ? 'Tier 0: Teminat yok — sadece kripto kilitlenir.' : 'Tier 0: No bond — only crypto is locked.'}
                </p>
              )}
              <div className="flex justify-between text-sm font-bold text-white border-t border-emerald-500/30 pt-2">
                <span>{lang === 'TR' ? 'Toplam Kilitlenecek:' : 'Total Locked:'}</span>
                <span>{totalLock > 0 ? `${totalLock} Kripto` : '—'}</span>
              </div>
            </div>
            <button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold mt-2 shadow-lg shadow-emerald-900/20">{lang === 'TR' ? 'Varlığı ve Teminatı Kilitle' : 'Lock Asset & Bond'}</button>
          </div>
        </div>
      </div>
    );
  };

  const renderProfileModal = () => {
    if (!showProfileModal) return null;
    // FIX-07: makerFull alanı ile filtre — önceki: o.maker (truncated) ile full address karşılaştırıyordu
    const myOrders = address ? orders.filter(o => o.makerFull?.toLowerCase() === address.toLowerCase()) : [];

    return (
      <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
          <div className="flex justify-between items-center p-6 border-b border-slate-700 shrink-0">
            <h2 className="text-2xl font-bold text-white">{lang === 'TR' ? 'Profil Merkezi' : 'Profile Center'}</h2>
            <button onClick={() => setShowProfileModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>

          <div className="flex border-b border-slate-700 shrink-0 overflow-x-auto hide-scrollbar">
            {['ayarlar', 'itibar', 'ilanlarim', 'aktif', 'gecmis'].map(tab => (
              <button key={tab} onClick={() => setProfileTab(tab)} className={`px-4 py-3 text-sm font-medium capitalize transition whitespace-nowrap ${profileTab === tab ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400 hover:text-white'}`}>
                {tab === 'ayarlar' ? (lang === 'TR' ? 'Ayarlar' : 'Settings') : tab === 'itibar' ? (lang === 'TR' ? 'İtibar' : 'Reputation') : tab === 'ilanlarim' ? (lang === 'TR' ? 'İlanlarım' : 'My Ads') : tab === 'aktif' ? (lang === 'TR' ? 'Aktif İşlemler' : 'Active Trades') : (lang === 'TR' ? 'Geçmiş' : 'History')}
              </button>
            ))}
          </div>

          <div className="overflow-y-auto p-6 flex-1">
            {profileTab === 'ayarlar' && (
              <div className="space-y-4 text-sm">
                {isBanned && (
                  <div className="bg-red-950/40 border border-red-900/50 p-4 rounded-xl flex items-start space-x-3">
                    <span className="text-2xl">🚫</span>
                    <div>
                      <p className="font-bold text-red-400">{lang === 'TR' ? 'Taker Kısıtlaması Aktif' : 'Taker Restriction Active'}</p>
                      <p className="text-red-300/80 text-xs mt-1">{lang === 'TR' ? 'Sadece Maker olarak ilan açabilirsiniz. Bitiş tarihi için on-chain kaydı kontrol edin.' : 'You can only create listings as Maker. Check on-chain record for expiry date.'}</p>
                    </div>
                  </div>
                )}
                
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                   <p className="text-slate-400 text-xs mb-1 uppercase tracking-widest font-bold">Cüzdan Adresi</p>
                   <p className="font-mono text-white text-xs break-all">{address ? address : 'Bağlı Değil'}</p>
                </div>
                
                {/* YENİ: PII Güncelleme Formu */}
                <form onSubmit={handleUpdatePII} className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
                  <p className="text-slate-300 text-sm font-bold">{lang === 'TR' ? 'Banka & İletişim Bilgileri' : 'Bank & Contact Info'}</p>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Banka Hesabı Sahibi (Ad Soyad)' : 'Bank Account Owner (Full Name)'}</label>
                    <input type="text" value={piiBankOwner} onChange={e => setPiiBankOwner(e.target.value)} placeholder={lang === 'TR' ? 'Adınız Soyadınız' : 'Your Full Name'} className="w-full bg-slate-800 text-white px-3 py-2 rounded-lg border border-slate-600 outline-none text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">IBAN</label>
                    <input type="text" value={piiIban} onChange={e => setPiiIban(e.target.value)} placeholder="TRXX XXXX XXXX XXXX XXXX XXXX XX" className="w-full bg-slate-800 text-white px-3 py-2 rounded-lg border border-slate-600 outline-none font-mono text-sm" />
                  </div>
                   <div>
                    <label className="block text-xs text-slate-400 mb-1">Telegram (Opsiyonel)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">@</span>
                      <input type="text" value={piiTelegram} onChange={e => setPiiTelegram(e.target.value)} placeholder="kullanici_adiniz" className="w-full bg-slate-800 text-white pl-7 pr-3 py-2 rounded-lg border border-slate-600 outline-none text-sm" />
                    </div>
                  </div>
                  <button type="submit" disabled={isContractLoading} className={`w-full py-2.5 rounded-xl font-bold text-sm transition ${isContractLoading ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
                    {isContractLoading ? (lang === 'TR' ? 'Kaydediliyor...' : 'Saving...') : (lang === 'TR' ? 'Bilgileri Kaydet' : 'Save Information')}
                  </button>
                  <p className="text-[10px] text-slate-500 text-center pt-2 border-t border-slate-700">
                    🔒 {lang === 'TR' ? 'Bu bilgiler şifrelenerek saklanır ve asla on-chain kaydedilmez.' : 'This information is stored encrypted and is never saved on-chain.'}
                  </p>
                </form>
              </div>
            )}
            
            {profileTab === 'itibar' && (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-slate-400 mb-4 text-center italic">{lang === 'TR' ? 'Bu veriler doğrudan on-chain akıllı kontrattan okunur ve değiştirilemez.' : 'This data is read directly from the on-chain smart contract and cannot be altered.'}</p>
                {!userReputation ? (
                  <div className="text-center text-slate-500 animate-pulse">{lang === 'TR' ? 'İtibar verisi yükleniyor...' : 'Loading reputation data...'}</div>
                ) : (() => {
                  const { successful, failed, effectiveTier, bannedUntil, consecutiveBans } = userReputation;
                  const totalTrades = successful + failed;
                  const successRate = totalTrades > 0 ? Math.round((successful / totalTrades) * 100) : 100;

                  const TIER_REQUIREMENTS = { 1: { trades: 15, failed: 0 }, 2: { trades: 50, failed: 1 }, 3: { trades: 100, failed: 1 }, 4: { trades: 200, failed: 0 } };
                  const nextTier = effectiveTier + 1;
                  const nextTierReq = TIER_REQUIREMENTS[nextTier];
                  const progress = nextTierReq ? Math.min(100, (successful / nextTierReq.trades) * 100) : 100;

                  return (
                    <div className="space-y-4">
                      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                        <div className="flex justify-between items-center text-xs text-slate-400 mb-2"><span>{lang === 'TR' ? 'Başarı Oranı' : 'Success Rate'}</span><span>{totalTrades} {lang === 'TR' ? 'İşlem' : 'Trades'}</span></div>
                        <div className="w-full bg-slate-800 rounded-full h-2.5 border border-slate-700/50"><div className="bg-gradient-to-r from-emerald-500 to-green-500 h-2.5 rounded-full" style={{ width: `${successRate}%` }}></div></div>
                        <p className="text-right text-lg font-bold text-emerald-400 mt-2">{successRate}%</p>
                      </div>
                      {nextTier <= 4 && (
                        <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                          <div className="flex justify-between items-center text-xs text-slate-400 mb-2"><span>{lang === 'TR' ? `Tier ${nextTier} için İlerleme` : `Progress to Tier ${nextTier}`}</span><span className="font-mono">{successful} / {nextTierReq.trades}</span></div>
                          <div className="w-full bg-slate-800 rounded-full h-2.5 border border-slate-700/50"><div className="bg-gradient-to-r from-purple-500 to-indigo-500 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div></div>
                          <p className="text-xs text-slate-500 mt-2">{lang === 'TR' ? `Tier ${nextTier}'e ulaşmak için ${Math.max(0, nextTierReq.trades - successful)} başarılı işlem daha yapın.` : `Complete ${Math.max(0, nextTierReq.trades - successful)} more successful trades to reach Tier ${nextTier}.`}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-900 p-3 rounded-xl border border-slate-700 text-center"><p className="text-slate-400 text-xs font-medium">{lang === 'TR' ? 'Efektif Tier' : 'Effective Tier'}</p><p className="text-2xl font-bold text-white mt-1">T{effectiveTier}</p></div>
                        <div className="bg-slate-900 p-3 rounded-xl border border-slate-700 text-center"><p className="text-slate-400 text-xs font-medium">{lang === 'TR' ? 'Başarılı İşlemler' : 'Successful'}</p><p className="text-2xl font-bold text-emerald-400 mt-1">{successful}</p></div>
                        <div className="bg-slate-900 p-3 rounded-xl border border-slate-700 text-center"><p className="text-slate-400 text-xs font-medium">{lang === 'TR' ? 'Başarısız' : 'Failed'}</p><p className="text-2xl font-bold text-red-400 mt-1">{failed}</p></div>
                        <div className="bg-slate-900 p-3 rounded-xl border border-slate-700 text-center"><p className="text-slate-400 text-xs font-medium">{lang === 'TR' ? 'Ardışık Yasak' : 'Consecutive Bans'}</p><p className="text-2xl font-bold text-white mt-1">{consecutiveBans}</p></div>
                      </div>
                      {bannedUntil > 0 && new Date(bannedUntil * 1000) > new Date() && (
                         <div className="bg-red-950/50 p-3 rounded-xl border border-red-900/60"><p className="text-red-400 text-xs font-medium">{lang === 'TR' ? 'Yasak Bitiş Tarihi' : 'Ban Ends On'}</p><p className="text-sm font-bold text-white mt-1">{new Date(bannedUntil * 1000).toLocaleString(lang === 'TR' ? 'tr-TR' : 'en-US')}</p></div>
                      )}
                      {consecutiveBans > 0 && (
                         <div className="bg-blue-950/30 p-3 rounded-xl border border-blue-900/50 text-center"><p className="text-blue-300 text-xs">💡 {lang === 'TR' ? `Son yasağınız bittikten 180 gün sonra "Ardışık Yasak" sayacınız otomatik olarak sıfırlanacaktır.` : `Your "Consecutive Bans" counter will automatically reset 180 days after your last ban expires.`}</p></div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {profileTab === 'ilanlarim' && (
              <div className="space-y-3">
                {myOrders.length > 0 ? myOrders.map(order => (
                  <div key={order.id} className={`bg-slate-900 border rounded-xl p-4 transition-all duration-200 ${confirmDeleteId === order.id ? 'border-red-500/60 bg-red-950/20' : 'border-slate-700'}`}>
                    <div className="flex justify-between items-center">
                      <div><p className="font-bold text-white text-sm">{order.crypto} → {order.fiat}</p><p className="text-xs text-slate-400 mt-0.5">{order.rate} {order.fiat} · {order.min}–{order.max}</p></div>
                      {confirmDeleteId !== order.id && <button onClick={() => setConfirmDeleteId(order.id)} className="text-xs text-red-400 border border-red-500/40 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition font-medium">Sil</button>}
                    </div>
                    {confirmDeleteId === order.id && (
                      <div className="mt-3 pt-3 border-t border-red-500/20">
                        <p className="text-xs text-red-400 mb-3">⚠️ {lang === 'TR' ? 'Emin misin?' : 'Are you sure?'}</p>
                        <div className="flex gap-2">
                          <button onClick={() => handleDeleteOrder(order)} disabled={isContractLoading} className="flex-1 bg-red-500 hover:bg-red-400 text-white text-xs font-bold py-2 rounded-lg transition disabled:opacity-50">{isContractLoading ? '...' : (lang === 'TR' ? 'Evet' : 'Yes')}</button>
                          <button onClick={() => setConfirmDeleteId(null)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold py-2 rounded-lg transition">İptal</button>
                        </div>
                      </div>
                    )}
                  </div>
                )) : <p className="text-center text-slate-500 text-xs mt-4">İlan bulunamadı.</p>}
              </div>
            )}

            {profileTab === 'aktif' && (
              <div className="space-y-3">
                {activeEscrows.length > 0 ? activeEscrows.map((escrow, index) => (
                  <div key={`${escrow.id}-${index}`} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div><span className="font-mono text-emerald-400 font-bold">{escrow.id}</span><span className="text-xs text-slate-500 ml-2 uppercase border border-slate-700 px-2 py-0.5 rounded">{escrow.role}</span></div>
                      <span className={`text-xs font-bold px-2 py-1 rounded ${escrow.state === 'PAID' ? 'bg-emerald-500/20 text-emerald-400' : escrow.state === 'CHALLENGED' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>{escrow.state}</span>
                    </div>
                    <p className="text-white font-medium text-sm mb-1">{escrow.amount}</p>
                    <p className="text-xs text-slate-400 mb-3">Karşı Taraf: <span className="font-mono">{escrow.counterparty}</span></p>
                    <button onClick={() => { setShowProfileModal(false); setCurrentView('tradeRoom'); setTradeState(escrow.state); }} className="w-full bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 rounded-lg transition border border-slate-600">{lang === 'TR' ? 'Odaya Git →' : 'Go to Room →'}</button>
                  </div>
                )) : <p className="text-center text-slate-500 text-xs mt-4">Aktif işlem bulunamadı.</p>}
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
                      <div key={tx._id} className="bg-slate-900 border border-slate-700 rounded-xl p-3 flex justify-between items-center">
                        <div>
                          <p className="font-mono text-xs text-slate-400">#{tx.onchain_escrow_id} · {new Date(tx.timers.resolved_at).toLocaleDateString(lang === 'TR' ? 'tr-TR' : 'en-CA')}</p>
                          <p className="text-white font-medium mt-0.5"><span className={`mr-2 ${isMaker ? 'text-red-400' : 'text-emerald-400'}`}>{isMaker ? '→' : '←'}</span>{tx.financials.crypto_amount} {tx.financials.crypto_asset}</p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-md font-bold bg-${displayStatus.color}-500/20 text-${displayStatus.color}-400`}>{displayStatus.text}</span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-center text-slate-500 text-xs mt-4">{lang === 'TR' ? 'İşlem geçmişi bulunamadı.' : 'No trade history found.'}</p>
                )}
                {tradeHistoryTotal > tradeHistoryLimit && (
                  <div className="flex justify-between items-center pt-4 border-t border-slate-700">
                    <button onClick={() => setTradeHistoryPage(p => p - 1)} disabled={tradeHistoryPage <= 1 || historyLoading} className="px-4 py-2 text-xs font-bold rounded-lg bg-slate-700 text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-600">{lang === 'TR' ? '← Önceki' : '← Previous'}</button>
                    <span className="text-xs text-slate-500">{lang === 'TR' ? 'Sayfa' : 'Page'} {tradeHistoryPage} / {Math.ceil(tradeHistoryTotal / tradeHistoryLimit)}</span>
                    <button onClick={() => setTradeHistoryPage(p => p + 1)} disabled={tradeHistoryPage * tradeHistoryLimit >= tradeHistoryTotal || historyLoading} className="px-4 py-2 text-xs font-bold rounded-lg bg-slate-700 text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-600">{lang === 'TR' ? 'Sonraki →' : 'Next →'}</button>
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
  // --- YENİ UX: LANDING (ANA SAYFA) EKRANI ---
  // ==========================================
  const renderLanding = () => (
    <main className="max-w-5xl mx-auto p-4 sm:p-8 pt-12 sm:pt-20 pb-24 relative">
      <div className="text-center mb-16 animate-fade-in-up">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-600 mb-6 drop-shadow-lg">
          {lang === 'TR' ? 'Güvenilmez Ortamlarda Tam Güven' : 'Trustless P2P Escrow'}
        </h1>
        <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
          {lang === 'TR' 
            ? 'Merkeziyetsiz, hakemsiz ve otonom takas protokolü. Base ağı üzerinde akıllı kontratlar ve oyun teorisi ile korunan güvenli P2P işlemler.' 
            : 'Decentralized, oracle-free P2P escrow board. Protected by smart contracts and game theory on the Base network.'}
        </p>
        <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4 px-4">
          <button onClick={() => setCurrentView('dashboard')} className="w-full sm:w-auto px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition shadow-lg shadow-emerald-900/30">
            {lang === 'TR' ? 'Pazar Yerine Git' : 'Enter Marketplace'}
          </button>
          <button onClick={handleOpenMakerModal} className="w-full sm:w-auto px-8 py-4 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 rounded-xl font-bold transition">
            {t.createAd}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-4">
        <div className="bg-slate-800/60 border border-slate-700 p-5 rounded-2xl shadow-lg relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 text-emerald-500/10 text-6xl group-hover:scale-110 transition-transform">📈</div>
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">{t.vol}</p>
          {statsLoading ? <div className="h-8 w-24 bg-slate-700 rounded animate-pulse mt-1" /> : (
            <div className="flex flex-col items-start">
              <p className="text-3xl font-bold text-white">${((protocolStats?.total_volume_usdt ?? 0) / 1000).toFixed(1)}K</p>
              <StatChange value={protocolStats?.changes_30d?.total_volume_usdt_pct} />
            </div>
          )}
        </div>
        <div className="bg-slate-800/60 border border-slate-700 p-5 rounded-2xl shadow-lg relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 text-blue-500/10 text-6xl group-hover:scale-110 transition-transform">🤝</div>
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">{t.trades}</p>
          {statsLoading ? <div className="h-8 w-20 bg-slate-700 rounded animate-pulse mt-1" /> : (
            <div className="flex flex-col items-start">
              <p className="text-3xl font-bold text-white">{(protocolStats?.completed_trades ?? 0).toLocaleString()}</p>
              <StatChange value={protocolStats?.changes_30d?.completed_trades_pct} />
            </div>
          )}
        </div>
        <div className="bg-slate-800/60 border border-slate-700 p-5 rounded-2xl shadow-lg relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 text-yellow-500/10 text-6xl group-hover:scale-110 transition-transform">⚡</div>
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">{lang === 'TR' ? 'Ort. Süre' : 'Avg. Time'}</p>
          {statsLoading ? <div className="h-8 w-20 bg-slate-700 rounded animate-pulse mt-1" /> : protocolStats?.avg_trade_hours !== null ? <p className="text-3xl font-bold text-yellow-400">{protocolStats?.avg_trade_hours}s</p> : <p className="text-3xl font-bold text-slate-500">—</p>}
        </div>
        <div className="bg-red-950/30 border border-red-900/50 p-5 rounded-2xl shadow-lg relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 text-red-500/10 text-6xl group-hover:scale-110 transition-transform">🔥</div>
          <p className="text-red-400/80 text-xs font-medium uppercase tracking-wider mb-2">{t.burn}</p>
          {statsLoading ? <div className="h-8 w-20 bg-red-900/30 rounded animate-pulse mt-1" /> : (
            <div className="flex flex-col items-start">
              <p className="text-3xl font-bold text-red-400">${(protocolStats?.burned_bonds_usdt ?? 0).toFixed(0)}</p>
              <StatChange value={protocolStats?.changes_30d?.burned_bonds_usdt_pct} />
            </div>
          )}
        </div>
      </div>
    </main>
  );

  // ==========================================
  // --- 5. PAZAR YERİ EKRANI (DASHBOARD) ---
  // ==========================================
  const renderDashboard = () => (
    <main className="max-w-6xl mx-auto p-4 md:p-6 pb-24 relative">
      {/* F-02 Fix: Debug/UX paneli yalnızca geliştirme ortamında görünür — production'da gizlenir */}
      {import.meta.env.DEV && (
        <div className="mb-8 p-3 bg-slate-800 rounded-xl border border-purple-500/50 flex flex-wrap gap-4 items-center text-sm shadow-lg shadow-purple-900/20">
          <span className="text-purple-400 font-bold tracking-widest uppercase text-xs">🛠️ UX Paneli:</span>
          <div className="flex items-center space-x-2">
            <button onClick={() => setUserRole('taker')} className={`px-3 py-1.5 rounded-lg transition ${userRole === 'taker' ? 'bg-purple-600 text-white' : 'bg-slate-700'}`}>Taker</button>
            <button onClick={() => setUserRole('maker')} className={`px-3 py-1.5 rounded-lg transition ${userRole === 'maker' ? 'bg-purple-600 text-white' : 'bg-slate-700'}`}>Maker</button>
          </div>
          <div className="w-px h-6 bg-slate-600 hidden sm:block"></div>
          <button onClick={() => setIsBanned(!isBanned)} className={`px-3 py-1.5 rounded-lg font-medium transition ${isBanned ? 'bg-red-600 text-white border border-red-500' : 'bg-slate-700 hover:bg-slate-600'}`}>
            {isBanned ? '🔴 Ban Aktif' : '⚪ Ban Kapalı'}
          </button>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 space-y-4 md:space-y-0">
        <div><h1 className="text-2xl md:text-3xl font-bold mb-1">{t.title}</h1><p className="text-sm text-slate-400">{t.subtitle}</p></div>
        <div className="flex items-center space-x-2 w-full md:w-auto">
          <input type="number" value={searchAmount} onChange={(e) => setSearchAmount(e.target.value)} placeholder={t.searchPlaceholder} className="w-full md:w-48 bg-slate-800 text-white px-4 py-2 rounded-xl border border-slate-700 outline-none focus:border-emerald-500" />
          <button onClick={() => setFilterTier1(!filterTier1)} className={`whitespace-nowrap px-4 py-2 rounded-xl font-medium transition text-sm ${filterTier1 ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30' : 'bg-slate-700 text-slate-300'}`}>{t.bondFilter}</button>
        </div>
      </div>

      <div className="overflow-x-auto bg-slate-800/50 rounded-2xl border border-slate-700 shadow-xl">
        <table className="w-full text-left border-collapse min-w-[620px]">
          <thead>
            <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase">
              <th className="p-4 font-medium">{t.tableSeller}</th><th className="p-4 font-medium">{t.tableRate}</th><th className="p-4 font-medium">{t.tableLimit}</th><th className="p-4 font-medium">{t.tableBond}</th><th className="p-4 font-medium text-right">{t.tableAction}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50 relative">
            {loading ? (
               <tr><td colSpan="5" className="p-8 text-center text-slate-400 animate-pulse">{lang === 'TR' ? 'Yükleniyor...' : 'Loading...'}</td></tr>
            ) : filteredOrders.length > 0 ? (
              filteredOrders.map((order) => {
                const effectiveUserTier = userReputation?.effectiveTier ?? 0;
                const isMyOwnAd = address && order.makerFull?.toLowerCase() === address.toLowerCase();
                const isTierLocked = isConnected && isAuthenticated && order.tier > effectiveUserTier;
                const canTakeOrder = isConnected && isAuthenticated && !isMyOwnAd && !isTierLocked;

                return (
                <tr key={order.id} className={`transition ${canTakeOrder ? 'hover:bg-slate-700/30' : 'opacity-50'}`}>
                  <td className="p-4 relative">
                    <div className="flex items-center space-x-2 cursor-pointer group w-max" onClick={(e) => { e.stopPropagation(); setActivePopover(activePopover === order.id ? null : order.id); }}>
                      <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs border border-slate-700 shrink-0 text-emerald-400 transition-colors group-hover:border-emerald-500/50">👤</div>
                      <div><span className="font-mono text-white text-sm group-hover:text-emerald-400 transition">{order.maker}</span></div>
                    </div>
                    {activePopover === order.id && (
                      <div className="absolute top-12 left-4 w-64 bg-slate-800/95 backdrop-blur-xl border border-slate-700 rounded-2xl p-4 shadow-2xl z-50 animate-fade-in-up">
                        <div className="flex justify-between items-start mb-3">
                          <div><p className="text-white font-bold font-mono">{order.maker}</p><p className="text-xs text-slate-400">Araf Güven Skoru</p></div>
                          <button onClick={(e) => { e.stopPropagation(); setActivePopover(null); }} className="text-slate-500 hover:text-white text-lg leading-none">&times;</button>
                        </div>
                        <div className="flex justify-between items-center bg-slate-900/50 p-3 rounded-xl border border-slate-700/50 mb-3">
                          <div className="text-center w-1/2 border-r border-slate-700"><p className="text-2xl font-bold text-emerald-400">%{order.successRate}</p><p className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Güven</p></div>
                          <div className="text-center w-1/2"><p className="text-2xl font-bold text-white">T{order.tier}</p><p className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Tier</p></div>
                        </div>
                        <div className="text-xs text-slate-400"><p className="flex justify-between mb-1"><span>Hacim:</span> <span className="text-white">— USDT</span></p><p className="flex justify-between"><span>İşlem Sayısı:</span> <span className="text-white">—</span></p></div>
                      </div>
                    )}
                  </td>
                  <td className="p-4"><div className="font-bold text-base">{order.rate} {order.fiat}</div><div className="text-xs text-slate-500">1 {order.crypto}</div></td>
                  <td className="p-4 text-slate-300 text-sm">{order.min} - {order.max} {order.fiat}</td>
                  <td className="p-4 text-xs font-bold text-emerald-400">{order.bond}</td>
                  <td className="p-4 text-right">
                    <button onClick={() => handleStartTrade(order)} disabled={!canTakeOrder} className={`px-4 py-2 rounded-lg font-bold text-sm transition flex items-center justify-center space-x-1.5 ml-auto ${!canTakeOrder ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-slate-100 text-slate-900 hover:bg-white'}`}>
                      {!canTakeOrder && <span className="text-base">🔒</span>}
                      <span>{t.buyBtn}</span>
                    </button>
                  </td>
                </tr>
              )})
            ) : (<tr><td colSpan="5" className="p-8 text-center text-slate-500">{lang === 'TR' ? 'İlan bulunamadı.' : 'No ads found.'}</td></tr>)}
          </tbody>
        </table>
      </div>

      <div className="md:hidden fixed bottom-6 right-6 flex flex-col space-y-3 z-30">
        <button onClick={() => setShowFeedbackModal(true)} className="w-12 h-12 bg-slate-700 border border-slate-600 rounded-full flex items-center justify-center text-white text-xl shadow-lg">💬</button>
        <button onClick={handleOpenMakerModal} className="w-14 h-14 bg-emerald-600 rounded-full flex items-center justify-center text-white text-3xl shadow-lg shadow-emerald-600/50">+</button>
      </div>
    </main>
  );

  // ==========================================
  // --- 6. İŞLEM VE ARAF ODASI (TRADE ROOM) ---
  // ==========================================
  const renderTradeRoom = () => {
    // AFS-003 Fix: useCountdown hook'ları buradan KALDIRILDI.
    // Artık App() fonksiyonunun üst seviyesinde tanımlı:
    //   gracePeriodTimer, bleedingTimer, principalProtectionTimer
    // Bu değişkenler closure üzerinden bu fonksiyona erişilebilir.

    const isChallenged = tradeState === 'CHALLENGED';
    const bgTheme = isChallenged ? 'bg-red-950/20' : 'bg-slate-900';
    const borderTheme = isChallenged ? 'border-red-900/50' : 'border-slate-800';

    const isTaker = userRole === 'taker';
    const isMaker = userRole === 'maker';

    return (
      <main className={`max-w-6xl mx-auto p-4 md:p-6 mt-4 transition-colors duration-500 ${bgTheme} pb-24`}>
        <div className="mb-4 p-2 bg-slate-800 rounded-xl border border-slate-700 flex flex-wrap gap-2 items-center text-xs">
          <button onClick={() => setTradeState('LOCKED')} className={`px-3 py-1.5 rounded ${tradeState === 'LOCKED' ? 'bg-blue-600' : 'bg-slate-700'}`}>1. LOCKED</button>
          <button onClick={() => { setTradeState('PAID'); setCooldownPassed(false); setChargebackAccepted(false); }} className={`px-3 py-1.5 rounded ${tradeState === 'PAID' ? 'bg-emerald-600' : 'bg-slate-700'}`}>2. PAID</button>
          <button onClick={() => setTradeState('CHALLENGED')} className={`px-3 py-1.5 rounded ${tradeState === 'CHALLENGED' ? 'bg-red-600' : 'bg-slate-700'}`}>3. CHALLENGED</button>
          {tradeState === 'PAID' && isMaker && (
            <button onClick={() => setCooldownPassed(!cooldownPassed)} className="ml-auto bg-orange-600 px-3 py-1.5 rounded font-bold">⏱️ Simüle Et: 1 Saat {cooldownPassed ? 'Geri Al' : 'İleri Sar'}</button>
          )}
          {tradeState === 'CHALLENGED' && (
             <button onClick={() => setCancelStatus('proposed_by_other')} className="ml-auto bg-slate-700 px-3 py-1.5 rounded text-orange-400 border border-orange-500/30">Simüle Et: Karşı Taraf İptal İstedi</button>
          )}
        </div>

        <button onClick={() => setCurrentView('dashboard')} className="text-slate-400 hover:text-white mb-4 flex items-center text-sm font-medium">← {lang === 'TR' ? 'Geri Dön' : 'Go Back'}</button>
        
        <div className="w-full bg-red-950/40 border border-red-900/50 p-3 rounded-xl mb-6 flex items-start space-x-3 text-sm">
          <span className="text-xl">🛡️</span>
          <div>
            <p className="text-red-400 font-bold">{lang === 'TR' ? 'Güvenlik Uyarısı!' : 'Security Warning!'}</p>
            <p className="text-slate-300 text-xs mt-0.5">{lang === 'TR' ? 'Araf Protocol destek ekibi size ASLA mesaj atmaz. Tüm sorunları kontrat butonlarıyla çözün. Harici cüzdanlara asla elden para göndermeyin.' : 'Araf Protocol support will NEVER DM you. Resolve all issues via contract buttons. Never send funds to external wallets.'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`bg-slate-800/80 p-5 rounded-2xl border ${borderTheme} shadow-xl`}>
            <h3 className="text-lg font-bold mb-4 text-white">{lang === 'TR' ? 'İşlem Detayları' : 'Trade Details'}</h3>
            <div className="space-y-3 text-sm">
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-700">
                <p className="text-slate-400 mb-1">{isTaker ? (lang === 'TR' ? 'Gönderilecek Tutar' : 'Amount to Send') : (lang === 'TR' ? 'Alınacak Tutar' : 'Amount to Receive')}</p>
                <p className="text-xl font-bold text-white">{activeTrade?.max || '0.00'} {activeTrade?.fiat}</p>
                <p className="text-xs text-emerald-400 mt-1">{((activeTrade?.max || 0) / (activeTrade?.rate || 1)).toFixed(2)} {activeTrade?.crypto}</p>
              </div>

              {isTaker ? (
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg">End-to-End Encrypted</div>
                  <p className="text-slate-400 mb-2 uppercase text-[10px] tracking-widest font-bold">🛡️ {lang === 'TR' ? 'Güvenli PII Verisi' : 'Secure PII Data'}</p>
                  {/* F-01 Fix: authToken prop kaldırıldı — PIIDisplay artık httpOnly cookie kullanıyor */}
                  <PIIDisplay tradeId={activeTrade?.id || 'TEST'} lang={lang} />
                  <div className="mt-4 p-2 bg-slate-800 rounded-lg flex items-start space-x-2 border border-slate-600">
                    <span className="text-lg">🔒</span>
                    <p className="text-[10px] text-slate-300 leading-tight">Bu bilgiler blockchain'e kaydedilmez. Sadece bu işleme özel şifreli olarak iletilmiştir.</p>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 text-center">
                  <div className="text-3xl mb-2">🏦</div>
                  <p className="text-slate-300 font-medium text-sm">{lang === 'TR' ? 'Banka hesabınıza ödeme bekleniyor.' : 'Waiting for fiat payment.'}</p>
                </div>
              )}

              {/* GÜVENLİ XSS KORUMALI TELEGRAM BUTONU */}
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-700 flex justify-between items-center">
                <span className="text-slate-400">{lang === 'TR' ? 'Karşı Taraf:' : 'Counterparty:'}</span>
                <a href={getSafeTelegramUrl(telegramHandle)} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 transition bg-blue-500/10 px-3 py-1.5 rounded-lg border border-blue-500/30">
                  <span>💬</span><span className="font-bold text-xs">{lang === 'TR' ? 'Mesaj At' : 'Message'}</span>
                </a>
              </div>
            </div>
          </div>

          <div className={`col-span-1 lg:col-span-2 bg-slate-800/80 p-5 rounded-2xl border ${borderTheme} shadow-xl flex flex-col justify-center`}>
            {tradeState === 'LOCKED' && (
              <div className="text-center py-6">
                <div className="w-14 h-14 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">🔒</div>
                <h2 className="text-xl md:text-2xl font-bold text-white mb-2">{lang === 'TR' ? 'USDT Kilitlendi' : 'USDT Locked'}</h2>
                {isTaker ? (
                  <button onClick={() => { setTradeState('PAID'); setCooldownPassed(false); }} className="bg-blue-600 hover:bg-blue-500 text-white w-full sm:w-auto px-8 py-3 rounded-xl font-bold mt-4">
                    {lang === 'TR' ? 'Ödemeyi Yaptım' : 'I have paid'}
                  </button>
                ) : (
                  <p className="text-slate-400 mb-6 text-sm animate-pulse">{lang === 'TR' ? 'Alıcının transferi bekleniyor...' : 'Waiting for buyer transfer...'}</p>
                )}
              </div>
            )}

            {tradeState === 'PAID' && (
              <div className="text-center py-4 flex flex-col items-center">
                <h2 className="text-lg md:text-xl font-bold text-emerald-400 mb-2">{lang === 'TR' ? 'Ödeme Bildirildi' : 'Payment Reported'}</h2>
                <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-4 mb-6">
                  <p className="text-xs text-slate-500 mb-1 uppercase font-bold">Grace Period</p>
                  <div className="text-4xl sm:text-5xl font-mono font-bold text-white tracking-wider">
                    {gracePeriodTimer.isFinished ? '00:00:00' : `${String(gracePeriodTimer.hours + gracePeriodTimer.days * 24).padStart(2, '0')}:${String(gracePeriodTimer.minutes).padStart(2, '0')}:${String(gracePeriodTimer.seconds).padStart(2, '0')}`}
                  </div>
                </div>
                {isTaker ? (
                  <div className="w-full max-w-md flex flex-col items-center">
                    <p className="text-slate-400 text-sm mb-4">{lang === 'TR' ? 'Satıcının onayı bekleniyor.' : 'Waiting for seller release.'}</p>
                    
                    {/* YENİ: pingMaker butonu ve durumu işlem odasına taşındı */}
                    {(() => {
                      if (!activeTrade?.paidAt) return null;

                      if (activeTrade.pingedAt) {
                        const autoReleaseBecomesAvailableAt = new Date(new Date(activeTrade.pingedAt).getTime() + 24 * 3600 * 1000);
                        const canAutoRelease = new Date() > autoReleaseBecomesAvailableAt;

                        if (canAutoRelease) {
                          return (
                            <button
                              onClick={() => handleAutoRelease(activeTrade.onchainId)}
                              disabled={isContractLoading}
                              className={`w-full mt-2 text-sm font-bold py-3 rounded-xl transition bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500 hover:text-white`}>
                              {isContractLoading ? '...' : (lang === 'TR' ? '✅ Fonları Otomatik Serbest Bırak' : '✅ Auto-Release Funds')}
                            </button>
                          );
                        }

                        return (
                          <div className="mt-2 text-center text-xs text-emerald-400 bg-emerald-900/30 p-3 rounded-lg border border-emerald-800 w-full">
                            <p className="font-bold">✓ {lang === 'TR' ? 'Satıcı Uyarıldı' : 'Maker Pinged'}</p>
                            <p className="mt-1">{lang === 'TR' ? 'Yanıt için kalan süre dolduğunda fonları serbest bırakabilirsiniz.' : 'You can release funds when the response window closes.'}</p>
                          </div>
                        );
                      }

                      const gracePeriodEnds = new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000);
                      const canPing = new Date() > gracePeriodEnds;
                      return (
                        <button
                          onClick={() => handlePingMaker(activeTrade.onchainId)}
                          disabled={!canPing || isContractLoading}
                          className={`w-full mt-2 text-sm font-bold py-3 rounded-xl transition ${!canPing || isContractLoading ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed' : 'bg-orange-600/20 text-orange-400 border border-orange-500/40 hover:bg-orange-500 hover:text-white'}`}>
                          {isContractLoading ? '...' : canPing ? (lang === 'TR' ? '🔔 Satıcıyı Uyar' : '🔔 Ping Maker') : (lang === 'TR' ? '⏱️ Onay Bekleniyor' : '⏱️ Awaiting Confirmation')}
                        </button>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="w-full max-w-md flex flex-col space-y-4">
                    <label className="flex items-start space-x-3 p-3 bg-red-950/30 border border-red-900/50 rounded-xl cursor-pointer text-left">
                      <input type="checkbox" checked={chargebackAccepted} onChange={(e) => handleChargebackAck(e.target.checked)} className="mt-1 w-4 h-4 accent-emerald-500 rounded bg-slate-800 border-slate-600 focus:ring-emerald-500 focus:ring-offset-slate-900" />
                      <span className="text-xs text-slate-300">
                        <strong className="text-red-400">{lang === 'TR' ? 'UYARI:' : 'WARNING:'}</strong> {lang === 'TR' ? 'Paranın farklı isimli bir hesaptan gelmediğini ve Chargeback (Ters İbraz) riskini anladığımı kabul ediyorum.' : 'I confirm the funds came from the correct name and understand the Chargeback risk.'}
                      </span>
                    </label>

                    <div className="flex flex-col sm:flex-row justify-center gap-3">
                      <button disabled={!chargebackAccepted || isContractLoading} onClick={handleRelease} className={`w-full sm:w-auto px-8 py-3 rounded-xl font-bold transition ${chargebackAccepted && !isContractLoading ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}>
                        {isContractLoading ? (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...') : (lang === 'TR' ? 'Serbest Bırak' : 'Release USDT')}
                      </button>
                      <button onClick={handleChallenge} disabled={!cooldownPassed || isContractLoading} className={`w-full sm:w-auto px-6 py-3 rounded-xl font-bold transition ${cooldownPassed && !isContractLoading ? 'bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white' : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'}`}>
                        {isContractLoading ? (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...') : cooldownPassed ? (lang === 'TR' ? 'İtiraz Et' : 'Challenge') : '⏳ Cooldown 59:12'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tradeState === 'CHALLENGED' && (
              <div className="text-center py-2">
                <div className="w-14 h-14 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl animate-pulse">⚠️</div>
                <h2 className="text-2xl md:text-3xl font-bold text-red-500 mb-2">{lang === 'TR' ? 'ARAF FAZI' : 'PURGATORY PHASE'}</h2>
                <div className="w-full bg-red-950/40 border border-red-900/50 rounded-2xl p-4 mb-6 text-left">
                  <div className="mb-4">
                    <div className="flex justify-between text-xs mb-1"><span className="text-red-400 font-bold">{lang === 'TR' ? 'Senin Teminatın' : 'Your Bond'}</span><span className="text-white font-mono">-{isTaker ? '10.1' : '6.2'}% / Gün</span></div>
                    <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-red-900/30"><div className="bg-red-600 h-2 rounded-full w-[20%]"></div></div>
                  </div>
                  <div className="mb-3">
                    <div className="flex justify-between text-xs mb-1"><span className="text-orange-400">{lang === 'TR' ? 'Karşı Tarafın Teminatı' : 'Opponent Bond'}</span><span className="text-slate-300 font-mono">-{isTaker ? '6.2' : '10.1'}% / Gün</span></div>
                    <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-orange-900/30"><div className="bg-orange-500/50 h-2 rounded-full w-[10%]"></div></div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-red-900/30">
                    <p className="text-xs text-slate-400 font-medium flex items-center justify-between">
                      <span>🛡️ {lang === 'TR' ? 'Ana Para Koruma:' : 'Principal Protection:'}</span>
                      <span className="text-emerald-400 font-mono">
                        {principalProtectionTimer.isFinished ? 'Bitti' : `${principalProtectionTimer.days}g ${principalProtectionTimer.hours}s`}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4">
                  {cancelStatus === null && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {isMaker && (
                        <button onClick={handleRelease} disabled={isContractLoading} className={`w-full bg-slate-800 border border-emerald-500/50 text-emerald-400 p-3 rounded-xl font-bold text-sm transition ${isContractLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-emerald-500 hover:text-white'}`}>
                          {isContractLoading ? '⏳' : '🤝'} {lang === 'TR' ? 'Serbest Bırak' : 'Release'}
                        </button>
                      )}
                      <button onClick={handleProposeCancel} className="w-full bg-slate-800 border border-orange-500/50 text-orange-400 p-3 rounded-xl font-bold text-sm hover:bg-orange-500 hover:text-white transition">↩️ {lang === 'TR' ? 'İptal Teklif Et' : 'Propose Cancel'}</button>
                    </div>
                  )}
                  {cancelStatus === 'proposed_by_me' && (
                    <div className="py-3 px-4 bg-orange-500/10 border border-orange-500/30 rounded-xl flex items-center justify-center space-x-3">
                      <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-orange-400 font-bold text-sm">Pending Approval...</span>
                    </div>
                  )}
                  {cancelStatus === 'proposed_by_other' && (
                    <div className="animate-pulse-slow">
                      <p className="text-orange-400 font-bold text-sm mb-3">⚠️ {lang === '
