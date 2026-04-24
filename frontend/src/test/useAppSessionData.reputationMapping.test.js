import { describe, it, expect } from 'vitest';
import { mapReputationToSessionView } from '../app/useAppSessionData';

describe('useAppSessionData V3 reputation mapping', () => {
  it('maps V3 authority counters into frontend-friendly session state', () => {
    const mapped = mapReputationToSessionView({
      successful: 11n,
      failed: 1n,
      bannedUntil: 12n,
      consecutiveBans: 2n,
      effectiveTier: 3n,
      manualReleaseCount: 4n,
      autoReleaseCount: 5n,
      mutualCancelCount: 6n,
      disputedResolvedCount: 7n,
      burnCount: 8n,
      disputeWinCount: 9n,
      disputeLossCount: 10n,
      riskPoints: 77n,
      lastPositiveEventAt: 123n,
      lastNegativeEventAt: 122n,
    }, 999n);

    expect(mapped).toMatchObject({
      successful: 11,
      effectiveTier: 3,
      firstSuccessfulTradeAt: 999,
      authorityCounters: {
        manualReleaseCount: 4,
        disputedResolvedCount: 7,
        riskPoints: 77,
      },
    });
  });

  it('returns null when contract reputation payload is missing', () => {
    expect(mapReputationToSessionView(null)).toBeNull();
  });
});
