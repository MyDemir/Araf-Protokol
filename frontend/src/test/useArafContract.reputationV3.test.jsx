import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockReadContract = vi.fn();

vi.mock('wagmi', () => ({
  usePublicClient: () => ({ readContract: mockReadContract }),
  useWalletClient: () => ({ data: null }),
  useChainId: () => 84532,
}));

vi.mock('viem', () => ({
  parseAbi: (x) => x,
  getAddress: (x) => x,
  decodeEventLog: vi.fn(),
}));

describe('useArafContract getReputation V3 mapping', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_ESCROW_ADDRESS', '0x1234567890123456789012345678901234567890');
  });

  it('returns normalized V3 named reputation fields', async () => {
    mockReadContract.mockResolvedValue({
      successfulTrades: 11n,
      failedDisputes: 2n,
      bannedUntil: 0n,
      consecutiveBans: 1n,
      effectiveTier: 3n,
      manualReleaseCount: 5n,
      autoReleaseCount: 1n,
      mutualCancelCount: 2n,
      disputedResolvedCount: 3n,
      burnCount: 0n,
      disputeWinCount: 1n,
      disputeLossCount: 1n,
      riskPoints: 12n,
      lastPositiveEventAt: 100n,
      lastNegativeEventAt: 200n,
    });

    const { useArafContract } = await import('../hooks/useArafContract');
    const { result } = renderHook(() => useArafContract());
    const rep = await result.current.getReputation('0xabc');

    expect(rep).toEqual({
      successful: 11n,
      failed: 2n,
      bannedUntil: 0n,
      consecutiveBans: 1n,
      effectiveTier: 3,
      manualReleaseCount: 5n,
      autoReleaseCount: 1n,
      mutualCancelCount: 2n,
      disputedResolvedCount: 3n,
      burnCount: 0n,
      disputeWinCount: 1n,
      disputeLossCount: 1n,
      riskPoints: 12n,
      lastPositiveEventAt: 100n,
      lastNegativeEventAt: 200n,
    });
  });

  it('normalizes tuple-style payloads returned by some clients', async () => {
    mockReadContract.mockResolvedValue([
      11n, 2n, 0n, 1n, 3n,
      5n, 1n, 2n, 3n, 0n,
      1n, 1n, 12n, 100n, 200n,
    ]);

    const { useArafContract } = await import('../hooks/useArafContract');
    const { result } = renderHook(() => useArafContract());
    const rep = await result.current.getReputation('0xabc');

    expect(rep).toEqual({
      successful: 11n,
      failed: 2n,
      bannedUntil: 0n,
      consecutiveBans: 1n,
      effectiveTier: 3,
      manualReleaseCount: 5n,
      autoReleaseCount: 1n,
      mutualCancelCount: 2n,
      disputedResolvedCount: 3n,
      burnCount: 0n,
      disputeWinCount: 1n,
      disputeLossCount: 1n,
      riskPoints: 12n,
      lastPositiveEventAt: 100n,
      lastNegativeEventAt: 200n,
    });
  });
});
