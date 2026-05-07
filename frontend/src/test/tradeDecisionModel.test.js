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
  it('LOCKED+taker produces report_payment', () => {
    const model = buildTradeDecisionModel(base);
    expect(model.primaryAction.key).toBe('report_payment');
  });

  it('LOCKED+maker produces waiting', () => {
    const model = buildTradeDecisionModel({ ...base, userRole: 'maker' });
    expect(model.primaryAction.type).toBe('waiting');
  });

  it('PAID+maker produces release primary and challenge secondary', () => {
    const model = buildTradeDecisionModel({ ...base, tradeState: 'PAID', userRole: 'maker' });
    expect(model.primaryAction.key).toBe('release_funds');
    expect(model.secondaryActions.map((a) => a.key)).toContain('start_challenge');
  });

  it('PAID+taker produces waiting/ping/auto-release conditional family', () => {
    const model = buildTradeDecisionModel({ ...base, tradeState: 'PAID', userRole: 'taker' });
    expect(model.primaryAction.type).toBe('waiting');
    expect(model.secondaryActions.map((a) => a.key)).toEqual(['ping_maker', 'auto_release', 'propose_cancel']);
  });

  it('CHALLENGED produces settlement family', () => {
    const model = buildTradeDecisionModel({ ...base, tradeState: 'CHALLENGED', userRole: 'maker' });
    expect(model.primaryAction.type).toBe('settlement');
    expect(model.secondaryActions.filter((a) => a.type === 'settlement')).toHaveLength(2);
    expect(model.secondaryActions.map((a) => a.key)).toContain('propose_cancel');
    expect(model.secondaryActions.map((a) => a.key)).not.toEqual(expect.arrayContaining(['propose_settlement', 'accept_settlement', 'reject_settlement', 'withdraw_settlement', 'expire_settlement']));
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
