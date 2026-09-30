import PIIDisplay from '../components/PIIDisplay';
import { fmtBps, fmtNum, fmtPct, getStateLabel, localeOf } from './copy';
import ReferenceRateTicker from '../components/ReferenceRateTicker';
import SettlementProposalCard from '../components/SettlementProposalCard';
import { normalizeSettlementState } from './contexts/settlement/settlementActionModel';
import PaymentRiskBadge from '../components/PaymentRiskBadge';
import { buildGoToTradeRoomAction } from './actions/tradeNavigationActions';
import OperationTradeCard from './contexts/operations/OperationTradeCard';
import { SettlementQueueCard } from './contexts/operations/OperationsPanels';
import OperationsCenterPage from './contexts/operations/OperationsCenterPage';
import ProfileContextPage from './contexts/profile/ProfileContextPage';
import { getOrderSideCopy } from './orderUiModel';
import { countActiveMarketFilters, MARKET_FIAT_OPTIONS, MARKET_FILTER_DEFAULTS } from './contexts/marketplace/marketFilters';
import { mapResolutionTypeLabel } from './useAppSessionData';
import TradeRoomPage from './contexts/trade-room/TradeRoomPage';
import ThemeToggle from './shell/ThemeToggle';
import { isViewInNav, NAV_ORDER, VIEW_REGISTRY } from './viewRegistry';
import {
  Banknote, ChevronDown, CircleCheck, CirclePause, Clock, Droplets, Flame, Handshake, History, Hourglass, Layers, ListPlus, LoaderCircle, Lock, Menu, Paperclip, Plus, RotateCcw, Search, Settings, Store, Swords,
  TriangleAlert, Undo2, Unplug, Wallet, X, EyeOff, Info, Maximize2, Minimize2, Download, Share,
} from 'lucide-react';
import { buildTradeRoomPanelCallbacks, getBurnExpiredDeadlinePassed, getPaymentWindowExpired } from './contexts/trade-room/tradeRoomPanelActions';

// [TR] App ana görünüm/render katmanı burada tutulur.
// [EN] Main application view/render layer lives here.
// [TR] Ana sayfa istatistik değişim rozeti (yalnız burada kullanılır). [EN] Home stat delta badge.
const StatChange = ({ value }) => {
  if (value == null) return null;
  const isPositive = value >= 0;
  return <span className={`text-[10px] ml-2 font-bold ${isPositive ? 'text-success' : 'text-danger'}`}>{isPositive ? '▲' : '▼'}{Math.abs(value).toFixed(1)}%</span>;
};

// [TR] P2 — Modül düzeyi bileşenler: render içinde tanımlanınca her render'da yeni tip oluşur, alt ağaç yeniden
//      mount olur (odak/kaydırma kaybı). Burada kimlikleri sabit.
// [EN] P2 — Module-level components: defining them inside render creates a new type per render and remounts the
//      subtree (lost focus/scroll). Here their identity is stable.
// [TR] Tek satır bileşeni: ikon + etiket + sayaç. Tüm drawer aynı ritimde görünür.
// [EN] One row primitive (icon + label + count) so every drawer row shares one rhythm.
const Row = ({ icon, label, count, active, tone = 'default', onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active ? 'true' : undefined}
    className={`w-full h-10 flex items-center gap-3 px-3 rounded-lg text-sm font-medium transition ${active ? 'bg-elevated text-textPrimary' : 'text-textSecondary hover:text-textPrimary hover:bg-elevated/60'}`}
  >
    <span className={`shrink-0 flex items-center justify-center w-5 ${tone === 'danger' ? 'text-danger' : active ? 'text-textPrimary' : 'text-textMuted'}`}>{icon}</span>
    <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    {count != null && (
      <span className={`min-w-[1.5rem] h-5 px-1.5 rounded-md text-[11px] font-semibold tabular-nums flex items-center justify-center ${typeof count === 'number' && count > 0 ? (tone === 'danger' ? 'bg-danger/15 text-danger' : 'bg-elevated text-textPrimary') : 'text-textMuted'}`}>{count}</span>
    )}
  </button>
);
const SectionLabel = ({ children }) => (
  <p className="px-3 mb-1.5 text-[11px] font-semibold tracking-wider text-textMuted">{children}</p>
);

const Segmented = ({ items, value, onChange, label }) => (
  <div role="tablist" aria-label={label} className="flex min-w-0 bg-surface border border-borderSubtle rounded-lg p-1">
    {items.map((it) => (
      <span
        key={it.value}
        role="tab"
        tabIndex={0}
        aria-selected={value === it.value}
        onClick={() => onChange(it.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(it.value); } }}
        className={`flex-1 min-w-0 md:flex-none cursor-pointer select-none text-center px-2 md:px-3 h-8 leading-8 rounded-md text-xs font-semibold transition ${value === it.value ? (it.activeClass || 'bg-elevated text-textPrimary shadow-sm') : 'text-textMuted hover:text-textPrimary'}`}
      >{it.label}</span>
    ))}
  </div>
);

// [TR] Ayarlanmamış sosyal linkler gösterilmez (önceden github.com / x.com ana sayfasına gidiyordu).
// [EN] Unconfigured social links are hidden (they used to point at bare github.com / x.com).
const SOCIAL_LINKS = {
  github: import.meta.env.VITE_SOCIAL_GITHUB || 'https://github.com/MyDemir/Araf-Protokol',
  twitter: import.meta.env.VITE_SOCIAL_TWITTER || '',
  farcaster: import.meta.env.VITE_SOCIAL_FARCASTER || '',
};

// [TR] SSS yanıtları kontrat sabitlerine dayanır (ArafEscrow: 48s ödeme penceresi, 48s+24s otomatik serbest,
//      itirazda 48s sonra teminat erimesi, 144s sonra ana para erimesi, 240s'te yakım). Ücret kontrattan okunur.
// [EN] FAQ answers follow contract constants; the fee comes from the contract fee config.
const buildFaqItems = (lang, protocolFeeConfig) => {
  const feeText = (() => {
    const tb = Number(protocolFeeConfig?.takerFeeBps);
    const mb = Number(protocolFeeConfig?.makerFeeBps);
    if (!Number.isFinite(tb) || !Number.isFinite(mb)) return null;
    return lang === 'TR' ? `alıcıdan ${fmtBps(tb, lang)}, satıcıdan ${fmtBps(mb, lang)}` : `${fmtBps(tb, lang)} from the buyer and ${fmtBps(mb, lang)} from the seller`;
  })();
  return lang === 'TR'
    ? [
        { q: 'Araf hakem kullanıyor mu?', a: 'Hayır. Uyuşmazlıkta insan hakem yoktur. Süreç zincirdeki zamanlayıcılar ve ekonomik teşviklerle ilerler; son söz kontratındır.' },
        { q: 'Platform fonlarıma erişebilir mi?', a: 'Hayır. Fonlar akıllı kontratta kilitlidir. Backend yalnız zinciri yansıtır; serbest bırakma kararı veremez.' },
        { q: 'Satıcı ödemeyi onaylamazsa ne olur?', a: 'Ödeme bildiriminden 48 saat sonra alıcı satıcıyı uyarır; 24 saat içinde yanıt gelmezse kripto otomatik olarak alıcıya geçer.' },
        { q: 'Eriyen kasa nedir?', a: 'İtiraz açıldıktan 48 saat sonra iki tarafın teminatı saat saat erimeye başlar; 144. saatten itibaren ana para da erir. 10 gün içinde uzlaşma olmazsa kalan tutar yakılır.' },
        { q: 'Neden tier ve teminat var?', a: 'Tier sistemi yeni cüzdanların emir büyüklüğünü sınırlar; teminatlar kötü niyeti pahalı hale getirir. Temiz sicil teminatı %1 düşürür, risk puanı %3 artırır.' },
        { q: 'Ücret ne kadar?', a: feeText ? `Başarılı işlemde kontrat ${feeText} ücret keser.` : 'Ücret oranı kontratta tanımlıdır ve işlem kilitlenirken sabitlenir.' },
      ]
    : [
        { q: 'Does Araf use arbitrators?', a: 'No. There are no human arbitrators. The flow runs on on-chain timers and economic incentives; the contract has the final say.' },
        { q: 'Can the platform access my funds?', a: 'No. Funds stay locked in the smart contract. The backend only mirrors the chain and cannot release funds.' },
        { q: 'What if the seller never confirms payment?', a: '48 hours after the payment report the buyer can ping the seller; with no response within 24 hours the crypto is released to the buyer automatically.' },
        { q: 'What is the bleeding escrow?', a: 'Starting 48 hours after a dispute opens, both bonds decay every hour; from hour 144 the principal decays too. Without a settlement within 10 days the rest is burned.' },
        { q: 'Why tiers and bonds?', a: 'Tiers cap order size for new wallets; bonds make bad faith expensive. A clean record lowers the bond by 1%, risk points raise it by 3%.' },
        { q: 'What are the fees?', a: feeText ? `On a successful trade the contract charges ${feeText}.` : 'The fee rate is defined in the contract and fixed when a trade locks.' },
      ];
};

export const buildAppViews = (ctx) => {
  const {
    lang,
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
    marketFilters = MARKET_FILTER_DEFAULTS,
    setMarketFilter,
    resetMarketFilters,
    marketOrdersTotal = null,
    filteredOrders,
    orders,
    ordersFeedError,
    fullscreen = { isStandalone: true },
    activeEscrows,
    loading,
    SUPPORTED_TOKEN_ADDRESSES,
    handleStartTrade,
    handleMint,
    isFaucetEnabled,
    isSupportedChainId,
    handleOpenMakerModal,
    activeEscrowCounts,
    setShowProfileModal,
    openProfilePage,
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
    activeTrade,
    setActiveTrade,
    userRole,
    setUserRole,
    setTradeState,
    resolvedTradeState,
    setCancelStatus,
    setChargebackAccepted,
    paymentIpfsHash,
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
    canMakerStartChallengeFlow,
    canMakerChallenge,
    tradeTimers = {},
    chainNowMs,
    chainOffsetMs = 0,
    bleedingAmounts,
    takerName,
    tokenDecimalsMap,
    formatTokenAmountFromRaw,
    rawTokenToDisplayNumber,
    fetchMyTrades,
    setIsContractLoading,
    authenticatedFetch,
    showToast,
    settlementContractFns,
  } = ctx;

  // [TR] Admin menü görünürlüğü yalnız UX katmanıdır; nihai yetki backend ADMIN_WALLETS + auth zincirindedir.
  //      F19.5 — Sunucu yanıtı (ctx.isAdmin: boolean) varsa tek doğrudur: true → göster, false → gizle.
  //      Şu an backend'de böyle bir uç yok (yalnız 403'lü /api/admin/*); yanıt yoksa geçiş dönemi davranışı:
  //      VITE_ADMIN_WALLETS doluysa yalnız listedeki cüzdanlara, boşsa imzalı her kullanıcıya gösterilir.
  //      NOT: env listesi istemci paketine girer; sunucu bayrağı bağlanınca bu yedek kaldırılmalı.
  // [EN] Admin menu visibility is UX-only. A server answer (ctx.isAdmin: boolean) is authoritative. No such endpoint
  //      exists yet (only 403-gated /api/admin/*), so without one: a non-empty VITE_ADMIN_WALLETS narrows the entry to
  //      listed wallets; an empty list keeps it visible to signed-in users. The env list ships in the bundle;
  //      drop this fallback once the server flag is wired.
  const adminWalletAllowlist = String(import.meta.env.VITE_ADMIN_WALLETS || "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const connectedWalletLower = typeof address === "string" ? address.toLowerCase() : null;
  const serverAdminAnswer = typeof ctx.isAdmin === "boolean" ? ctx.isAdmin : null;
  const inEnvAllowlist = Boolean(connectedWalletLower) && adminWalletAllowlist.includes(connectedWalletLower);
  const isLikelyAdminWallet = serverAdminAnswer === true || (serverAdminAnswer === null && inEnvAllowlist);
  const adminAllowedByPolicy = serverAdminAnswer !== null
    ? serverAdminAnswer
    : (adminWalletAllowlist.length === 0 || inEnvAllowlist);
  const canSeeAdminEntry = Boolean(isConnected && isAuthenticated && connectedWalletLower && adminAllowedByPolicy);
  // [TR] İşlem Odası, Takip, Profil ve Geçmiş yalnız imzalı oturumla anlamlıdır; oturum yokken gezinmede
  //      gösterilmez (App.jsx de bu görünümlerden ana sayfaya yönlendirir). UI Lab senaryoları istisnadır.
  // [EN] Trade room, tracking, profile and history need a signed session; hidden from navigation otherwise.
  const navUnlocked = Boolean((isConnected && isAuthenticated) || ctx.devScenarioCategory);
  // [TR] Oturum yokken "Emir oluştur" hata bildirimi yerine cüzdan bağlama/imza akışını başlatır.
  const openCreateOrder = () => ((isConnected && isAuthenticated) || ctx.devScenarioCategory ? handleOpenMakerModal() : handleAuthAction());

  const renderSlimRail = () => (
    <div className="hidden md:flex w-16 bg-shell border-r border-borderSubtle flex-col items-center py-6 justify-between z-50 shrink-0 shadow-2xl">
      <div className="space-y-6 flex flex-col items-center w-full">
        <div className="w-8 h-8 rounded bg-gradient-to-br from-white to-slate-400 flex items-center justify-center font-bold text-black mb-4 cursor-pointer" onClick={() => setCurrentView('home')}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="square" strokeLinejoin="miter" strokeWidth="3" d="M4 4h4v4H4zm12 0h4v4h-4zM4 16h4v4H4zm12 0h4v4h-4zM10 10h4v4h-4z" /></svg>
        </div>
        <button onClick={toggleSidebar} title={lang === 'TR' ? 'Filtreler' : 'Filters'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${sidebarOpen ? 'bg-elevated text-textPrimary border border-borderStrong' : 'text-textMuted hover:text-textPrimary hover:bg-elevated'}`}><Menu className="w-5 h-5" strokeWidth={1.8} aria-hidden="true" /></button>
        {NAV_ORDER.rail.filter((key) => isViewInNav(key, { navUnlocked, canSeeAdminEntry })).map((key) => {
          const view = VIEW_REGISTRY[key];
          const Icon = view.icon;
          // [TR] Admin başlığı yetki ipucunu taşır; backend yine nihai otoritedir. [EN] Admin title carries the access hint.
          const title = key === 'admin'
            ? (isLikelyAdminWallet
              ? (lang === 'TR' ? 'Yönetim Paneli (uzlaşma analitiği: salt okunur)' : 'Admin Panel (Settlement analytics: read-only)')
              : (lang === 'TR' ? 'Admin Gözlem (sunucu yetkisine bağlı, read-only)' : 'Admin Observability (server-authorized, read-only)'))
            : view.label[lang === 'TR' ? 'TR' : 'EN'];
          return (
            <button key={key} onClick={() => setCurrentView(key)} title={title} className={`w-10 h-10 flex items-center justify-center rounded-xl transition relative ${currentView === key ? `bg-elevated ${view.tone} border border-borderStrong` : 'text-textMuted hover:text-textPrimary hover:bg-elevated'}`}>
              <Icon className="w-5 h-5" strokeWidth={1.8} aria-hidden="true" />
              {key === 'tradeRoom' && activeEscrows.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>}
            </button>
          );
        })}
        {navUnlocked && (
          <button onClick={() => { if (!isConnected || !isAuthenticated) { handleAuthAction(); return; } openProfilePage?.('history'); }} title={lang === 'TR' ? 'İşlem Geçmişi' : 'Trade History'} className="w-10 h-10 flex items-center justify-center rounded-xl text-textMuted hover:text-textPrimary hover:bg-elevated transition"><History className="w-5 h-5" strokeWidth={1.8} aria-hidden="true" /></button>
        )}
      </div>
      <div className="space-y-3 flex flex-col items-center w-full px-2">
        <div className="w-full flex justify-center">
          <ThemeToggle />
        </div>
        <button onClick={() => setLang(lang === 'TR' ? 'EN' : 'TR')} title={lang === 'TR' ? 'Dili Değiştir' : 'Change Language'} className="text-xs font-bold text-textMuted hover:text-textPrimary mb-1">{lang}</button>
        <button onClick={handleAuthAction} title={isConnected && isAuthenticated ? (lang === 'TR' ? 'Profil Merkezi' : 'Profile Center') : (lang === 'TR' ? 'Cüzdan Bağla' : 'Connect Wallet')} className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all shadow-lg mx-auto ${isConnected && isAuthenticated ? 'border-emerald-500 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'border-borderStrong bg-surface text-textMuted hover:text-textPrimary hover:border-brand/50 hover:bg-elevated'}`}>
          {isLoggingIn || !authChecked ? <LoaderCircle className="w-4 h-4 animate-spin" strokeWidth={1.8} aria-hidden="true" /> : <Wallet className="w-5 h-5" strokeWidth={1.8} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );

  // [TR] Bağlamsal yan panel — açık/kapalı durumu explicit butonlar ve overlay ile yönetilir.
  //      Filtreler, durum akordiyonu ve yeni order oluşturma butonu içerir.
  // [EN] Context sidebar — open/close state is controlled by explicit buttons and overlay.
  //      Contains filters, status accordion and create-order button.
  const renderContextSidebar = () => {
    const tr = lang === 'TR';
    const settlementCounts = activeEscrowCounts?.settlement || {};
    // [TR] Akış alınamadıysa sayaç "—": "0 emir" yanıltıcı olur.
    const orderCount = (list, total = null) => (ordersFeedError ? '—' : Number.isFinite(total) ? total : list.length);
    const proposedEscrows = activeEscrows.filter((escrow) => normalizeSettlementState(escrow?.rawTrade?.settlementProposal?.state) === 'PROPOSED');
    const goToRoom = (escrow) => buildGoToTradeRoomAction({
      escrow, setActiveTrade, setUserRole, setTradeState, setChargebackAccepted, setCurrentView, setSidebarOpen,
    });
    const tokenMark = (letter, cls) => (
      <span className={`w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center ${cls}`} aria-hidden="true">{letter}</span>
    );
    const ico = (Icon) => <Icon className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />;

    return (
      <>
        {sidebarOpen && <div className="md:hidden fixed inset-0 max-w-full overflow-x-hidden bg-black/60 z-[55] backdrop-blur-sm transition-opacity" onClick={() => setSidebarOpen(false)} />}
        <aside
          aria-label={tr ? 'Filtreler ve işlemler' : 'Filters and trades'}
          className={`fixed md:relative inset-y-0 left-0 box-border h-dvh md:h-full max-w-full bg-shell border-r border-borderSubtle flex flex-col z-[60] md:z-40 shrink-0 overflow-x-hidden overflow-y-auto overscroll-contain transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-[280px] max-w-[calc(100vw_-_3rem)] pl-[calc(0.75rem_+_env(safe-area-inset-left))] pr-3 pt-[calc(1rem_+_env(safe-area-inset-top))] pb-[calc(1rem_+_env(safe-area-inset-bottom))] opacity-100' : 'w-0 p-0 opacity-0'}`}
        >
          <div className="md:hidden flex items-center justify-between px-3 mb-4">
            <span className="text-base font-bold tracking-tight text-textPrimary">Araf</span>
            <button type="button" onClick={() => setSidebarOpen(false)} aria-label={tr ? 'Menüyü kapat' : 'Close menu'} className="w-9 h-9 -mr-2 flex items-center justify-center rounded-lg text-textMuted hover:text-textPrimary hover:bg-elevated">
              <X className="w-5 h-5" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>

          <nav className="mb-5">
            <SectionLabel>{tr ? 'PAZAR' : 'MARKET'}</SectionLabel>
            {/* [TR] Sayaç yalnız seçili varlıkta gösterilir: sunucu yalnız o varlığın emirlerini döndürür. */}
            {[
              { value: 'ALL', icon: ico(Layers), label: tr ? 'Tüm emirler' : 'All orders' },
              { value: 'USDT', icon: tokenMark('T', 'bg-emerald-600'), label: 'USDT' },
              { value: 'USDC', icon: tokenMark('C', 'bg-blue-600'), label: 'USDC' },
            ].map((row) => (
              <Row
                key={row.value}
                icon={row.icon}
                label={row.label}
                count={marketFilters.token === row.value ? orderCount(orders, marketOrdersTotal) : undefined}
                active={marketFilters.token === row.value && currentView === 'market'}
                onClick={() => { setMarketFilter('token', row.value); setCurrentView('market'); }}
              />
            ))}
          </nav>

          {navUnlocked ? (
            <>
          <nav className="mb-5">
            <SectionLabel>{tr ? 'İŞLEMLERİM' : 'MY TRADES'}</SectionLabel>
            {['LOCKED', 'PAID', 'CHALLENGED'].map(status => {
              const isExpanded = expandedStatus === status;
              const statusTrades = activeEscrows.filter(e => e.state === status);
              const icon = status === 'LOCKED' ? Lock : status === 'PAID' ? Banknote : Swords;
              return (
                <div key={status}>
                  <Row
                    icon={ico(icon)}
                    label={getStateLabel(status, lang)}
                    count={Number(activeEscrowCounts?.[status] || 0)}
                    tone={status === 'CHALLENGED' ? 'danger' : 'default'}
                    active={isExpanded}
                    onClick={() => setExpandedStatus(isExpanded ? null : status)}
                  />
                  {isExpanded && (
                    <div className="ml-5 pl-3 my-1 border-l border-borderSubtle space-y-2">
                      {statusTrades.length > 0 ? statusTrades.map(escrow => (
                        <OperationTradeCard key={escrow.id} escrow={escrow} lang={lang} onGoToRoom={goToRoom(escrow)} />
                      )) : (
                        <p className="py-2 text-xs text-textMuted">{tr ? 'Bu durumda işlem yok.' : 'No trades in this state.'}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <nav className="mb-5">
            <SectionLabel>{tr ? 'UZLAŞMA' : 'SETTLEMENT'}</SectionLabel>
            <Row icon={ico(Handshake)} label={tr ? 'Açık teklifler' : 'Open proposals'} count={Number(settlementCounts.PROPOSED || 0)} onClick={() => setCurrentView('operations')} />
            {Number(settlementCounts.ACTION_REQUIRED || 0) > 0 && (
              <Row icon={ico(Hourglass)} label={tr ? 'Yanıtını bekliyor' : 'Needs your reply'} count={Number(settlementCounts.ACTION_REQUIRED)} tone="danger" onClick={() => setCurrentView('operations')} />
            )}
            {Number(settlementCounts.WAITING || 0) > 0 && (
              <Row icon={ico(Clock)} label={tr ? 'Karşı taraf yanıtlıyor' : 'Awaiting counterparty'} count={Number(settlementCounts.WAITING)} onClick={() => setCurrentView('operations')} />
            )}
            {proposedEscrows.length > 0 && (
              <div className="mt-2 space-y-2 px-1">
                {proposedEscrows.map((escrow) => (
                  <SettlementQueueCard key={`settle-${escrow.onchainId}`} escrow={{ ...escrow, viewerAddress: address }} lang={lang} onGoToRoom={goToRoom(escrow)} />
                ))}
              </div>
            )}
          </nav>

            </>
          ) : (
            <div className="mb-5 mx-1 rounded-xl border border-borderSubtle bg-surface p-4" data-testid="drawer-signin-card">
              <p className="text-sm font-semibold text-textPrimary">{tr ? 'İşlemlerin burada görünür' : 'Your trades show up here'}</p>
              <p className="text-xs text-textMuted mt-1">{tr ? 'Aktif işlemler, uzlaşma teklifleri ve profil için cüzdanını bağlayıp imzala.' : 'Connect and sign in with your wallet to see active trades, settlement offers and your profile.'}</p>
              <button type="button" onClick={() => { setSidebarOpen(false); handleAuthAction(); }} className="mt-3 w-full h-9 rounded-lg bg-brand text-black text-sm font-semibold hover:opacity-90 inline-flex items-center justify-center gap-2">
                <Wallet className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />{isConnected ? (tr ? 'İmzala ve giriş yap' : 'Sign in') : (tr ? 'Cüzdan bağla' : 'Connect wallet')}
              </button>
            </div>
          )}

          <div className="mt-auto pt-4 border-t border-borderSubtle px-1 space-y-3">
            {/* [TR] Mobilde tarayıcı çubuklarını gizleme: Fullscreen API varsa tam ekran düğmesi her zaman görünür;
                kurulum teklifi (PWA) varsa ek satır olarak gelir, tam ekranın yerini almaz. iOS'ta yönerge. */}
            {!fullscreen.isStandalone && (
              <div className="md:hidden -mx-1" data-testid="drawer-fullscreen">
                {fullscreen.supported && (
                  <Row icon={ico(fullscreen.isFullscreen ? Minimize2 : Maximize2)} label={fullscreen.isFullscreen ? (tr ? 'Tam ekrandan çık' : 'Exit full screen') : (tr ? 'Tam ekran' : 'Full screen')} onClick={fullscreen.toggle} />
                )}
                {fullscreen.canInstall && (
                  <Row icon={ico(Download)} label={tr ? 'Uygulamayı yükle' : 'Install app'} onClick={fullscreen.install} />
                )}
                {!fullscreen.supported && !fullscreen.canInstall && (
                  <p className="flex items-start gap-2 px-3 py-2 text-xs text-textMuted">
                    <Share className="w-4 h-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                    {tr ? 'Tam ekran için: Paylaş → Ana Ekrana Ekle' : 'For full screen: Share → Add to Home Screen'}
                  </p>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="flex flex-1 bg-surface rounded-lg p-1 border border-borderSubtle" role="group" aria-label={tr ? 'Dil' : 'Language'}>
                {['TR', 'EN'].map((code) => (
                  <button key={code} type="button" onClick={() => setLang(code)} aria-pressed={lang === code} className={`flex-1 h-8 rounded-md text-xs font-semibold transition ${lang === code ? 'bg-elevated text-textPrimary shadow-sm' : 'text-textMuted hover:text-textPrimary'}`}>{code}</button>
                ))}
              </div>
              <ThemeToggle />
            </div>
            {/* [TR] Oturum yokken emir oluşturma düğmesi işlevsizdir; yerine üstteki "Cüzdan bağla" kartı var. */}
            {navUnlocked && (
              <button onClick={handleOpenMakerModal} disabled={isPaused} className={`w-full h-11 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2 ${isPaused ? 'bg-elevated text-textMuted cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'}`}>
                <Plus className="w-4 h-4" strokeWidth={2} aria-hidden="true" /> {tr ? 'Yeni emir oluştur' : 'Create order'}
              </button>
            )}
          </div>
        </aside>
      </>
    );
  };

  // ═══════════════════════════════════════════
  // 12. SAYFA RENDER FONKSİYONLARI
  //     Home, Marketplace, Trade Room views
  // ═══════════════════════════════════════════

  // [TR] Ana sayfa — protokol açıklaması ve istatistik kartları
  // [EN] Home page — protocol description and stats cards
  // [TR] İstatistik gelmediyse "$0" yanıltıcıdır; veri yokken tire gösterilir.
  // [EN] "$0" is misleading when stats failed to load; show a dash when there is no data.
  const statValue = (value, format) => (protocolStats == null || value == null ? '—' : format(value));

  const renderHome = () => (
    <div className="w-full max-w-[1200px] min-w-0 p-4 md:p-8">
      <div className="mb-10">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-textPrimary via-textSecondary to-textMuted tracking-tight mb-3">
          {lang === 'TR' ? <>Sistem yargılamaz. <br/>Dürüstsüzlüğü pahalıya mal eder.</> : <>The system does not judge. <br/>It makes dishonesty expensive.</>}
        </h1>
        <p className="text-textMuted text-sm max-w-lg">{lang === 'TR' ? 'Emanet tutmayan, hakemsiz eşten eşe USDT/USDC takası. Kurallar kontratta.' : 'Non-custodial, arbitrator-free P2P USDT/USDC trading. The rules live in the contract.'}</p>
        <div className="mt-5 flex flex-col sm:flex-row gap-3">
          <button onClick={() => setCurrentView('market')} className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-brand text-black text-sm font-bold hover:opacity-90 transition">
            <Store className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />{lang === 'TR' ? 'Pazara git' : 'Open market'}
          </button>
          <button onClick={openCreateOrder} disabled={isPaused} className="px-6 py-3 rounded-xl bg-surface border border-borderStrong text-textPrimary text-sm font-bold hover:bg-elevated transition disabled:opacity-50 disabled:cursor-not-allowed">
            {lang === 'TR' ? '+ Emir oluştur' : '+ Create order'}
          </button>
        </div>
      </div>

      {(() => {
        const tr = lang === 'TR';
        const usd = (v) => `$${Number(v).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })}`;
        const openOrders = protocolStats && (protocolStats.open_sell_orders != null || protocolStats.open_buy_orders != null)
          ? Number(protocolStats.open_sell_orders || 0) + Number(protocolStats.open_buy_orders || 0)
          : null;
        const hours = protocolStats?.avg_trade_hours;
        const tiles = [
          { k: 'vol', label: tr ? 'Tamamlanan hacim' : 'Settled volume', value: statValue(protocolStats?.total_volume_usdt, usd), change: protocolStats?.changes_30d?.total_volume_usdt_pct },
          { k: 'trades', label: tr ? 'Başarılı işlem' : 'Successful trades', value: statValue(protocolStats?.completed_trades, (v) => Number(v).toLocaleString(localeOf(lang))), change: protocolStats?.changes_30d?.completed_trades_pct },
          { k: 'open', label: tr ? 'Açık emir' : 'Open orders', value: openOrders == null ? '—' : openOrders.toLocaleString(), sub: openOrders == null ? null : (tr ? `${protocolStats.open_sell_orders || 0} satış · ${protocolStats.open_buy_orders || 0} alış` : `${protocolStats.open_sell_orders || 0} sell · ${protocolStats.open_buy_orders || 0} buy`) },
          { k: 'time', label: tr ? 'Ort. işlem süresi' : 'Avg. trade time', value: hours != null ? (hours < 1 ? `${Math.max(1, Math.round(hours * 60))} ${tr ? 'dk' : 'min'}` : `${Number(hours).toLocaleString(localeOf(lang), { maximumFractionDigits: 1 })} ${tr ? 'sa' : 'h'}`) : '—' },
          { k: 'burn', label: tr ? 'Eriyen ve yakılan' : 'Decayed & burned', value: statValue(protocolStats?.burned_bonds_usdt, (v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`), danger: true, sub: tr ? 'Uzlaşmayanların kaybı' : 'Lost by those who would not settle' },
        ];
        return (
          <div className="mb-10">
            <div className="grid min-w-0 grid-cols-2 md:grid-cols-5 gap-3" aria-busy={statsLoading ? 'true' : 'false'} data-testid="home-stats">
              {tiles.map((tile) => (
                <div key={tile.k} className={`min-w-0 overflow-hidden bg-surface border p-4 rounded-2xl relative ${tile.danger ? 'border-danger/30 col-span-2 md:col-span-1' : 'border-borderSubtle'}`}>
                  {tile.danger && <Flame className="absolute -right-2 -bottom-2 w-14 h-14 text-danger/10" strokeWidth={1.8} aria-hidden="true" />}
                  <p className={`text-[10px] font-bold tracking-widest uppercase mb-2 ${tile.danger ? 'text-danger' : 'text-textMuted'}`}>{tile.label}</p>
                  {statsLoading && protocolStats == null ? (
                    <div className="h-7 w-20 rounded-md bg-elevated animate-pulse" />
                  ) : (
                    <div className="flex min-w-0 flex-wrap items-baseline relative">
                      <span className={`max-w-full truncate text-2xl font-bold tabular-nums ${tile.danger ? 'text-danger' : 'text-textPrimary'}`}>{tile.value}</span>
                      {tile.change != null && <StatChange value={tile.change} />}
                    </div>
                  )}
                  {tile.sub && <p className="text-[11px] text-textMuted mt-1 truncate relative">{tile.sub}</p>}
                </div>
              ))}
            </div>
            {statsError && (
              <p className="text-center pt-3 text-textMuted text-xs">
                {tr ? 'İstatistik verisi alınamadı.' : 'Failed to load stats.'}
                <button type="button" onClick={fetchStats} className="ml-2 text-brand font-semibold hover:underline">{tr ? 'Tekrar dene' : 'Retry'}</button>
              </p>
            )}
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <section className="bg-surface border border-borderSubtle rounded-2xl p-5 md:p-6" data-testid="home-how-it-works">
          <p className="text-[11px] tracking-[0.2em] uppercase text-brand mb-2">{lang === 'TR' ? 'Nasıl çalışır' : 'How it works'}</p>
          <h3 className="text-xl font-bold text-textPrimary mb-4">{lang === 'TR' ? 'Kararı kontrat verir, backend değil.' : 'The contract decides, not the backend.'}</h3>
          <ol className="space-y-3">
            {(lang === 'TR' ? [
              { icon: ListPlus, title: 'Emir', text: 'Satıcı kriptoyu ve teminatını kilitler; alıcı kendi teminatıyla işleme girer.' },
              { icon: Banknote, title: 'Ödeme', text: 'Alıcı 48 saat içinde banka ödemesini yapıp bildirir; yapmazsa teminatından kesinti olur.' },
              { icon: CircleCheck, title: 'Onay', text: 'Satıcı onaylar. Sessiz kalırsa alıcı 48 saat sonra uyarır, 24 saat sonra kripto otomatik serbest kalır.' },
              { icon: Flame, title: 'İtiraz', text: 'Hakem yok: teminatlar ve sonra ana para erir. Hızlı uzlaşmak her iki taraf için en ucuz yoldur.' },
            ] : [
              { icon: ListPlus, title: 'Order', text: 'The seller locks crypto plus a bond; the buyer joins with a bond of their own.' },
              { icon: Banknote, title: 'Payment', text: 'The buyer pays by bank within 48 hours and reports it; otherwise part of their bond is lost.' },
              { icon: CircleCheck, title: 'Release', text: 'The seller confirms. If silent, the buyer pings after 48 hours and funds auto-release 24 hours later.' },
              { icon: Flame, title: 'Dispute', text: 'No arbitrator: bonds, then principal, decay. Settling fast is the cheapest path for both sides.' },
            ]).map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="shrink-0 w-8 h-8 rounded-lg bg-elevated border border-borderSubtle flex items-center justify-center text-textSecondary">
                  <step.icon className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-textPrimary"><span className="text-textMuted tabular-nums mr-1">{i + 1}.</span>{step.title}</p>
                  <p className="text-xs md:text-sm text-textSecondary leading-relaxed">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-surface border border-borderSubtle rounded-2xl p-5 md:p-6" data-testid="home-faq">
          <p className="text-[11px] tracking-[0.2em] uppercase text-textMuted mb-3">{lang === 'TR' ? 'Sık sorulanlar' : 'FAQ'}</p>
          <div className="min-w-0 divide-y divide-borderSubtle">
            {buildFaqItems(lang, protocolFeeConfig).map((item) => (
              <details key={item.q} className="group py-3 first:pt-0">
                <summary className="cursor-pointer list-none text-sm font-semibold text-textPrimary flex items-center justify-between gap-3">
                  {item.q}
                  <ChevronDown className="w-4 h-4 shrink-0 text-textMuted group-open:rotate-180 transition" strokeWidth={1.8} aria-hidden="true" />
                </summary>
                <p className="text-xs md:text-sm text-textSecondary mt-2 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  // [TR] Pazar yeri — side-aware order listesi, filtreler, test faucet butonları
  // [EN] Marketplace — side-aware order list, filters, test faucet buttons
  // [TR] Pazar — P2P borsalarındaki gibi sıkı satırlar: fiyat öne çıkar, aksiyon sağda, detay dokununca açılır.
  //      "Al" sekmesi kripto satan emirleri (SELL_CRYPTO), "Sat" sekmesi kripto alan emirleri (BUY_CRYPTO) listeler.
  // [EN] Market — dense P2P rows: price first, action on the right, details on tap.
  const renderMarket = () => {
    const tr = lang === 'TR';
    const fmt = (n, digits = 2) => fmtNum(n, lang, digits);
    const filters = { ...MARKET_FILTER_DEFAULTS, ...marketFilters };
    const side = filters.side;
    const setFilter = (key, value) => setMarketFilter?.(key, value);
    const visibleOrders = filteredOrders || [];
    const activeFilterCount = countActiveMarketFilters(filters);
    const isNarrowed = activeFilterCount > 0 || side !== 'ALL';
    const viewerTier = isAuthenticated && Number.isInteger(userReputation?.effectiveTier) ? userReputation.effectiveTier : null;
    // [TR] Taraf seçili değilken "en iyi kur" anlamsızdır (alış/satış kurları ters yönlü); varsayılan en yüksek miktardır.
    // [EN] Without a side "best rate" is ambiguous (buy/sell rates point opposite ways); the default is largest amount.
    const sortOptions = side !== 'ALL'
      ? [{ value: 'AUTO', label: tr ? 'En iyi kur' : 'Best rate' }, { value: 'AMOUNT', label: tr ? 'En yüksek miktar' : 'Largest amount' }, { value: 'NEWEST', label: tr ? 'En yeni' : 'Newest' }]
      : [{ value: 'AUTO', label: tr ? 'En yüksek miktar' : 'Largest amount' }, { value: 'NEWEST', label: tr ? 'En yeni' : 'Newest' }];
    const sortValue = side === 'ALL' && filters.sort === 'AMOUNT' ? 'AUTO' : filters.sort;
    const shownCount = visibleOrders.length;
    // [TR] İlk sayfa 50 emirle sınırlı; sunucu toplamı daha büyükse ayrıca gösterilir. [EN] Show the server total when it exceeds the first page.
    const loadedCount = (orders || []).length;
    const totalCount = Number.isFinite(marketOrdersTotal) ? marketOrdersTotal : loadedCount;
    const fieldClass = 'h-9 w-full min-w-0 bg-surface text-textPrimary rounded-lg border border-borderSubtle outline-none focus:border-brand/50 text-sm transition';
    // [TR] Bileşen değil fonksiyon: her render'da yeni tip oluşup odak kaybolmasın. [EN] Plain call keeps focus across renders.
    const selectField = ({ value, onChange, label, options, className = '' }) => (
      <label key={label} className={`relative min-w-0 ${className}`}>
        <span className="sr-only">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldClass} appearance-none cursor-pointer pl-3 pr-8`}>
          {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted" strokeWidth={1.8} aria-hidden="true" />
      </label>
    );
    return (
      <div className="w-full max-w-[1200px] min-w-0 p-4 md:p-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-textPrimary">{tr ? 'Pazar' : 'Market'}</h2>
          <button onClick={openCreateOrder} disabled={isPaused} className="inline-flex items-center gap-1.5 h-9 px-3 md:px-4 rounded-lg bg-brand text-black text-sm font-semibold hover:opacity-90 disabled:opacity-50">
            <Plus className="w-4 h-4" strokeWidth={2} aria-hidden="true" />{tr ? 'Emir oluştur' : 'Create order'}
          </button>
        </div>

        <div className="mb-3 grid grid-cols-2 md:flex md:items-center gap-2">
          <Segmented
            label={tr ? 'İşlem yönü' : 'Trade side'}
            value={side}
            onChange={(v) => setFilter('side', v)}
            items={[
              { value: 'ALL', label: tr ? 'Tümü' : 'All' },
              { value: 'BUY', label: tr ? 'Al' : 'Buy', activeClass: 'bg-emerald-600 text-white shadow-sm' },
              { value: 'SELL', label: tr ? 'Sat' : 'Sell', activeClass: 'bg-danger text-white shadow-sm' },
            ]}
          />
          <Segmented
            label={tr ? 'Varlık' : 'Asset'}
            value={filters.token}
            onChange={(v) => setFilter('token', v)}
            items={[{ value: 'ALL', label: tr ? 'Hepsi' : 'Any' }, { value: 'USDT', label: 'USDT' }, { value: 'USDC', label: 'USDC' }]}
          />
        </div>

        {/* [TR] Gelişmiş filtreler: tutar tek işleme sığan emirleri, para birimi, teminat/tier ve sıralama.
             Tümü sunucuda uygulanır; "kendi emirlerimi gizle" yalnız istemcide. */}
        <div role="search" aria-label={tr ? 'Pazar filtreleri' : 'Market filters'} className="mb-2 grid grid-cols-2 md:flex md:flex-wrap md:items-center gap-2">
          <div className="relative col-span-2 md:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted" strokeWidth={1.8} aria-hidden="true" />
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={filters.amount}
              onChange={(e) => setFilter('amount', e.target.value)}
              placeholder={tr ? 'İşlem tutarı' : 'Trade amount'}
              aria-label={tr ? 'İşlem tutarı' : 'Trade amount'}
              className={`${fieldClass} pl-9 pr-16 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-textMuted">{filters.token === 'ALL' ? 'USD₮/C' : filters.token}</span>
          </div>
          {selectField({
            className: 'md:w-44',
            label: tr ? 'Para birimi' : 'Currency',
            value: filters.fiat,
            onChange: (v) => setFilter('fiat', v),
            options: [{ value: 'ALL', label: tr ? 'Tüm dövizler' : 'All currencies' }, ...MARKET_FIAT_OPTIONS.map((c) => ({ value: c, label: c }))],
          })}
          {selectField({
            className: 'md:w-48',
            label: tr ? 'Teminat' : 'Bond',
            value: filters.tier,
            onChange: (v) => setFilter('tier', v),
            options: [
              { value: 'ALL', label: tr ? 'Tüm tier’lar' : 'All tiers' },
              { value: 'NO_BOND', label: tr ? 'Teminatsız (Tier 0)' : 'No bond (Tier 0)' },
              { value: 'ELIGIBLE', label: viewerTier != null ? (tr ? `Girebildiklerim (≤ T${viewerTier})` : `I can take (≤ T${viewerTier})`) : (tr ? 'Girebildiklerim (giriş gerekli)' : 'I can take (sign in)'), disabled: viewerTier == null },
            ],
          })}
          {selectField({
            className: address ? 'md:w-44' : 'col-span-2 md:col-span-1 md:w-44',
            label: tr ? 'Sıralama' : 'Sort',
            value: sortValue,
            onChange: (v) => setFilter('sort', v),
            options: sortOptions,
          })}
          {address && (
            <button
              type="button"
              aria-pressed={filters.hideOwn}
              onClick={() => setFilter('hideOwn', !filters.hideOwn)}
              className={`h-9 min-w-0 inline-flex items-center justify-center gap-1.5 px-3 rounded-lg border text-sm font-medium transition ${filters.hideOwn ? 'border-brand/50 bg-brand/10 text-textPrimary' : 'border-borderSubtle bg-surface text-textSecondary hover:text-textPrimary'}`}
            >
              <EyeOff className="w-4 h-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <span className="truncate">{tr ? 'Emirlerimi gizle' : 'Hide mine'}</span>
            </button>
          )}
        </div>

        <div className="mb-3 flex min-h-[1.75rem] items-center justify-between gap-2 text-xs text-textMuted">
          <p aria-live="polite" className="tabular-nums">
            {loading || ordersFeedError ? '\u00a0' : totalCount > loadedCount
              ? (tr ? `${shownCount} emir · toplam ${totalCount}` : `${shownCount} ${shownCount === 1 ? 'order' : 'orders'} · ${totalCount} total`)
              : (tr ? `${shownCount} emir` : `${shownCount} ${shownCount === 1 ? 'order' : 'orders'}`)}
          </p>
          {activeFilterCount > 0 && (
            <button type="button" onClick={() => resetMarketFilters?.()} className="inline-flex items-center gap-1 h-7 px-2 rounded-md font-semibold text-textSecondary hover:text-textPrimary hover:bg-elevated">
              <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
              {tr ? `Filtreleri temizle (${activeFilterCount})` : `Clear filters (${activeFilterCount})`}
            </button>
          )}
        </div>

        {isFaucetEnabled && (
          <div className="mb-3 flex items-center gap-2 text-xs text-textMuted">
            <Droplets className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />
            <span>{tr ? 'Test token:' : 'Test tokens:'}</span>
            {['USDT', 'USDC'].map((sym) => (
              <button key={sym} onClick={() => handleMint(sym)} disabled={isContractLoading} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-borderSubtle bg-surface font-semibold text-textSecondary hover:text-textPrimary hover:bg-elevated disabled:opacity-50">
                {isContractLoading && loadingText.includes(sym) ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" strokeWidth={1.8} aria-hidden="true" /> : null}
                {tr ? `${sym} al` : `Get ${sym}`}
              </button>
            ))}
          </div>
        )}

        <ReferenceRateTicker lang={lang} />

        <div className="space-y-2">
          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-xl bg-surface border border-borderSubtle animate-pulse" />)}
            </div>
          ) : visibleOrders.length > 0 ? (
            visibleOrders.map((order) => {
              const effectiveUserTier = userReputation?.effectiveTier ?? 0;
              const isMyOwnAd    = address && order.makerFull?.toLowerCase() === address.toLowerCase();
              const isTierLocked = isConnected && isAuthenticated && order.tier > effectiveUserTier;
              const canTakeOrder = isConnected && isAuthenticated && !isMyOwnAd && !isTierLocked && !isPaused;
              const tokenAddr    = SUPPORTED_TOKEN_ADDRESSES[order.crypto || 'USDT'];
              const isTokenConfigured = Boolean(tokenAddr);
              const isCorrectChain    = isSupportedChainId(chainId);
              const isSellSide = order.side === 'SELL_CRYPTO';
              // [TR] F13 — Taker giriş kapıları (yaş / dust / cooldown) yalnız SATIŞ emrini dolduran kişiye uygulanır:
              //      alış emrini dolduran kontratta maker'dır (_enforceTakerEntry emir sahibine bakar). Tier kilidi iki yönde de geçerli.
              //      Cooldown yalnız Tier 0/1 emirlerinde zorlanır (_getCooldownForTier).
              // [EN] F13 — Taker entry gates (age / dust / cooldown) apply only when filling a SELL order; the filler of a
              //      BUY order is the maker on-chain. The tier lock stays in both directions. Cooldown is enforced for tier 0/1 only.
              const isFunded          = !isSellSide || (sybilStatus ? sybilStatus.funded !== false : true);
              const isAged            = !isSellSide || (sybilStatus ? sybilStatus.aged !== false : true);
              const isCooldownOk      = !isSellSide || Number(order.tier) >= 2 || (sybilStatus ? sybilStatus.cooldownOk !== false : true);
              const finalCanTakeOrder = canTakeOrder && isCooldownOk && isFunded && isAged && !isPaused && isTokenConfigured && isCorrectChain;
              // [TR] Renk kullanıcının yapacağı işi anlatır: "Satın Al" yeşil, "Sat" kırmızı. Emir yönü rozeti nötrdür;
              //      renkli rozet (ör. yeşil "Satış emri") yanındaki butonla çelişiyordu.
              // [EN] Colour follows the viewer's action (buy green, sell red); the order-side badge stays neutral.
              const sideBadgeClass = 'text-textSecondary border-borderSubtle bg-elevated';
              const sideLabel = order.sideLabel || getOrderSideCopy(order.side, 'order', lang) || order.side;
              // [TR] Oturum yoksa buton pasif "Kilitli" yerine giriş akışını başlatır.
              const needsSignIn = !isConnected || !isAuthenticated;
              const isDisabled = needsSignIn ? false : (!finalCanTakeOrder || isContractLoading);
              const icon = (I, spin) => <I className={`w-4 h-4${spin ? ' animate-spin' : ''}`} strokeWidth={1.8} aria-hidden="true" />;
              const ctaContent =
                // Signed out: keep the action label and colour; the click starts sign-in.
                needsSignIn         ? <>{order.ctaLabel || (tr ? 'İşlem yap' : 'Trade')}</> :
                isPaused            ? <>{icon(CirclePause)} {tr ? 'Bakımda' : 'Paused'}</> :
                !isCorrectChain     ? <>{icon(Unplug)} {tr ? 'Yanlış ağ' : 'Wrong network'}</> :
                !isTokenConfigured  ? <>{icon(Settings)} {tr ? 'Token ayarlanmadı' : 'Token not set'}</> :
                isMyOwnAd           ? <>{tr ? 'Sizin emriniz' : 'Your order'}</> :
                isTierLocked        ? <>{icon(Lock)} {tr ? `Tier ${order.tier} gerekli` : `Tier ${order.tier} required`}</> :
                !canTakeOrder       ? <>{icon(Lock)} {tr ? 'Kilitli' : 'Locked'}</> :
                !isAged             ? <>{icon(Hourglass)} {tr ? 'Cüzdan çok yeni' : 'Wallet too new'}</> :
                !isFunded           ? <>{icon(TriangleAlert)} {tr ? 'Bakiye yetersiz' : 'Low balance'}</> :
                !isCooldownOk       ? <>{icon(Hourglass)} {tr ? `${Math.ceil((sybilStatus?.cooldownRemaining || 0) / 60)} dk` : `${Math.ceil((sybilStatus?.cooldownRemaining || 0) / 60)} min`}</> :
                isContractLoading   ? <>{icon(LoaderCircle, true)}{loadingText || (tr ? 'İşleniyor…' : 'Processing…')}</> :
                (order.ctaLabel || (tr ? 'İşlem yap' : 'Trade'));
              const ctaTone = isDisabled
                ? 'bg-elevated text-textMuted border border-borderSubtle cursor-not-allowed'
                : isSellSide ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-danger text-white hover:opacity-90';
              const bondText = Number(order.tier) === 0
                ? (tr ? 'teminatsız' : 'no bond')
                : (order.bondLabel && order.bondLabel !== '—' ? `${order.bondLabel} ${tr ? 'teminat' : 'bond'}` : null);

              return (
                <article key={order.id} className="min-w-0 bg-surface border border-borderSubtle rounded-xl p-3 md:p-4 transition-colors hover:border-borderStrong">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-textSecondary">
                        <span className={`w-4 h-4 shrink-0 rounded-full text-[9px] font-bold text-white flex items-center justify-center ${order.crypto === 'USDC' ? 'bg-blue-600' : 'bg-emerald-600'}`} aria-hidden="true">{order.crypto === 'USDC' ? 'C' : 'T'}</span>
                        <span className="font-mono truncate">{order.maker}</span>
                        <span className="shrink-0 px-1.5 rounded bg-elevated text-[10px] font-semibold text-textSecondary">T{order.tier}</span>
                        {order.successRate != null && <span className="shrink-0 text-[11px] text-textMuted">{fmtPct(order.successRate, lang)}</span>}
                      </div>
                      <p className="mt-1.5 text-xl font-bold text-textPrimary tabular-nums leading-tight">
                        {order.hasPrice === false
                          ? <span className="text-sm font-medium text-textMuted">{tr ? 'Kur belirtilmedi' : 'No rate set'}</span>
                          : <>{fmt(order.rate, 4)} <span className="text-xs font-medium text-textMuted">{order.fiat}</span></>}
                      </p>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                        <dt className="text-textMuted">{tr ? 'Miktar' : 'Available'}</dt>
                        <dd className="text-textPrimary font-medium tabular-nums truncate">{fmt(order.remainingAmount)} {order.crypto}</dd>
                        <dt className="text-textMuted">Limit</dt>
                        <dd className="text-textSecondary tabular-nums truncate">Min {fmt(order.minFillAmount)} {order.crypto}{bondText ? ` · ${bondText}` : ''}</dd>
                      </dl>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${sideBadgeClass}`}>{sideLabel}</span>
                      <button onClick={() => (needsSignIn ? handleAuthAction() : handleStartTrade(order))} disabled={isDisabled} title={needsSignIn ? (tr ? 'Önce cüzdanınızı bağlayıp giriş yapın' : 'Connect your wallet and sign in first') : undefined} className={`h-9 min-w-[5.5rem] px-4 rounded-lg text-sm font-semibold transition inline-flex items-center justify-center gap-1.5 ${ctaTone}`}>
                        {ctaContent}
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-borderSubtle flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded border border-borderSubtle text-textMuted">{order.statusLabel || order.status}</span>
                    {order.paymentRiskSignal && <PaymentRiskBadge lang={lang} riskEntry={order.paymentRiskSignal} compact />}
                    {/* [TR] Hover yerine dokunmatik uyumlu açılır özet; mobilde de çalışır. */}
                    <details className="group ml-auto min-w-0 text-xs">
                      <summary className="cursor-pointer list-none text-textMuted hover:text-textPrimary inline-flex items-center gap-1">
                        <Info className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />{tr ? 'Özet' : 'Summary'}
                      </summary>
                      <div className="mt-2 rounded-lg border border-borderSubtle bg-elevated p-3 w-[min(18rem,calc(100vw_-_3rem))]">
                        <p className="text-[10px] text-textMuted mb-1 tracking-widest">{tr ? 'İŞLEM SAHİBİ ÖZETİ' : 'ORDER OWNER SUMMARY'}</p>
                        <p className="text-[11px] text-textMuted mb-2">{order.ownerSideHint || (tr ? 'Emir sahibi taraf bilgisi' : 'Order owner side context')}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div><p className="text-[10px] text-textMuted">{tr ? 'Başarı' : 'Success'}</p><p className="font-semibold text-emerald-500">{order.successRate != null ? `${order.successRate}%` : '—'}</p></div>
                          <div><p className="text-[10px] text-textMuted">{tr ? 'Toplam işlem' : 'Total trades'}</p><p className="font-mono text-textPrimary">{order.totalTrades ?? order.txCount ?? '—'}</p></div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-[10px] text-textMuted">{tr ? 'Güven Görünürlüğü' : 'Trust Visibility'}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded border ${order?.trustSummary?.chipClass || 'text-textMuted border-borderSubtle bg-elevated'}`}>
                            {order?.trustSummary?.band ? `${order.trustSummary.band} · ${order.trustSummary.label}` : (order?.trustSummary?.label || (tr ? 'Sinyal yok' : 'Signal unavailable'))}
                          </span>
                        </div>
                        <p className="text-[10px] text-textMuted mt-1">{tr ? 'Bilgilendirme amaçlıdır.' : 'Informational only.'}</p>
                      </div>
                    </details>
                  </div>
                  {!isFunded && isConnected && canTakeOrder && !isPaused && (
                    <p className="mt-2 text-xs text-danger">{tr ? 'En az 0.001 ETH gerekli.' : 'Needs at least 0.001 ETH.'}</p>
                  )}
                </article>
              );
            })
          ) : (
            <div className="p-8 text-center border border-dashed border-borderSubtle rounded-xl">
              <p className="text-sm text-textMuted mb-4">
                {ordersFeedError
                  ? (tr ? 'Pazar verisi alınamadı. Bağlantı düzelince liste otomatik yenilenecek.' : 'Market data unavailable. The list refreshes automatically.')
                  : isNarrowed
                    ? (tr ? 'Bu filtreye uyan emir yok.' : 'No orders match this filter.')
                    : (tr ? 'Henüz açık emir yok.' : 'No open orders yet.')}
              </p>
              {!ordersFeedError && activeFilterCount > 0 && (
                <button type="button" onClick={() => resetMarketFilters?.()} className="mb-3 mx-auto flex items-center gap-1.5 h-9 px-4 rounded-lg border border-borderSubtle bg-surface text-sm font-semibold text-textPrimary hover:bg-elevated">
                  <RotateCcw className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />{tr ? 'Filtreleri temizle' : 'Clear filters'}
                </button>
              )}
              {!isPaused && !ordersFeedError && (
                <button onClick={openCreateOrder} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-brand text-black text-sm font-semibold hover:opacity-90">
                  <Plus className="w-4 h-4" strokeWidth={2} aria-hidden="true" />{tr ? 'İlk emri oluştur' : 'Create the first order'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // [TR] İşlem odası — LOCKED/PAID/CHALLENGED durumlarına göre taker/maker aksiyonlarını gösterir.
  //      Bleeding Escrow görsel barı, zamanlayıcılar, iptal/serbest bırakma ve PII bölümü içerir.
  // [EN] Trade room — shows taker/maker actions based on LOCKED/PAID/CHALLENGED state.
  //      Contains Bleeding Escrow visual bar, timers, cancel/release and PII section.
  const renderTradeRoom = () => {
    // [TR] Session invalidation sonrası activeTrade temizlenmiş olabilir.
    //      Bu durumda fallback "0.00/undefined" ile kırık oda render etmek yerine
    //      kullanıcıya deterministik empty-state gösterip güvenli aksiyon sunuyoruz.
    // [EN] activeTrade can be cleared after session invalidation.
    //      Instead of rendering a broken room with fallback values, show a
    //      deterministic empty-state with safe navigation actions.
    if (!activeTrade) {
      return (
        <div className="p-4 md:p-8 max-w-[900px] w-full mx-auto mt-6 md:mt-0">
          <div className="bg-surface border border-borderSubtle rounded-2xl p-6 md:p-8 text-center">
            <div className="w-14 h-14 bg-elevated border border-borderStrong rounded-full flex items-center justify-center mx-auto mb-4 text-warning"><TriangleAlert className="w-6 h-6" strokeWidth={1.8} aria-hidden="true" /></div>
            <h2 className="text-xl font-bold text-textPrimary mb-2">
              {lang === 'TR' ? 'Aktif işlem bulunamadı' : 'No active trade found'}
            </h2>
            <p className="text-sm text-textSecondary mb-5">
              {lang === 'TR'
                ? 'Oturumunuz sona ermiş veya işlem durumu güncellenmiş olabilir. Güvenli şekilde pazar yerine dönebilirsiniz.'
                : 'Your session may have expired or trade state was refreshed. You can safely return to the marketplace.'}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => { fetchMyTrades(); }}
                className="w-full sm:w-auto px-5 py-2.5 bg-elevated border border-borderStrong hover:bg-surface text-textPrimary rounded-xl text-sm font-bold transition"
              >
                {lang === 'TR' ? 'İşlemleri Yenile' : 'Refresh Trades'}
              </button>
              <button
                onClick={() => setCurrentView('market')}
                className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold transition"
              >
                {lang === 'TR' ? 'Pazar Yerine Dön' : 'Go to Marketplace'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (activeTrade?._pendingBackendSync && !activeTrade?.id) {
      return (
        <div className="p-8 text-center">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-textPrimary font-bold text-lg mb-2">
            {lang === 'TR' ? 'İşlem Zincire Yazıldı' : 'Trade Written On-Chain'}
          </p>
          <p className="text-textSecondary text-sm">
            {lang === 'TR'
              ? 'Backend kaydı senkronize ediliyor... Bu birkaç saniye sürebilir.'
              : 'Syncing backend record... This may take a few seconds.'}
          </p>
          <button
            onClick={fetchMyTrades}
            className="mt-4 px-6 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold"
          >
            {lang === 'TR' ? 'Yenile' : 'Refresh'}
          </button>
        </div>
      );
    }
    const roomState = resolvedTradeState;
    const isChallenged = roomState === 'CHALLENGED';
    const isTaker = userRole === 'taker';
    const isMaker = userRole === 'maker';

    const tradeTokenDecimals = activeTrade?.tokenDecimals ?? (tokenDecimalsMap[activeTrade?.crypto || 'USDT'] ?? null);
    const rawCryptoAmt = activeTrade?.cryptoAmountRaw
      ? rawTokenToDisplayNumber(activeTrade.cryptoAmountRaw, tradeTokenDecimals)
      : (Number(activeTrade?.max) > 0 && Number(activeTrade?.rate) > 0 ? Number(activeTrade.max) / Number(activeTrade.rate) : 0);
    // [TR] Ücret, global config değil trade'in kilitlendiği andaki fee snapshot'ından hesaplanır.
    // [EN] Fee uses the trade's lock-time fee snapshot, not the current global config.
    const effectiveTakerFeeBps = Number.isFinite(Number(activeTrade?.takerFeeBps)) && activeTrade?.takerFeeBps !== null
      ? Number(activeTrade.takerFeeBps)
      : Number(takerFeeBps || 0);
    const protocolFee  = rawCryptoAmt * (effectiveTakerFeeBps / 10000);
    const netAmount    = rawCryptoAmt - protocolFee;
    const asset        = activeTrade?.crypto || 'USDT';
    const fmt = (value, digits = 2) => fmtNum(value, lang, digits);
    const feeBreakdownText = lang === 'TR'
      ? `Kilitli ${fmt(rawCryptoAmt)} ${asset} · Ücret ${fmt(protocolFee, 4)} · Alıcıya net ${fmt(netAmount)} ${asset}`
      : `Locked ${fmt(rawCryptoAmt)} ${asset} · Fee ${fmt(protocolFee, 4)} · Net to taker ${fmt(netAmount)} ${asset}`;
    // [TR] Karşı taraf adresi her zaman kısaltılır; ham 42 karakterlik adres mobilde taşıyordu.
    // [EN] Counterparty address is always shortened; the raw 42-char address overflowed on mobile.
    const counterpartyRaw = isMaker ? activeTrade?.takerFull : (activeTrade?.makerFull || activeTrade?.maker);
    const counterpartyDisplay = counterpartyRaw && String(counterpartyRaw).length > 14 ? formatAddress(counterpartyRaw) : (counterpartyRaw || '—');
    const fiatTotal = Number(activeTrade?.max) > 0 && activeTrade?.fiat ? `${fmt(activeTrade.max)} ${activeTrade.fiat}` : null;
    const hasOnchainTradeId = activeTrade?.onchainId !== null && activeTrade?.onchainId !== undefined && activeTrade?.onchainId !== '';
    const missingOnchainIdReason = lang === 'TR' ? 'On-chain trade ID bulunamadı.' : 'Missing on-chain trade ID.';
    // [TR] Zincir saati (yoksa cihaz saati). [EN] Chain time, falling back to the device clock.
    const nowMs = Number.isFinite(chainNowMs) ? chainNowMs : Date.now();
    const burnExpiredDeadlinePassed = getBurnExpiredDeadlinePassed({ activeTrade, roomState, now: new Date(nowMs) });
    const handleBurnExpired = ctx.handleBurnExpired || ctx.tradeRoomActions?.handleBurnExpired;
    const paymentWindowExpired = getPaymentWindowExpired({ activeTrade, roomState, now: new Date(nowMs) });
    const handleExpirePaymentWindow = ctx.handleExpirePaymentWindow || ctx.tradeRoomActions?.handleExpirePaymentWindow;
    // [TR] Lab'da handler'lar günlüğe yazar; aktif/pasif kuralları her iki durumda da aynıdır.
    const labHandlers = ctx.devTradeHandlers || null;
    const tradeActionCallbacks = buildTradeRoomPanelCallbacks({
      lang,
      activeTrade,
      roomState,
      isMaker,
      isContractLoading,
      chargebackAccepted,
      hasOnchainTradeId,
      missingOnchainIdReason,
      canMakerChallenge,
      canMakerStartChallengeFlow,
      burnExpiredDeadlinePassed,
      handleReportPayment: labHandlers?.handleReportPayment || handleReportPayment,
      handleRelease: labHandlers?.handleRelease || handleRelease,
      handleChallenge: labHandlers?.handleChallenge || handleChallenge,
      handlePingMaker: labHandlers?.handlePingMaker || handlePingMaker,
      handleAutoRelease: labHandlers?.handleAutoRelease || handleAutoRelease,
      handleProposeCancel: labHandlers?.handleProposeCancel || handleProposeCancel,
      handleBurnExpired: labHandlers?.handleBurnExpired || handleBurnExpired,
      handleExpirePaymentWindow: labHandlers?.handleExpirePaymentWindow || handleExpirePaymentWindow,
      paymentWindowExpired,
      nowMs,
      confirmFn: labHandlers ? () => true : undefined,
    });
    const defaultTradeDecisionInput = {
      trade: activeTrade,
      tradeState: roomState,
      userRole,
      chargebackAccepted,
      paymentIpfsHash,
      timers: tradeTimers,
      isConnected,
      isAuthenticated,
      isSupportedChain: isSupportedChainId(chainId),
      isPaused,
      lang,
      canBurnExpired: burnExpiredDeadlinePassed,
      paymentWindowExpired,
      cancelStatus,
    };
    const tradeDecisionInput = ctx.devTradeDecisionInput
      ? { ...ctx.devTradeDecisionInput, lang, cancelStatus, timers: { ...ctx.devTradeDecisionInput.timers } }
      : defaultTradeDecisionInput;

    return (
      <div className="p-4 md:p-8 max-w-[900px] w-full mx-auto relative mt-6 md:mt-0">
        <button onClick={() => setCurrentView('market')} className="absolute -top-2 md:-top-4 left-4 md:left-8 text-textMuted hover:text-textPrimary text-sm transition">← {lang === 'TR' ? 'Pazar Yerine Dön' : 'Go Back'}</button>

        {/* [TR] Aktif işlem odasında da yalnız bilgilendirme amaçlı referans kur görünürlüğü sağlanır.
            [EN] Active trade room also shows the same informational-only reference widget. */}
        <ReferenceRateTicker lang={lang} />

        <div className={`border rounded-2xl p-4 md:p-6 shadow-xl transition-colors duration-700 ${isChallenged ? 'bg-surface border-danger/40' : 'bg-surface border-borderSubtle'}`}>
          <div className="flex items-start justify-between gap-3 mb-4 border-b border-borderSubtle pb-4" data-testid="trade-room-header">
            <div className="min-w-0">
              <p className="text-textMuted text-[11px] tracking-widest mb-1">{lang === 'TR' ? 'İŞLEM' : 'TRADE'} #{activeTrade?.onchainId ?? '—'}</p>
              <h2 className="text-2xl font-bold text-textPrimary leading-tight">{fmt(rawCryptoAmt)} {asset}</h2>
              {fiatTotal && <p className="text-sm font-medium text-textMuted">≈ {fiatTotal}</p>}
            </div>
            <div className="shrink-0 text-right">
              <span className={`inline-block text-xs px-3 py-1 rounded-full border ${isChallenged || roomState === 'BURNED' ? 'bg-danger/10 text-danger border-danger/40' : roomState === 'CANCELED' ? 'bg-elevated text-textMuted border-borderSubtle' : 'bg-brand/10 text-brand border-brand/40'}`}>{getStateLabel(roomState, lang)}</span>
              <p className="mt-1.5 text-[11px] text-textMuted">{lang === 'TR' ? 'Karşı taraf' : 'Counterparty'}</p>
              <p className="text-xs text-textPrimary font-mono">{counterpartyDisplay}</p>
            </div>
          </div>

          {/* [TR] Eriyen emanet: her kalem (satıcı teminatı, alıcı teminatı, ana para) kendi çubuğunda, kontrattaki
              orijinal tutara oranla gösterilir. Veri yoksa "hesaplanıyor" yazar; yanıltıcı %100/0 gösterilmez.
              [EN] Bleeding escrow: one meter per bucket vs. its lock-time amount; no fake 100%/0 while loading. */}
          {isChallenged && (() => {
            const toNum = (v) => { try { return Number(BigInt(v ?? 0)); } catch { return 0; } };
            const pctOf = (remaining, original) => (original > 0 ? Math.max(0, Math.min(100, Math.round((remaining / original) * 100))) : null);
            const rows = [
              { key: 'maker', label: lang === 'TR' ? 'Satıcı teminatı' : 'Maker bond', mine: isMaker, pct: bleedingAmounts ? pctOf(toNum(bleedingAmounts.makerBondRemaining), toNum(activeTrade?.makerBondRaw)) : null },
              { key: 'taker', label: lang === 'TR' ? 'Alıcı teminatı' : 'Taker bond', mine: isTaker, pct: bleedingAmounts ? pctOf(toNum(bleedingAmounts.takerBondRemaining), toNum(activeTrade?.takerBondRaw)) : null },
              { key: 'crypto', label: lang === 'TR' ? 'Ana para' : 'Principal', mine: false, pct: bleedingAmounts && bleedingAmounts.currentCrypto !== undefined ? pctOf(toNum(bleedingAmounts.currentCrypto), toNum(activeTrade?.cryptoAmountRaw)) : null },
            ].filter((row) => row.pct !== null || !bleedingAmounts);
            const barTone = (pct) => (pct === null ? 'bg-borderStrong' : pct > 66 ? 'bg-emerald-500' : pct > 33 ? 'bg-warning' : 'bg-danger');
            return (
              <div className="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-4" data-testid="bleeding-meter">
                <div className="mb-3">
                  <p className="flex items-center gap-1.5 text-sm font-bold text-danger"><Flame className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />{lang === 'TR' ? 'Eriyen emanet' : 'Bleeding escrow'}</p>
                  <p className="mt-0.5 text-xs text-textSecondary">{lang === 'TR' ? 'Eriyen toplam' : 'Total burned'}: <span className="font-semibold text-danger tabular-nums">{bleedingAmounts ? `${formatTokenAmountFromRaw(bleedingAmounts.totalDecayed ?? 0n, tradeTokenDecimals)} ${asset}` : (lang === 'TR' ? 'hesaplanıyor…' : 'calculating…')}</span></p>
                </div>
                <div className="space-y-2.5">
                  {rows.map((row) => (
                    <div key={row.key} className="text-xs">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={row.mine ? 'font-semibold text-textPrimary' : 'text-textSecondary'}>{row.label}{row.mine ? (lang === 'TR' ? ' (siz)' : ' (you)') : ''}</span>
                        <span className="tabular-nums text-textPrimary">{row.pct === null ? '—' : fmtPct(row.pct, lang)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-elevated overflow-hidden" aria-hidden="true">
                        <div className={`h-full rounded-full transition-all duration-500 ${barTone(row.pct)}`} style={{ width: `${row.pct ?? 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {(() => {
            // [TR] Önce görülmesi gereken: alıcı için satıcının ödeme bilgileri (nereye ödeyeceği).
            // [EN] Must-see-first: for the taker, the maker's payment details (where to pay).
            const showTakerPii = isTaker && ['LOCKED', 'PAID'].includes(roomState);
            const beforeActions = showTakerPii ? (
              <div className="mb-4">
                <PIIDisplay key={activeTrade?.id} tradeId={activeTrade?.id} lang={lang} authenticatedFetch={authenticatedFetch} />
              </div>
            ) : null;

            // [TR] Birincil aksiyonun girdileri: yalnız o adımda gereken alanlar, butonun hemen üstünde.
            // [EN] Primary action inputs: only what this step needs, right above the button.
            let primaryInput = null;
            if (roomState === 'LOCKED' && isTaker) {
              primaryInput = (
                <div>
                  <input type="file" onChange={handleFileUpload} accept="image/*,.pdf" className="hidden" id="receipt-upload" />
                  <label htmlFor="receipt-upload" className={`w-full px-4 py-3 rounded-lg border text-sm flex items-center justify-center gap-2 cursor-pointer transition ${paymentIpfsHash ? 'border-success/40 bg-success/10 text-success' : 'border-dashed border-borderStrong bg-elevated text-textPrimary hover:border-brand'}`}>
                    {paymentIpfsHash ? <><CircleCheck className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />{lang === 'TR' ? 'Dekont yüklendi' : 'Receipt uploaded'}</> : <><Paperclip className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />{lang === 'TR' ? 'Dekont yükle' : 'Upload receipt'}</>}
                  </label>
                  <p className="mt-1 text-[11px] text-textMuted text-center">{lang === 'TR' ? 'Şifrelenir, işlem bitince silinir.' : 'Encrypted, deleted after the trade.'}</p>
                </div>
              );
            }
            if (isMaker && ['LOCKED', 'PAID'].includes(roomState)) {
              primaryInput = (
                <>
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                    <p className="text-xs text-textMuted">{lang === 'TR' ? 'Gönderen adı bu olmalı' : 'Sender name must be'}</p>
                    <p className="font-bold text-textPrimary">{takerName || (lang === 'TR' ? 'Yükleniyor…' : 'Loading…')}</p>
                    <p className="mt-1 text-[11px] text-textMuted">{lang === 'TR' ? 'Eşleşmiyorsa onaylamayın; parayı iade edip iptal edin.' : 'If it does not match, do not release; refund and cancel.'}</p>
                  </div>
                  {roomState === 'PAID' && (
                    <>
                      <p className="text-[11px] font-mono text-textMuted text-center">{feeBreakdownText}</p>
                      <label className="flex items-start gap-2 p-3 bg-elevated border border-borderSubtle rounded-lg cursor-pointer text-left">
                        <input type="checkbox" checked={chargebackAccepted} onChange={(e) => handleChargebackAck(e.target.checked)} className="mt-0.5 w-4 h-4 accent-emerald-500" />
                        <span className="text-xs text-textSecondary">{lang === 'TR' ? 'Parayı hesabımda gördüm, gönderen adı eşleşiyor. Ters ibraz riskini anlıyorum.' : 'I see the funds in my account and the sender name matches. I understand the chargeback risk.'}</span>
                      </label>
                    </>
                  )}
                </>
              );
            }

            // [TR] Kapanmış işlemde odada yapılacak iş yok: kullanıcıyı sonraki mantıklı yere yönlendir.
            if (['RESOLVED', 'CANCELED', 'BURNED'].includes(roomState)) {
              primaryInput = (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setCurrentView('market')} className="h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">{lang === 'TR' ? 'Pazara dön' : 'Back to market'}</button>
                  <button type="button" onClick={() => { if (!isConnected || !isAuthenticated) { handleAuthAction(); return; } openProfilePage?.('history'); }} className="h-10 rounded-lg border border-borderStrong bg-surface text-textPrimary text-sm font-semibold hover:bg-elevated">{lang === 'TR' ? 'İşlem geçmişi' : 'Trade history'}</button>
                </div>
              );
            }

            return (
              <TradeRoomPage decisionInput={tradeDecisionInput} actionCallbacks={tradeActionCallbacks} beforeActions={beforeActions} primaryInput={primaryInput}>
                {/* [TR] Uzlaşma kartı yalnız itiraz aşamasında anlamlı; diğer durumlarda "kullanılamaz" kutusu gürültüydü. */}
                {roomState === 'CHALLENGED' && (
                  <div className="mb-4">
                    <SettlementProposalCard
                      activeTrade={activeTrade}
                      userRole={userRole}
                      address={address}
                      lang={lang}
                      authenticatedFetch={authenticatedFetch}
                      settlementContractFns={settlementContractFns}
                      fetchMyTrades={fetchMyTrades}
                      showToast={showToast}
                      isContractLoading={isContractLoading}
                      setIsContractLoading={setIsContractLoading}
                      nowOffsetMs={chainOffsetMs}
                    />
                  </div>
                )}

                {/* [TR] İptal teklifi durumu: bekleyen teklif veya karşı tarafın teklifine yanıt. Teklif butonu "Diğer seçenekler"de. */}
                {['LOCKED', 'PAID', 'CHALLENGED'].includes(roomState) && cancelStatus === 'proposed_by_me' && (
                  <div className="mb-4 py-3 px-4 bg-warning/10 border border-warning/30 rounded-xl flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-warning border-t-transparent rounded-full animate-spin shrink-0"></div>
                    <span className="text-sm font-semibold text-textPrimary">{lang === 'TR' ? 'İptal teklifiniz gönderildi; karşı taraf bekleniyor.' : 'Cancel proposed; waiting for the counterparty.'}</span>
                  </div>
                )}
                {['LOCKED', 'PAID', 'CHALLENGED'].includes(roomState) && cancelStatus === 'proposed_by_other' && (
                  <div className="mb-4 p-4 bg-warning/10 border border-warning/30 rounded-xl">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-textPrimary"><Undo2 className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />{lang === 'TR' ? 'Karşı taraf iptal teklif etti' : 'Counterparty proposed a cancel'}</p>
                    <p className="text-xs text-textMuted mt-1">
                      {roomState === 'LOCKED'
                        ? (lang === 'TR' ? 'Ödeme bildirilmediği için kesinti yok.' : 'No fees before payment is reported.')
                        : (lang === 'TR' ? 'Protokol ücreti kesilir, kalan iade edilir.' : 'Protocol fee applies; the rest is refunded.')}
                    </p>
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <button onClick={handleProposeCancel} disabled={isContractLoading} className="w-full bg-warning text-white py-2.5 rounded-lg font-bold text-sm hover:opacity-90 transition disabled:opacity-50">
                        {isContractLoading ? '…' : (lang === 'TR' ? 'Onayla' : 'Approve')}
                      </button>
                      <button onClick={() => setCancelStatus(null)} className="w-full bg-elevated border border-borderStrong text-textPrimary py-2.5 rounded-lg font-bold text-sm hover:bg-surface transition">
                        {lang === 'TR' ? 'Yok say' : 'Dismiss'}
                      </button>
                    </div>
                  </div>
                )}
              </TradeRoomPage>
            );
          })()}
        </div>
      </div>
    );
  };

  // [TR] Mobil alt navigasyon çubuğu — yalnızca mobil cihazlarda görünür
  // [EN] Mobile bottom navigation bar — visible only on mobile devices
  const renderMobileNav = () => {
    // [TR] Her ikonun altında kısa etiket: yalnız emoji ile menü tahmin oyununa dönüyordu. Giriş yapınca
    //      cüzdan düğmesi profil ikonuyla aynı görünüyordu; artık cüzdan ikonu + yeşil nokta.
    // [EN] Short label under each icon (emoji-only nav was guesswork). The wallet button no longer
    //      turns into a second profile icon when signed in; it keeps the wallet icon with a green dot.
    const item = ({ key, icon: Icon, label, active, onClick, activeClass = 'text-textPrimary', dot = null }) => (
      <button
        key={key}
        onClick={onClick}
        aria-label={label}
        className={`h-10 min-w-0 flex-1 basis-0 rounded-xl transition-all relative flex flex-col items-center justify-center gap-0.5 leading-none ${active ? `bg-elevated ${activeClass}` : 'text-textMuted'}`}
      >
        <Icon className="w-5 h-5" strokeWidth={1.8} aria-hidden="true" />
        <span className="text-[9px] font-semibold truncate max-w-full">{label}</span>
        {dot && <span className={`absolute top-0.5 right-2 w-2 h-2 border border-shell rounded-full ${dot}`}></span>}
      </button>
    );
    const tr = lang === 'TR';
    const signedIn = isConnected && isAuthenticated;
    return (
      <div className="md:hidden fixed inset-x-0 bottom-0 box-border h-[calc(4rem_+_env(safe-area-inset-bottom))] max-w-full bg-shell border-t border-borderSubtle z-[45] flex items-center justify-around gap-0 overflow-hidden px-[calc(0.25rem_+_env(safe-area-inset-left))] pr-[calc(0.25rem_+_env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(0,0,0,0.12)]">
        {NAV_ORDER.mobile.filter((key) => isViewInNav(key, { navUnlocked, canSeeAdminEntry })).map((key) => {
          const view = VIEW_REGISTRY[key];
          return item({
            key,
            icon: view.icon,
            label: view.shortLabel[tr ? 'TR' : 'EN'],
            active: currentView === key,
            activeClass: view.tone,
            onClick: () => setCurrentView(key),
            dot: key === 'tradeRoom' && activeEscrows.length > 0 ? 'bg-orange-500 animate-pulse' : null,
          });
        })}
        {item({ key: 'menu', icon: Menu, label: tr ? 'Menü' : 'Menu', active: sidebarOpen, onClick: toggleSidebar })}
        {item({ key: 'wallet', icon: Wallet, label: signedIn ? (tr ? 'Bağlı' : 'Linked') : (tr ? 'Bağlan' : 'Connect'), active: false, onClick: handleAuthAction, dot: signedIn ? 'bg-success' : null })}
      </div>
    );
  };


  const renderProfileContext = () => {
    // [TR] Lab "Profil Merkezi" senaryosu itibar/kayıt verisini sağlar; gerçek oturum verisinin yerine geçer.
    const lp = ctx.labProfile || null;
    const labSession = ctx.devScenarioCategory === 'activeTrades' || Boolean(lp);
    return (
      <ProfileContextPage
        lang={lang}
        onConnect={handleAuthAction}
        address={address}
        formatAddress={formatAddress}
        isConnected={isConnected || labSession}
        isAuthenticated={isAuthenticated || labSession}
        authenticatedWallet={lp ? address : ctx.authenticatedWallet}
        payoutProfileDraft={lp?.payoutProfileDraft || ctx.payoutProfileDraft}
        setPayoutProfileDraft={ctx.setPayoutProfileDraft}
        handleUpdatePII={ctx.handleUpdatePII}
        userReputation={lp ? lp.userReputation : userReputation}
        reputationPolicy={lp ? lp.reputationPolicy : ctx.reputationPolicy}
        sybilStatus={lp ? lp.sybilStatus : sybilStatus}
        walletAgeRemainingDays={lp ? lp.walletAgeRemainingDays : walletAgeRemainingDays}
        isBanned={lp ? lp.isBanned : Boolean(ctx.isBanned)}
        decayReputation={ctx.decayReputation}
        myOrders={lp ? lp.myOrders : (ctx.myOrders || [])}
        setConfirmDeleteId={ctx.setConfirmDeleteId || (() => {})}
        confirmDeleteId={ctx.confirmDeleteId ?? null}
        handleDeleteOrder={ctx.orderActions?.handleDeleteOrder}
        initialActiveTab={ctx.profileContextTab}
        setInitialActiveTab={ctx.setProfileContextTab}
        activeTradesFilter={ctx.activeTradesFilter}
        setActiveTradesFilter={ctx.setActiveTradesFilter}
        activeEscrows={activeEscrows}
        setActiveTrade={setActiveTrade}
        setUserRole={setUserRole}
        setTradeState={setTradeState}
        setChargebackAccepted={setChargebackAccepted}
        setCurrentView={setCurrentView}
        setShowProfileModal={setShowProfileModal}
        tradeHistory={lp ? lp.tradeHistory : (ctx.tradeHistory || [])}
        historyLoading={lp ? false : Boolean(ctx.historyLoading)}
        tradeHistoryPage={lp ? 1 : ctx.tradeHistoryPage}
        setTradeHistoryPage={ctx.setTradeHistoryPage}
        tradeHistoryTotal={lp ? (lp.tradeHistoryTotal ?? lp.tradeHistory.length) : ctx.tradeHistoryTotal}
        tradeHistoryLimit={lp ? 6 : ctx.tradeHistoryLimit}
        mapResolutionTypeLabel={mapResolutionTypeLabel}
        handleLogoutAndDisconnect={ctx.handleLogoutAndDisconnect}
        canonicalizePayoutProfileDraft={ctx.canonicalizePayoutProfileDraft}
        isContractLoading={isContractLoading}
        setIsContractLoading={setIsContractLoading}
        tokenDecimalsMap={tokenDecimalsMap}
        showToast={showToast}
        rewardsReader={lp?.labRewards?.reader || null}
        fetchClaimHistory={lp?.labRewards?.fetchClaimHistory || null}
        now={lp?.labRewards?.now ?? null}
      />
    );
  };

  const renderFooter = () => {
    const links = [
      { k: 'github', label: 'GitHub', href: SOCIAL_LINKS.github },
      { k: 'twitter', label: 'X', href: SOCIAL_LINKS.twitter },
      { k: 'farcaster', label: 'Farcaster', href: SOCIAL_LINKS.farcaster },
    ].filter((l) => l.href);
    return (
      <footer className="w-full max-w-[1200px] px-4 md:px-8 pb-6 md:pb-8 mt-2" data-testid="app-footer">
        <div className="border-t border-borderSubtle pt-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-textPrimary">Araf</p>
            <p className="text-xs text-textMuted">{lang === 'TR' ? 'Hakem değil, oyun teorisi. Karar mercii kontrat.' : 'No arbitrator, only game theory. The contract is the final authority.'}</p>
            <p className="text-[11px] text-textMuted mt-1">{lang === 'TR' ? 'Deneysel yazılım; kendi sorumluluğunuzda kullanın.' : 'Experimental software; use at your own risk.'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setShowFeedbackModal(true)} className="px-3 py-2 rounded-lg border border-borderSubtle text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-elevated transition">
              {lang === 'TR' ? 'Geri bildirim' : 'Feedback'}
            </button>
            {links.map((l) => (
              <a key={l.k} href={l.href} target="_blank" rel="noreferrer noopener" className="px-3 py-2 rounded-lg border border-borderSubtle text-xs font-semibold text-textSecondary hover:text-textPrimary hover:bg-elevated transition">{l.label}</a>
            ))}
          </div>
        </div>
      </footer>
    );
  };

  const renderOperations = () => {
    const operationSetters = ctx.operationsActionSetters || {};
    return (
      <OperationsCenterPage
        activeEscrows={activeEscrows}
        activeEscrowCounts={activeEscrowCounts}
        activeTrade={activeTrade}
        address={address}
        lang={lang}
        setActiveTrade={operationSetters.setActiveTrade || setActiveTrade}
        setUserRole={operationSetters.setUserRole || setUserRole}
        setTradeState={operationSetters.setTradeState || setTradeState}
        setChargebackAccepted={operationSetters.setChargebackAccepted || setChargebackAccepted}
        setCurrentView={operationSetters.setCurrentView || setCurrentView}
        setSidebarOpen={operationSetters.setSidebarOpen || setSidebarOpen}
        setShowProfileModal={operationSetters.setShowProfileModal || setShowProfileModal}
      />
    );
  };

  return {
    renderHome,
    renderMarket,
    renderOperations,
    renderProfileContext,
    renderTradeRoom,
    renderSlimRail,
    renderContextSidebar,
    renderMobileNav,
    renderFooter,
  };
};
