import React from 'react';
import { buildMakerPreview, getMakerModalCopy, getOrderSideCopy, mapOffchainHealthToUi } from './orderUiModel';
import { TERMS_ACCEPTED_STORAGE_KEY } from './bootstrapState';
import { mapResolutionTypeLabel } from './useAppSessionData';
import PaymentRiskBadge from '../components/PaymentRiskBadge';
import { buildGoToTradeRoomAction } from './actions/tradeNavigationActions';
import { getStateLabel } from './copy';

const getActiveTradeRoleLabel = (role, lang = 'EN') => {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'maker') return lang === 'TR' ? 'Maker' : 'Maker';
  if (normalized === 'taker') return lang === 'TR' ? 'Alıcı' : 'Taker';
  return role || '—';
};

// [TR] Eksik env değişkenleri için kapatılabilir uyarı şeridi.
// [EN] Dismissible warning strip for missing env variables.
export const EnvWarningBanner = ({ envErrors }) => {
  const [visible, setVisible] = React.useState(true);
  if (!envErrors?.length || !visible) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-950/95 border-b border-red-800/60 backdrop-blur-sm flex items-center justify-between px-4 py-1.5 shadow-lg">
      <span className="text-red-400 text-xs font-mono flex items-center gap-2">
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
    paymentRiskConfig,
    userReputation,
    SUPPORTED_TOKEN_ADDRESSES,
    onchainTokenMap,
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
    decayReputation,
    tokenDecimalsMap,
    DEFAULT_TOKEN_DECIMALS,
    formatTokenAmountFromRaw,
    showToast,
  
  } = ctx;

  const renderWalletModal = () => {
    if (!showWalletModal) return null;
    return (
      <div className="fixed inset-0 max-w-full overflow-x-hidden bg-[#060608]/90 backdrop-blur-md flex items-center justify-center p-4 safe-area-x z-[100]">
        <div className="bg-[#111113] border border-[#222] rounded-2xl p-6 w-full max-w-sm shadow-2xl max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] overflow-x-hidden overflow-y-auto overscroll-contain">
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
          <p className="mt-6 text-xs text-center text-slate-500 italic">
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
      <div className="fixed inset-0 max-w-full overflow-x-hidden bg-[#060608]/70 backdrop-blur-sm flex items-start justify-end p-4 md:p-6 safe-area-x z-[100]">
        <div className="bg-[#111113] border border-[#222] rounded-2xl p-5 md:p-6 w-full max-w-md shadow-2xl max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] overflow-x-hidden overflow-y-auto overscroll-contain animate-in slide-in-from-top-8 slide-in-from-right-8 duration-300">
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
          <div className="flex items-center justify-between text-xs mb-3">
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

          <p className="text-xs text-slate-500 mb-3">
            {lang === 'TR' ? 'Not: Private key, seed phrase veya kişisel bankacılık parolanızı asla paylaşmayın.' : 'Note: Never share private keys, seed phrase, or personal banking passwords.'}
          </p>

          <button onClick={submitFeedback} disabled={isSubmittingFeedback} className={`w-full py-3 rounded-xl font-bold transition ${isSubmittingFeedback ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.25)]'}`}>
            {isSubmittingFeedback ? (lang === 'TR' ? 'Gönderiliyor...' : 'Submitting...') : (lang === 'TR' ? 'Gönder' : 'Submit')}
          </button>
        </div>
      </div>
    );
  };


  const makerFieldClass = "w-full bg-elevated text-textPrimary px-3 py-2 rounded-xl border border-borderStrong outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30";
  const makerLabelClass = "block text-xs text-textMuted mb-1 font-medium";
  const renderMakerSection = (title, children, hint = null) => (
    <section className="rounded-xl border border-borderSubtle bg-surface p-3 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-textPrimary">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-textMuted leading-relaxed">{hint}</p>}
      </div>
      {children}
    </section>
  );

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

    const modalCopy = getMakerModalCopy(makerSide, lang);
    const payoutRiskEntry = makerPayoutRiskEntry;
    const validationError = makerValidationError || null;

    return (
      <div className="fixed inset-0 max-w-full overflow-x-hidden bg-[#060608]/80 backdrop-blur-sm flex items-center justify-center p-4 safe-area-x z-[100]">
        <div className="bg-[#111113] border border-[#222] rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] overflow-x-hidden overflow-y-auto overscroll-contain">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">{t.createAd}</h2>
            <button onClick={() => setShowMakerModal(false)} className="text-slate-400 hover:text-white text-2xl">&times;</button>
          </div>
          <div className="space-y-3">
            {renderMakerSection(
              lang === 'TR' ? 'Order yönü' : 'Order type',
              <div className="grid grid-cols-2 gap-2">
                <button type="button" data-testid="maker-side-SELL_CRYPTO" onClick={() => setMakerSide('SELL_CRYPTO')} className={`py-2.5 rounded-xl text-xs font-bold border transition ${makerSide === 'SELL_CRYPTO' ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40' : 'bg-elevated text-textSecondary border-borderStrong hover:text-textPrimary'}`}>{getOrderSideCopy('SELL_CRYPTO', 'display', lang)}</button>
                <button type="button" data-testid="maker-side-BUY_CRYPTO" onClick={() => setMakerSide('BUY_CRYPTO')} className={`py-2.5 rounded-xl text-xs font-bold border transition ${makerSide === 'BUY_CRYPTO' ? 'bg-blue-600/20 text-blue-400 border-blue-500/40' : 'bg-elevated text-textSecondary border-borderStrong hover:text-textPrimary'}`}>{getOrderSideCopy('BUY_CRYPTO', 'display', lang)}</button>
              </div>,
              lang === 'TR' ? 'Parent order ile kripto satacağınızı veya kripto alacağınızı seçin.' : 'Choose whether this parent order sells crypto or buys crypto.'
            )}

            {renderMakerSection(
              lang === 'TR' ? 'Varlık' : 'Asset',
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={makerLabelClass}>{lang === 'TR' ? 'Kripto varlık' : 'Crypto asset'}</label>
                  <select value={makerToken} onChange={e => setMakerToken(e.target.value)} className={makerFieldClass}>
                    <option value="USDT">USDT</option>
                    <option value="USDC">USDC</option>
                  </select>
                </div>
                <div>
                  <label className={makerLabelClass}>{lang === 'TR' ? 'İtibari para' : 'Fiat currency'}</label>
                  <select value={makerFiat} onChange={e => setMakerFiat(e.target.value)} className={makerFieldClass}>
                    <option value="TRY">TRY</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>
            )}

            {renderMakerSection(
              lang === 'TR' ? 'Miktar' : 'Amount',
              <div>
                <label className={makerLabelClass}>{lang === 'TR' ? 'Order miktarı' : 'Order amount'}</label>
                <input type="number" placeholder={lang === 'TR' ? 'Örn: 1000' : 'Example: 1000'} value={makerAmount} onChange={e => setMakerAmount(e.target.value)} className={makerFieldClass} />
              </div>
            )}

            {renderMakerSection(
              lang === 'TR' ? 'Kur' : 'Rate',
              <div>
                <label className={makerLabelClass}>{lang === 'TR' ? `Kur (1 ${makerToken} için)` : `Rate (per 1 ${makerToken})`}</label>
                <input type="number" placeholder={lang === 'TR' ? 'Örn: 33.50' : 'Example: 33.50'} value={makerRate} onChange={e => setMakerRate(e.target.value)} className={makerFieldClass} />
              </div>
            )}

            {renderMakerSection(
              lang === 'TR' ? 'Limitler' : 'Limits',
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={makerLabelClass}>{lang === 'TR' ? 'Minimum limit' : 'Minimum limit'}</label>
                  <input type="number" placeholder="500" value={makerMinLimit} onChange={e => setMakerMinLimit(e.target.value)} className={makerFieldClass} />
                </div>
                <div>
                  <label className={makerLabelClass}>{lang === 'TR' ? 'Maksimum limit' : 'Maximum limit'}</label>
                  <input type="number" placeholder="2500" value={makerMaxLimit} onChange={e => setMakerMaxLimit(e.target.value)} className={makerFieldClass} />
                </div>
              </div>
            )}

            {renderMakerSection(
              lang === 'TR' ? 'Tier' : 'Tier',
              <div>
                <label className={makerLabelClass}>{lang === 'TR' ? 'Kullanılacak tier seviyesi' : 'Tier level'}</label>
                <select value={makerTier} onChange={e => setMakerTier(Number(e.target.value))} className={makerFieldClass}>
                  {[0, 1, 2, 3, 4].map(t => (
                    <option key={t} value={t} disabled={t > effectiveUserTier}>
                      {TIER_LABELS[t]} {t > effectiveUserTier ? (lang === 'TR' ? '(Yetersiz)' : '(Too Low)') : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {renderMakerSection(
              lang === 'TR' ? 'Reserve önizlemesi' : 'Reserve preview',
              <div className="p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-xl">
                <p className="text-xs text-emerald-400 mb-2 font-medium">🛡️ {modalCopy.previewTitle} • {TIER_LABELS[makerTier]}</p>
                {bondPct > 0 ? (
                  <div className="flex justify-between gap-3 text-xs text-textSecondary mb-1">
                    <span>{modalCopy.bondRoleLabel} (%{bondPct}):</span>
                    <span className="font-mono">{preview.reserveAmount > 0 ? `${preview.reserveAmount} ${makerToken}` : '—'}</span>
                  </div>
                ) : (
                  <p className="text-xs text-textMuted mb-1">{lang === 'TR' ? 'Tier 0: Teminat yok' : 'Tier 0: No bond'}</p>
                )}
                <div className="flex justify-between gap-3 text-sm font-bold text-textPrimary border-t border-emerald-500/30 pt-2">
                  <span>{modalCopy.totalLabel}:</span>
                  <span className="font-mono">{preview.totalAmount > 0 ? `${preview.totalAmount} ${makerToken}` : '—'}</span>
                </div>
                <p className="text-xs text-textMuted mt-2 leading-relaxed">{modalCopy.previewHint}</p>
              </div>
            )}

            {renderMakerSection(
              lang === 'TR' ? 'Ödeme yöntemi karmaşıklığı' : 'Payment method complexity',
              <>
                <PaymentRiskBadge lang={lang} riskEntry={payoutRiskEntry} />
                <p className="text-xs text-textMuted leading-relaxed">
                  {lang === 'TR'
                    ? 'Payment risk sınıfı kullanıcı güveni değil, ödeme yönteminin operasyonel karmaşıklığıdır.'
                    : 'Payment risk class describes payment-method complexity, not user trust.'}
                </p>
                {isCreateTemporarilyDisabledByRisk && (
                  <p className="text-sm text-red-300 bg-red-950/20 border border-red-900/40 rounded-lg p-3 leading-relaxed">
                    {lang === 'TR'
                      ? 'Bu rail/country kombinasyonu şu an availability config nedeniyle kısıtlı görünüyor. Bu bir kontrat hükmü değildir.'
                      : 'This rail/country pair is currently restricted by availability config. This is not a contract authority rule.'}
                  </p>
                )}
              </>
            )}

            {renderMakerSection(
              lang === 'TR' ? 'Onay' : 'Confirm',
              <>
                {validationError && (
                  <p className="text-red-300 text-sm font-medium bg-red-950/30 p-3 rounded-lg border border-red-900/50 leading-relaxed">{validationError}</p>
                )}
                <button
                  onClick={handleCreateOrder}
                  disabled={isContractLoading || validationError !== null || isCreateTemporarilyDisabledByRisk}
                  className={`w-full py-3 rounded-xl font-bold shadow-lg transition ${
                    isContractLoading || validationError !== null || isCreateTemporarilyDisabledByRisk
                      ? 'bg-elevated text-textMuted border border-borderStrong cursor-not-allowed'
                      : 'bg-white hover:bg-slate-200 text-black shadow-white/10'
                  }`}>
                  {isContractLoading ? (loadingText || (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...')) : modalCopy.submitLabel}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // [TR] Profil merkezi modalı — ayarlar, itibar, orderlarım, aktif ve geçmiş sekmeleri
  // [EN] Profile center modal — settings, reputation, my orders, active and history tabs
  const renderProfileModal = () => {
    if (!showProfileModal) return null;
    // [TR] Profil modalı görünürken auth kopmuş olabilir.
    //      Burada setter çağırmak render sırasında state update üretip
    //      React boundary'e düşebilen "illegal render side-effect" oluşturur.
    //      Kapatma işlemi App.jsx içindeki useEffect ile yönetilir.
    // [EN] If auth drops while modal is open, closing is handled in App.jsx effect.
    if (!isConnected || !isAuthenticated) return null;
    const resolvedMyOrders = myOrders || (address ? orders.filter(o => o.ownerAddress?.toLowerCase() === address.toLowerCase()) : []);

    return (
      <div className="fixed inset-0 max-w-full overflow-x-hidden bg-[#060608]/90 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 safe-area-x z-[100]">
        <div className="bg-[#111113] border-t sm:border border-[#222] rounded-t-3xl sm:rounded-2xl w-full max-w-2xl shadow-2xl h-[min(85dvh,calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)))] sm:h-auto sm:max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] flex flex-col pb-[calc(4rem_+_env(safe-area-inset-bottom))] sm:pb-0">
          <div className="flex justify-between items-center p-5 sm:p-6 border-b border-[#222] shrink-0">
            <h2 className="text-2xl font-bold text-white">{lang === 'TR' ? 'Profil Merkezi' : 'Profile Center'}</h2>
            <button onClick={() => setShowProfileModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>

          <div className="flex border-b border-[#222] shrink-0 overflow-x-auto overscroll-x-contain hide-scrollbar">
            {['ayarlar', 'itibar', 'ilanlarim', 'aktif', 'gecmis'].map(tab => (
              <button key={tab} onClick={() => setProfileTab(tab)} className={`px-4 py-3 text-sm font-medium capitalize transition whitespace-nowrap ${profileTab === tab ? 'text-emerald-400 border-b-2 border-emerald-400 bg-[#1a1a1f]/50' : 'text-slate-400 hover:text-white'}`}>
                {tab === 'ayarlar' ? (lang === 'TR' ? 'Ayarlar' : 'Settings') : tab === 'itibar' ? (lang === 'TR' ? 'İtibar' : 'Reputation') : tab === 'ilanlarim' ? (lang === 'TR' ? 'Orderlarım' : 'My Orders') : tab === 'aktif' ? (lang === 'TR' ? 'Aktif İşlemler' : 'Active Trades') : (lang === 'TR' ? 'Geçmiş' : 'History')}
              </button>
            ))}
          </div>

          <div className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain p-6 safe-area-x flex-1">
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
                  <p className="text-slate-300 text-sm font-bold">{lang === 'TR' ? 'Ödeme Profili ve İletişim' : 'Payout Profile & Contact'}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Rail</label>
                      <select
                        value={payoutProfileDraft.rail}
                        onChange={(e) => {
                          const nextRail = e.target.value;
                          setPayoutProfileDraft((prev) => canonicalizePayoutProfileDraft({ ...prev, rail: nextRail }));
                        }}
                        className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm"
                      >
                        <option value="TR_IBAN">TR_IBAN</option>
                        <option value="SEPA_IBAN">SEPA_IBAN</option>
                        <option value="US_ACH">US_ACH</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Country</label>
                      <select
                        value={payoutProfileDraft.country || ''}
                        onChange={(e) => setPayoutProfileDraft((prev) => canonicalizePayoutProfileDraft({ ...prev, country: e.target.value }))}
                        className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm"
                      >
                        {(payoutProfileDraft.rail === 'TR_IBAN'
                          ? ['TR']
                          : payoutProfileDraft.rail === 'US_ACH'
                            ? ['US']
                            : SEPA_COUNTRIES
                        ).map((countryCode) => (
                          <option key={countryCode} value={countryCode}>{countryCode}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'İletişim Kanalı' : 'Contact Channel'}</label>
                      <select value={payoutProfileDraft.contact?.channel || ''} onChange={(e) => setPayoutProfileDraft((prev) => canonicalizePayoutProfileDraft({ ...prev, contact: { ...prev.contact, channel: e.target.value || null } }))} className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm">
                        <option value="">{lang === 'TR' ? 'Yok' : 'None'}</option>
                        <option value="telegram">telegram</option>
                        <option value="email">email</option>
                        <option value="phone">phone</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'İletişim Değeri' : 'Contact Value'}</label>
                      <input
                        type="text"
                        value={payoutProfileDraft.contact?.value || ''}
                        placeholder={payoutProfileDraft.contact?.channel === 'telegram' ? 'username' : payoutProfileDraft.contact?.channel === 'email' ? 'name@example.com' : payoutProfileDraft.contact?.channel === 'phone' ? '+905...' : ''}
                        onChange={(e) => setPayoutProfileDraft((prev) => canonicalizePayoutProfileDraft({ ...prev, contact: { ...prev.contact, value: e.target.value || null } }))}
                        className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Hesap Sahibi' : 'Account Holder'}</label>
                    <input type="text" value={payoutProfileDraft.fields?.account_holder_name || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, fields: { ...prev.fields, account_holder_name: e.target.value } }))} placeholder={lang === 'TR' ? 'Örn: Jean-Luc Picard' : 'e.g. Jean-Luc Picard'} className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm" />
                  </div>
                  {(payoutProfileDraft.rail === 'TR_IBAN' || payoutProfileDraft.rail === 'SEPA_IBAN') && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">IBAN</label>
                      <input type="text" value={payoutProfileDraft.fields?.iban || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, fields: { ...prev.fields, iban: e.target.value } }))} className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none font-mono text-sm" />
                    </div>
                  )}
                  {payoutProfileDraft.rail === 'SEPA_IBAN' && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">BIC</label>
                      <input type="text" value={payoutProfileDraft.fields?.bic || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, fields: { ...prev.fields, bic: e.target.value || null } }))} className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm" />
                    </div>
                  )}
                  {payoutProfileDraft.rail === 'US_ACH' && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Routing Number</label>
                        <input type="text" value={payoutProfileDraft.fields?.routing_number || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, fields: { ...prev.fields, routing_number: e.target.value } }))} className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Account Number</label>
                        <input type="text" value={payoutProfileDraft.fields?.account_number || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, fields: { ...prev.fields, account_number: e.target.value } }))} className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Account Type</label>
                        <select value={payoutProfileDraft.fields?.account_type || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, fields: { ...prev.fields, account_type: e.target.value || null } }))} className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm">
                        <option value="">account_type</option>
                        <option value="checking">checking</option>
                        <option value="savings">savings</option>
                        </select>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Banka Adı (Opsiyonel)' : 'Bank Name (Optional)'}</label>
                    <input type="text" value={payoutProfileDraft.fields?.bank_name || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, fields: { ...prev.fields, bank_name: e.target.value || null } }))} className="w-full bg-[#0c0c0e] text-white px-3 py-2 rounded-lg border border-[#222] outline-none text-sm" />
                  </div>
                  <button type="submit" disabled={isContractLoading} className={`w-full py-2.5 rounded-xl font-bold text-sm transition ${isContractLoading ? 'bg-[#222] text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
                    {isContractLoading ? (lang === 'TR' ? 'Kaydediliyor...' : 'Saving...') : (lang === 'TR' ? 'Profili Kaydet' : 'Save Profile')}
                  </button>
                  <p className="text-xs text-slate-500 text-center pt-3 border-t border-[#2a2a2e]">
                    🔒 {lang === 'TR' ? 'Payout profile bilgileriniz AES-256 ile şifrelenir ve asla on-chain kaydedilmez.' : 'Your payout profile is AES-256 encrypted and never saved on-chain.'}
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
                  const partialSettlementCount = Number(userReputation?.authorityCounters?.partialSettlementCount ?? 0);
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
                        <div className="bg-[#151518] p-3 rounded-xl border border-[#2a2a2e] text-center col-span-2">
                          <p className="text-slate-500 text-[10px] font-bold tracking-widest">{lang === 'TR' ? 'UZLAŞMALI KAPANIŞ' : 'AGREED SETTLEMENT'}</p>
                          <p className="text-2xl font-bold text-cyan-300 mt-1">{partialSettlementCount}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            {lang === 'TR' ? 'Risk cezası değil, uzlaşmalı kapanış geçmişi göstergesidir.' : 'This is an event-history marker, not a risk penalty.'}
                          </p>
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
                        const cleanSlateTime = bannedUntil + (90 * 24 * 60 * 60);
                        const isEligible = now > cleanSlateTime && bannedUntil > 0;
                        const isBanActive = now < bannedUntil;
                        return (
                          <div className="bg-blue-950/20 p-4 rounded-xl border border-blue-900/40 text-center mt-4">
                            <p className="text-blue-400 text-xs font-bold mb-2">🛡️ {lang === 'TR' ? 'Temiz Sayfa Hakkı' : 'Clean Slate Right'}</p>
                            {isBanActive ? (
                              <p className="text-slate-400 text-xs">
                                {lang === 'TR' ? 'Cezanız devam ediyor. Ardışık yasak sayacınızı sıfırlamak için cezanız bittikten sonra 90 gün beklemelisiniz.' : 'Your ban is active. You must wait 90 days after your ban expires to reset your consecutive bans counter.'}
                              </p>
                            ) : isEligible ? (
                              <>
                                <p className="text-emerald-400 text-xs mb-3">
                                  {lang === 'TR' ? 'Tebrikler! Son yasağınızın üzerinden 90 gün geçti. Sicilinizi şimdi temizleyebilirsiniz.' : 'Congratulations! 90 days have passed since your last ban. You can clear your record now.'}
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
                              <p className="text-slate-400 text-xs">
                                {lang === 'TR' ? 'Ardışık yasak sayacınızı sıfırlamak için son cezanızın üzerinden 90 gün geçmesi gerekir.' : 'You must wait 90 days after your last ban to reset your consecutive bans counter.'}
                                <br/>
                                <span className="text-slate-300 font-bold mt-1 block">
                                  {lang === 'TR' ? 'Açılış Tarihi:' : 'Unlock Date:'} {new Date(cleanSlateTime * 1000).toLocaleDateString()}
                                </span>
                              </p>
                            )}
                          </div>
                        );
                      })()}

                      {(() => {
                        // [TR] Trust Visibility Layer yalnız mevcut trade payload'ındaki offchain_health_score_input verisini okur.
                        //      Bu bölüm enforcement üretmez; read-only/non-blocking semantiği UI'da açıkça korunur.
                        // [EN] Trust Visibility Layer reads only offchain_health_score_input from current trade payload.
                        //      It never enforces actions; read-only/non-blocking semantics are explicit in UI.
                        const trustRows = (activeEscrows || [])
                          .filter((escrow) => escrow?.role === 'maker')
                          .map((escrow) => ({
                            escrowId: escrow.onchainId,
                            ui: mapOffchainHealthToUi({
                              signal: escrow?.rawTrade?.offchainHealthScoreInput,
                              lang,
                            }),
                          }))
                          .filter((row) => row.ui);

                        if (trustRows.length === 0) {
                          return (
                            <div className="bg-[#151518] p-4 rounded-xl border border-[#2a2a2e]">
                              <p className="text-sm font-semibold text-slate-200 mb-1">
                                {lang === 'TR' ? 'Trust Visibility' : 'Trust Visibility'}
                              </p>
                              <p className="text-xs text-slate-500">
                                {lang === 'TR'
                                  ? 'Aktif maker-bağlantılı işlemler için görüntülenecek sinyal yok. Veri yoksa alan soft-fail ile sade kalır.'
                                  : 'No signal is available for active maker-linked trades. If payload is missing, this area soft-fails gracefully.'}
                              </p>
                            </div>
                          );
                        }

                        return (
                          <div className="bg-[#151518] p-4 rounded-xl border border-[#2a2a2e] space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-200">
                                {lang === 'TR' ? 'Trust Visibility' : 'Trust Visibility'}
                              </p>
                              <span className="text-[10px] px-2 py-1 rounded border text-slate-400 border-slate-700 bg-[#0c0c0e]">
                                {lang === 'TR' ? 'Aktif maker-bağlantılı işlemler' : 'Active maker-linked trades'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500">
                              {lang === 'TR'
                                ? 'Bilgilendirme amaçlıdır: read-only, non-blocking ve protokol hükmü değildir.'
                                : 'Informational only: read-only, non-blocking, and not a protocol verdict.'}
                            </p>
                            <div className="grid gap-2">
                              {trustRows.map(({ escrowId, ui }) => (
                                <div key={escrowId} className="rounded-lg border border-[#2a2a2e] bg-[#0c0c0e] p-3 space-y-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-xs text-slate-400 font-mono">#{escrowId}</p>
                                    <span className={`text-[10px] px-2 py-0.5 rounded border ${ui.severityChipClass}`}>
                                      {ui.severityBand} · {ui.severityLabel}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    <span className={`text-[10px] px-2 py-0.5 rounded border ${ui.readOnly ? 'text-emerald-400 border-emerald-700/50' : 'text-red-400 border-red-700/50'}`}>readOnly: {String(ui.readOnly)}</span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded border ${ui.nonBlocking ? 'text-emerald-400 border-emerald-700/50' : 'text-red-400 border-red-700/50'}`}>nonBlocking: {String(ui.nonBlocking)}</span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded border ${!ui.canBlockProtocolActions ? 'text-emerald-400 border-emerald-700/50' : 'text-red-400 border-red-700/50'}`}>canBlockProtocolActions: {String(ui.canBlockProtocolActions)}</span>
                                  </div>
                                  {ui.reasonLabels.length > 0 ? (
                                    <ul className="text-xs text-slate-400 list-disc pl-4 space-y-1">
                                      {ui.reasonLabels.map((reasonLabel, idx) => (
                                        <li key={`${escrowId}-reason-${idx}`}>{reasonLabel}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="text-xs text-slate-500">
                                      {lang === 'TR' ? 'Ek risk nedeni raporlanmadı.' : 'No additional risk reason reported.'}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
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
                        <p className="font-bold text-white text-sm">{order.sideLabel || getOrderSideCopy(order.side, 'order', lang) || order.side} · {order.status}</p>
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
                      className={`flex-1 text-xs font-bold py-1.5 rounded transition ${activeTradesFilter === f ? 'bg-[#222] text-white' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      {getStateLabel(f, lang)}
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
                          <span className="text-xs text-slate-500 ml-2 border border-[#333] px-2 py-0.5 rounded">{getActiveTradeRoleLabel(escrow.role, lang)}</span>
                        </div>
                        <span className={`text-xs font-bold px-2 py-1 rounded-md border ${escrow.state === 'PAID' ? 'bg-emerald-900/20 border-emerald-900/50 text-emerald-400' : escrow.state === 'CHALLENGED' ? 'bg-red-900/20 border-red-900/50 text-red-500' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>{getStateLabel(escrow.state, lang)}</span>
                      </div>
                      <p className="text-white font-medium text-sm mb-1">{escrow.amount} <span className="text-slate-500 text-xs ml-1">({escrow.rawTrade.max.toFixed(2)} {escrow.rawTrade.fiat})</span></p>
                      <p className="text-xs text-slate-400 mb-3">Karşı Taraf: <span className="font-mono">{escrow.counterparty}</span></p>
                      <button onClick={buildGoToTradeRoomAction({
                        escrow,
                        setActiveTrade,
                        setUserRole,
                        setTradeState,
                        setChargebackAccepted,
                        setCurrentView,
                        setShowProfileModal,
                      })} className="w-full mt-3 bg-[#0c0c0e] hover:bg-[#222] text-white text-xs font-bold py-2.5 rounded-lg transition border border-[#2a2a2e]">
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
                    const resolutionType = tx?.resolutionType || tx?.resolution_type || null;
                    const isPartialSettlement = resolutionType === 'PARTIAL_SETTLEMENT';
                    const statusMap = {
                      RESOLVED: { text: isPartialSettlement ? (lang === 'TR' ? 'Uzlaşmalı Kapanış' : 'Partial settlement') : (lang === 'TR' ? 'Tamamlandı' : 'Resolved'), color: isPartialSettlement ? 'cyan' : 'emerald' },
                      CANCELED: { text: lang === 'TR' ? 'İptal Edildi' : 'Canceled', color: 'slate' },
                      BURNED: { text: lang === 'TR' ? 'Yakıldı' : 'Burned', color: 'red' },
                    };
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
                        {['RESOLVED', 'CANCELED', 'BURNED'].includes(tx.status) && (
                          <p className="text-[10px] text-slate-400 mt-1 text-right">
                            {mapResolutionTypeLabel(resolutionType, lang)}
                          </p>
                        )}
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
            onClick={() => {
              // [TR] Kullanım koşulları kabulü kalıcı tutulur; modal refresh sonrası tekrar açılmaz.
              // [EN] Persist terms acceptance so modal does not re-open after refresh.
              if (typeof window !== 'undefined') {
                window.localStorage.setItem(TERMS_ACCEPTED_STORAGE_KEY, 'true');
              }
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

  return {
    renderWalletModal,
    renderFeedbackModal,
    renderMakerModal,
    renderProfileModal,
    renderTermsModal,
  };
};
