import { describe, it, expect } from 'vitest';
import {
  normalizeV3Reputation,
  normalizeTokenDecimalsOrThrow,
  normalizeTradeIdOrThrow,
  normalizeMakerShareBpsOrThrow,
  normalizeUnixSecondsOrThrow,
} from '../../frontend/src/hooks/useArafContract';

describe('useArafContract V3 reputation normalization', () => {
  it('normalizes named V3 response fields without tuple assumptions', () => {
    const normalized = normalizeV3Reputation({
      successful: 10n,
      failed: 2n,
      bannedUntil: 0n,
      consecutiveBans: 1n,
      effectiveTier: 3n,
      manualReleaseCount: 4n,
      autoReleaseCount: 5n,
      mutualCancelCount: 6n,
      disputedResolvedCount: 7n,
      burnCount: 8n,
      disputeWinCount: 9n,
      disputeLossCount: 1n,
      partialSettlementCount: 12n,
      riskPoints: 44n,
      lastPositiveEventAt: 100n,
      lastNegativeEventAt: 90n,
    });

    expect(normalized?.riskPoints).toBe(44n);
    expect(normalized?.disputedResolvedCount).toBe(7n);
    expect(normalized?.partialSettlementCount).toBe(12n);
  });

  it('returns null for stale/malformed V3 shapes with missing fields', () => {
    const malformed = normalizeV3Reputation({
      successful: 10n,
      failed: 2n,
      bannedUntil: 0n,
      consecutiveBans: 1n,
      effectiveTier: 3n,
    });

    expect(malformed).toBeNull();
  });

  it('accepts 6 and 18 decimals for safe parsing', () => {
    expect(normalizeTokenDecimalsOrThrow(6)).toBe(6);
    expect(normalizeTokenDecimalsOrThrow(18)).toBe(18);
  });

  it('rejects missing/invalid decimals instead of fallback', () => {
    expect(() => normalizeTokenDecimalsOrThrow(0)).toThrow();
    expect(() => normalizeTokenDecimalsOrThrow(19)).toThrow();
    expect(() => normalizeTokenDecimalsOrThrow(undefined)).toThrow();
  });

  it('normalizes positive settlement trade IDs safely for BigInt-compatible writes', () => {
    expect(normalizeTradeIdOrThrow('1')).toBe(1n);
    expect(normalizeTradeIdOrThrow(1n)).toBe(1n);
    expect(normalizeTradeIdOrThrow('12345678901234567890')).toBe(12345678901234567890n);
  });

  it('normalizes non-trade settlement tx primitives safely', () => {
    expect(normalizeMakerShareBpsOrThrow('1500')).toBe(1500);
    expect(normalizeUnixSecondsOrThrow(1760000000.93)).toBe(1760000000n);
  });

  it('fails closed on zero, negative, missing, or malformed settlement trade IDs', () => {
    [0, '0', -1, '', null, undefined, 'invalid-id'].forEach((tradeId) => {
      expect(() => normalizeTradeIdOrThrow(tradeId)).toThrow('Geçersiz tradeId. Lütfen işlemi yenileyin.');
    });
  });

  it('fails closed on malformed non-trade settlement tx primitives', () => {
    expect(() => normalizeMakerShareBpsOrThrow(10001)).toThrow();
    expect(() => normalizeMakerShareBpsOrThrow(-1)).toThrow();
    expect(() => normalizeUnixSecondsOrThrow(0)).toThrow();
  });
});
