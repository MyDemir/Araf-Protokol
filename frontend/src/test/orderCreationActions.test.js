import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCreateOrderAction,
  getMakerOrderValidationError,
} from '../app/actions/orderCreationActions';

const makeDeps = (overrides = {}) => {
  const state = {
    makerTier: 1,
    makerAmount: '100',
    makerRate: '34',
    makerMinLimit: '100',
    makerMaxLimit: '1000',
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

  it('preserves tier validation thresholds including unrestricted tier 4 behavior', () => {
    expect(getMakerOrderValidationError({ makerTier: 0, makerAmount: '151', makerRate: '1', makerMinLimit: '1', makerMaxLimit: '1', makerFiat: 'TRY' })).toBe('Tier 0 max order limit is 150 USDT/USDC.');
    expect(getMakerOrderValidationError({ makerTier: 1, makerAmount: '1501', makerRate: '1', makerMinLimit: '1', makerMaxLimit: '1', makerFiat: 'TRY' })).toBe('Tier 1 max order limit is 1500 USDT/USDC.');
    expect(getMakerOrderValidationError({ makerTier: 2, makerAmount: '7501', makerRate: '1', makerMinLimit: '1', makerMaxLimit: '1', makerFiat: 'TRY' })).toBe('Tier 2 max order limit is 7500 USDT/USDC.');
    expect(getMakerOrderValidationError({ makerTier: 3, makerAmount: '30001', makerRate: '1', makerMinLimit: '1', makerMaxLimit: '1', makerFiat: 'TRY' })).toBe('Tier 3 max order limit is 30000 USDT/USDC.');
    expect(getMakerOrderValidationError({ makerTier: 4, makerAmount: '30001', makerRate: '1', makerMinLimit: '1', makerMaxLimit: '1', makerFiat: 'TRY' })).toBeNull();
  });

  it('blocks invalid min/max limits before contract calls', async () => {
    const minOverMax = makeDeps({ state: { makerMinLimit: '2000', makerMaxLimit: '1000' } });
    await runAction(minOverMax);
    expect(minOverMax.createSellOrder).not.toHaveBeenCalled();
    expect(minOverMax.showToast).toHaveBeenCalledWith('Min limit cannot exceed Max.', 'error');

    const maxOverTotal = makeDeps({ state: { makerAmount: '10', makerRate: '10', makerMinLimit: '10', makerMaxLimit: '101' } });
    await runAction(maxOverTotal);
    expect(maxOverTotal.createSellOrder).not.toHaveBeenCalled();
    expect(maxOverTotal.showToast).toHaveBeenCalledWith('Max limit exceeds total fiat (100.00 TRY).', 'error');
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
