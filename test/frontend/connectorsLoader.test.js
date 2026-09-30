import { describe, it, expect, vi } from 'vitest';
import { loadConnectorsSafely, renderFatalReload } from '../../frontend/src/app/connectorsLoader';
import { readRewardsSnapshot } from '../../frontend/src/hooks/useRewardsContract';

const logger = () => ({ error: vi.fn() });
const mod = () => ({ injected: vi.fn(() => 'inj'), coinbaseWallet: vi.fn(() => 'cb') });

describe('main.jsx connector loading resilience', () => {
  it('returns all connectors on success', async () => {
    expect(await loadConnectorsSafely(async () => mod(), logger())).toEqual(['inj', 'cb']);
  });

  it('retries with injected only when the first load fails', async () => {
    const log = logger();
    const importer = vi.fn().mockRejectedValueOnce(new Error('chunk 404')).mockResolvedValueOnce(mod());
    expect(await loadConnectorsSafely(importer, log)).toEqual(['inj']);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('continues with no connectors when the chunk never loads', async () => {
    const log = logger();
    expect(await loadConnectorsSafely(async () => { throw new Error('x'); }, log)).toEqual([]);
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('renders a reload message into the container', () => {
    const el = document.createElement('div');
    renderFatalReload(el);
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector('button')).not.toBeNull();
  });

  it('main.jsx catches bootstrap failures', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/main.jsx'), 'utf8');
    expect(src).toMatch(/bootstrap\(\)\.catch/);
  });
});

describe('readRewardsSnapshot clock fallback flag', () => {
  const addr = '0x' + 'b'.repeat(40);
  const client = (getBlock) => ({
    chain: { contracts: { multicall3: {} } },
    multicall: async ({ contracts }) => contracts.map((c) => (c.functionName === 'epochTokenFinalized' || c.functionName === 'claimed' ? false : 0n)),
    getBlock,
  });
  const args = { address: addr, user: '0x' + '1'.repeat(40), tokens: ['0x' + 'a'.repeat(40)], epochsBack: 0 };

  it('warns and flags usingBrowserClock when getBlock fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const snap = await readRewardsSnapshot(client(async () => { throw new Error('rpc down'); }), args);
    expect(snap.chainNow).toBeNull();
    expect(snap.usingBrowserClock).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not flag when chain time is available', async () => {
    const snap = await readRewardsSnapshot(client(async () => ({ timestamp: 5n })), args);
    expect(snap.usingBrowserClock).toBe(false);
    expect(snap.chainNow).toBe(5);
  });
});
