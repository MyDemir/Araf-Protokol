import { describe, expect, it } from 'vitest';
import {
  calcBondRaw,
  computeCreateAllowance,
  computeFillAllowance,
  resolveAllowanceBondBps,
} from '../../frontend/src/app/actions/allowanceMath';
import { computeMinFillRaw, parseDecimalToUnits } from '../../frontend/src/app/actions/decimalUnits';

describe('parseDecimalToUnits (F22)', () => {
  it('parses plain decimals exactly, without float error', () => {
    expect(parseDecimalToUnits('1', 6)).toBe(1_000_000n);
    expect(parseDecimalToUnits('0.1', 6)).toBe(100_000n);
    expect(parseDecimalToUnits('.5', 6)).toBe(500_000n);
    expect(parseDecimalToUnits('123456789.123456', 6)).toBe(123_456_789_123_456n);
    expect(parseDecimalToUnits('1,5', 6)).toBe(1_500_000n);
  });

  it('rejects exponent notation, signs, junk and too many fraction digits', () => {
    for (const bad of ['1e-7', '1e21', '-1', '+1', 'abc', '', '.', '1.2.3', '0.1234567']) {
      expect(parseDecimalToUnits(bad, 6)).toBeNull();
    }
  });

  it('can truncate extra fraction digits when asked (used for fiat/rate)', () => {
    expect(parseDecimalToUnits('0.1234567', 6, { truncate: true })).toBe(123_456n);
  });
});

describe('computeMinFillRaw (F22)', () => {
  it('floors minFiat / rate in token base units and never returns 0', () => {
    expect(computeMinFillRaw({ minFiat: '100', rate: '34', totalAmountRaw: 100_000_000n, tokenDecimals: 6 })).toBe(2_941_176n);
    expect(computeMinFillRaw({ minFiat: '0.0000001', rate: '1000000', totalAmountRaw: 100_000_000n, tokenDecimals: 6 })).toBe(1n);
  });

  it('defaults to the full amount when no min limit is given and clamps to the total', () => {
    expect(computeMinFillRaw({ minFiat: '', rate: '34', totalAmountRaw: 5n, tokenDecimals: 6 })).toBe(5n);
    expect(computeMinFillRaw({ minFiat: '0', rate: '34', totalAmountRaw: 5n, tokenDecimals: 6 })).toBe(5n);
    expect(computeMinFillRaw({ minFiat: '1000', rate: '1', totalAmountRaw: 5_000_000n, tokenDecimals: 6 })).toBe(5_000_000n);
  });

  it('returns null for non-decimal inputs', () => {
    expect(computeMinFillRaw({ minFiat: '1e2', rate: '34', totalAmountRaw: 1n, tokenDecimals: 6 })).toBeNull();
    expect(computeMinFillRaw({ minFiat: '10', rate: '0', totalAmountRaw: 1n, tokenDecimals: 6 })).toBeNull();
  });
});

describe('allowance math mirrors the contract (F14)', () => {
  it('floors like Solidity integer division', () => {
    expect(calcBondRaw(33_333_333n, 900)).toBe(2_999_999n);
  });

  it('tier 0 has zero bond regardless of reputation', () => {
    expect(resolveAllowanceBondBps({ role: 'taker', tier: 0, reputation: null })).toBe(0);
    expect(computeFillAllowance({ side: 'SELL_CRYPTO', fillAmountRaw: 10n ** 9n, tier: 0 })).toBe(0n);
  });

  it('sell fill = taker bond only; buy fill = amount + maker bond', () => {
    const rep = { successful: 2n, riskPoints: 0n };
    expect(computeFillAllowance({ side: 'SELL_CRYPTO', fillAmountRaw: 100_000_000n, tier: 2, reputation: rep })).toBe(7_000_000n); // 800-100 bps
    expect(computeFillAllowance({ side: 'BUY_CRYPTO', fillAmountRaw: 100_000_000n, tier: 2, reputation: rep })).toBe(105_000_000n); // 600-100 bps
  });

  it('create: sell = amount + maker bond; buy = taker bond', () => {
    const rep = { successful: 0n, riskPoints: 0n }; // neither discount nor penalty
    expect(computeCreateAllowance({ side: 'SELL_CRYPTO', totalAmountRaw: 100_000_000n, tier: 3, reputation: rep })).toBe(105_000_000n);
    expect(computeCreateAllowance({ side: 'BUY_CRYPTO', totalAmountRaw: 100_000_000n, tier: 3, reputation: rep })).toBe(5_000_000n);
  });

  it('uses the backend bondMap percentages when provided', () => {
    const bondMap = { 1: { maker: 5, taker: 6 } };
    expect(computeCreateAllowance({ side: 'SELL_CRYPTO', totalAmountRaw: 100n * 10n ** 6n, tier: 1, bondMap, reputation: { successful: 0n, riskPoints: 0n } })).toBe(105_000_000n);
  });

  it('is conservative (penalty, or highest tier) when reputation/tier are unknown', () => {
    expect(resolveAllowanceBondBps({ role: 'maker', tier: 1, reputation: null })).toBe(1100);
    expect(resolveAllowanceBondBps({ role: 'taker', tier: undefined, reputation: null })).toBe(1300);
  });
});
