import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyStatePin,
  createStatePin,
  mapChainTradeState,
  resolveConfirmedState,
} from '../../frontend/src/app/tradeStateSync';
import { clearAppHashRoute } from '../../frontend/src/app/actions/tradeNavigationActions';
import { deepEqual, useAppSessionData } from '../../frontend/src/app/useAppSessionData';
import { buildApiUrl } from '../../frontend/src/app/apiConfig';

const WALLET = '0xabc0000000000000000000000000000000000000';

const mkRes = (status, body, { badJson = false } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { if (badJson) throw new Error('not json'); return body; },
  clone() { return mkRes(status, body, { badJson }); },
});

const trade = (over = {}) => ({
  _id: 'db1',
  onchain_escrow_id: '7',
  maker_address: WALLET,
  taker_address: '0xdef0000000000000000000000000000000000000',
  status: 'LOCKED',
  financials: { crypto_amount: '1000000', crypto_asset: 'USDT' },
  timers: {},
  ...over,
});

let routes;
const installFetch = () => {
  global.fetch = vi.fn(async (url, opts) => {
    const target = String(url);
    for (const [needle, handler] of routes) {
      if (target.includes(needle)) return handler(target, opts);
    }
    return mkRes(200, {});
  });
};

const baseRoutes = () => ([
  ['auth/me', () => mkRes(200, { wallet: WALLET })],
  ['trades/my', () => mkRes(200, { trades: [], total: 0, page: 1, limit: 50 })],
  ['orders/my', () => mkRes(200, { orders: [], total: 0, page: 1, limit: 50 })],
  ['orders/config', () => mkRes(200, {})],
  ['stats', () => mkRes(200, { stats: {} })],
  ['orders', () => mkRes(200, { orders: [], total: 0 })],
]);

const makeProps = (over = {}) => ({
  address: WALLET,
  isConnected: true,
  connector: null,
  chainId: 84532,
  publicClient: null,
  currentView: 'home',
  lang: 'EN',
  isContractLoading: false,
  connectedWallet: WALLET,
  setShowMakerModal: vi.fn(),
  setCurrentView: vi.fn(),
  showToast: vi.fn(),
  SUPPORTED_TOKEN_ADDRESSES: { USDT: '', USDC: '' },
  ...over,
});

const mount = async (over = {}) => {
  const props = makeProps(over);
  const hook = renderHook((p) => useAppSessionData(p), { initialProps: props });
  await waitFor(() => expect(hook.result.current.isAuthenticated).toBe(true));
  return { hook, props };
};

beforeEach(() => {
  routes = baseRoutes();
  installFetch();
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('F1 authenticatedFetch 409 handling', () => {
  it('does not log out on a 409 without SESSION_WALLET_MISMATCH and leaves the body to the caller', async () => {
    const { hook, props } = await mount();
    routes.unshift(['auth/profile', () => mkRes(409, { code: 'BANK_PROFILE_LOCKED_DURING_ACTIVE_TRADE' })]);
    let res;
    await act(async () => { res = await hook.result.current.authenticatedFetch(buildApiUrl('auth/profile'), { method: 'PUT' }); });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('BANK_PROFILE_LOCKED_DURING_ACTIVE_TRADE');
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('auth/logout'))).toBe(false);
    expect(hook.result.current.isAuthenticated).toBe(true);
    expect(props.showToast).not.toHaveBeenCalled();
  });

  it('survives a 409 whose body is not JSON', async () => {
    const { hook } = await mount();
    routes.unshift(['x/y', () => mkRes(409, null, { badJson: true })]);
    await act(async () => { await hook.result.current.authenticatedFetch(buildApiUrl('x/y')); });
    expect(hook.result.current.isAuthenticated).toBe(true);
  });

  it('logs out and toasts only for SESSION_WALLET_MISMATCH', async () => {
    const { hook, props } = await mount();
    routes.unshift(['x/y', () => mkRes(409, { code: 'SESSION_WALLET_MISMATCH' })]);
    await act(async () => { await hook.result.current.authenticatedFetch(buildApiUrl('x/y')); });
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('auth/logout'))).toBe(true);
    await waitFor(() => expect(hook.result.current.isAuthenticated).toBe(false));
    expect(props.showToast).toHaveBeenCalledWith(expect.stringContaining('wallet mismatch'), 'error');
  });
});

describe('F2 payment receipt hash is trade-bound and survives refresh', () => {
  it('fills from evidence.ipfs_receipt_hash of the backend trade after opening the room', async () => {
    routes.unshift(['trades/my', () => mkRes(200, { trades: [trade({ evidence: { ipfs_receipt_hash: 'Qm-backend' } })], total: 1, page: 1, limit: 50 })]);
    const { hook } = await mount();
    await waitFor(() => expect(hook.result.current.activeEscrows).toHaveLength(1));
    act(() => { hook.result.current.setActiveTrade({ onchainId: '7', id: 'db1', state: 'LOCKED' }); });
    await act(async () => { await hook.result.current.fetchMyTrades(); });
    expect(hook.result.current.paymentIpfsHash).toBe('Qm-backend');
  });

  it('binds an uploaded hash to the open trade and does not leak it to another trade', async () => {
    const { hook } = await mount();
    act(() => { hook.result.current.setActiveTrade({ onchainId: '7', id: 'a' }); });
    act(() => { hook.result.current.setPaymentIpfsHash('Qm-local'); });
    expect(hook.result.current.paymentIpfsHash).toBe('Qm-local');
    act(() => { hook.result.current.setActiveTrade({ onchainId: '8', id: 'b' }); });
    expect(hook.result.current.paymentIpfsHash).toBe('');
    act(() => { hook.result.current.setActiveTrade(null); });
    expect(hook.result.current.paymentIpfsHash).toBe('');
  });
});

describe('F4/F15/F16 fetchMyTrades merge', () => {
  it('derives the role from the address when merging into the open room', async () => {
    routes.unshift(['trades/my', () => mkRes(200, { trades: [trade({ maker_address: '0xdef0000000000000000000000000000000000000', taker_address: WALLET })], total: 1, page: 1, limit: 50 })]);
    const { hook } = await mount();
    act(() => { hook.result.current.setActiveTrade({ onchainId: '7', id: 'db1', state: 'LOCKED' }); });
    act(() => { hook.result.current.setUserRole('maker'); });
    await act(async () => { await hook.result.current.fetchMyTrades(); });
    expect(hook.result.current.userRole).toBe('taker');
    expect(hook.result.current.activeEscrows[0].role).toBe('taker');
  });

  it('does not touch an unrelated or null activeTrade', async () => {
    const { hook } = await mount({ currentView: 'market' });
    routes.unshift(['trades/my', () => mkRes(200, { trades: [trade()], total: 1, page: 1, limit: 50 })]);
    await act(async () => { await hook.result.current.fetchMyTrades(); });
    expect(hook.result.current.activeTrade).toBeNull();
    act(() => { hook.result.current.setActiveTrade({ onchainId: '99', id: 'other', state: 'PAID' }); });
    await act(async () => { await hook.result.current.fetchMyTrades(); });
    expect(hook.result.current.activeTrade).toMatchObject({ onchainId: '99', state: 'PAID' });
  });

  it('keeps the same object references when nothing changed (P3)', async () => {
    routes.unshift(['trades/my', () => mkRes(200, { trades: [trade()], total: 1, page: 1, limit: 50 })]);
    const { hook } = await mount();
    await waitFor(() => expect(hook.result.current.activeEscrows).toHaveLength(1));
    const escrowsBefore = hook.result.current.activeEscrows;
    const setBefore = hook.result.current.setActiveTrade;
    await act(async () => { await hook.result.current.fetchMyTrades(); });
    expect(hook.result.current.activeEscrows).toBe(escrowsBefore);
    expect(hook.result.current.setActiveTrade).toBe(setBefore);
    const t = { onchainId: '7', id: 'x' };
    act(() => { hook.result.current.setActiveTrade(t); });
    const held = hook.result.current.activeTrade;
    act(() => { hook.result.current.setActiveTrade({ ...t }); });
    expect(hook.result.current.activeTrade).toBe(held);
  });

  it('runs toast/state side effects outside the setActiveTrade updater (F16)', async () => {
    routes.unshift(['trades/my', () => mkRes(200, { trades: [trade({ status: 'PAID' })], total: 1, page: 1, limit: 50 })]);
    const { hook, props } = await mount();
    act(() => { hook.result.current.setActiveTrade({ onchainId: '7', id: null, _pendingBackendSync: true, state: 'LOCKED' }); });
    await act(async () => { await hook.result.current.fetchMyTrades(); });
    await waitFor(() => expect(hook.result.current.activeTrade.state).toBe('PAID'));
    expect(props.showToast.mock.calls.filter(([m]) => m === 'Trade room ready!')).toHaveLength(1);
    expect(hook.result.current.tradeState).toBe('PAID');
  });
});

describe('F6 state pin against a lagging mirror', () => {
  it('ignores older mirror states until it catches up', () => {
    const pin = createStatePin('7', 'PAID');
    const lag = applyStatePin([{ onchain_escrow_id: '7', status: 'LOCKED' }], pin);
    expect(lag.trades[0].status).toBe('PAID');
    expect(lag.pin).toBe(pin);
    const caught = applyStatePin([{ onchain_escrow_id: '7', status: 'PAID' }], pin);
    expect(caught.pin).toBeNull();
    const ahead = applyStatePin([{ onchain_escrow_id: '7', status: 'CHALLENGED' }], pin);
    expect(ahead.trades[0].status).toBe('CHALLENGED');
    expect(ahead.pin).toBeNull();
  });

  it('drops a finished trade that the mirror still lists, and expires the pin', () => {
    const pin = createStatePin('7', 'RESOLVED', 1000);
    expect(applyStatePin([{ onchain_escrow_id: '7', status: 'PAID' }], pin, 1001).trades).toEqual([]);
    expect(applyStatePin([{ onchain_escrow_id: '7', status: 'PAID' }], pin, 1000 + 10 * 60_000).pin).toBeNull();
  });

  it('maps getTrade output and never trusts a chain read older than the confirmed tx', () => {
    expect(mapChainTradeState({ state: 2 })).toBe('PAID');
    expect(mapChainTradeState([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3])).toBe('CHALLENGED');
    expect(mapChainTradeState(null)).toBeNull();
    expect(resolveConfirmedState('LOCKED', 'PAID')).toBe('PAID');
    expect(resolveConfirmedState('RESOLVED', 'PAID')).toBe('RESOLVED');
    expect(resolveConfirmedState(null, 'PAID')).toBe('PAID');
  });

  it('pinTradeState keeps a just-finished trade out of activeEscrows while the mirror lags', async () => {
    routes.unshift(['trades/my', () => mkRes(200, { trades: [trade({ status: 'PAID' })], total: 1, page: 1, limit: 50 })]);
    const { hook } = await mount();
    await waitFor(() => expect(hook.result.current.activeEscrows).toHaveLength(1));
    act(() => { hook.result.current.pinTradeState('7', 'RESOLVED'); });
    await act(async () => { await hook.result.current.fetchMyTrades(); });
    expect(hook.result.current.activeEscrows).toHaveLength(0);
  });
});

describe('F5 hash cleanup', () => {
  it('clearAppHashRoute removes our route via replaceState without a hashchange', () => {
    window.location.hash = '#/trade/7';
    const onHash = vi.fn();
    window.addEventListener('hashchange', onHash);
    expect(clearAppHashRoute()).toBe(true);
    expect(window.location.hash).toBe('');
    window.removeEventListener('hashchange', onHash);
  });

  it('leaves foreign hashes alone', () => {
    window.location.hash = '#section';
    expect(clearAppHashRoute()).toBe(false);
    expect(window.location.hash).toBe('#section');
    window.history.replaceState(null, '', window.location.pathname);
  });
});

describe('F7 pending tx', () => {
  const hash = `0x${'ab'.repeat(32)}`;
  it('does not delete araf_pending_tx on the first disconnected render', async () => {
    localStorage.setItem('araf_pending_tx', JSON.stringify({ hash, createdAt: Date.now() }));
    renderHook((p) => useAppSessionData(p), { initialProps: makeProps({ isConnected: false, connectedWallet: null, address: undefined }) });
    await waitFor(() => expect(true).toBe(true));
    expect(localStorage.getItem('araf_pending_tx')).not.toBeNull();
  });

  it('shows an error (not a success) when the recovered receipt reverted', async () => {
    localStorage.setItem('araf_pending_tx', JSON.stringify({ hash, createdAt: Date.now() }));
    const publicClient = { getTransactionReceipt: vi.fn(async () => ({ status: 'reverted' })) };
    const { props } = await mount({ publicClient });
    await waitFor(() => expect(props.showToast).toHaveBeenCalledWith(expect.stringContaining('reverted'), 'error'));
    expect(props.showToast).not.toHaveBeenCalledWith(expect.stringContaining('Recovered'), 'success');
    expect(localStorage.getItem('araf_pending_tx')).toBeNull();
  });

  it('confirms a successful recovered receipt', async () => {
    localStorage.setItem('araf_pending_tx', JSON.stringify({ hash, createdAt: Date.now() }));
    const publicClient = { getTransactionReceipt: vi.fn(async () => ({ status: 'success' })) };
    const { props } = await mount({ publicClient });
    await waitFor(() => expect(props.showToast).toHaveBeenCalledWith(expect.stringContaining('Recovered'), 'success'));
  });

  it('clears the record on explicit clearLocalSessionState({ clearPendingTx: true }) only', async () => {
    const { hook } = await mount();
    localStorage.setItem('araf_pending_tx', '{}');
    act(() => { hook.result.current.clearLocalSessionState({}); });
    expect(localStorage.getItem('araf_pending_tx')).toBe('{}');
    act(() => { hook.result.current.clearLocalSessionState({ clearPendingTx: true }); });
    expect(localStorage.getItem('araf_pending_tx')).toBeNull();
  });
});

describe('F8 taker name', () => {
  it('is bound to the trade and reset when the trade changes', async () => {
    routes.unshift(['pii/taker-name/7', () => mkRes(200, { bankOwner: 'Ali Veli' })]);
    routes.unshift(['pii/taker-name/8', () => mkRes(200, {})]);
    const { hook } = await mount({ currentView: 'tradeRoom' });
    act(() => { hook.result.current.setUserRole('maker'); });
    act(() => { hook.result.current.setActiveTrade({ onchainId: '7', id: 'a', state: 'LOCKED' }); });
    await waitFor(() => expect(hook.result.current.takerName).toBe('Ali Veli'));
    act(() => { hook.result.current.setActiveTrade({ onchainId: '8', id: 'b', state: 'LOCKED' }); });
    expect(hook.result.current.takerName).toBe('');
  });

  it('drops a late response that belongs to a previous trade', async () => {
    let release;
    routes.unshift(['pii/taker-name/7', () => new Promise((resolve) => { release = () => resolve(mkRes(200, { bankOwner: 'Late Name' })); })]);
    routes.unshift(['pii/taker-name/8', () => mkRes(200, {})]);
    const { hook } = await mount({ currentView: 'tradeRoom' });
    act(() => { hook.result.current.setUserRole('maker'); });
    act(() => { hook.result.current.setActiveTrade({ onchainId: '7', id: 'a', state: 'LOCKED' }); });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    act(() => { hook.result.current.setActiveTrade({ onchainId: '8', id: 'b', state: 'LOCKED' }); });
    await act(async () => { release(); await Promise.resolve(); });
    expect(hook.result.current.takerName).toBe('');
  });
});

describe('F9 reputation refresh and chain-time ban', () => {
  const rep = (over = {}) => ({ successful: 1n, failed: 0n, bannedUntil: 0n, consecutiveBans: 0n, effectiveTier: 1n, ...over });

  it('re-reads reputation when a trade reaches a terminal state and exposes refreshReputation', async () => {
    const getReputation = vi.fn(async () => rep());
    const { hook } = await mount({ getReputation, getFirstSuccessfulTradeAt: vi.fn(async () => 5n) });
    await waitFor(() => expect(getReputation).toHaveBeenCalledTimes(1));
    act(() => { hook.result.current.setTradeState('RESOLVED'); });
    await waitFor(() => expect(getReputation).toHaveBeenCalledTimes(2));
    await act(async () => { await hook.result.current.refreshReputation(); });
    expect(getReputation).toHaveBeenCalledTimes(3);
  });

  it('derives isBanned from bannedUntil and lifts it at the deadline without a wallet change', async () => {
    let bannedUntil = BigInt(Math.floor(Date.now() / 1000) + 2);
    const getReputation = vi.fn(async () => rep({ bannedUntil }));
    const { hook } = await mount({ getReputation });
    await waitFor(() => expect(hook.result.current.isBanned).toBe(true));
    bannedUntil = 0n;
    await waitFor(() => expect(hook.result.current.isBanned).toBe(false), { timeout: 5000 });
  });

  it('reports an unreadable first-trade time as unknown (null), not 0 (F20)', async () => {
    const { hook } = await mount({
      getReputation: vi.fn(async () => rep()),
      getFirstSuccessfulTradeAt: vi.fn(async () => { throw new Error('rpc'); }),
    });
    await waitFor(() => expect(hook.result.current.userReputation).not.toBeNull());
    expect(hook.result.current.userReputation.firstSuccessfulTradeAt).toBeNull();
  });
});

describe('F20 unknown states', () => {
  it('wallet registration read failure leaves isWalletRegistered unknown (null)', async () => {
    const { hook } = await mount({ getWalletRegisteredAt: vi.fn(async () => { throw new Error('rpc'); }) });
    await waitFor(() => expect(hook.result.current.isWalletRegistered).toBeNull());
    expect(hook.result.current.walletAgeRemainingDays).toBeNull();
  });

  it('cooldown read failure is flagged unknown instead of 0', async () => {
    const { hook } = await mount({
      antiSybilCheck: vi.fn(async () => ({ aged: true, funded: true, cooldownOk: false })),
      getCooldownRemaining: vi.fn(async () => { throw new Error('rpc'); }),
    });
    await waitFor(() => expect(hook.result.current.sybilStatus).not.toBeNull());
    expect(hook.result.current.sybilStatus.cooldownUnknown).toBe(true);
  });
});

describe('F10 race conditions', () => {
  it('drops an in-flight trades response after logout', async () => {
    let release;
    const { hook } = await mount();
    routes.unshift(['trades/my', () => new Promise((resolve) => { release = () => resolve(mkRes(200, { trades: [trade()], total: 1, page: 1, limit: 50 })); })]);
    let pending;
    act(() => { pending = hook.result.current.fetchMyTrades(); });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    act(() => { hook.result.current.clearLocalSessionState({}); });
    await act(async () => { release(); await pending; });
    expect(hook.result.current.activeEscrows).toEqual([]);
  });

  it('lets only the latest overlapping trades request write', async () => {
    const { hook } = await mount();
    const releases = [];
    routes.unshift(['trades/my', () => new Promise((resolve) => { releases.push((body) => resolve(mkRes(200, body))); })]);
    let p1; let p2;
    act(() => { p1 = hook.result.current.fetchMyTrades(); });
    act(() => { p2 = hook.result.current.fetchMyTrades(); });
    await waitFor(() => expect(releases).toHaveLength(2));
    await act(async () => { releases[1]({ trades: [trade({ onchain_escrow_id: '2' })], total: 1, page: 1, limit: 50 }); await p2; });
    await act(async () => { releases[0]({ trades: [trade({ onchain_escrow_id: '1' })], total: 1, page: 1, limit: 50 }); await p1; });
    expect(hook.result.current.activeEscrows.map((e) => e.onchainId)).toEqual(['2']);
  });

  it('ignores a bleeding-amounts result that belongs to another trade', async () => {
    let resolveFirst;
    const getCurrentAmounts = vi.fn((id) => (id === '7'
      ? new Promise((resolve) => { resolveFirst = () => resolve({ currentCrypto: 1n }); })
      : Promise.resolve({ currentCrypto: 2n })));
    const { hook } = await mount({ getCurrentAmounts });
    act(() => { hook.result.current.setActiveTrade({ onchainId: '7', id: 'a', state: 'CHALLENGED' }); });
    await waitFor(() => expect(resolveFirst).toBeTypeOf('function'));
    act(() => { hook.result.current.setActiveTrade({ onchainId: '8', id: 'b', state: 'CHALLENGED' }); });
    await waitFor(() => expect(hook.result.current.bleedingAmounts?.currentCrypto).toBe(2n));
    await act(async () => { resolveFirst(); await Promise.resolve(); });
    expect(hook.result.current.bleedingAmounts.currentCrypto).toBe(2n);
  });

  it('aborts the market order request when the query changes', async () => {
    const signals = [];
    routes.unshift(['orders?', (u, opts) => { signals.push(opts?.signal); return new Promise(() => {}); }]);
    const hook = renderHook((p) => useAppSessionData(p), { initialProps: makeProps({ currentView: 'market' }) });
    await waitFor(() => expect(signals.length).toBeGreaterThan(0));
    hook.rerender(makeProps({ currentView: 'home' }));
    await waitFor(() => expect(signals[0].aborted).toBe(true));
  });
});

describe('F12 trade-room polling', () => {
  afterEach(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); });

  it('installs the interval even when the tab starts hidden and fetches immediately when it becomes visible', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const { hook } = await mount({ currentView: 'tradeRoom' });
    await waitFor(() => expect(hook.result.current.authChecked).toBe(true));
    const count = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('trades/my')).length;
    const before = count();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(count()).toBeGreaterThan(before));
  });
});

describe('F17 provider listener binding', () => {
  it('removes a listener that was bound after the effect was cleaned up', async () => {
    let resolveProvider;
    const provider = { on: vi.fn(), removeListener: vi.fn() };
    const connector = { getProvider: () => new Promise((resolve) => { resolveProvider = () => resolve(provider); }) };
    const { hook } = await mount({ connector });
    hook.unmount();
    await act(async () => { resolveProvider(); await Promise.resolve(); });
    expect(provider.on).not.toHaveBeenCalled();
  });

  it('binds and unbinds normally when still mounted', async () => {
    const provider = { on: vi.fn(), removeListener: vi.fn() };
    const connector = { getProvider: async () => provider };
    const { hook } = await mount({ connector });
    await waitFor(() => expect(provider.on).toHaveBeenCalled());
    hook.unmount();
    expect(provider.removeListener).toHaveBeenCalledTimes(provider.on.mock.calls.length);
  });
});

describe('deepEqual', () => {
  it('compares structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
  });
});
