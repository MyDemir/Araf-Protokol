import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { buildAppViews } from '../../frontend/src/app/AppViews';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const baseCtx = {
  lang: 'EN',
  setLang: vi.fn(),
  isConnected: true,
  isAuthenticated: true,
  isLoggingIn: false,
  isContractLoading: false,
  loadingText: '',
  isPaused: false,
  authChecked: true,
  currentView: 'market',
  setCurrentView: vi.fn(),
  toggleSidebar: vi.fn(),
  handleAuthAction: vi.fn(),
  formatAddress: (a) => a,
  address: '0xabc',
  chainId: 84532,
  sidebarOpen: true,
  setSidebarOpen: vi.fn(),
  setExpandedStatus: vi.fn(),
  expandedStatus: null,
  marketFilters: { side: 'ALL', token: 'ALL', amount: '', fiat: 'ALL', tier: 'ALL', sort: 'AUTO', hideOwn: false },
  setMarketFilter: vi.fn(),
  resetMarketFilters: vi.fn(),
  filteredOrders: [],
  orders: [],
  activeEscrows: [],
  loading: false,
  SUPPORTED_TOKEN_ADDRESSES: { USDT: '0x1', USDC: '0x2' },
  handleStartTrade: vi.fn(),
  handleMint: vi.fn(),
  isFaucetEnabled: false,
  isSupportedChainId: () => true,
  handleOpenMakerModal: vi.fn(),
  activeEscrowCounts: { LOCKED: 0, PAID: 0, CHALLENGED: 0 },
  protocolStats: {},
  userReputation: { effectiveTier: 3 },
  sybilStatus: { aged: true, funded: true, cooldownOk: true, cooldownRemaining: 0 },
  fullscreen: { isStandalone: true },
};

const makeOrder = (over = {}) => ({
  id: 'o1',
  side: 'SELL_CRYPTO',
  sideLabel: 'Sell Order',
  ctaLabel: 'Buy',
  statusLabel: 'Open',
  bondLabel: '8%',
  maker: '0xmaker',
  makerFull: '0xmaker',
  rate: 33,
  fiat: 'TRY',
  crypto: 'USDT',
  minFillAmount: 10,
  remainingAmount: 50,
  tier: 1,
  trustSummary: { available: false, band: null, label: 'n/a', chipClass: 'text-textMuted' },
  paymentRiskSignal: null,
  ...over,
});

const renderMarketWith = (ctx) => {
  const views = buildAppViews({ ...baseCtx, ...ctx });
  return render(<div>{views.renderMarket()}</div>);
};

const blockedSybil = { aged: false, funded: false, cooldownOk: false, cooldownRemaining: 3600 };

describe('F13: taker entry gates apply by order direction', () => {
  it('does not block filling a BUY order (filler is the maker) with a young, unfunded, cooling-down wallet', () => {
    renderMarketWith({
      sybilStatus: blockedSybil,
      filteredOrders: [makeOrder({ id: 'b1', side: 'BUY_CRYPTO', sideLabel: 'Buy Order', ctaLabel: 'Sell' })],
    });
    const cta = screen.getByRole('button', { name: 'Sell' });
    expect(cta).toBeEnabled();
    expect(screen.queryByText(/Low balance|Wallet too new|min$/i)).not.toBeInTheDocument();
  });

  it('keeps the tier lock on BUY orders', () => {
    renderMarketWith({
      userReputation: { effectiveTier: 1 },
      sybilStatus: blockedSybil,
      filteredOrders: [makeOrder({ id: 'b2', side: 'BUY_CRYPTO', ctaLabel: 'Sell', tier: 3 })],
    });
    const cta = screen.getByRole('button', { name: /Tier 3 required/i });
    expect(cta).toBeDisabled();
  });

  it('blocks filling a SELL order with a too-young wallet', () => {
    renderMarketWith({
      sybilStatus: { aged: false, funded: true, cooldownOk: true, cooldownRemaining: 0 },
      filteredOrders: [makeOrder()],
    });
    const cta = screen.getByRole('button', { name: /Wallet too new/i });
    expect(cta).toBeDisabled();
  });

  it('blocks filling a SELL order with a dust balance', () => {
    renderMarketWith({
      sybilStatus: { aged: true, funded: false, cooldownOk: true, cooldownRemaining: 0 },
      filteredOrders: [makeOrder()],
    });
    expect(screen.getByRole('button', { name: /Low balance/i })).toBeDisabled();
  });

  it('blocks a Tier 0/1 SELL order during cooldown but not a Tier 2+ one', () => {
    renderMarketWith({
      sybilStatus: { aged: true, funded: true, cooldownOk: false, cooldownRemaining: 600 },
      filteredOrders: [
        makeOrder({ id: 's1', tier: 1, maker: '0xm1', makerFull: '0xm1' }),
        makeOrder({ id: 's2', tier: 2, maker: '0xm2', makerFull: '0xm2' }),
      ],
    });
    expect(screen.getByRole('button', { name: /10 min/i })).toBeDisabled();
    const enabled = screen.getAllByRole('button', { name: 'Buy' });
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toBeEnabled();
  });

  it('enables a SELL order for an eligible wallet', () => {
    renderMarketWith({ filteredOrders: [makeOrder()] });
    expect(screen.getByRole('button', { name: 'Buy' })).toBeEnabled();
  });
});

describe('F19.5: admin entry follows the server answer', () => {
  const adminTitle = /Admin (Panel|Observability)/;
  const renderRail = (ctx) => {
    const views = buildAppViews({ ...baseCtx, ...ctx });
    return render(<div>{views.renderSlimRail()}</div>);
  };

  it('hides the admin entry when the server says the wallet is not an admin', () => {
    renderRail({ isAdmin: false });
    expect(screen.queryByTitle(adminTitle)).not.toBeInTheDocument();
  });

  it('shows the admin entry when the server says the wallet is an admin, even without env list', () => {
    vi.stubEnv('VITE_ADMIN_WALLETS', '');
    renderRail({ isAdmin: true });
    expect(screen.getByTitle(/Admin Panel \(Settlement analytics/)).toBeInTheDocument();
  });

  it('server answer beats a matching env list', () => {
    vi.stubEnv('VITE_ADMIN_WALLETS', '0xabc');
    renderRail({ isAdmin: false });
    expect(screen.queryByTitle(adminTitle)).not.toBeInTheDocument();
  });

  it('without a server answer a non-empty env list narrows the entry to listed wallets', () => {
    vi.stubEnv('VITE_ADMIN_WALLETS', '0xdef');
    renderRail({});
    expect(screen.queryByTitle(adminTitle)).not.toBeInTheDocument();
  });

  it('without a server answer and a matching env list the entry is shown', () => {
    vi.stubEnv('VITE_ADMIN_WALLETS', '0xABC, 0xdef');
    renderRail({});
    expect(screen.getByTitle(/Admin Panel \(Settlement analytics/)).toBeInTheDocument();
  });

  it('never shows the entry when signed out', () => {
    renderRail({ isAdmin: true, isAuthenticated: false });
    expect(screen.queryByTitle(adminTitle)).not.toBeInTheDocument();
  });
});

describe('P2: inline components keep their identity across renders', () => {
  it('keeps the same DOM node (and focus) for market segmented tabs when the view re-renders', () => {
    const first = buildAppViews({ ...baseCtx });
    const { rerender } = render(<div>{first.renderMarket()}</div>);
    const tab = screen.getByRole('tab', { name: 'Buy' });
    tab.focus();
    expect(document.activeElement).toBe(tab);

    rerender(<div>{buildAppViews({ ...baseCtx }).renderMarket()}</div>);

    expect(screen.getByRole('tab', { name: 'Buy' })).toBe(tab);
    expect(document.activeElement).toBe(tab);
  });

  it('keeps the same DOM node (and focus) for drawer rows when the view re-renders', () => {
    const first = buildAppViews({ ...baseCtx });
    const { rerender } = render(<div>{first.renderContextSidebar()}</div>);
    const row = screen.getByRole('button', { name: /USDT/ });
    row.focus();
    expect(document.activeElement).toBe(row);

    rerender(<div>{buildAppViews({ ...baseCtx }).renderContextSidebar()}</div>);

    expect(screen.getByRole('button', { name: /USDT/ })).toBe(row);
    expect(document.activeElement).toBe(row);
  });
});
