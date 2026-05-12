const panelActionConfig = (onClick, { disabled = false, disabledReasons = [], hasOnchainTradeId, missingOnchainIdReason } = {}) => ({
  onClick,
  disabled: disabled || !hasOnchainTradeId,
  disabledReasons: [
    ...(!hasOnchainTradeId ? [missingOnchainIdReason] : []),
    ...disabledReasons,
  ],
});

export const getBurnExpiredDeadlinePassed = ({ activeTrade, roomState, now = new Date() }) => Boolean(
  activeTrade?.onchainId
  && roomState === 'CHALLENGED'
  && activeTrade.challengedAt
  && (now.getTime() - new Date(activeTrade.challengedAt).getTime() > 10 * 24 * 3600 * 1000)
);

export const buildTradeRoomPanelCallbacks = ({
  lang = 'EN',
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
  handleReportPayment,
  handleRelease,
  handleChallenge,
  handlePingMaker,
  handleAutoRelease,
  handleProposeCancel,
  handleBurnExpired,
  confirmFn = typeof window !== 'undefined' ? window.confirm.bind(window) : () => false,
}) => {
  const makerChallengeBlocked = activeTrade?.challengePingedAt ? !canMakerChallenge : !canMakerStartChallengeFlow;
  const makerChallengeReason = activeTrade?.challengePingedAt
    ? (lang === 'TR' ? 'İtiraz için 24 saat bekleyin.' : 'Wait 24h to challenge.')
    : (lang === 'TR' ? 'Uyarı için 24 saat bekleyin.' : 'Wait 24h to ping buyer.');
  const gracePeriodEnds = activeTrade?.paidAt ? new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000) : null;
  const canPanelPingMaker = Boolean(activeTrade?.paidAt && !activeTrade?.pingedAt && !activeTrade?.challengePingedAt && gracePeriodEnds && new Date() > gracePeriodEnds);
  const autoReleaseAt = activeTrade?.pingedAt ? new Date(new Date(activeTrade.pingedAt).getTime() + 24 * 3600 * 1000) : null;
  const canPanelAutoRelease = Boolean(autoReleaseAt && new Date() > autoReleaseAt);
  const withGuard = (onClick, options = {}) => panelActionConfig(onClick, { ...options, hasOnchainTradeId, missingOnchainIdReason });

  return {
    report_payment: withGuard(handleReportPayment, { disabled: isContractLoading }),
    release_funds: withGuard(handleRelease, {
      disabled: isContractLoading || (isMaker && roomState === 'PAID' && !chargebackAccepted),
      disabledReasons: isMaker && roomState === 'PAID' && !chargebackAccepted
        ? [lang === 'TR' ? 'Chargeback onayı gerekli.' : 'Chargeback acknowledgement is required.']
        : [],
    }),
    start_challenge: withGuard(handleChallenge, {
      disabled: isContractLoading || makerChallengeBlocked,
      disabledReasons: makerChallengeBlocked ? [makerChallengeReason] : [],
    }),
    ping_maker: withGuard(() => handlePingMaker(activeTrade.onchainId), {
      disabled: isContractLoading || !canPanelPingMaker,
      disabledReasons: !canPanelPingMaker ? [lang === 'TR' ? 'Satıcı uyarısı için onay süresi bekleniyor.' : 'Grace period must expire before pinging maker.'] : [],
    }),
    auto_release: withGuard(() => handleAutoRelease(activeTrade.onchainId), {
      disabled: isContractLoading || !canPanelAutoRelease,
      disabledReasons: !canPanelAutoRelease ? [lang === 'TR' ? 'Otomatik serbest bırakma için satıcı uyarısı sonrası 24 saat bekleyin.' : 'Wait 24h after maker ping before auto-release.'] : [],
    }),
    propose_cancel: withGuard(() => {
      const msg = roomState === 'LOCKED'
        ? (lang === 'TR' ? 'LOCKED aşamasında (henüz ödeme bildirilmeden) iptaller kesintisizdir. Onaylıyor musunuz?' : 'Cancel in LOCKED state has zero fees. Confirm?')
        : (lang === 'TR' ? 'Karşılıklı iptal durumunda standart protokol ücreti kesilecektir. Onaylıyor musunuz?' : 'Standard protocol fees will be deducted upon mutual cancellation. Confirm?');
      if (confirmFn(msg)) handleProposeCancel();
    }, { disabled: isContractLoading }),
    burn_expired: withGuard(handleBurnExpired, {
      disabled: isContractLoading || !burnExpiredDeadlinePassed,
      disabledReasons: !burnExpiredDeadlinePassed ? [lang === 'TR' ? '10 günlük yakma süresi henüz dolmadı.' : '10-day burn deadline has not passed.'] : [],
    }),
  };
};
