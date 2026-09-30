import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ESCROW = '0x00000000000000000000000000000000000000AA';
const WALLET = '0x00000000000000000000000000000000000000BB';

const readContract = vi.fn();
const walletWriteContract = vi.fn();
const waitForTransactionReceipt = vi.fn();
let accountState;
let configChainId;

vi.mock('wagmi', () => ({
  usePublicClient: () => ({ readContract, waitForTransactionReceipt }),
  useWalletClient: () => ({ data: { writeContract: walletWriteContract, account: { address: WALLET } } }),
  useChainId: () => configChainId,
  useAccount: () => accountState,
}));

const load = async () => {
  vi.resetModules();
  vi.stubEnv('VITE_ESCROW_ADDRESS', ESCROW);
  return import('../../frontend/src/hooks/useArafContract');
};

describe('resolveChainMismatch (F11)', () => {
  it('uses the wallet chain and the deployment chain, not the config chain', async () => {
    const { resolveChainMismatch } = await load();
    const supportedChains = { 8453: 'Base Mainnet', 84532: 'Base Sepolia' };
    expect(resolveChainMismatch({ walletChainId: 8453, supportedChains })).toBeNull();
    expect(resolveChainMismatch({ walletChainId: 1, supportedChains })).toContain('Chain ID 1');
    expect(resolveChainMismatch({ walletChainId: undefined, supportedChains })).toContain('Yanlış ağ');
    expect(resolveChainMismatch({ walletChainId: 84532, expectedChainId: 8453, supportedChains })).toContain('8453');
    expect(resolveChainMismatch({ walletChainId: 8453, expectedChainId: 8453, supportedChains })).toBeNull();
  });
});

describe('useArafContract wallet-chain guard (F11)', () => {
  beforeEach(() => {
    readContract.mockReset();
    walletWriteContract.mockReset();
    waitForTransactionReceipt.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(async () => ({ ok: true }));
    // config chain is a supported chain; the wallet is on a foreign one
    configChainId = 31337;
    accountState = { chainId: 1, address: WALLET };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('blocks writes when the wallet is on an unsupported chain even if useChainId() is supported', async () => {
    const { useArafContract } = await load();
    const { result } = renderHook(() => useArafContract());
    await expect(result.current.releaseFunds(1n)).rejects.toThrow('Chain ID 1');
    expect(walletWriteContract).not.toHaveBeenCalled();
  });

  it('blocks writes when the wallet chain differs from the deployment chain', async () => {
    accountState = { chainId: 31337, address: WALLET };
    const { useArafContract } = await load();
    const { result } = renderHook(() => useArafContract({ expectedChainId: 8453 }));
    await expect(result.current.releaseFunds(1n)).rejects.toThrow('8453');
    expect(walletWriteContract).not.toHaveBeenCalled();
  });

  it('allows writes when wallet chain is supported and matches the deployment', async () => {
    accountState = { chainId: 31337, address: WALLET };
    const hash = `0x${'ab'.repeat(32)}`;
    walletWriteContract.mockResolvedValue(hash);
    waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [] });
    const { useArafContract } = await load();
    const { result } = renderHook(() => useArafContract({ expectedChainId: 31337 }));
    await expect(result.current.releaseFunds(1n)).resolves.toMatchObject({ status: 'success' });
  });
});

describe('useArafContract read failures are not masked (F20)', () => {
  beforeEach(() => {
    readContract.mockReset();
    accountState = { chainId: 31337, address: WALLET };
    configChainId = 31337;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('getWalletRegisteredAt throws instead of returning 0n (which means unregistered)', async () => {
    readContract.mockRejectedValue(new Error('rpc down'));
    const { useArafContract } = await load();
    const { result } = renderHook(() => useArafContract());
    await expect(result.current.getWalletRegisteredAt(WALLET)).rejects.toThrow('rpc down');
  });

  it('getCooldownRemaining, getFirstSuccessfulTradeAt and getTakerFeeBps throw on RPC failure', async () => {
    readContract.mockRejectedValue(new Error('rpc down'));
    const { useArafContract } = await load();
    const { result } = renderHook(() => useArafContract());
    await expect(result.current.getCooldownRemaining(WALLET)).rejects.toThrow('rpc down');
    await expect(result.current.getFirstSuccessfulTradeAt(WALLET)).rejects.toThrow('rpc down');
    await expect(result.current.getTakerFeeBps()).rejects.toThrow('rpc down');
  });

  it('still returns real values on success', async () => {
    readContract.mockResolvedValueOnce(1234n).mockResolvedValueOnce([25n, 30n]);
    const { useArafContract } = await load();
    const { result } = renderHook(() => useArafContract());
    await expect(result.current.getWalletRegisteredAt(WALLET)).resolves.toBe(1234n);
    await expect(result.current.getTakerFeeBps()).resolves.toBe(25n);
  });
});

describe('pending tx record cleanup on write failure (F7)', () => {
  const hash = `0x${'cd'.repeat(32)}`;
  beforeEach(() => {
    localStorage.clear();
    walletWriteContract.mockReset();
    waitForTransactionReceipt.mockReset();
    accountState = { chainId: 31337, address: WALLET };
    configChainId = 31337;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(async () => ({ ok: true }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('drops the record when the tx reverts on chain', async () => {
    walletWriteContract.mockResolvedValue(hash);
    waitForTransactionReceipt.mockResolvedValue({ status: 'reverted', logs: [] });
    const { useArafContract } = await load();
    const { result } = renderHook(() => useArafContract());
    await expect(result.current.releaseFunds(1n)).rejects.toThrow(/reverted/);
    expect(localStorage.getItem('araf_pending_tx')).toBeNull();
  });

  it('drops this call record when waiting fails definitively', async () => {
    walletWriteContract.mockResolvedValue(hash);
    waitForTransactionReceipt.mockRejectedValue(new Error('replaced'));
    const { useArafContract } = await load();
    const { result } = renderHook(() => useArafContract());
    await expect(result.current.releaseFunds(1n)).rejects.toThrow('replaced');
    expect(localStorage.getItem('araf_pending_tx')).toBeNull();
  });

  it('keeps the record on a wait timeout (outcome unknown, recovery needs it)', async () => {
    walletWriteContract.mockResolvedValue(hash);
    const timeout = new Error('timed out');
    timeout.name = 'WaitForTransactionReceiptTimeoutError';
    waitForTransactionReceipt.mockRejectedValue(timeout);
    const { useArafContract } = await load();
    const { result } = renderHook(() => useArafContract());
    await expect(result.current.releaseFunds(1n)).rejects.toThrow('timed out');
    expect(JSON.parse(localStorage.getItem('araf_pending_tx')).hash).toBe(hash);
  });

  it('does not delete an older record when the wallet rejects before a hash exists', async () => {
    localStorage.setItem('araf_pending_tx', JSON.stringify({ hash: `0x${'ef'.repeat(32)}` }));
    walletWriteContract.mockRejectedValue(new Error('User rejected'));
    const { useArafContract } = await load();
    const { result } = renderHook(() => useArafContract());
    await expect(result.current.releaseFunds(1n)).rejects.toThrow('rejected');
    expect(localStorage.getItem('araf_pending_tx')).not.toBeNull();
  });
});
