import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import RewardsPanel from '../../frontend/src/app/contexts/profile/RewardsPanel';
import { batchRead, readRewardsSnapshot } from '../../frontend/src/hooks/useRewardsContract';
import { buildLabRewards } from '../ui-lab/fixtures/profileFixtures';

vi.mock('../../frontend/src/hooks/useRewardsContract', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useRewardsContract: () => ({ isConfigured: false, isSupportedChain: true }) };
});

afterEach(cleanup);

const REWARDS = '0x' + 'b'.repeat(40);
const USER = '0x' + '1'.repeat(40);
const TOKEN_A = '0x' + 'a'.repeat(40);
const TOKEN_B = '0x' + 'c'.repeat(40);
const DAY = 86400;

// Deterministic fake multicall: returns a value derived from the call so the layout can be verified.
const fakeResult = (c) => {
  switch (c.functionName) {
    case 'currentEpoch': return 3n;
    case 'epochDuration': return BigInt(30 * DAY);
    case 'claimDelay': return BigInt(DAY);
    case 'claimWindow': return BigInt(7 * DAY);
    case 'totalWeight': return 1000n + c.args[0];
    case 'userWeight': return 10n + c.args[0];
    case 'epochRewardPool': return 100n * c.args[0] + (c.args[1].toLowerCase() === TOKEN_A.toLowerCase() ? 1n : 2n);
    case 'epochTokenFinalized': return c.args[0] % 2n === 0n;
    case 'claimed': return c.args[0] === 3n;
    default: throw new Error(`unexpected ${c.functionName}`);
  }
};

const makeClient = ({ withMulticall3 = true } = {}) => ({
  chain: withMulticall3 ? { contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } } } : { contracts: {} },
  multicall: vi.fn(async ({ contracts }) => contracts.map(fakeResult)),
  readContract: vi.fn(async (c) => fakeResult(c)),
  getBlock: vi.fn(async () => ({ timestamp: 1_900_000_000n })),
});

describe('P4: rewards chain reads are batched', () => {
  it('reads timing, epochs, pools and claim state in two multicalls plus one block read', async () => {
    const client = makeClient();
    const snap = await readRewardsSnapshot(client, { address: REWARDS, user: USER, tokens: [TOKEN_A, TOKEN_B], epochsBack: 5 });

    expect(client.multicall).toHaveBeenCalledTimes(2);
    expect(client.readContract).not.toHaveBeenCalled();
    expect(client.getBlock).toHaveBeenCalledTimes(1);
    // 4 timing reads, then 4 epochs (3..0) x (2 weights + 2 tokens x 3).
    expect(client.multicall.mock.calls[0][0].contracts).toHaveLength(4);
    expect(client.multicall.mock.calls[1][0].contracts).toHaveLength(4 * (2 + 2 * 3));
    expect(client.multicall.mock.calls[1][0].allowFailure).toBe(false);

    expect(snap.current).toBe(3n);
    expect(snap.chainNow).toBe(1_900_000_000);
    expect(snap.timing).toEqual({ epochDuration: BigInt(30 * DAY), claimDelay: BigInt(DAY), claimWindow: BigInt(7 * DAY) });
    expect(snap.epochs.map((e) => e.epoch)).toEqual([3n, 2n, 1n, 0n]);
    const e2 = snap.epochs[1];
    expect(e2.totalWeight).toBe(1002n);
    expect(e2.userWeight).toBe(12n);
    expect(e2.tokens[0]).toMatchObject({ pool: 201n, finalized: true, claimed: false });
    expect(e2.tokens[1]).toMatchObject({ pool: 202n, finalized: true, claimed: false });
    expect(snap.epochs[0].tokens[0]).toMatchObject({ claimed: true, finalized: false });
  });

  it('falls back to per-call reads on chains without Multicall3', async () => {
    const client = makeClient({ withMulticall3: false });
    const snap = await readRewardsSnapshot(client, { address: REWARDS, user: USER, tokens: [TOKEN_A], epochsBack: 1 });
    expect(client.multicall).not.toHaveBeenCalled();
    expect(client.readContract).toHaveBeenCalled();
    expect(snap.epochs).toHaveLength(2);
  });

  it('batchRead of nothing makes no RPC call', async () => {
    const client = makeClient();
    expect(await batchRead(client, [])).toEqual([]);
    expect(client.multicall).not.toHaveBeenCalled();
  });
});

describe('P4: RewardsPanel', () => {
  it('does not refetch chain data when only the language changes', async () => {
    const lab = buildLabRewards({ hoursIntoEpoch: 72 });
    const currentEpoch = vi.spyOn(lab.reader, 'currentEpoch');
    const props = { address: USER, rewardsReader: lab.reader, fetchClaimHistory: lab.fetchClaimHistory, now: lab.now };
    const { rerender } = render(<RewardsPanel lang="EN" {...props} />);
    expect(await screen.findByTestId('rewards-claimable')).toBeInTheDocument();
    expect(currentEpoch).toHaveBeenCalledTimes(1);

    rerender(<RewardsPanel lang="TR" {...props} />);
    await screen.findByTestId('rewards-claimable');
    expect(currentEpoch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Barış ödülleri/)).toBeInTheDocument();
  });

  it('uses the batched snapshot and derives claim windows from chain time, not the browser clock', async () => {
    const epochEnd = 11 * 30 * DAY; // epoch 10 ended here
    const readSnapshot = vi.fn(async () => ({
      current: 11n,
      timing: { epochDuration: BigInt(30 * DAY), claimDelay: BigInt(DAY), claimWindow: BigInt(7 * DAY) },
      // Chain says: 2 days after epoch 10 ended -> claimable. The browser clock (2026) would say "expired".
      chainNow: epochEnd + 2 * DAY,
      epochs: [
        { epoch: 11n, totalWeight: 0n, userWeight: 0n, tokens: [{ token: TOKEN_A, pool: 0n, finalized: false, claimed: false }] },
        { epoch: 10n, totalWeight: 1000n, userWeight: 250n, tokens: [{ token: TOKEN_A, pool: 1_000_000_000n, finalized: true, claimed: false }] },
      ],
    }));
    const currentEpoch = vi.fn();
    const reader = {
      isConfigured: true,
      isSupportedChain: true,
      tokens: { USDT: TOKEN_A },
      readSnapshot,
      currentEpoch,
      claim: vi.fn(),
      finalizeEpochToken: vi.fn(),
    };

    render(<RewardsPanel lang="EN" address={USER} rewardsReader={reader} fetchClaimHistory={async () => []} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Claim' })).toBeInTheDocument());
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(readSnapshot).toHaveBeenCalledWith({ user: USER, tokens: [TOKEN_A], epochsBack: 5 });
    expect(currentEpoch).not.toHaveBeenCalled();
  });
});
