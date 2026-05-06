const labels = {
  state: {
    LOCKED: { TR: 'Kilitli', EN: 'Locked' },
    PAID: { TR: 'Ödeme Bildirildi', EN: 'Paid' },
    CHALLENGED: { TR: 'İtirazlı', EN: 'Challenged' },
  },
  role: {
    taker: { TR: 'Alıcı', EN: 'Taker' },
    maker: { TR: 'Satıcı', EN: 'Maker' },
  },
};

const timerLabels = {
  gracePeriod: { TR: 'Grace period', EN: 'Grace period' },
  makerPing: { TR: 'Maker uyarı penceresi', EN: 'Maker ping window' },
  makerChallengePing: { TR: 'Alıcı uyarı penceresi', EN: 'Buyer ping window' },
  makerChallenge: { TR: 'İtiraz penceresi', EN: 'Challenge window' },
  bleeding: { TR: 'Bleeding escrow', EN: 'Bleeding escrow' },
  principalProtection: { TR: 'Ana para koruması', EN: 'Principal protection' },
};

const t = (lang, tr, en) => (lang === 'TR' ? tr : en);
const pickLocale = (lang) => (lang === 'TR' ? 'TR' : 'EN');

const formatTimerValue = (timer, lang) => {
  if (!timer || typeof timer !== 'object') return null;
  if (timer.isFinished) return t(lang, 'Tamamlandı', 'Finished');

  const parts = [];
  if (Number.isFinite(Number(timer.days)) && Number(timer.days) > 0) parts.push(`${Number(timer.days)}d`);
  if (Number.isFinite(Number(timer.hours))) parts.push(`${String(Number(timer.hours)).padStart(2, '0')}h`);
  if (Number.isFinite(Number(timer.minutes))) parts.push(`${String(Number(timer.minutes)).padStart(2, '0')}m`);
  if (Number.isFinite(Number(timer.seconds))) parts.push(`${String(Number(timer.seconds)).padStart(2, '0')}s`);

  return parts.length ? parts.join(' ') : null;
};

const buildTimerCards = (timers = {}, lang = 'EN') => {
  if (!timers || typeof timers !== 'object') return [];
  return Object.entries(timers)
    .map(([key, timer]) => {
      const summary = formatTimerValue(timer, lang);
      if (!summary) return null;
      return {
        key,
        label: timerLabels[key]?.[pickLocale(lang)] || key,
        summary,
      };
    })
    .filter(Boolean);
};

const action = (type, key, description, extra = {}) => ({ type, key, description, ...extra });

export function buildTradeDecisionModel({
  trade,
  tradeState,
  userRole,
  chargebackAccepted,
  paymentIpfsHash,
  timers,
  isConnected,
  isAuthenticated,
  isSupportedChain,
  isPaused,
  lang = 'EN',
}) {
  const normalizedState = String(tradeState || trade?.state || 'LOCKED').toUpperCase();
  const normalizedRole = String(userRole || 'taker').toLowerCase();

  const disabledReasons = [];
  if (!isConnected) disabledReasons.push(t(lang, 'Cüzdan bağlı değil.', 'Wallet not connected.'));
  if (!isAuthenticated) disabledReasons.push(t(lang, 'Oturum doğrulanmamış.', 'Session is not authenticated.'));
  if (!isSupportedChain) disabledReasons.push(t(lang, 'Desteklenmeyen ağ.', 'Unsupported network.'));
  if (isPaused) disabledReasons.push(t(lang, 'Sistem bakım modunda.', 'System is in maintenance mode.'));

  let primaryAction = action('waiting', 'waiting', t(lang, 'Bir sonraki kontrat aksiyonu mevcut durum tarafından belirlenir.', 'Next contract action is determined by the current state.'));
  let secondaryActions = [];
  const guidance = [];

  if (normalizedState === 'LOCKED' && normalizedRole === 'taker') {
    primaryAction = action(
      'contract',
      'report_payment',
      t(lang, 'Dekont yükleyip chargeback riskini onayladıktan sonra mevcut ödeme bildirimi formunu kullanın.', 'Upload payment proof and acknowledge chargeback risk, then use the existing payment report form.'),
      {
        requiresPaymentProof: !paymentIpfsHash,
        requiresChargebackAck: !chargebackAccepted,
      },
    );
    guidance.push(t(lang, 'Ödeme kanıtı yüklenmeden pasif rehberlik işlemi hazır saymaz.', 'Passive guidance does not consider the payment path ready until proof is uploaded.'));
    if (!paymentIpfsHash) disabledReasons.push(t(lang, 'Dekont gerekli.', 'Payment proof is required.'));
    if (!chargebackAccepted) disabledReasons.push(t(lang, 'Chargeback onayı gerekli.', 'Chargeback acknowledgement is required.'));
  }

  if (normalizedState === 'LOCKED' && normalizedRole === 'maker') {
    primaryAction = action('waiting', 'waiting_payment_notification', t(lang, 'Alıcının ödeme bildirimini bekleyin.', 'Wait for the buyer payment notification.'));
    guidance.push(t(lang, 'Ödeme bildirimi bekleniyor.', 'Payment notification is expected.'));
  }

  if (normalizedState === 'PAID' && normalizedRole === 'maker') {
    primaryAction = action('contract', 'release_funds', t(lang, 'Ödemeyi doğruladıysanız mevcut serbest bırakma panelini kullanın.', 'If payment checks out, use the existing release panel.'));
    secondaryActions = [action('contract', 'start_challenge', t(lang, 'Ödeme gelmediyse mevcut itiraz uyarı akışını takip edin.', 'If payment did not arrive, follow the existing challenge warning flow.'))];
    guidance.push(t(lang, 'Ödemeyi banka hesabınızda ve isim eşleşmesiyle doğrulayın.', 'Verify the payment in your bank account and confirm the sender-name match.'));
  }

  if (normalizedState === 'PAID' && normalizedRole === 'taker') {
    primaryAction = action('waiting', 'waiting_for_maker', t(lang, 'Maker serbest bırakmasını bekleyin.', 'Wait for maker release.'));
    secondaryActions = [
      action('conditional', 'ping_maker', t(lang, 'Grace period dolduğunda mevcut maker uyarı akışı kullanılabilir.', 'When the grace period expires, the existing maker ping flow may be available.')),
      action('conditional', 'auto_release', t(lang, 'Maker uyarısı sonrası süre dolarsa mevcut auto-release akışı kullanılabilir.', 'After maker ping expires, the existing auto-release flow may be available.')),
    ];
    guidance.push(t(lang, 'Maker pasif kalırsa zamanlayıcılar ping ve auto-release yolunu belirler.', 'If maker is inactive, timers determine the ping and auto-release path.'));
  }

  if (normalizedState === 'CHALLENGED') {
    primaryAction = action('settlement', 'settlement_guidance', t(lang, 'Settlement adımlarını mevcut settlement kartından takip edin.', 'Follow settlement steps from the existing settlement card.'));
    secondaryActions = [
      action('settlement', 'counterparty_response', t(lang, 'Karşı taraf yanıtları settlement kartında gösterilir.', 'Counterparty responses are shown in the settlement card.')),
      action('settlement', 'expiry_or_burn_guidance', t(lang, 'Süre dolumu ve yakma bilgileri mevcut işlem odası panellerinde kalır.', 'Expiry and burn information remains in the existing trade-room panels.')),
    ];
    guidance.push(t(lang, 'Araf hakem değildir; settlement taraf aksiyonu gerektirir.', 'Araf is not an arbitrator; settlement requires party action.'));
  }

  return {
    stateLabel: labels.state[normalizedState]?.[pickLocale(lang)] || normalizedState,
    roleLabel: labels.role[normalizedRole]?.[pickLocale(lang)] || normalizedRole,
    primaryAction,
    secondaryActions,
    disabledReasons,
    timerCards: buildTimerCards(timers, lang),
    guidance,
    riskCopy: {
      chargeback: t(lang, 'Chargeback riski kullanıcı sorumluluğundadır.', 'Chargeback risk remains user responsibility.'),
      settlement: t(lang, 'Settlement sonucu kontrat kurallarıyla belirlenir.', 'Settlement outcomes are governed by contract rules.'),
    },
    technicalDetails: {
      tradeId: trade?.id ?? null,
      onchainId: trade?.onchainId ?? null,
      tradeState: normalizedState,
      userRole: normalizedRole,
    },
  };
}

export default buildTradeDecisionModel;
