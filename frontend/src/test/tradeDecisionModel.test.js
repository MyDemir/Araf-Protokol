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
    expect(model.secondaryActions.map((a) => a.key)).toEqual(['ping_maker', 'auto_release']);
  });

  it('CHALLENGED produces settlement family', () => {
    const model = buildTradeDecisionModel({ ...base, tradeState: 'CHALLENGED', userRole: 'maker' });
    expect(model.primaryAction.type).toBe('settlement');
    expect(model.secondaryActions.every((a) => a.type === 'settlement')).toBe(true);
  });

  it('wrong chain / paused / unauthenticated appear as disabled reasons', () => {
    const model = buildTradeDecisionModel({ ...base, isConnected: false, isSupportedChain: false, isPaused: true, isAuthenticated: false });
    expect(model.disabledReasons).toContain('Wallet not connected.');
    expect(model.disabledReasons).toContain('Session is not authenticated.');
    expect(model.disabledReasons).toContain('Unsupported network.');
    expect(model.disabledReasons).toContain('System is in maintenance mode.');
  });
});
