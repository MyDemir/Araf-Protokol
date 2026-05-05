import React from 'react';
import ReferenceRateTicker from '../components/ReferenceRateTicker';
import { normalizeSettlementState } from '../components/SettlementProposalCard';
import PaymentRiskBadge from '../components/PaymentRiskBadge';
import { buildGoToTradeRoomAction } from './actions/tradeNavigationActions';
import OperationsCenterPage from './contexts/operations/OperationsCenterPage';
import ProfileContextPage from './contexts/profile/ProfileContextPage';
import { mapResolutionTypeLabel } from './useAppSessionData';
import TradeRoomPage from './contexts/trade-room/TradeRoomPage';
import OperationTradeCard from './contexts/operations/OperationTradeCard';
import SettlementQueueCard from './contexts/operations/SettlementQueueCard';
import PendingSyncCard from './contexts/operations/PendingSyncCard';

// [TR] App ana görünüm/render katmanı burada tutulur.
// [EN] Main application view/render layer lives here.
export const buildAppViews = (ctx) => {
  const {
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
    isFaucetEnabled,
    isSupportedChainId,
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
    burnExpired,

  } = ctx;

  // [TR] Frontend admin menü görünürlüğü yalnız UX katmanıdır.
  //      Nihai yetki doğrulaması backend ADMIN_WALLETS + auth chain tarafındadır.
  // [EN] Frontend admin menu visibility is UX-only; backend remains authority.
  const adminWalletAllowlist = String(import.meta.env.VITE_ADMIN_WALLETS || "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const connectedWalletLower = typeof address === "string" ? address.toLowerCase() : null;
  const isLikelyAdminWallet =
    Boolean(connectedWalletLower) && adminWalletAllowlist.includes(connectedWalletLower);
  const canSeeAdminEntry = Boolean(isConnected && isAuthenticated && connectedWalletLower);

  const renderSlimRail = () => (
    <div className="space-y-6 flex flex-col items-center w-full">
      <div className="w-8 h-8 rounded bg-gradient-to-br from-white to-slate-400 flex items-center justify-center font-bold text-black mb-4 cursor-pointer" onClick={() => setCurrentView('home')}>
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="square" strokeLinejoin="miter" strokeWidth="3" d="M4 4h4v4H4zm12 0h4v4h-4zM4 16h4v4H4zm12 0h4v4h-4zM10 10h4v4h-4z" /></svg>
      </div>
      <div className="space-y-6 flex flex-col items-center w-full">
        <button onClick={openSidebar} title={lang === 'TR' ? 'Filtreler' : 'Filters'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${sidebarOpen ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>☰</button>
        <button onClick={() => setCurrentView('home')} title={lang === 'TR' ? 'Ana Sayfa' : 'Home'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${currentView === 'home' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>🏠</button>
        <button onClick={() => setCurrentView('market')} title={lang === 'TR' ? 'Pazar Yeri' : 'Marketplace'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${currentView === 'market' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>🛒</button>
        <button onClick={() => setCurrentView('operations')} title={lang === 'TR' ? 'İşlem Takip Merkezi' : 'Operations Center'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${currentView === 'operations' ? 'bg-cyan-900/30 text-cyan-400' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>📍</button>
        {/* [TR] Admin girişi authenticated kullanıcıya her zaman görünür;
            VITE_ADMIN_WALLETS yalnızca UX ipucu amaçlıdır.
            [EN] Admin entry is always visible for authenticated users;
            VITE_ADMIN_WALLETS is only a UX hint. */}
        {canSeeAdminEntry && (
          <button
            onClick={() => setCurrentView('admin')}
            title={isLikelyAdminWallet
              ? (lang === 'TR' ? 'Admin Paneli (Settlement analytics: read-only)' : 'Admin Panel (Settlement analytics: read-only)')
              : (lang === 'TR' ? 'Admin Gözlem (sunucu yetkisine bağlı, read-only)' : 'Admin Observability (server-authorized, read-only)')}
            className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${currentView === 'admin' ? 'bg-emerald-900/30 text-emerald-400' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}
          >
            🧭
          </button>
        )}
        <button onClick={() => setCurrentView('tradeRoom')} title={lang === 'TR' ? 'İşlem Odası' : 'Trade Room'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition relative ${currentView === 'tradeRoom' ? 'bg-orange-600/20 text-orange-500' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>
          💼 {activeEscrows.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>}
        </button>
        <button onClick={() => setCurrentView('profile')} title={lang === 'TR' ? 'Profil Merkezi' : 'Profile Center'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${currentView === 'profile' ? 'bg-emerald-900/30 text-emerald-400' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>👤</button>
        <button onClick={() => { if (!isConnected || !isAuthenticated) { handleAuthAction(); return; } setProfileTab('gecmis'); setShowProfileModal(true); }} title={lang === 'TR' ? 'İşlem Geçmişi' : 'Trade History'} className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-500 hover:text-white hover:bg-[#111113] transition">🗂️</button>
      </div>
      <div className="space-y-4 flex flex-col items-center w-full px-2">
        <button onClick={() => setLang(lang === 'TR' ? 'EN' : 'TR')} title={lang === 'TR' ? 'Dili Değiştir' : 'Change Language'} className="text-xs font-bold text-slate-400 hover:text-white mb-1">{lang}</button>
        <button onClick={handleAuthAction} title={isConnected && isAuthenticated ? (lang === 'TR' ? 'Profil Merkezi' : 'Profile Center') : (lang === 'TR' ? 'Cüzdan Bağla' : 'Connect Wallet')} className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all shadow-lg mx-auto ${isConnected && isAuthenticated ? 'border-emerald-500 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'border-[#2a2a2e] bg-[#111113] text-slate-400 hover:text-white hover:border-emerald-500/50 hover:bg-[#1a1a1f]'}`}>
          {isLoggingIn || !authChecked ? <span className="text-xs animate-spin">⚙️</span> : (isConnected && isAuthenticated ? <span className="text-base drop-shadow-[0_0_5px_rgba(16,185,129,0.8)]">👤</span> : <span className="text-base drop-shadow-[0_0_5px_rgba(255,255,255,0.5)]">👛</span>)}
        </button>
      </div>
    </div>
  );

  // [TR] Bağlamsal yan panel — açık/kapalı davranışı kullanıcı etkileşimi ile yönetilir.
  //      Filtreler, durum akordiyonu ve yeni order oluşturma butonu içerir.
  // [EN] Context sidebar — visibility is controlled by explicit user interaction.
  //      Contains filters, status accordion and create-order button.
  const renderContextSidebar = () => (
    <>
      {sidebarOpen && <div className="md:hidden fixed inset-0 bg-black/60 z-[55] backdrop-blur-sm transition-opacity" onClick={() => setSidebarOpen(false)} />}
      <div
        className={`fixed md:relative top-0 left-0 h-full bg-[#0c0c0e] border-r border-[#1a1a1a] flex flex-col z-[60] md:z-40 shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${sidebarOpen ? 'w-[260px] p-5 opacity-100' : 'w-0 p-0 opacity-0'}`}
      >
        <div className="relative mb-6">
          <span className="absolute left-3 top-2.5 text-slate-500 text-sm">🔍</span>
          <input type="number" value={searchAmount} onChange={e => setSearchAmount(e.target.value)} placeholder={lang === 'TR' ? 'Tutar Ara...' : 'Search...'} className="w-full bg-[#151518] text-white pl-9 pr-3 py-2.5 rounded-xl border border-[#2a2a2e] outline-none focus:border-emerald-500/50 text-sm transition" />
        </div>

        <div className="mb-8">
          <p className="text-[10px] font-bold text-slate-500 mb-3 tracking-widest">{lang === 'TR' ? 'PAZAR YERİ' : 'MARKETPLACE'}</p>
          <div className="space-y-1">
            <button onClick={() => { setFilterToken('ALL'); setCurrentView('market'); }} className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm transition ${filterToken === 'ALL' && currentView === 'market' ? 'bg-[#1a1a1f] text-white border border-[#2a2a2e]' : 'text-slate-400 hover:text-white hover:bg-[#1a1a1f]/50'}`}>
              <div className="flex items-center gap-2"><span className="text-slate-500">⛓️</span> {lang === 'TR' ? 'TÜM ORDERLAR' : 'ALL ORDERS'}</div>
              <span className="bg-[#222] text-[10px] px-2 py-0.5 rounded text-slate-300">{orders.length}</span>
            </button>
            <button onClick={() => { setFilterToken('USDT'); setCurrentView('market'); }} className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm transition ${filterToken === 'USDT' && currentView === 'market' ? 'bg-[#1a1a1f] text-white border border-[#2a2a2e]' : 'text-slate-400 hover:text-white hover:bg-[#1a1a1f]/50'}`}>
              <div className="flex items-center gap-2"><span className="text-emerald-500">₮</span> USDT</div>
              <span className="bg-[#222] text-[10px] px-2 py-0.5 rounded text-slate-300">{orders.filter(o => o.crypto === 'USDT').length}</span>
            </button>
            <button onClick={() => setFilterTier1(!filterTier1)} className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm transition ${filterTier1 ? 'bg-[#1a1a1f] text-yellow-500 border border-yellow-500/20' : 'text-slate-400 hover:text-white hover:bg-[#1a1a1f]/50'}`}>
              <div className="flex items-center gap-2"><span className="text-yellow-500/70">🛡️</span> {lang === 'TR' ? 'Tier 0-1 Düşük Risk Filtresi' : 'Tier 0-1 Low-Risk Filter'}</div>
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
                      <span className={status === 'CHALLENGED' ? 'bg-red-900/40 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded border border-red-900/50' : 'bg-[#222] text-[10px] px-2 py-0.5 rounded text-slate-300'}>
                        {status === 'CHALLENGED' ? 'Araf' : count}
                      </span>
                    )}
                  </button>
                  <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-[500px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                    {statusTrades.length > 0 ? (
                      <div className="pl-3 pr-1 py-1 space-y-2 border-l-2 border-[#222] ml-3">
                        {statusTrades.map((escrow) => (
                          <OperationTradeCard
                            key={escrow.id}
                            escrow={escrow}
                            lang={lang}
                            onGoToRoom={buildGoToTradeRoomAction({
                              escrow,
                              setActiveTrade,
                              setUserRole,
                              setTradeState,
                              setChargebackAccepted,
                              setCurrentView,
                              setSidebarOpen,
                            })}
                          />
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
        <div className="mt-6">
          <p className="text-[10px] font-bold text-slate-500 mb-3 tracking-widest">
            {lang === 'TR' ? 'SETTLEMENT' : 'SETTLEMENT'}
          </p>
          <div className="space-y-1">
            <div className="w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm text-slate-300 border border-[#2a2a2e] bg-[#101014]">
              <span className="flex items-center gap-2"><span className="text-emerald-400">🧩</span>{lang === 'TR' ? 'Aktif Teklif' : 'Active Proposals'}</span>
              <span className="bg-[#222] text-[10px] px-2 py-0.5 rounded text-slate-200">{activeEscrowCounts?.settlement?.PROPOSED ?? 0}</span>
            </div>
            <div className="w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm text-slate-300 border border-[#2a2a2e] bg-[#101014]">
              <span className="flex items-center gap-2"><span className="text-yellow-400">⏳</span>{lang === 'TR' ? 'Benden Aksiyon Bekliyor' : 'Action Required'}</span>
              <span className="bg-[#222] text-[10px] px-2 py-0.5 rounded text-slate-200">{activeEscrowCounts?.settlement?.ACTION_REQUIRED ?? 0}</span>
            </div>
            <div className="w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm text-slate-300 border border-[#2a2a2e] bg-[#101014]">
              <span className="flex items-center gap-2"><span className="text-sky-400">🕒</span>{lang === 'TR' ? 'Karşı Taraftan Yanıt Bekliyorum' : 'Waiting Counterparty'}</span>
              <span className="bg-[#222] text-[10px] px-2 py-0.5 rounded text-slate-200">{activeEscrowCounts?.settlement?.WAITING ?? 0}</span>
            </div>
            {activeEscrows
              .filter((escrow) => normalizeSettlementState(escrow?.rawTrade?.settlementProposal?.state) === 'PROPOSED')
              .map((escrow) => {
                const proposer = escrow?.rawTrade?.settlementProposal?.proposer?.toLowerCase?.() || null;
                const viewer = address?.toLowerCase?.() || null;
                const isWaiting = Boolean(proposer && viewer && proposer === viewer);
                const goToRoom = buildGoToTradeRoomAction({
                  escrow,
                  setActiveTrade,
                  setUserRole,
                  setTradeState,
                  setChargebackAccepted,
                  setCurrentView,
                  setSidebarOpen,
                });
                if (escrow?.rawTrade?._pendingBackendSync) {
                  return <PendingSyncCard key={`settle-${escrow.onchainId}`} escrow={escrow} lang={lang} onGoToRoom={goToRoom} />;
                }
                return <SettlementQueueCard key={`settle-${escrow.onchainId}`} escrow={escrow} lang={lang} onGoToRoom={goToRoom} isWaiting={isWaiting} />;
              })}
          </div>
        </div>

        <div className="mt-auto pt-6 border-t border-[#1a1a1a]">
          <div className="flex bg-[#0c0c0e] rounded-lg p-1 border border-[#2a2a2e] mb-3">
            <button onClick={() => setLang('TR')} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition ${lang === 'TR' ? 'bg-[#222] text-white' : 'text-slate-500 hover:text-white'}`}>🇹🇷 TR</button>
            <button onClick={() => setLang('EN')} className={`flex-1 py-1.5 rounded-md text-xs font-bold transition ${lang === 'EN' ? 'bg-[#222] text-white' : 'text-slate-500 hover:text-white'}`}>🇬🇧 EN</button>
          </div>
          <button onClick={handleOpenMakerModal} disabled={isPaused} className={`w-full py-3 bg-gradient-to-r ${isPaused ? 'from-slate-700 to-slate-600 cursor-not-allowed text-slate-400' : 'from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] text-white'} rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2`}>
            <span className="text-lg leading-none">+</span> {lang === 'TR' ? 'YENİ ORDER AÇ' : 'CREATE ORDER'}
          </button>
        </div>
      </div>
    </>
  );

  // ═══════════════════════════════════════════
  // 12. SAYFA RENDER FONKSİYONLARI
  //     Home, Marketplace, Trade Room views
  // ═══════════════════════════════════════════

  // [TR] Ana sayfa — protokol açıklaması ve istatistik kartları
  // [EN] Home page — protocol description and stats cards
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
          <p className="text-slate-500 text-[10px] font-bold tracking-widest uppercase mb-2">{lang === 'TR' ? 'AÇIK SELL ORDER' : 'OPEN SELL ORDERS'}</p>
          <span className="text-2xl font-bold text-white">{(protocolStats?.open_sell_orders ?? 0).toLocaleString()}</span>
        </div>
        <div className="bg-[#111113] border border-[#222] p-4 md:p-5 rounded-2xl">
          <p className="text-slate-500 text-[10px] font-bold tracking-widest uppercase mb-2">{lang === 'TR' ? 'ORT. SÜRE' : 'AVG TIME'}</p>
          <span className="text-2xl font-bold text-yellow-500">{protocolStats?.avg_trade_hours ?? '—'}h</span>
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
          <button onClick={fetchStats} className="ml-2 text-emerald-400 hover:underline">
            {lang === 'TR' ? 'Tekrar dene' : 'Retry'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <section className="bg-[#111113] border border-[#222] rounded-2xl p-5 md:p-6">
          <p className="text-[11px] tracking-[0.2em] uppercase text-emerald-400 mb-2">
            {lang === 'TR' ? 'P2P Nasıl Çalışır?' : 'How P2P Works'}
          </p>
          <h3 className="text-xl font-bold text-white mb-3">
            {lang === 'TR' ? 'Kararı backend değil, kontrat verir.' : 'The contract decides, not the backend.'}
          </h3>
          <ul className="space-y-2 text-sm text-slate-300 leading-relaxed">
            <li>• {lang === 'TR' ? 'Maker USDT/USDC + bond kilitler, Taker şartları kabul edip girer.' : 'Maker locks USDT/USDC + bond, Taker joins under clear on-chain rules.'}</li>
            <li>• {lang === 'TR' ? 'Uyuşmazlıkta insan hakem yok; süre uzadıkça her iki taraf için de maliyet artar.' : 'No human arbitrator in disputes; delay becomes progressively expensive for both sides.'}</li>
            <li>• {lang === 'TR' ? 'Bu yapı gereksiz tartışmayı değil, hızlı uzlaşıyı ekonomik olarak teşvik eder.' : 'This structure rewards fast settlement rather than endless argument.'}</li>
          </ul>
        </section>

        <section className="bg-[#111113] border border-[#222] rounded-2xl p-5 md:p-6">
          <p className="text-[11px] tracking-[0.2em] uppercase text-slate-400 mb-3">FAQ</p>
          <div className="space-y-3">
            {faqItems.map((item) => (
              <details key={item.q} className="group border border-[#2a2a2e] rounded-xl p-3 bg-[#0d0d10]">
                <summary className="cursor-pointer list-none text-sm font-semibold text-white flex items-center justify-between gap-3">
                  {item.q}
                  <span className="text-slate-500 group-open:rotate-45 transition">+</span>
                </summary>
                <p className="text-xs md:text-sm text-slate-400 mt-2 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  // [TR] Pazar yeri — side-aware order listesi, filtreler, test faucet butonları
  // [EN] Marketplace — side-aware order list, filters, test faucet buttons
  const renderMarket = () => (
    <div className="p-4 md:p-8 max-w-[1200px] w-full">
      <div className="mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-white">{lang === 'TR' ? 'Pazar Yeri' : 'Marketplace'}</h2>
        {isFaucetEnabled && (
          <div className="flex gap-3 w-full md:w-auto">
            <button onClick={() => handleMint('USDT')} disabled={isContractLoading} className="flex-1 md:flex-none px-4 py-2 bg-[#111113] border border-[#222] hover:bg-[#1a1a1f] rounded-xl text-xs sm:text-sm font-bold text-emerald-400 transition shadow-lg flex items-center justify-center gap-2">
              {isContractLoading && loadingText.includes('USDT') ? '⏳' : '🚰'} {lang === 'TR' ? 'Test USDT Al' : 'Get Test USDT'}
            </button>
            <button onClick={() => handleMint('USDC')} disabled={isContractLoading} className="flex-1 md:flex-none px-4 py-2 bg-[#111113] border border-[#222] hover:bg-[#1a1a1f] rounded-xl text-xs sm:text-sm font-bold text-blue-400 transition shadow-lg flex items-center justify-center gap-2">
              {isContractLoading && loadingText.includes('USDC') ? '⏳' : '🚰'} {lang === 'TR' ? 'Test USDC Al' : 'Get Test USDC'}
            </button>
          </div>
        )}
      </div>

      <ReferenceRateTicker lang={lang} />

      <div className="mb-4 p-3 rounded-xl border border-orange-700/40 bg-orange-900/20">
        <p className="text-[11px] text-orange-200 leading-relaxed">
          {lang === 'TR'
            ? 'Bilgi: CHALLENGED durumunda 10 gün dolunca burnExpired fonksiyonu kontratta herkese açıktır; üçüncü taraflar da çağırabilir.'
            : 'Info: In CHALLENGED state, once 10 days pass, burnExpired is permissionless on-chain and can be called by third parties.'}
        </p>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="p-8 text-center text-slate-500 animate-pulse">{lang === 'TR' ? 'Yükleniyor...' : 'Loading...'}</div>
        ) : filteredOrders.length > 0 ? (
          filteredOrders.map((order) => {
            const effectiveUserTier = userReputation?.effectiveTier ?? 0;
            const isMyOwnAd    = address && order.makerFull?.toLowerCase() === address.toLowerCase();
            const isTierLocked = isConnected && isAuthenticated && order.tier > effectiveUserTier;
            const canTakeOrder = isConnected && isAuthenticated && !isMyOwnAd && !isTierLocked && !isPaused;
            const tokenAddr    = SUPPORTED_TOKEN_ADDRESSES[order.crypto || 'USDT'];
            const isTokenConfigured = Boolean(tokenAddr);
            const isCorrectChain    = isSupportedChainId(chainId);
            const isFunded          = sybilStatus ? sybilStatus.funded : true;
            const isCooldownOk      = sybilStatus ? sybilStatus.cooldownOk : true;
            const finalCanTakeOrder = canTakeOrder && isCooldownOk && isFunded && !isPaused && isTokenConfigured && isCorrectChain;
            const isSellSide = order.side === 'SELL_CRYPTO';
            const sideBadgeClass = isSellSide ? 'bg-emerald-900/20 text-emerald-400 border-emerald-800/40' : 'bg-blue-900/20 text-blue-400 border-blue-800/40';

            return (
              <div key={order.id} className="bg-[#111113] hover:bg-[#151518] border border-[#222] p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between transition-colors group relative gap-4 md:gap-0">
                <div className="flex items-center gap-4 w-full md:w-1/3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-900/20 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shrink-0">₮</div>
                  <div className="relative group/tooltip">
                    <p className="text-white font-medium text-sm cursor-help">{order.maker}</p>
                    <p className="text-xs text-slate-500">{order.rate} {order.fiat} / 1 {order.crypto}</p>
                    <span className={`inline-flex mt-1 text-[10px] px-2 py-0.5 rounded border ${sideBadgeClass}`}>{order.sideLabel || order.side}</span>
                    <div className="absolute left-0 sm:-left-4 md:left-1/2 md:-translate-x-1/2 bottom-full mb-2 hidden group-hover/tooltip:block z-50">
                      {/* [TR] V3 compact hover özeti: taraf-bağımlı ama seller-only terminoloji içermez.
                          [EN] V3 compact hover summary: side-aware, without seller-only terminology. */}
                      <div className="bg-[#111] border border-[#333] p-4 rounded-2xl shadow-2xl w-72 backdrop-blur-xl">
                        <p className="text-[10px] text-slate-400 mb-2 tracking-widest uppercase">
                          {lang === 'TR' ? 'İŞLEM SAHİBİ ÖZETİ' : 'ORDER OWNER SUMMARY'}
                        </p>
                        <p className="text-[10px] text-slate-500 mb-3">
                          {order.ownerSideHint || (lang === 'TR' ? 'Order sahibi taraf bilgisi' : 'Order owner side context')}
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-lg border border-[#2e2e2e] bg-[#151518] px-2.5 py-2">
                            <p className="text-[10px] text-slate-500 uppercase">{lang === 'TR' ? 'Başarı' : 'Success'}</p>
                            <p className="text-emerald-400 font-bold">{order.successRate}%</p>
                          </div>
                          <div className="rounded-lg border border-[#2e2e2e] bg-[#151518] px-2.5 py-2">
                            <p className="text-[10px] text-slate-500 uppercase">{lang === 'TR' ? 'Toplam İşlem' : 'Total Trades'}</p>
                            <p className="text-white font-mono">{order.totalTrades ?? order.txCount} Tx</p>
                          </div>
                          <div className="rounded-lg border border-[#2e2e2e] bg-[#151518] px-2.5 py-2">
                            <p className="text-[10px] text-slate-500 uppercase">{lang === 'TR' ? 'Taraf' : 'Side'}</p>
                            <p className="text-slate-200">{order.sideLabel || order.side}</p>
                          </div>
                          <div className="rounded-lg border border-[#2e2e2e] bg-[#151518] px-2.5 py-2">
                            <p className="text-[10px] text-slate-500 uppercase">Tier</p>
                            <p className="text-yellow-500 font-bold">T{order.tier} 🛡️</p>
                          </div>
                        </div>
                        <div className="mt-3 rounded-lg border border-[#2e2e2e] bg-[#151518] px-2.5 py-2">
                          {/* [TR] Hover özeti taker-facing kısa görünürlük katmanıdır; detaylar Profil Merkezi'ndedir.
                              [EN] Hover summary is a taker-facing compact visibility layer; details remain in Profile Center. */}
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] text-slate-500 uppercase">{lang === 'TR' ? 'Güven Görünürlüğü' : 'Trust Visibility'}</p>
                            <span className={`text-[10px] px-2 py-0.5 rounded border ${order?.trustSummary?.chipClass || 'text-slate-400 border-slate-700/60 bg-slate-900/20'}`}>
                              {order?.trustSummary?.band ? `${order.trustSummary.band} · ${order.trustSummary.label}` : (order?.trustSummary?.label || (lang === 'TR' ? 'Sinyal yok' : 'Signal unavailable'))}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1">
                            {lang === 'TR'
                              ? 'Bilgilendirme amaçlı kısa özet; nihai hüküm değildir.'
                              : 'Informational quick summary; not a final verdict.'}
                          </p>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-3 leading-relaxed">
                          {lang === 'TR'
                            ? 'Not: Bu kart hızlı bir özet gösterir; nihai güven/hüküm değerlendirmesi değildir.'
                            : 'Note: This card is a quick summary, not a final trust verdict.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="w-full md:w-1/3 text-left md:text-center border-t border-[#222] md:border-none pt-3 md:pt-0">
                  <p className="text-sm font-bold text-slate-300">{order.limitLabel}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {lang === 'TR' ? 'Minimum Fill:' : 'Min Fill:'} {order.minFillAmount ?? 0} {order.crypto}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider">
                    {order.statusLabel || order.status}
                  </p>
                  <p className="text-[10px] text-emerald-500/80 mt-0.5 uppercase tracking-wider">
                    {order.bondLabel} {lang === 'TR' ? 'Teminat' : 'Bond'}
                  </p>
                  {order.paymentRiskSignal && <PaymentRiskBadge lang={lang} riskEntry={order.paymentRiskSignal} compact />}
                </div>

                <div className="w-full md:w-1/3 flex flex-col items-start md:items-end justify-center relative">
                  <button onClick={() => handleStartTrade(order)} disabled={!finalCanTakeOrder || isContractLoading} className={`w-full md:w-auto px-6 py-2.5 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 ${!finalCanTakeOrder ? 'bg-[#1a1a1f] text-slate-500 border border-[#2a2a2e] cursor-not-allowed' : 'bg-white text-black hover:bg-slate-200 shadow-[0_0_15px_rgba(255,255,255,0.1)]'}`}>
                    {isPaused            ? <><span>⏸️</span> {lang === 'TR' ? 'Bakımda' : 'Paused'}</> :
                     !isCorrectChain     ? <><span>⛓️</span> {lang === 'TR' ? 'Yanlış Ağ' : 'Wrong Network'}</> :
                     !isTokenConfigured  ? <><span>⚙️</span> {lang === 'TR' ? 'Token Ayarlanmadı' : 'Token Not Set'}</> :
                     !canTakeOrder       ? <><span>🔒</span> {lang === 'TR' ? 'Kilitli' : 'Locked'}</> :
                     !isFunded           ? <><span>⚠️</span> {lang === 'TR' ? 'Bakiye Yetersiz' : 'Low Balance'}</> :
                     !isCooldownOk       ? <><span>⏳</span> {lang === 'TR' ? `Cooldown: ${Math.ceil((sybilStatus?.cooldownRemaining || 0) / 60)} dk` : `Cooldown: ${Math.ceil((sybilStatus?.cooldownRemaining || 0) / 60)} min`}</> :
                     (isContractLoading  ? (loadingText || (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...')) : (order.ctaLabel || (lang === 'TR' ? 'İşlem Yap' : 'Trade')))}
                  </button>
                  {!isFunded && isConnected && canTakeOrder && !isPaused && (
                    <p className="text-[10px] text-red-500 mt-2 text-center md:text-right w-full leading-tight">
                      ⚠️ Anti-Spam: {lang === 'TR' ? 'İşlem yapabilmek için cüzdanınızda en az 0.001 ETH bulunmalıdır.' : 'You must have at least 0.001 ETH in your wallet to trade.'}
                    </p>
                  )}
                  {!isCooldownOk && isConnected && (
                    <p className="text-[10px] text-amber-400 mt-2 text-center md:text-right w-full leading-tight">
                      {lang === 'TR'
                        ? 'Not: 4 saatlik cooldown Tier 0 ve Tier 1 için geçerlidir.'
                        : 'Note: the 4-hour cooldown applies to both Tier 0 and Tier 1.'}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-8 text-center text-slate-500">{lang === 'TR' ? 'Order bulunamadı.' : 'No orders found.'}</div>
        )}
      </div>
    </div>
  );

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
          <div className="bg-[#111113] border border-[#222] rounded-2xl p-6 md:p-8 text-center">
            <div className="w-14 h-14 bg-[#1a1a1f] border border-[#2a2a2e] rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">⚠️</div>
            <h2 className="text-xl font-bold text-white mb-2">
              {lang === 'TR' ? 'Aktif işlem bulunamadı' : 'No active trade found'}
            </h2>
            <p className="text-sm text-slate-400 mb-5">
              {lang === 'TR'
                ? 'Oturumunuz sona ermiş veya işlem durumu güncellenmiş olabilir. Güvenli şekilde pazar yerine dönebilirsiniz.'
                : 'Your session may have expired or trade state was refreshed. You can safely return to the marketplace.'}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={() => { fetchMyTrades(); }}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#1a1a1f] border border-[#2a2a2e] hover:bg-[#222] text-white rounded-xl text-sm font-bold transition"
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
          <p className="text-white font-bold text-lg mb-2">
            {lang === 'TR' ? 'İşlem Zincire Yazıldı' : 'Trade Written On-Chain'}
          </p>
          <p className="text-slate-400 text-sm">
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

    const isSupportedChain = typeof isSupportedChainId === 'function' ? isSupportedChainId(chainId) : true;
    const actionHandlers = {
      report_payment: handleReportPayment,
      release_funds: handleRelease,
      start_challenge: handleChallenge,
      ping_maker: () => handlePingMaker(activeTrade?.onchainId),
      auto_release: () => handleAutoRelease(activeTrade?.onchainId),
      propose_cancel: handleProposeCancel,
      chargeback_ack: () => handleChargebackAck(true),
      propose_settlement: proposeSettlement,
      reject_settlement: rejectSettlement,
      withdraw_settlement: withdrawSettlement,
      expire_settlement: expireSettlement,
      accept_settlement: acceptSettlement,
      burn_expired: activeTrade?.onchainId ? () => burnExpired(BigInt(activeTrade.onchainId)) : undefined,
    };

    return (
      <TradeRoomPage
        decisionInput={{ trade: activeTrade, tradeState: roomState, userRole, chargebackAccepted, paymentIpfsHash, timers: { gracePeriodTimer, bleedingTimer, principalProtectionTimer, makerPingTimer, makerChallengePingTimer, makerChallengeTimer }, isConnected, isAuthenticated, isSupportedChain, isPaused, lang }}
        actionHandlers={actionHandlers}
        viewProps={{
          setCurrentView,
          handleFileUpload,
          paymentIpfsHash,
          chargebackAccepted,
          handleChargebackAck,
          isContractLoading,
          setIsContractLoading,
          setLoadingText,
          canMakerPing,
          canMakerStartChallengeFlow,
          canMakerChallenge,
          gracePeriodTimer,
          makerPingTimer,
          makerChallengePingTimer,
          makerChallengeTimer,
          bleedingTimer,
          principalProtectionTimer,
          bleedingAmounts,
          tokenDecimalsMap,
          DEFAULT_TOKEN_DECIMALS,
          rawTokenToDisplayNumber,
          formatTokenAmountFromRaw,
          takerFeeBps,
          cancelStatus,
          setCancelStatus,
          setActiveTrade,
          setTradeState,
          setChargebackAccepted,
          activeTrade,
          resolvedTradeState,
          userRole,
          takerName,
          address,
          lang,
          authenticatedFetch,
          fetchMyTrades,
          showToast,
          getSafeTelegramUrl,
        }}
      />
    );
  };

  // [TR] Mobil alt navigasyon çubuğu — yalnızca mobil cihazlarda görünür
  // [EN] Mobile bottom navigation bar — visible only on mobile devices
  const renderMobileNav = () => (
    <>
      <button onClick={() => setCurrentView('home')} className={`p-2 text-xl transition-all ${currentView === 'home' ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] -translate-y-1' : 'text-slate-600'}`}>🏠</button>
      <button onClick={() => setCurrentView('market')} className={`p-2 text-xl transition-all ${currentView === 'market' ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] -translate-y-1' : 'text-slate-600'}`}>🛒</button>
      <button onClick={() => setCurrentView('operations')} className={`p-2 text-xl transition-all ${currentView === 'operations' ? 'text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)] -translate-y-1' : 'text-slate-600'}`}>📍</button>
      <button onClick={() => setCurrentView('tradeRoom')} className={`p-2 text-xl transition-all relative ${currentView === 'tradeRoom' ? 'text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)] -translate-y-1' : 'text-slate-600'}`}>
        💼{activeEscrows.length > 0 && <span className="absolute top-2 right-1 w-2.5 h-2.5 bg-orange-500 border border-[#060608] rounded-full animate-pulse"></span>}
      </button>
      {/* [TR] Mobil admin girişi authenticated kullanıcıya açık kalır; backend nihai otoritedir.
          [EN] Mobile admin entry remains reachable for authenticated users; backend is authoritative. */}
      {canSeeAdminEntry && (
        <button onClick={() => setCurrentView('admin')} className={`p-2 text-xl transition-all ${currentView === 'admin' ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)] -translate-y-1' : 'text-slate-600'}`}>🧭</button>
      )}
      <button onClick={openSidebar} className={`p-2 text-xl transition-all ${sidebarOpen ? 'text-white -translate-y-1' : 'text-slate-600'}`}>☰</button>
      <button onClick={() => setCurrentView('profile')} className={`p-2 text-xl transition-all ${currentView === 'profile' ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)] -translate-y-1' : 'text-slate-600'}`}>👤</button>
      <button onClick={handleAuthAction} className={`p-2 text-xl transition-all ${isConnected && isAuthenticated ? 'text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)] -translate-y-1' : 'text-slate-600'}`}>
        {isConnected && isAuthenticated ? '👤' : '👛'}
      </button>
    </>
  );


  const renderProfileContext = () => (
    <ProfileContextPage
      lang={lang}
      address={address}
      formatAddress={formatAddress}
      isConnected={isConnected}
      isAuthenticated={isAuthenticated}
      payoutProfileDraft={ctx.payoutProfileDraft}
      setPayoutProfileDraft={ctx.setPayoutProfileDraft}
      handleUpdatePII={ctx.handleUpdatePII}
      userReputation={userReputation}
      myOrders={ctx.myOrders || []}
      setConfirmDeleteId={ctx.setConfirmDeleteId || (() => {})}
      activeTradesFilter={ctx.activeTradesFilter}
      setActiveTradesFilter={ctx.setActiveTradesFilter}
      activeEscrows={activeEscrows}
      setActiveTrade={setActiveTrade}
      setUserRole={setUserRole}
      setTradeState={setTradeState}
      setChargebackAccepted={setChargebackAccepted}
      setCurrentView={setCurrentView}
      setShowProfileModal={setShowProfileModal}
      tradeHistory={ctx.tradeHistory || []}
      mapResolutionTypeLabel={mapResolutionTypeLabel}
      handleLogoutAndDisconnect={ctx.handleLogoutAndDisconnect}
    />
  );

  const renderFooter = () => (
    <footer className="w-full max-w-[1200px] px-4 md:px-8 pb-24 md:pb-8 mt-2">
      <div className="border border-[#222] bg-[#0d0d10] rounded-2xl px-4 py-4 md:px-6 md:py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">Araf © 2026</p>
          <p className="text-xs text-slate-500">
            {lang === 'TR' ? 'Hakem değil, oyun teorisi. Karar mercii kontrat.' : 'No arbitrator, only game theory. Final authority is the contract.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={socialLinks.github} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-[#151518] border border-[#2a2a2e] text-xs font-semibold text-slate-200 hover:text-white hover:border-slate-500 transition">GitHub</a>
          <a href={socialLinks.twitter} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-[#151518] border border-[#2a2a2e] text-xs font-semibold text-slate-200 hover:text-white hover:border-slate-500 transition">Twitter</a>
          <a href={socialLinks.farcaster} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-[#151518] border border-[#2a2a2e] text-xs font-semibold text-slate-200 hover:text-white hover:border-slate-500 transition">Farcaster</a>
        </div>
      </div>
    </footer>
  );


  const renderOperations = () => (
    <OperationsCenterPage
      activeEscrows={activeEscrows}
      activeEscrowCounts={activeEscrowCounts}
      activeTrade={activeTrade}
      address={address}
      lang={lang}
      setActiveTrade={setActiveTrade}
      setUserRole={setUserRole}
      setTradeState={setTradeState}
      setChargebackAccepted={setChargebackAccepted}
      setCurrentView={setCurrentView}
      setSidebarOpen={setSidebarOpen}
      setShowProfileModal={setShowProfileModal}
    />
  );

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
