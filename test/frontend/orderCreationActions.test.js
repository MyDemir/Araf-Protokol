import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCreateOrderAction,
  getMakerOrderValidationError,
} from '../../frontend/src/app/actions/orderCreationActions';

const makeDeps = (overrides = {}) => {
  const state = {
    makerTier: 1,
    makerAmount: '100',
    makerRate: '34',
    makerMinLimit: '100',
    makerFiat: 'TRY',
    makerToken: 'USDT',
    makerSide: 'SELL_CRYPTO',
    ...(overrides.state || {}),
  };
  return {
    getFormState: () => state,
    resetForm: vi.fn(),
    requireSignedSessionForActiveWallet: vi.fn(() => true),
    supportedTokens: { USDT: { address: '0x0000000000000000000000000000000000000001', decimalsRequired: true } },
    address: '0xabc0000000000000000000000000000000000000',
    lang: 'EN',
    isContractLoading: vi.fn(() => false),
    setIsContractLoading: vi.fn(),
    setLoadingText: vi.fn(),
    setShowMakerModal: vi.fn(),
    showToast: vi.fn(),
    getTokenDecimals: vi.fn(async () => 6),
    getAllowance: vi.fn(async () => 1_000_000_000_000n),
    approveToken: vi.fn(async () => undefined),
    createSellOrder: vi.fn(async () => undefined),
    createBuyOrder: vi.fn(async () => undefined),
    fillSellOrder: vi.fn(),
    fillBuyOrder: vi.fn(),
    cancelSellOrder: vi.fn(),
    cancelBuyOrder: vi.fn(),
    canonicalizePayoutProfileDraft: vi.fn((v) => ({ rail: v.rail || 'TR_IBAN', country: v.country || 'TR' })),
    payoutProfileDraft: { rail: 'TR_IBAN', country: 'TR' },
    paymentRiskConfig: { TR: { TR_IBAN: { riskLevel: 'MEDIUM', enabled: true } } },
    ...overrides,
  };
};

const runAction = async (deps) => buildCreateOrderAction(deps)();

describe('order creation actions', () => {
  it('SELL_CRYPTO calls the createSellOrder path with raw side-driven contract values', async () => {
    const deps = makeDeps({ state: { makerSide: 'SELL_CRYPTO' } });

    await runAction(deps);

    expect(deps.createSellOrder).toHaveBeenCalledTimes(1);
    expect(deps.createBuyOrder).not.toHaveBeenCalled();
    const [tokenAddress, amountRaw, minFillRaw, tier, orderRef, riskLevel] = deps.createSellOrder.mock.calls[0];
    expect(tokenAddress).toBe('0x0000000000000000000000000000000000000001');
    expect(amountRaw).toBe(100_000_000n);
    expect(minFillRaw).toBe(2_941_176n);
    expect(tier).toBe(1);
    expect(orderRef).toMatch(/^0x[0-9a-f]{64}$/);
    expect(riskLevel).toBe('MEDIUM');
  });

  it('BUY_CRYPTO calls the createBuyOrder path without changing the internal enum', async () => {
    const deps = makeDeps({ state: { makerSide: 'BUY_CRYPTO' } });

    await runAction(deps);

    expect(deps.getFormState().makerSide).toBe('BUY_CRYPTO');
    expect(deps.createBuyOrder).toHaveBeenCalledTimes(1);
    expect(deps.createSellOrder).not.toHaveBeenCalled();
  });

  it('approves exactly amount + maker bond for a sell order (no 2x over-approval) (F14)', async () => {
    // tier 1 maker 8%, no reputation known => conservative +3% => 11% of 100 USDT
    const deps = makeDeps({ getAllowance: vi.fn(async () => 0n) });

    await runAction(deps);

    expect(deps.approveToken).toHaveBeenCalledTimes(1);
    expect(deps.approveToken).toHaveBeenCalledWith('0x0000000000000000000000000000000000000001', 111_000_000n);
  });

  it('approves exactly the taker bond for a buy order, using reputation when provided (F14)', async () => {
    // tier 1 taker 10%, riskPoints 0 and successful > 0 => -1% => 9% of 100 USDT
    const deps = makeDeps({
      state: { makerSide: 'BUY_CRYPTO' },
      getAllowance: vi.fn(async () => 0n),
      getReputation: vi.fn(async () => ({ successful: 4n, riskPoints: 0n })),
    });

    await runAction(deps);

    expect(deps.approveToken).toHaveBeenCalledWith('0x0000000000000000000000000000000000000001', 9_000_000n);
    expect(deps.createBuyOrder).toHaveBeenCalledTimes(1);
  });

  it('does not request approve(0) when the create call fails after approve (F14)', async () => {
    const deps = makeDeps({
      getAllowance: vi.fn(async () => 0n),
      createSellOrder: vi.fn(async () => { throw new Error('create failed'); }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runAction(deps);

    expect(deps.approveToken).toHaveBeenCalledTimes(1);
    expect(deps.approveToken).not.toHaveBeenCalledWith(expect.anything(), 0n);
    expect(deps.showToast).toHaveBeenCalledWith('create failed', 'error');
  });

  it('parses amounts as decimal strings: tiny and huge values never go through exponent notation (F22)', async () => {
    const tiny = makeDeps({ state: { makerAmount: '0.000001', makerRate: '34', makerMinLimit: '' } });
    await runAction(tiny);
    expect(tiny.createSellOrder.mock.calls[0][1]).toBe(1n);

    // 1e-7 tokens is below 6 decimals and (as text) is rejected instead of being mis-parsed
    const exp = makeDeps({ state: { makerAmount: '1e-7', makerRate: '34', makerMinLimit: '' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await runAction(exp);
    expect(exp.createSellOrder).not.toHaveBeenCalled();
    expect(exp.showToast).toHaveBeenCalledWith(expect.stringContaining('valid amount'), 'error');
  });

  it('keeps every fractional digit that floating point would round away (F22)', async () => {
    const deps = makeDeps({ state: { makerAmount: '123.456789', makerRate: '34', makerMinLimit: '', makerTier: 4 } });
    await runAction(deps);
    expect(deps.createSellOrder.mock.calls[0][1]).toBe(123_456_789n);
  });

  it('preserves tier validation thresholds including unrestricted tier 4 behavior', () => {
    expect(getMakerOrderValidationError({ makerTier: 0, makerAmount: '151', makerRate: '1', makerMinLimit: '1', makerFiat: 'TRY' })).toBe('Tier 0 max order limit is 150 USDT.');
    expect(getMakerOrderValidationError({ makerTier: 1, makerAmount: '1501', makerRate: '1', makerMinLimit: '1', makerFiat: 'TRY' })).toBe('Tier 1 max order limit is 1,500 USDT.');
    expect(getMakerOrderValidationError({ makerTier: 2, makerAmount: '7501', makerRate: '1', makerMinLimit: '1', makerFiat: 'TRY' })).toBe('Tier 2 max order limit is 7,500 USDT.');
    expect(getMakerOrderValidationError({ makerTier: 3, makerAmount: '30001', makerRate: '1', makerMinLimit: '1', makerFiat: 'TRY' })).toBe('Tier 3 max order limit is 30,000 USDT.');
    expect(getMakerOrderValidationError({ makerTier: 4, makerAmount: '30001', makerRate: '1', makerMinLimit: '1', makerFiat: 'TRY' })).toBeNull();
  });

  it('blocks a min limit above the total fiat value before contract calls', async () => {
    const minOverTotal = makeDeps({ state: { makerAmount: '10', makerRate: '10', makerMinLimit: '101' } });
    await runAction(minOverTotal);
    expect(minOverTotal.createSellOrder).not.toHaveBeenCalled();
    expect(minOverTotal.showToast).toHaveBeenCalledWith('Min limit exceeds total fiat (100.00 TRY).', 'error');
  });

  it('blocks restricted payment risk availability without treating it as contract authority', async () => {
    const deps = makeDeps({
      payoutProfileDraft: { rail: 'US_ACH', country: 'US' },
      paymentRiskConfig: { US: { US_ACH: { riskLevel: 'RESTRICTED', enabled: false } } },
    });

    await runAction(deps);

    expect(deps.createSellOrder).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('This rail/country pair is restricted by availability config. Order creation blocked.', 'error');
  });

  it('keeps App.jsx from declaring maker order form state or handleCreateOrder inline', () => {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    expect(appSource).toContain("import { useMakerOrderForm } from './app/contexts/marketplace/useMakerOrderForm';");
    expect(appSource).toContain('} = useMakerOrderForm({');
    expect(appSource).not.toMatch(/const\s+\[maker(?:Tier|Amount|Rate|MinLimit|MaxLimit|Fiat|Token|Side)/);
    expect(appSource).not.toMatch(/const\s+handleCreateOrder\s*=\s*async/);
  });
});
