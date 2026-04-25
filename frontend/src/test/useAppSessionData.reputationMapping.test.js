import { describe, it, expect } from 'vitest';
import {
  mapReputationToSessionView,
  mapSettlementProposalFromApi,
  buildSettlementQuickCounts,
} from '../app/useAppSessionData';

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
      partialSettlementCount: 5n,
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
        partialSettlementCount: 5,
        riskPoints: 77,
      },
    });
  });

  it('returns null when contract reputation payload is missing', () => {
    expect(mapReputationToSessionView(null)).toBeNull();
  });

  it('maps backend settlement proposal payload into active trade safe shape', () => {
    const mapped = mapSettlementProposalFromApi({
      id: 1,
      proposer: '0xabc',
      state: 'PROPOSED',
    });
    expect(mapped).toMatchObject({
      id: 1,
      proposer: '0xabc',
      state: 'PROPOSED',
    });
  });

  it('computes settlement quick counts for action-required vs waiting lanes', () => {
    const activeEscrows = [
      { rawTrade: { settlementProposal: { state: 'PROPOSED', proposer: '0xmaker' } } },
      { rawTrade: { settlementProposal: { state: 'PROPOSED', proposer: '0xother' } } },
      { rawTrade: { settlementProposal: { state: 'REJECTED', proposer: '0xmaker' } } },
    ];

    const counts = buildSettlementQuickCounts(activeEscrows, '0xmaker');
    expect(counts).toStrictEqual({
      PROPOSED: 2,
      ACTION_REQUIRED: 1,
      WAITING: 1,
    });
  });
});
