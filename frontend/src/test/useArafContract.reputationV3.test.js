import { describe, it, expect } from 'vitest';
import {
  normalizeV3Reputation,
  normalizeTokenDecimalsOrThrow,
  normalizeTradeIdOrThrow,
  normalizeMakerShareBpsOrThrow,
  normalizeUnixSecondsOrThrow,
} from '../hooks/useArafContract';

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
      riskPoints: 44n,
      lastPositiveEventAt: 100n,
      lastNegativeEventAt: 90n,
    });

    expect(normalized?.riskPoints).toBe(44n);
    expect(normalized?.disputedResolvedCount).toBe(7n);
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

  it('normalizes settlement tx primitives safely for BigInt-compatible writes', () => {
    expect(normalizeTradeIdOrThrow('42')).toBe(42n);
    expect(normalizeMakerShareBpsOrThrow('1500')).toBe(1500);
    expect(normalizeUnixSecondsOrThrow(1760000000.93)).toBe(1760000000n);
  });

  it('fails closed on malformed settlement tx primitives', () => {
    expect(() => normalizeTradeIdOrThrow('invalid-id')).toThrow();
    expect(() => normalizeMakerShareBpsOrThrow(10001)).toThrow();
    expect(() => normalizeMakerShareBpsOrThrow(-1)).toThrow();
    expect(() => normalizeUnixSecondsOrThrow(0)).toThrow();
  });
});
