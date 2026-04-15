import React from 'react';
import PIIDisplay from '../components/PIIDisplay';

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
    authenticatedFetch,
    showToast,
  
  } = ctx;

  const renderSlimRail = () => (
    <div className="hidden md:flex w-16 bg-black border-r border-[#1a1a1a] flex-col items-center py-6 justify-between z-50 shrink-0 shadow-2xl">
      <div className="space-y-6 flex flex-col items-center w-full">
        <div className="w-8 h-8 rounded bg-gradient-to-br from-white to-slate-400 flex items-center justify-center font-bold text-black mb-4 cursor-pointer" onClick={() => setCurrentView('home')}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="square" strokeLinejoin="miter" strokeWidth="3" d="M4 4h4v4H4zm12 0h4v4h-4zM4 16h4v4H4zm12 0h4v4h-4zM10 10h4v4h-4z" /></svg>
        </div>
        <button onClick={openSidebar} title={lang === 'TR' ? 'Filtreler' : 'Filters'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${sidebarOpen ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>☰</button>
        <button onClick={() => setCurrentView('home')} title={lang === 'TR' ? 'Ana Sayfa' : 'Home'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${currentView === 'home' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>🏠</button>
        <button onClick={() => setCurrentView('market')} title={lang === 'TR' ? 'Pazar Yeri' : 'Marketplace'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${currentView === 'market' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>🛒</button>
        <button onClick={() => setCurrentView('tradeRoom')} title={lang === 'TR' ? 'İşlem Odası' : 'Trade Room'} className={`w-10 h-10 flex items-center justify-center rounded-xl transition relative ${currentView === 'tradeRoom' ? 'bg-orange-600/20 text-orange-500' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>
          💼 {activeEscrows.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>}
        </button>
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

  // [TR] Bağlamsal yan panel — 5 sn sonra kapanır, hover timer'ı sıfırlar.
  //      Filtreler, durum akordiyonu ve sell order oluşturma butonu içerir.
  // [EN] Context sidebar — closes after 5s, hover resets timer.
  //      Contains filters, status accordion and sell-order creation button.
  const renderContextSidebar = () => (
    <>
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
                                setChargebackAccepted(escrow.rawTrade?.chargebackAcked === true);
                                setCurrentView('tradeRoom');
                                setSidebarOpen(false);
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

  // [TR] Pazar yeri — sell order listesi, filtreler, test faucet butonları
  // [EN] Marketplace — sell-order list, filters, test faucet buttons
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
            const isCorrectChain    = [8453, 84532, 31337].includes(chainId);
            const isFunded          = sybilStatus ? sybilStatus.funded : true;
            const isCooldownOk      = sybilStatus ? sybilStatus.cooldownOk : true;
            const finalCanTakeOrder = canTakeOrder && isCooldownOk && isFunded && !isPaused && isTokenConfigured && isCorrectChain;

            return (
              <div key={order.id} className="bg-[#111113] hover:bg-[#151518] border border-[#222] p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between transition-colors group relative gap-4 md:gap-0">
                <div className="flex items-center gap-4 w-full md:w-1/3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-900/20 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shrink-0">₮</div>
                  <div className="relative group/tooltip">
                    <p className="text-white font-medium text-sm cursor-help">{order.maker}</p>
                    <p className="text-xs text-slate-500">{order.rate} {order.fiat} / 1 {order.crypto}</p>
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
                    {isPaused            ? <><span>⏸️</span> {lang === 'TR' ? 'Bakımda' : 'Paused'}</> :
                     !isCorrectChain     ? <><span>⛓️</span> {lang === 'TR' ? 'Yanlış Ağ' : 'Wrong Network'}</> :
                     !isTokenConfigured  ? <><span>⚙️</span> {lang === 'TR' ? 'Token Ayarlanmadı' : 'Token Not Set'}</> :
                     !canTakeOrder       ? <><span>🔒</span> {lang === 'TR' ? 'Kilitli' : 'Locked'}</> :
                     !isFunded           ? <><span>⚠️</span> {lang === 'TR' ? 'Bakiye Yetersiz' : 'Low Balance'}</> :
                     !isCooldownOk       ? <><span>⏳</span> {lang === 'TR' ? `Cooldown: ${Math.ceil((sybilStatus?.cooldownRemaining || 0) / 60)} dk` : `Cooldown: ${Math.ceil((sybilStatus?.cooldownRemaining || 0) / 60)} min`}</> :
                     (isContractLoading  ? (loadingText || (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...')) : (lang === 'TR' ? 'Satın Al' : 'Buy'))}
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
          <div className="p-8 text-center text-slate-500">{lang === 'TR' ? 'İlan bulunamadı.' : 'No ads found.'}</div>
        )}
      </div>
    </div>
  );

  // [TR] İşlem odası — LOCKED/PAID/CHALLENGED durumlarına göre taker/maker aksiyonlarını gösterir.
  //      Bleeding Escrow görsel barı, zamanlayıcılar, iptal/serbest bırakma ve PII bölümü içerir.
  // [EN] Trade room — shows taker/maker actions based on LOCKED/PAID/CHALLENGED state.
  //      Contains Bleeding Escrow visual bar, timers, cancel/release and PII section.
  const renderTradeRoom = () => {
    // renderTradeRoom fonksiyonunun başına ekle
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
    const isChallenged = roomState === 'CHALLENGED';
    const isTaker = userRole === 'taker';
    const isMaker = userRole === 'maker';

    const tradeTokenDecimals = activeTrade?.tokenDecimals ?? (tokenDecimalsMap[activeTrade?.crypto || 'USDT'] ?? DEFAULT_TOKEN_DECIMALS);
    const rawCryptoAmt = activeTrade?.cryptoAmountRaw
      ? rawTokenToDisplayNumber(activeTrade.cryptoAmountRaw, tradeTokenDecimals)
      : ((activeTrade?.max || 0) / (activeTrade?.rate || 1));
    const protocolFee  = rawCryptoAmt * ((takerFeeBps || 10) / 10000);
    const netAmount    = rawCryptoAmt - protocolFee;
    const asset        = activeTrade?.crypto || 'USDT';
    const feeBreakdownText = lang === 'TR'
      ? `Kilitli: ${rawCryptoAmt.toFixed(2)} ${asset} | Protokol Kesintisi: ${protocolFee.toFixed(4)} ${asset} | Net Alınacak: ${netAmount.toFixed(2)} ${asset}`
      : `Locked: ${rawCryptoAmt.toFixed(2)} ${asset} | Protocol Fee: ${protocolFee.toFixed(4)} ${asset} | Net to Receive: ${netAmount.toFixed(2)} ${asset}`;

    return (
      <div className="p-4 md:p-8 max-w-[900px] w-full mx-auto relative mt-6 md:mt-0">
        <button onClick={() => setCurrentView('market')} className="absolute -top-2 md:-top-4 left-4 md:left-8 text-slate-500 hover:text-white text-sm transition">← {lang === 'TR' ? 'Pazar Yerine Dön' : 'Go Back'}</button>

        <div className={`border rounded-2xl p-5 md:p-8 shadow-2xl transition-colors duration-700 ${isChallenged ? 'bg-[#1a0f0f] border-red-900/40' : 'bg-[#111113] border-[#222]'}`}>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 border-b border-[#222] pb-6 gap-4 md:gap-0">
            <div>
              <p className="text-slate-500 text-xs tracking-widest mb-1">{lang === 'TR' ? 'İŞLEM ODASI' : 'TRADE ROOM'}: {activeTrade?.id}</p>
              <h2 className="text-2xl font-bold text-white flex flex-col sm:flex-row items-start sm:items-center gap-3">
                {activeTrade?.max || '0.00'} {activeTrade?.fiat}
                <span className={`text-xs px-3 py-1 rounded-full border ${isChallenged ? 'bg-red-900/20 text-red-500 border-red-900' : 'bg-emerald-900/20 text-emerald-500 border-emerald-900'}`}>{isChallenged ? (lang === 'TR' ? 'Araf Fazı' : 'Purgatory') : roomState}</span>
              </h2>
            </div>
            <div className="text-left md:text-right w-full md:w-auto border-t border-[#222] md:border-none pt-4 md:pt-0">
              <p className="text-slate-500 text-xs">{lang === 'TR' ? 'KARŞI TARAF' : 'COUNTERPARTY'}</p>
              <p className="text-white font-mono">{activeTrade?.maker || '0x...'}</p>
            </div>
          </div>

          {/* Bleeding Escrow görsel barı — yalnızca CHALLENGED state'inde gösterilir */}
          {isChallenged && (
            <div className="mb-8 md:mb-10 p-4 md:p-6 bg-[#0a0505] border border-red-950 rounded-xl relative overflow-hidden">
              <div className="flex justify-between text-xs font-bold mb-3">
                <span className="text-red-500">MAKER BOND</span>
                <span className="text-orange-500">TAKER BOND</span>
              </div>
              {(() => {
                const myBond       = bleedingAmounts ? (isTaker ? Number(bleedingAmounts.takerBondRemaining) : Number(bleedingAmounts.makerBondRemaining)) : null;
                const opponentBond = bleedingAmounts ? (isTaker ? Number(bleedingAmounts.makerBondRemaining) : Number(bleedingAmounts.takerBondRemaining)) : null;
                const myBondOrig   = myBond       !== null ? Math.max(myBond, 1)       : 1;
                const oppBondOrig  = opponentBond !== null ? Math.max(opponentBond, 1)  : 1;
                const myPct        = myBond       !== null ? Math.round((myBond       / myBondOrig)  * 100) : 40;
                const opponentPct  = opponentBond !== null ? Math.round((opponentBond / oppBondOrig)  * 100) : 35;
                const decayedTotal = bleedingAmounts ? (bleedingAmounts.totalDecayed ?? 0n) : 0n;
                return (
                  <>
                    <div className="w-full h-3 bg-[#111] rounded-full flex relative border border-[#222]">
                      <div className="h-full bg-gradient-to-r from-red-700 to-red-500 rounded-l-full relative transition-all duration-500" style={{width: `${isMaker ? myPct : opponentPct}%`}}>
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-red-500 rounded-full blur-sm"></div>
                      </div>
                      <div className="flex-1 bg-transparent border-y border-red-900/30 flex items-center justify-center overflow-hidden">
                        <div className="w-full h-px bg-red-500/20 shadow-[0_0_10px_red] animate-pulse"></div>
                      </div>
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
                        <p className="text-red-400 font-bold text-sm drop-shadow-[0_0_5px_red]">{lang === 'TR' ? 'Yanan Toplam:' : 'Total Burned:'} {formatTokenAmountFromRaw(decayedTotal, tradeTokenDecimals)} {asset} 🔥</p>
                      </div>
                    </div>
                  </>
                );
              })()}
              <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-500">
                <span className="text-emerald-500">🔒</span> {lang === 'TR' ? 'Ana Para Güvende:' : 'Principal Safe:'} <span className="font-mono text-emerald-400">{principalProtectionTimer.isFinished ? 'Bitti' : `${principalProtectionTimer.days}g ${principalProtectionTimer.hours}s`}</span>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {/* LOCKED state aksiyon paneli */}
            {roomState === 'LOCKED' && (
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

            {/* PAID state aksiyon paneli */}
            {roomState === 'PAID' && (
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
                        const autoReleaseAt = new Date(new Date(activeTrade.pingedAt).getTime() + 24 * 3600 * 1000);
                        const canAutoRelease = new Date() > autoReleaseAt;
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
                    {!activeTrade?.challengePingedAt && (
                      <button
                        onClick={handleChallenge}
                        disabled={!canMakerStartChallengeFlow || isContractLoading}
                        className={`w-full py-3 rounded-xl font-bold transition ${!canMakerStartChallengeFlow || isContractLoading ? 'bg-[#1a1a1f] text-slate-500 border border-[#2a2a2e] cursor-not-allowed' : 'bg-orange-600/20 text-orange-400 border border-orange-500/40 hover:bg-orange-500 hover:text-white'}`}
                      >
                        {isContractLoading ? '...' : (!canMakerStartChallengeFlow ? (lang === 'TR' ? '⏱️ Uyarı için 24 saat bekleyin' : '⏱️ Wait 24h to ping buyer') : (lang === 'TR' ? '🔔 Alıcıyı Uyar (Ödeme Gelmedi)' : '🔔 Ping Buyer (No Payment)'))}
                      </button>
                    )}
                    {activeTrade?.challengePingedAt && (
                      <button
                        onClick={handleChallenge}
                        disabled={!canMakerChallenge || isContractLoading}
                        className={`w-full py-3 rounded-xl font-bold transition ${!canMakerChallenge || isContractLoading ? 'bg-[#1a1a1f] text-slate-500 border border-[#2a2a2e] cursor-not-allowed' : 'bg-red-600/20 text-red-400 border border-red-500/40 hover:bg-red-500 hover:text-white'}`}
                      >
                        {isContractLoading ? '...' : (!canMakerChallenge ? (lang === 'TR' ? '⏱️ İtiraz için 24 saat bekleyin' : '⏱️ Wait 24h to challenge') : (lang === 'TR' ? '⚔️ Resmi İtiraz Başlat' : '⚔️ Open Formal Challenge'))}
                      </button>
                    )}
                    <label className="flex items-start space-x-3 p-3 md:p-4 bg-[#1a0f0f] border border-red-900/30 rounded-xl cursor-pointer text-left">
                      <input type="checkbox" checked={chargebackAccepted} onChange={(e) => handleChargebackAck(e.target.checked)} className="mt-1 w-4 h-4 accent-emerald-500 rounded bg-[#0a0a0c] border-[#333]" />
                      <span className="text-xs text-slate-400"><strong className="text-red-500">{lang === 'TR' ? 'UYARI:' : 'WARNING:'}</strong> {lang === 'TR' ? 'Paranın farklı isimli bir hesaptan gelmediğini ve Chargeback riskini anladığımı kabul ediyorum.' : 'I confirm the funds came from the correct name and understand the Chargeback risk.'}</span>
                    </label>
                    <div className="w-full flex flex-col gap-2">
                      <div className="text-center p-2 bg-[#0c0c0e] rounded-xl border border-[#222]">
                        <p className="text-[10px] text-slate-400 font-mono">{feeBreakdownText}</p>
                      </div>
                      <div className="flex flex-col sm:flex-row justify-center gap-3">
                        <button disabled={!chargebackAccepted || isContractLoading} onClick={handleRelease} className={`w-full sm:w-auto px-8 py-3 rounded-xl font-bold transition ${chargebackAccepted && !isContractLoading ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-[#1a1a1f] text-slate-500 cursor-not-allowed border border-[#2a2a2e]'}`}>
                          {isContractLoading ? (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...') : (lang === 'TR' ? 'Serbest Bırak' : 'Release USDT')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Ortak aksiyon paneli (iptal + serbest bırakma) — tüm aktif durumlarda gösterilir */}
            {['LOCKED', 'PAID', 'CHALLENGED'].includes(roomState) && (
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
                        const msg = roomState === 'LOCKED'
                          ? (lang === 'TR' ? 'LOCKED aşamasında (henüz ödeme bildirilmeden) iptaller kesintisizdir. Onaylıyor musunuz?' : 'Cancel in LOCKED state has zero fees. Confirm?')
                          : (lang === 'TR' ? 'Karşılıklı iptal durumunda standart protokol ücreti kesilecektir. Onaylıyor musunuz?' : 'Standard protocol fees will be deducted upon mutual cancellation. Confirm?');
                        if (window.confirm(msg)) handleProposeCancel();
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
                    <p className="text-orange-400 font-bold text-sm mb-2">⚠️ {lang === 'TR' ? 'Karşı taraf iptal teklif etti.' : 'Opponent proposed cancellation.'}</p>
                    <p className="text-[11px] text-slate-400 mb-3">
                      {roomState === 'LOCKED'
                        ? (lang === 'TR' ? 'İşlem LOCKED aşamasında olduğu için herhangi bir kesinti yapılmayacaktır.' : 'Since trade is in LOCKED state, no fees will be deducted.')
                        : (lang === 'TR' ? 'Onaylarsanız standart protokol ücreti kesilecek ve kalan fonlar iade edilecektir.' : 'If you approve, standard protocol fee will be deducted and remaining funds returned.')}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={handleProposeCancel} disabled={isContractLoading} className="w-full bg-orange-600 hover:bg-orange-500 text-white p-3 rounded-xl font-bold text-sm transition">
                        {isContractLoading ? '...' : (lang === 'TR' ? 'Onayla ve İptal Et' : 'Approve Cancel')}
                      </button>
                      <button onClick={() => setCancelStatus(null)} className="w-full bg-[#1a1a1f] border border-[#2a2a2e] hover:bg-[#222] text-white p-3 rounded-xl font-bold text-sm transition">
                        {lang === 'TR' ? 'Reddet' : 'Reject'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PII bölümü: taker şifreli banka bilgilerini görür, maker ödeme beklediğini bilir */}
            {isTaker && roomState !== 'RESOLVED' && (
              <div className="border border-[#222] rounded-xl overflow-hidden mt-6 bg-[#0a0a0c] p-1">
                <PIIDisplay
                  tradeId={activeTrade?.id}
                  lang={lang}
                  getSafeTelegramUrl={getSafeTelegramUrl}
                  authenticatedFetch={authenticatedFetch}
                />
              </div>
            )}
            {isMaker && roomState !== 'RESOLVED' && (
              <div className="bg-[#0a0a0c] p-6 rounded-xl border border-[#222] text-center mt-6">
                <div className="text-3xl mb-2">🏦</div>
                <p className="text-slate-300 font-medium text-sm">{lang === 'TR' ? 'Banka hesabınıza ödeme bekleniyor.' : 'Waiting for fiat payment.'}</p>
                <p className="text-xs text-slate-500 mt-2">{lang === 'TR' ? 'Alıcı IBAN ve Telegram bilgilerinizi şifreli kanaldan aldı.' : 'Buyer received your IBAN & Telegram via encrypted channel.'}</p>
              </div>
            )}

            {/* burnExpired butonu — CHALLENGED ve 10 günü geçmiş işlemler için */}
            {activeTrade?.onchainId && roomState === 'CHALLENGED' && (() => {
              const burnDate = activeTrade.challengedAt;
              if (!burnDate) return null;
              const isExpired = new Date().getTime() - new Date(burnDate).getTime() > 10 * 24 * 3600 * 1000;
              if (!isExpired) return null;
              return (
                <div className="mt-6 bg-[#1a0505] border border-red-950 rounded-xl p-4 text-center">
                  <p className="text-red-500 text-xs font-bold mb-2">
                    🔥 {lang === 'TR' ? '10 Gün Süresi Doldu — Sözleşme Artık Yakılabilir' : '10-Day Deadline Passed — Contract Can Now Be Burned'}
                  </p>
                  <p className="text-slate-500 text-[11px] mb-3">
                    {lang === 'TR' ? 'Uyarı: Sözleşme yakıldığında içerideki kilitli tüm USDT ve her iki tarafın teminatları kalıcı olarak Protokol Hazinesine aktarılır. İade yapılmaz.' : 'Warning: When burned, all locked USDT and bonds from both parties are permanently transferred to the Treasury. No refunds.'}
                  </p>
                  <p className="text-[11px] text-orange-300 mb-3">
                    {lang === 'TR'
                      ? 'Not: burnExpired fonksiyonu kontratta herkese açıktır; 10 gün dolduktan sonra üçüncü kişiler de bu çağrıyı yapabilir.'
                      : 'Note: burnExpired is permissionless on-chain; after 10 days, third parties can also execute it.'}
                  </p>
                  <button
                    onClick={async () => {
                      if (isContractLoading) return;
                      try {
                        setIsContractLoading(true);
                        showToast(lang === 'TR' ? 'Yakma işlemi gönderiliyor... Cüzdanınızdan onaylayın.' : 'Burn transaction sent... Confirm in wallet.', 'info');
                        await burnExpired(BigInt(activeTrade.onchainId));
                        setTradeState('RESOLVED');
                        setActiveTrade(null);
                        setCancelStatus(null);
                        setChargebackAccepted(false);
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

  // [TR] Mobil alt navigasyon çubuğu — yalnızca mobil cihazlarda görünür
  // [EN] Mobile bottom navigation bar — visible only on mobile devices
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


  return {
    renderHome,
    renderMarket,
    renderTradeRoom,
    renderSlimRail,
    renderContextSidebar,
    renderMobileNav,
    renderFooter,
  };
};
