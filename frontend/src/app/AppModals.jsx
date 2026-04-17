import React from 'react';
import { buildMakerPreview, getMakerModalCopy } from './orderModel';

// [TR] Eksik env değişkenleri için kapatılabilir uyarı şeridi.
// [EN] Dismissible warning strip for missing env variables.
export const EnvWarningBanner = ({ envErrors }) => {
  const [visible, setVisible] = React.useState(true);
  if (!envErrors?.length || !visible) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-950/95 border-b border-red-800/60 backdrop-blur-sm flex items-center justify-between px-4 py-1.5 shadow-lg">
      <span className="text-red-400 text-[11px] font-mono flex items-center gap-2">
        <span className="text-red-500">⚠</span>
        {envErrors.join(' · ')}
      </span>
      <button
        onClick={() => setVisible(false)}
        className="ml-4 text-red-500 hover:text-white transition text-sm leading-none shrink-0"
        aria-label="Kapat"
      >✕</button>
    </div>
  );
};

// [TR] App modal/render katmanı burada tutulur.
// [EN] App modal/render layer lives here.
export const buildAppModals = (ctx) => {
  const {
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
    userReputation,
    SUPPORTED_TOKEN_ADDRESSES,
    onchainTokenMap,
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
  
  } = ctx;

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

  // [TR] Geri bildirim modalı — kategori + yıldız puanı + metin girişi
  // [EN] Feedback modal — category + star rating + text input
  const renderFeedbackModal = () => {
    if (!showFeedbackModal) return null;
    return (
      <div className="fixed inset-0 bg-[#060608]/70 backdrop-blur-sm flex items-start justify-end p-4 md:p-6 z-[100]">
        <div className="bg-[#111113] border border-[#222] rounded-2xl p-5 md:p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto animate-in slide-in-from-top-8 slide-in-from-right-8 duration-300">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xl font-bold text-white">{lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}</h2>
            <button
              onClick={() => setShowFeedbackModal(false)}
              className="text-slate-400 hover:text-white text-2xl"
              aria-label={lang === 'TR' ? 'Geri bildirim penceresini kapat' : 'Close feedback panel'}
            >
              &times;
            </button>
          </div>
          <p className="text-sm text-slate-400 mb-4">{lang === 'TR' ? 'Deneyiminizi paylaşın. Hedefimiz gereksiz tx/revert maliyetlerini düşürmek.' : 'Share your experience. Our goal is to reduce avoidable tx/revert costs.'}</p>
          <div className="flex justify-center space-x-2 mb-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} onClick={() => setFeedbackRating(star)} className={`text-3xl transition ${feedbackRating >= star ? 'text-yellow-400 scale-110' : 'text-slate-600 hover:text-yellow-400/50'}`}>★</button>
            ))}
          </div>
          <select
            value={feedbackCategory}
            onChange={(e) => { setFeedbackCategory(e.target.value); setFeedbackError(''); }}
            className="w-full bg-[#151518] text-white px-3 py-2.5 rounded-xl border border-[#2a2a2e] outline-none text-sm mb-3"
          >
            <option value="" disabled>{lang === 'TR' ? 'Kategori Seçin...' : 'Select Category...'}</option>
            <option value="bug">{lang === 'TR' ? '🐞 Hata Bildirimi' : '🐞 Bug Report'}</option>
            <option value="suggestion">{lang === 'TR' ? '💡 Özellik İsteği' : '💡 Feature Suggestion'}</option>
            <option value="ui/ux">{lang === 'TR' ? '🎨 Tasarım/Kullanıcı Deneyimi' : '🎨 Design/UX'}</option>
            <option value="other">{lang === 'TR' ? '🧩 Diğer' : '🧩 Other'}</option>
          </select>

          <textarea
            value={feedbackText}
            onChange={(e) => { setFeedbackText(e.target.value); setFeedbackError(''); }}
            placeholder={lang === 'TR' ? 'Nerede sorun yaşadınız? Hangi adımda tx/revert maliyeti oluştu? Kısaca anlatın...' : 'Where did it break? Which step caused tx/revert cost? Please describe briefly...'}
            className="w-full bg-[#151518] text-white px-3 py-3 rounded-xl border border-[#2a2a2e] outline-none h-28 text-sm mb-2 resize-none"
          />
          <div className="flex items-center justify-between text-[11px] mb-3">
            <span className="text-slate-500">
              {lang === 'TR' ? `Minimum ${FEEDBACK_MIN_LENGTH} karakter` : `Minimum ${FEEDBACK_MIN_LENGTH} characters`}
            </span>
            <span className={`${feedbackText.trim().length >= FEEDBACK_MIN_LENGTH ? 'text-emerald-400' : 'text-slate-500'}`}>
              {feedbackText.trim().length}/{1000}
            </span>
          </div>

          {feedbackError && (
            <p className="text-red-400 text-xs mb-3 bg-red-950/30 border border-red-900/40 rounded-lg p-2">{feedbackError}</p>
          )}

          <p className="text-[11px] text-slate-500 mb-3">
            {lang === 'TR' ? 'Not: Private key, seed phrase veya kişisel bankacılık parolanızı asla paylaşmayın.' : 'Note: Never share private keys, seed phrase, or personal banking passwords.'}
          </p>

          <button onClick={submitFeedback} disabled={isSubmittingFeedback} className={`w-full py-3 rounded-xl font-bold transition ${isSubmittingFeedback ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.25)]'}`}>
            {isSubmittingFeedback ? (lang === 'TR' ? 'Gönderiliyor...' : 'Submitting...') : (lang === 'TR' ? 'Gönder' : 'Submit')}
          </button>
        </div>
      </div>
    );
  };

  // [TR] Maker order oluşturma modalı — side seçimi, tier validasyonu ve reserve önizlemesi
  // [EN] Maker order creation modal — side selection, tier validation and reserve preview
  const renderMakerModal = () => {
    if (!showMakerModal) return null;

    const TIER_LABELS = {
      0: lang === 'TR' ? 'Tier 0 — Bond Yok (Yeni)' : 'Tier 0 — No Bond (New)',
      1: lang === 'TR' ? 'Tier 1 — %8 Bond (Başlangıç)' : 'Tier 1 — 8% Bond (Starter)',
      2: lang === 'TR' ? 'Tier 2 — %6 Bond (Standart)'  : 'Tier 2 — 6% Bond (Standard)',
      3: lang === 'TR' ? 'Tier 3 — %5 Bond (Deneyimli)' : 'Tier 3 — 5% Bond (Pro)',
      4: lang === 'TR' ? 'Tier 4 — %2 Bond (Premium)'   : 'Tier 4 — 2% Bond (Premium)',
    };

    const bondPct = onchainBondMap ? (makerSide === 'BUY_CRYPTO' ? (onchainBondMap[makerTier]?.taker ?? 0) : (onchainBondMap[makerTier]?.maker ?? 0)) : 0;
    const cryptoAmt  = parseFloat(makerAmount) || 0;
    const preview = buildMakerPreview({ side: makerSide, amountUi: cryptoAmt, bondPct });
    const effectiveUserTier = userReputation?.effectiveTier ?? 0;

    const cryptoAmtNum = parseFloat(makerAmount) || 0;
    const rateNum      = parseFloat(makerRate) || 0;
    const minLimNum    = parseFloat(makerMinLimit) || 0;
    const maxLimNum    = parseFloat(makerMaxLimit) || 0;
    const totalFiatValue = cryptoAmtNum * rateNum;
    const modalCopy = getMakerModalCopy(makerSide, lang);

    let validationError = null;
    if (!makerAmount || cryptoAmtNum <= 0)                    validationError = lang === 'TR' ? 'Order miktarını giriniz.' : 'Enter order amount.';
    else if (makerTier === 0 && cryptoAmtNum > 150)           validationError = lang === 'TR' ? 'Tier 0 maksimum order limiti 150 USDT/USDC.' : 'Tier 0 max order limit is 150 USDT/USDC.';
    else if (makerTier === 1 && cryptoAmtNum > 1500)          validationError = lang === 'TR' ? 'Tier 1 maksimum order limiti 1.500 USDT/USDC.' : 'Tier 1 max order limit is 1500 USDT/USDC.';
    else if (makerTier === 2 && cryptoAmtNum > 7500)          validationError = lang === 'TR' ? 'Tier 2 maksimum order limiti 7.500 USDT/USDC.' : 'Tier 2 max order limit is 7500 USDT/USDC.';
    else if (makerTier === 3 && cryptoAmtNum > 30000)         validationError = lang === 'TR' ? 'Tier 3 maksimum order limiti 30.000 USDT/USDC.' : 'Tier 3 max order limit is 30000 USDT/USDC.';
    else if (!makerRate || rateNum <= 0)                      validationError = lang === 'TR' ? 'Kur fiyatını giriniz.' : 'Enter exchange rate.';
    else if (!makerMinLimit || minLimNum <= 0)                validationError = lang === 'TR' ? 'Minimum işlem limitini giriniz.' : 'Enter min limit.';
    else if (!makerMaxLimit || maxLimNum <= 0)                validationError = lang === 'TR' ? 'Maksimum işlem limitini giriniz.' : 'Enter max limit.';
    else if (minLimNum > maxLimNum)                           validationError = lang === 'TR' ? 'Min limit, Max limitten büyük olamaz.' : 'Min limit cannot exceed Max.';
    else if (maxLimNum > totalFiatValue)                      validationError = lang === 'TR' ? `Max limit toplam değeri (${totalFiatValue.toFixed(2)} ${makerFiat}) aşamaz.` : `Max limit exceeds total fiat (${totalFiatValue.toFixed(2)} ${makerFiat}).`;

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
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Order Kripto' : 'Order Crypto'}</label>
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
              <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Order Side' : 'Order Side'}</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setMakerSide('SELL_CRYPTO')} className={`py-2 rounded-xl text-xs font-bold border transition ${makerSide === 'SELL_CRYPTO' ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40' : 'bg-[#151518] text-slate-300 border-[#2a2a2e]'}`}>SELL_CRYPTO</button>
                <button type="button" onClick={() => setMakerSide('BUY_CRYPTO')} className={`py-2 rounded-xl text-xs font-bold border transition ${makerSide === 'BUY_CRYPTO' ? 'bg-blue-600/20 text-blue-400 border-blue-500/40' : 'bg-[#151518] text-slate-300 border-[#2a2a2e]'}`}>BUY_CRYPTO</button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Order Miktarı' : 'Order Amount'}</label>
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
              <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Order Tier Seviyesi' : 'Order Tier'}</label>
              <select value={makerTier} onChange={e => setMakerTier(Number(e.target.value))} className="w-full bg-[#151518] text-white px-3 py-2 rounded-xl border border-[#2a2a2e] outline-none">
                {[0, 1, 2, 3, 4].map(t => (
                  <option key={t} value={t} disabled={t > effectiveUserTier}>
                    {TIER_LABELS[t]} {t > effectiveUserTier ? (lang === 'TR' ? '(Yetersiz)' : '(Too Low)') : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-4 p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-xl">
              <p className="text-xs text-emerald-400 mb-2 font-medium">🛡️ {modalCopy.previewTitle} • {TIER_LABELS[makerTier]}</p>
              {bondPct > 0 ? (
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>{modalCopy.bondRoleLabel} (%{bondPct}):</span>
                  <span>{preview.reserveAmount > 0 ? `${preview.reserveAmount} ${makerToken}` : '—'}</span>
                </div>
              ) : (
                <p className="text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Tier 0: Teminat yok' : 'Tier 0: No bond'}</p>
              )}
              <div className="flex justify-between text-sm font-bold text-white border-t border-emerald-500/30 pt-2">
                <span>{modalCopy.totalLabel}:</span>
                <span>{preview.totalAmount > 0 ? `${preview.totalAmount} ${makerToken}` : '—'}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">{modalCopy.previewHint}</p>
            </div>
            {validationError && (
              <p className="text-red-400 text-[11px] font-medium text-center bg-red-950/30 py-2 rounded-lg border border-red-900/50 mt-2">{validationError}</p>
            )}
            <button
              onClick={handleCreateOrder}
              disabled={isContractLoading || validationError !== null}
              className={`w-full py-3 rounded-xl font-bold mt-2 shadow-lg transition ${
                isContractLoading || validationError !== null
                  ? 'bg-[#151518] text-slate-500 border border-[#2a2a2e] cursor-not-allowed'
                  : 'bg-white hover:bg-slate-200 text-black shadow-white/10'
              }`}>
              {isContractLoading ? (loadingText || (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...')) : modalCopy.submitLabel}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // [TR] Profil merkezi modalı — ayarlar, itibar, orderlarım, aktif ve geçmiş sekmeleri
  // [EN] Profile center modal — settings, reputation, my orders, active and history tabs
  const renderProfileModal = () => {
    if (!showProfileModal) return null;
    if (!isConnected || !isAuthenticated) {
      setShowProfileModal(false);
      return null;
    }
    const resolvedMyOrders = myOrders || (address ? orders.filter(o => o.ownerAddress?.toLowerCase() === address.toLowerCase()) : []);

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
                {tab === 'ayarlar' ? (lang === 'TR' ? 'Ayarlar' : 'Settings') : tab === 'itibar' ? (lang === 'TR' ? 'İtibar' : 'Reputation') : tab === 'ilanlarim' ? (lang === 'TR' ? 'Orderlarım' : 'My Orders') : tab === 'aktif' ? (lang === 'TR' ? 'Aktif İşlemler' : 'Active Trades') : (lang === 'TR' ? 'Geçmiş' : 'History')}
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
                      <p className="text-red-300/80 text-xs mt-1">{lang === 'TR' ? 'Sadece maker olarak order açabilirsiniz.' : 'You can only open orders as Maker.'}</p>
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
                  onClick={handleLogoutAndDisconnect}
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
                      {bannedUntil > 0 && new Date(bannedUntil * 1000) > new Date() && (
                        <div className="bg-red-950/30 p-3 rounded-xl border border-red-900/50">
                          <p className="text-red-400 text-xs font-medium">{lang === 'TR' ? 'Yasak Bitiş Tarihi' : 'Ban Ends On'}</p>
                          <p className="text-sm font-bold text-white mt-1">{new Date(bannedUntil * 1000).toLocaleString(lang === 'TR' ? 'tr-TR' : 'en-US')}</p>
                        </div>
                      )}
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
                                {lang === 'TR' ? 'Cezanız devam ediyor. Ardışık yasak sayacınızı sıfırlamak için cezanız bittikten sonra 180 gün beklemelisiniz.' : 'Your ban is active. You must wait 180 days after your ban expires to reset your consecutive bans counter.'}
                              </p>
                            ) : isEligible ? (
                              <>
                                <p className="text-emerald-400 text-[11px] mb-3">
                                  {lang === 'TR' ? 'Tebrikler! Son yasağınızın üzerinden 180 gün geçti. Sicilinizi şimdi temizleyebilirsiniz.' : 'Congratulations! 180 days have passed since your last ban. You can clear your record now.'}
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
                                {lang === 'TR' ? 'Ardışık yasak sayacınızı sıfırlamak için son cezanızın üzerinden 180 gün geçmesi gerekir.' : 'You must wait 180 days after your last ban to reset your consecutive bans counter.'}
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

            {profileTab === 'ilanlarim' && (
              <div className="space-y-3">
                {resolvedMyOrders.length > 0 ? resolvedMyOrders.map(order => (
                  <div key={order.id} className={`bg-[#151518] border rounded-xl p-4 transition-all duration-200 ${confirmDeleteId === order.id ? 'border-red-900/60 bg-red-950/20' : 'border-[#2a2a2e] flex flex-col'}`}>
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-bold text-white text-sm">{order.side} · {order.status}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{order.crypto}/{order.fiat} @ {order.rate}</p>
                        <p className="text-xs text-slate-500 mt-0.5">Remaining: {order.remainingAmount} {order.crypto} • Min Fill: {order.minFillAmount} {order.crypto} • Tier: {order.tier}</p>
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
                )) : <p className="text-center text-slate-500 text-xs mt-4">{lang === 'TR' ? 'Order bulunamadı.' : 'No orders found.'}</p>}
              </div>
            )}

            {profileTab === 'aktif' && (
              <div className="space-y-3">
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
                        setActiveTrade(escrow.rawTrade);
                        setUserRole(escrow.role);
                        setTradeState(escrow.state);
                        setChargebackAccepted(escrow.rawTrade?.chargebackAcked === true);
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
                    const historyAsset = tx.financials?.crypto_asset || 'USDT';
                    const historyDecimals = tokenDecimalsMap[historyAsset] ?? DEFAULT_TOKEN_DECIMALS;
                    return (
                      <div key={tx._id} className="bg-[#151518] border border-[#2a2a2e] rounded-xl p-3 flex justify-between items-center">
                        <div>
                          <p className="font-mono text-[10px] text-slate-500">#{tx.onchain_escrow_id}</p>
                          <p className="text-white font-medium mt-0.5 text-xs"><span className={`mr-1 ${isMaker ? 'text-red-400' : 'text-emerald-400'}`}>{isMaker ? '→' : '←'}</span> {formatTokenAmountFromRaw(tx.financials?.crypto_amount || '0', historyDecimals)} {historyAsset}</p>
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

  // ═══════════════════════════════════════════
  // 11. NAVİGASYON BİLEŞENLERİ
  //     Slim rail, context sidebar, mobile nav
  // ═══════════════════════════════════════════

  // [TR] Sol dar navigasyon çubuğu — yalnızca masaüstünde görünür

  // [TR] Kullanım koşulları modalı — ilk bağlantıda bir kez gösterilir, localStorage'a kaydedilir
  // [EN] Terms of use modal — shown once on first connect, persisted to localStorage
  const renderTermsModal = () => {
    if (termsAccepted || (!isConnected && !isAuthenticated)) return null;
    return (
      <div className="fixed inset-0 bg-[#060608]/95 backdrop-blur-xl flex items-center justify-center p-4 z-[200]">
        <div className="bg-[#111113] border border-[#222] rounded-2xl p-6 w-full max-w-lg shadow-2xl flex flex-col">
          <h2 className="text-xl font-bold text-white mb-4">📜 {lang === 'TR' ? 'Platform Kullanım Sözleşmesi ve Sorumluluk Reddi' : 'Terms of Use and Disclaimer'}</h2>
          <div className="space-y-4 text-sm text-slate-400 mb-6 bg-[#0a0a0c] p-4 rounded-xl border border-[#222] overflow-y-auto max-h-64">
            <p>{lang === 'TR' ? 'Araf Protokolü merkeziyetsiz bir akıllı kontrattır. Hiçbir aracı kurum veya hakem bulunmamaktadır.' : 'Araf Protocol is a decentralized smart contract. There are no intermediaries or arbitrators.'}</p>
            <p>{lang === 'TR' ? 'Tüm işlemleriniz kendi sorumluluğunuzdadır. "Bleeding Escrow" (Eriyen Kasa) oyun teorisine dayalı çalışır ve itiraz durumlarında fonlarınız zamanla eriyebilir.' : 'All transactions are at your own risk. The system operates on the "Bleeding Escrow" game theory, and in case of disputes, your funds may decay over time.'}</p>
            <p className="text-red-400 font-bold">{lang === 'TR' ? 'Chargeback (Ters İbraz) riski tamamen Maker tarafına aittir. Gelen fonların kaynağını doğrulamak sizin sorumluluğunuzdadır.' : 'The risk of Chargeback belongs entirely to the Maker side. It is your responsibility to verify the source of incoming funds.'}</p>
          </div>
          <button
            onClick={() => { localStorage.setItem('araf_terms_accepted', 'true'); setTermsAccepted(true); }}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition shadow-[0_0_15px_rgba(16,185,129,0.3)]"
          >
            {lang === 'TR' ? 'Okudum, Kabul Ediyorum' : 'I Read and Accept'}
          </button>
        </div>
      </div>
    );
  };

  return {
    renderWalletModal,
    renderFeedbackModal,
    renderMakerModal,
    renderProfileModal,
    renderTermsModal,
  };
};
