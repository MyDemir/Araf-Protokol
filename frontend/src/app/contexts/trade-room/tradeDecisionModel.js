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

const t = (lang, tr, en) => (lang === 'TR' ? tr : en);

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

  let primaryAction = { type: 'waiting', key: 'waiting' };
  let secondaryActions = [];
  const guidance = [];

  if (normalizedState === 'LOCKED' && normalizedRole === 'taker') {
    primaryAction = {
      type: 'contract',
      key: 'report_payment',
      requiresPaymentProof: !paymentIpfsHash,
      requiresChargebackAck: !chargebackAccepted,
    };
    if (!paymentIpfsHash) disabledReasons.push(t(lang, 'Dekont gerekli.', 'Payment proof is required.'));
    if (!chargebackAccepted) disabledReasons.push(t(lang, 'Chargeback onayı gerekli.', 'Chargeback acknowledgement is required.'));
  }

  if (normalizedState === 'LOCKED' && normalizedRole === 'maker') {
    primaryAction = { type: 'waiting', key: 'waiting_payment_notification' };
    guidance.push(t(lang, 'Ödeme bildirimi bekleniyor.', 'Payment notification is expected.'));
  }

  if (normalizedState === 'PAID' && normalizedRole === 'maker') {
    primaryAction = { type: 'contract', key: 'release_funds' };
    secondaryActions = [{ type: 'contract', key: 'start_challenge' }];
  }

  if (normalizedState === 'PAID' && normalizedRole === 'taker') {
    primaryAction = { type: 'waiting', key: 'waiting_for_maker' };
    secondaryActions = [
      { type: 'conditional', key: 'ping_maker' },
      { type: 'conditional', key: 'auto_release' },
    ];
  }

  if (normalizedState === 'CHALLENGED') {
    primaryAction = { type: 'settlement', key: 'settlement_actions' };
    secondaryActions = [
      { type: 'settlement', key: 'reject_or_withdraw' },
      { type: 'settlement', key: 'burn_or_expire' },
    ];
    guidance.push(t(lang, 'Araf hakem değildir; settlement taraf aksiyonu gerektirir.', 'Araf is not an arbitrator; settlement requires party action.'));
  }

  return {
    stateLabel: labels.state[normalizedState]?.[lang === 'TR' ? 'TR' : 'EN'] || normalizedState,
    roleLabel: labels.role[normalizedRole]?.[lang === 'TR' ? 'TR' : 'EN'] || normalizedRole,
    primaryAction,
    secondaryActions,
    disabledReasons,
    timerCards: timers || {},
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
