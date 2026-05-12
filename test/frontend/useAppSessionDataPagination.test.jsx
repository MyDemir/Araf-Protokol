import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useAppSessionData } from '../../frontend/src/app/useAppSessionData';

const ADDRESS = '0xabc';

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const makeTrade = (index) => ({
  _id: `trade-${index}`,
  onchain_escrow_id: String(1000 + index),
  maker_address: ADDRESS,
  taker_address: `0xtaker${String(index).padStart(4, '0')}`,
  status: index % 3 === 0 ? 'PAID' : index % 3 === 1 ? 'LOCKED' : 'CHALLENGED',
  financials: {
    crypto_amount: '1000000',
    crypto_asset: 'USDT',
    fiat_currency: 'TRY',
    exchange_rate: 33,
  },
  timers: {},
  chargeback_ack: { acknowledged: true },
});

const makeOrder = (index) => ({
  _id: `order-${index}`,
  onchain_order_id: String(2000 + index),
  owner_address: ADDRESS,
  side: index % 2 === 0 ? 'SELL_CRYPTO' : 'BUY_CRYPTO',
  status: 'OPEN',
  tier: 0,
  market: {
    crypto_asset: 'USDT',
    fiat_currency: 'TRY',
    exchange_rate: 33,
  },
  amounts: {
    min_fill_amount: '1000000',
    remaining_amount: '1000000',
    min_fill_amount_num: 1,
    remaining_amount_num: 1,
  },
  stats: { fills_count: 0 },
});

const baseProps = {
  address: ADDRESS,
  isConnected: true,
  connector: null,
  chainId: 84532,
  publicClient: null,
  currentView: 'home',
  showProfileModal: false,
  profileTab: 'ayarlar',
  lang: 'EN',
  isContractLoading: false,
  setShowMakerModal: vi.fn(),
  setShowProfileModal: vi.fn(),
  setCurrentView: vi.fn(),
  showToast: vi.fn(),
  getTakerFeeBps: undefined,
  getTokenDecimals: undefined,
  getCurrentAmounts: undefined,
  getWalletRegisteredAt: undefined,
  getReputation: undefined,
  getFirstSuccessfulTradeAt: undefined,
  antiSybilCheck: undefined,
  getCooldownRemaining: undefined,
  getPaused: undefined,
  SUPPORTED_TOKEN_ADDRESSES: { USDT: '', USDC: '' },
  filterTier1: false,
  filterToken: 'ALL',
  searchAmount: '',
};

const HookHarness = () => {
  const state = useAppSessionData({
    ...baseProps,
    connectedWallet: ADDRESS,
  });

  return (
    <div>
      <div data-testid="active-escrows-count">{state.activeEscrows.length}</div>
      <div data-testid="paid-count">{state.activeEscrowCounts.PAID}</div>
      <div data-testid="my-orders-count">{state.myOrders.length}</div>
    </div>
  );
};

const installPaginatedFetch = ({ trades, orders }) => {
  global.fetch = vi.fn(async (url) => {
    const parsed = new URL(String(url), 'http://localhost');
    const path = parsed.pathname;
    const page = Number(parsed.searchParams.get('page') || 1);
    const limit = Number(parsed.searchParams.get('limit') || 20);

    if (path.endsWith('/api/auth/me')) return response({ wallet: ADDRESS });
    if (path.endsWith('/api/orders/config')) return response({});
    if (path.endsWith('/api/stats')) return response({ stats: {} });

    if (path.endsWith('/api/trades/my')) {
      const start = (page - 1) * limit;
      return response({ trades: trades.slice(start, start + limit), total: trades.length, page, limit });
    }

    if (path.endsWith('/api/orders/my')) {
      const start = (page - 1) * limit;
      return response({ orders: orders.slice(start, start + limit), total: orders.length, page, limit });
    }

    if (path.endsWith('/api/orders')) return response({ orders: [] });

    return response({});
  });
};

describe('useAppSessionData paginated backend reads', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('fetches all trades/my pages and derives active escrow state from the combined 55 trades', async () => {
    const trades = Array.from({ length: 55 }, (_, i) => makeTrade(i + 1));
    const orders = [];
    installPaginatedFetch({ trades, orders });

    render(<HookHarness />);

    await waitFor(() => expect(screen.getByTestId('active-escrows-count').textContent).toBe('55'));
    expect(screen.getByTestId('paid-count').textContent).toBe(String(trades.filter((t) => t.status === 'PAID').length));

    const tradeUrls = global.fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/api/trades/my'));
    expect(tradeUrls).toEqual(expect.arrayContaining([
      expect.stringContaining('trades/my?page=1&limit=50'),
      expect.stringContaining('trades/my?page=2&limit=50'),
    ]));
  });

  it('fetches all orders/my pages without expanding the public marketplace orders request', async () => {
    const trades = [];
    const orders = Array.from({ length: 55 }, (_, i) => makeOrder(i + 1));
    installPaginatedFetch({ trades, orders });

    render(<HookHarness />);

    await waitFor(() => expect(screen.getByTestId('my-orders-count').textContent).toBe('55'));

    const myOrderUrls = global.fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/api/orders/my'));
    expect(myOrderUrls).toEqual(expect.arrayContaining([
      expect.stringContaining('orders/my?page=1&limit=50'),
      expect.stringContaining('orders/my?page=2&limit=50'),
    ]));

    const publicOrderUrls = global.fetch.mock.calls.map(([url]) => String(url)).filter((url) => {
      const parsed = new URL(url, 'http://localhost');
      return parsed.pathname.endsWith('/api/orders');
    });
    expect(publicOrderUrls.every((url) => !url.includes('page=') && !url.includes('limit='))).toBe(true);
  });
});
