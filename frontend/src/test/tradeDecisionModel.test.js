import { describe, expect, it } from 'vitest';
import { buildTradeDecisionModel } from '../app/contexts/trade-room/tradeDecisionModel';

const base = {
  trade: { id: 't1', onchainId: 11 },
  tradeState: 'LOCKED',
  userRole: 'taker',
  chargebackAccepted: true,
  paymentIpfsHash: 'hash',
  timers: {},
  isConnected: true,
  isAuthenticated: true,
  isSupportedChain: true,
  isPaused: false,
  lang: 'EN',
};

describe('buildTradeDecisionModel', () => {
  it('LOCKED+taker produces report_payment and user-facing decision copy', () => {
    const model = buildTradeDecisionModel(base);
    expect(model.primaryAction.key).toBe('report_payment');
    expect(model.headline).toBe('Payment proof is needed');
    expect(model.nowLabel).toBe('Now');
    expect(model.nowDescription).toContain('contract state remains authoritative');
    expect(model.nextDescription).toContain('existing timers');
  });

  it('LOCKED+maker produces waiting', () => {
    const model = buildTradeDecisionModel({ ...base, userRole: 'maker' });
    expect(model.primaryAction.type).toBe('waiting');
  });

  it('PAID+maker produces release primary, challenge secondary, and review copy', () => {
    const model = buildTradeDecisionModel({ ...base, tradeState: 'PAID', userRole: 'maker' });
    expect(model.primaryAction.key).toBe('release_funds');
    expect(model.secondaryActions.map((a) => a.key)).toContain('start_challenge');
    expect(model.headline).toBe('Payment was reported; review it now');
    expect(model.nowDescription).toContain('release the funds');
    expect(model.nextDescription).toContain('Araf is not an arbitrator');
  });

  it('PAID+taker produces waiting/ping/auto-release conditional family and waiting copy', () => {
    const model = buildTradeDecisionModel({ ...base, tradeState: 'PAID', userRole: 'taker' });
    expect(model.primaryAction.type).toBe('waiting');
    expect(model.secondaryActions.map((a) => a.key)).toEqual(['ping_maker', 'auto_release', 'propose_cancel']);
    expect(model.headline).toBe('Payment reported; waiting for maker review');
    expect(model.nextDescription).toContain('frontend only presents those paths');
  });

  it('CHALLENGED produces settlement family and party-driven settlement copy', () => {
    const model = buildTradeDecisionModel({ ...base, tradeState: 'CHALLENGED', userRole: 'maker' });
    expect(model.primaryAction.type).toBe('settlement');
    expect(model.primaryAction.key).toBe('settlement_guidance');
    expect(model.secondaryActions.filter((a) => a.type === 'settlement')).toHaveLength(2);
    expect(model.secondaryActions.map((a) => a.key)).toContain('propose_cancel');
    expect(model.secondaryActions.map((a) => a.key)).not.toEqual(expect.arrayContaining(['propose_settlement', 'accept_settlement', 'reject_settlement', 'withdraw_settlement', 'expire_settlement']));
    expect(model.headline).toBe('Challenge phase is active');
    expect(model.subheadline).toContain('Araf does not decide');
    expect(`${model.headline} ${model.subheadline} ${model.nowDescription} ${model.nextDescription}`).not.toMatch(/won|lost|decides who is right|trust score/i);
  });


  it('keeps required action keys unchanged across active states', () => {
    const lockedTaker = buildTradeDecisionModel(base);
    const paidMaker = buildTradeDecisionModel({ ...base, tradeState: 'PAID', userRole: 'maker' });
    const paidTaker = buildTradeDecisionModel({ ...base, tradeState: 'PAID', userRole: 'taker' });
    const challenged = buildTradeDecisionModel({ ...base, tradeState: 'CHALLENGED', userRole: 'maker' });

    expect(lockedTaker.primaryAction.key).toBe('report_payment');
    expect(paidMaker.primaryAction.key).toBe('release_funds');
    expect(paidMaker.secondaryActions.map((a) => a.key)).toEqual(['start_challenge', 'propose_cancel']);
    expect(paidTaker.secondaryActions.map((a) => a.key)).toEqual(['ping_maker', 'auto_release', 'propose_cancel']);
    expect(challenged.primaryAction.key).toBe('settlement_guidance');
    expect(challenged.secondaryActions.map((a) => a.key)).toContain('propose_cancel');
  });

  it('returns localized Turkish decision copy', () => {
    const model = buildTradeDecisionModel({ ...base, lang: 'TR', tradeState: 'LOCKED', userRole: 'taker' });
    expect(model.headline).toBe('Ödeme kanıtı bekleniyor');
    expect(model.nowLabel).toBe('Şimdi');
    expect(model.nextLabel).toBe('Süre devam ederse');
    expect(model.nowDescription).toContain('kontrat durumu belirler');
  });

  it('wrong chain / paused / unauthenticated appear as global and primary disabled reasons', () => {
    const model = buildTradeDecisionModel({ ...base, isSupportedChain: false, isPaused: true, isAuthenticated: false });
    const expected = [
      'Unsupported network.',
      'System is in maintenance mode.',
      'Session is not authenticated.',
    ];
    expect(model.disabledReasons).toEqual(expect.arrayContaining(expected));
    expect(model.globalDisabledReasons).toEqual(expect.arrayContaining(expected));
  });

  it('LOCKED+taker with payment proof can report payment without chargeback acknowledgement', () => {
    const model = buildTradeDecisionModel({ ...base, paymentIpfsHash: 'proof-hash', chargebackAccepted: false });
    expect(model.primaryAction.key).toBe('report_payment');
    expect(model.primaryAction.requiresPaymentProof).toBe(false);
    expect(model.primaryAction.requiresChargebackAck).toBeUndefined();
    expect(model.disabledReasons).not.toContain('Chargeback acknowledgement is required.');
    expect(model.disabledReasons).not.toContain('Payment proof is required.');
    expect(model.globalDisabledReasons).not.toContain('Payment proof is required.');
  });

  it('LOCKED+taker without payment proof only disables the primary report-payment action', () => {
    const model = buildTradeDecisionModel({ ...base, paymentIpfsHash: '', chargebackAccepted: false });
    expect(model.primaryAction.key).toBe('report_payment');
    expect(model.primaryAction.requiresPaymentProof).toBe(true);
    expect(model.primaryAction.requiresChargebackAck).toBeUndefined();
    expect(model.disabledReasons).toContain('Payment proof is required.');
    expect(model.disabledReasons).not.toContain('Chargeback acknowledgement is required.');
    expect(model.globalDisabledReasons).not.toContain('Payment proof is required.');
    expect(model.secondaryActions.map((a) => a.key)).toContain('propose_cancel');
  });

  it('adds burn_expired only when the caller proves the burn deadline is available', () => {
    const unavailable = buildTradeDecisionModel({ ...base, tradeState: 'CHALLENGED', canBurnExpired: false });
    const available = buildTradeDecisionModel({ ...base, tradeState: 'CHALLENGED', canBurnExpired: true });

    expect(unavailable.secondaryActions.map((a) => a.key)).not.toContain('burn_expired');
    expect(available.secondaryActions.map((a) => a.key)).toContain('burn_expired');
  });

  it('turns supplied timers into passive timer summaries', () => {
    const model = buildTradeDecisionModel({
      ...base,
      timers: { gracePeriod: { isFinished: false, hours: 1, minutes: 2, seconds: 3 } },
    });
    expect(model.timerCards).toEqual([
      { key: 'gracePeriod', label: 'Grace period', summary: '01h 02m 03s' },
    ]);
  });
});
