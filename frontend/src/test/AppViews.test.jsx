import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildAppViews } from '../app/AppViews';

const baseCtx = {
  lang: 'EN',
  t: {},
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
  openSidebar: vi.fn(),
  handleAuthAction: vi.fn(),
  formatAddress: (a) => a,
  address: '0xabc',
  chainId: 84532,
  sidebarOpen: false,
  setSidebarOpen: vi.fn(),
  setExpandedStatus: vi.fn(),
  expandedStatus: null,
  sidebarTimerRef: { current: null },
  filterTier1: false,
  setFilterTier1: vi.fn(),
  filterToken: 'ALL',
  setFilterToken: vi.fn(),
  searchAmount: '',
  setSearchAmount: vi.fn(),
  filteredOrders: [],
  orders: [],
  activeEscrows: [],
  loading: false,
  SUPPORTED_TOKEN_ADDRESSES: { USDT: '0x1', USDC: '0x2' },
  handleStartTrade: vi.fn(),
  handleMint: vi.fn(),
  handleOpenMakerModal: vi.fn(),
  activeEscrowCounts: { LOCKED: 0, PAID: 0, CHALLENGED: 0 },
  setShowProfileModal: vi.fn(),
  setProfileTab: vi.fn(),
  setShowFeedbackModal: vi.fn(),
  protocolStats: {},
  statsLoading: false,
  statsError: false,
  fetchStats: vi.fn(),
  StatChange: () => null,
  userReputation: { effectiveTier: 3 },
  sybilStatus: { funded: true, cooldownOk: true, cooldownRemaining: 0 },
  walletAgeRemainingDays: null,
  takerFeeBps: 10,
  socialLinks: {},
  faqItems: [],
  activeTrade: null,
  setActiveTrade: vi.fn(),
  userRole: 'taker',
  setUserRole: vi.fn(),
  tradeState: 'LOCKED',
  setTradeState: vi.fn(),
  resolvedTradeState: 'LOCKED',
  setCancelStatus: vi.fn(),
  setChargebackAccepted: vi.fn(),
  paymentIpfsHash: '',
  setPaymentIpfsHash: vi.fn(),
  handleFileUpload: vi.fn(),
  handleReportPayment: vi.fn(),
  handleProposeCancel: vi.fn(),
  cancelStatus: null,
  chargebackAccepted: false,
  handleChargebackAck: vi.fn(),
  handleRelease: vi.fn(),
  handleChallenge: vi.fn(),
  handlePingMaker: vi.fn(),
  handleAutoRelease: vi.fn(),
  canMakerPing: false,
  makerPingTimer: {},
  canMakerStartChallengeFlow: false,
  makerChallengePingTimer: {},
  canMakerChallenge: false,
  makerChallengeTimer: {},
  gracePeriodTimer: {},
  bleedingTimer: { isFinished: true, hours: 0, minutes: 0, seconds: 0 },
  principalProtectionTimer: { isFinished: true, days: 0, hours: 0 },
  bleedingAmounts: null,
  takerName: '',
  tokenDecimalsMap: { USDT: 6 },
  DEFAULT_TOKEN_DECIMALS: 6,
  formatTokenAmountFromRaw: () => '0',
  rawTokenToDisplayNumber: () => 0,
  fetchMyTrades: vi.fn(),
  setIsContractLoading: vi.fn(),
  getSafeTelegramUrl: () => '#',
  authenticatedFetch: vi.fn(),
  showToast: vi.fn(),
};

describe('AppViews market side-aware rendering', () => {
  it('keeps admin entry reachable for authenticated users even when VITE_ADMIN_WALLETS is empty', () => {
    const previous = import.meta.env.VITE_ADMIN_WALLETS;
    import.meta.env.VITE_ADMIN_WALLETS = '';
    try {
      const views = buildAppViews({
        ...baseCtx,
        isConnected: true,
        isAuthenticated: true,
      });
      render(<div>{views.renderSlimRail()}</div>);
      expect(screen.getByTitle('Admin Observability (server-authorized)')).toBeInTheDocument();
    } finally {
      import.meta.env.VITE_ADMIN_WALLETS = previous;
    }
  });

  it('renders side badge and side CTA labels', () => {
    const views = buildAppViews({
      ...baseCtx,
      filteredOrders: [
        {
          id: '1',
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
          limitLabel: 'Min Fill 10 USDT • Remaining 50 USDT',
          tier: 1,
          ownerSideHint: 'Order owner is selling crypto',
          tokenPolicy: { supported: true, allowSellOrders: true, allowBuyOrders: true },
        },
        {
          id: '2',
          side: 'BUY_CRYPTO',
          sideLabel: 'Buy Order',
          ctaLabel: 'Sell',
          statusLabel: 'Open',
          bondLabel: '10%',
          maker: '0xowner',
          makerFull: '0xowner',
          rate: 34,
          fiat: 'TRY',
          crypto: 'USDT',
          minFillAmount: 5,
          limitLabel: 'Min Fill 5 USDT • Remaining 20 USDT',
          tier: 1,
          ownerSideHint: 'Order owner is buying crypto',
          tokenPolicy: { supported: true, allowSellOrders: true, allowBuyOrders: true },
        },
      ],
      orders: [{ crypto: 'USDT' }],
    });

    render(<div>{views.renderMarket()}</div>);

    expect(screen.getAllByText('Sell Order').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Buy Order').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Buy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sell/i })).toBeInTheDocument();
    expect(screen.getAllByText('ORDER OWNER SUMMARY').length).toBeGreaterThan(0);
    expect(screen.getByText('Order owner is selling crypto')).toBeInTheDocument();
    expect(screen.getByText('Order owner is buying crypto')).toBeInTheDocument();
    expect(screen.queryByText('SELLER PROFILE')).not.toBeInTheDocument();
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Bond/i).length).toBeGreaterThan(0);
  });

  it('shows explicit empty-state instead of broken trade room when activeTrade is missing', async () => {
    const user = userEvent.setup();
    const setCurrentView = vi.fn();
    const fetchMyTrades = vi.fn();
    const views = buildAppViews({
      ...baseCtx,
      currentView: 'tradeRoom',
      activeTrade: null,
      setCurrentView,
      fetchMyTrades,
    });

    render(<div>{views.renderTradeRoom()}</div>);

    expect(screen.getByText(/No active trade found/i)).toBeInTheDocument();
    expect(screen.queryByText(/0.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/COUNTERPARTY/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Go to Marketplace/i }));
    expect(setCurrentView).toHaveBeenCalledWith('market');
  });
});
