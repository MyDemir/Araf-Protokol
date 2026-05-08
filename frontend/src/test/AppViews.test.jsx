import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildAppViews } from '../app/AppViews';

afterEach(() => cleanup());

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
  toggleSidebar: vi.fn(),
  handleAuthAction: vi.fn(),
  formatAddress: (a) => a,
  address: '0xabc',
  chainId: 84532,
  sidebarOpen: false,
  setSidebarOpen: vi.fn(),
  setExpandedStatus: vi.fn(),
  expandedStatus: null,
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
  isFaucetEnabled: true,
  isSupportedChainId: () => true,
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
  it('security_prod_mode_hides_test_faucet_buttons', () => {
    const views = buildAppViews({
      ...baseCtx,
      isFaucetEnabled: false,
    });

    render(<div>{views.renderMarket()}</div>);
    expect(screen.queryByText(/Get Test USDT|Test USDT Al/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Get Test USDC|Test USDC Al/i)).not.toBeInTheDocument();
  });

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
      expect(screen.getByTitle('Admin Observability (server-authorized, read-only)')).toBeInTheDocument();
    } finally {
      import.meta.env.VITE_ADMIN_WALLETS = previous;
    }
  });


  it('renders desktop UI Lab nav entry only when uiLabEnabled is true', async () => {
    const user = userEvent.setup();
    const enabledSetCurrentView = vi.fn();
    const enabledViews = buildAppViews({
      ...baseCtx,
      uiLabEnabled: true,
      setCurrentView: enabledSetCurrentView,
    });
    const enabledRender = render(<div>{enabledViews.renderSlimRail()}</div>);

    const labButton = screen.getByTitle('UI Lab');
    expect(labButton).toBeInTheDocument();
    await user.click(labButton);
    expect(enabledSetCurrentView).toHaveBeenCalledWith('uiLab');
    enabledRender.unmount();

    const disabledViews = buildAppViews({
      ...baseCtx,
      uiLabEnabled: false,
    });
    render(<div>{disabledViews.renderSlimRail()}</div>);
    expect(screen.queryByTitle('UI Lab')).not.toBeInTheDocument();
  });

  it('renders mobile UI Lab nav entry only when uiLabEnabled is true', () => {
    const enabledViews = buildAppViews({
      ...baseCtx,
      uiLabEnabled: true,
    });
    const enabledRender = render(<div>{enabledViews.renderMobileNav()}</div>);
    expect(screen.getByLabelText('UI Lab')).toBeInTheDocument();
    enabledRender.unmount();

    const disabledViews = buildAppViews({
      ...baseCtx,
      uiLabEnabled: false,
    });
    render(<div>{disabledViews.renderMobileNav()}</div>);
    expect(screen.queryByLabelText('UI Lab')).not.toBeInTheDocument();
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
          trustSummary: {
            available: true,
            band: 'YELLOW',
            label: 'Medium Signal',
            chipClass: 'text-amber-400 border-amber-700/60 bg-amber-900/20',
          },
          paymentRiskSignal: {
            riskLevel: 'MEDIUM',
            enabled: true,
            minBondSurchargeBps: 0,
            feeSurchargeBps: 0,
            warningKey: 'BANK_TRANSFER_CONFIRMATION_REQUIRED',
            description: { EN: 'x', TR: 'y' },
          },
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
          trustSummary: {
            available: false,
            band: null,
            label: 'Signal unavailable',
            chipClass: 'text-slate-400 border-slate-700/60 bg-slate-900/20',
          },
          paymentRiskSignal: null,
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
    expect(screen.getAllByText(/Trust Visibility|Güven Görünürlüğü/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/YELLOW · Medium Signal/i)).toBeInTheDocument();
    expect(screen.getByText(/Signal unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/maker_profile_changed_after_lock/i)).not.toBeInTheDocument();
    expect(screen.queryByText('SELLER PROFILE')).not.toBeInTheDocument();
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Bond/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Payment complexity/i).length).toBe(1);
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.queryByText(/minBondSurchargeBps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/feeSurchargeBps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/warningKey/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/BANK_TRANSFER_CONFIRMATION_REQUIRED/i)).not.toBeInTheDocument();
  });


  it('renders dictionary order-side labels when market cards receive raw enums without display fields', () => {
    const views = buildAppViews({
      ...baseCtx,
      filteredOrders: [
        {
          id: 'raw-sell',
          side: 'SELL_CRYPTO',
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
          trustSummary: { available: false, band: null, label: 'Signal unavailable', chipClass: 'text-slate-400' },
          paymentRiskSignal: null,
          tokenPolicy: { supported: true, allowSellOrders: true, allowBuyOrders: true },
        },
        {
          id: 'raw-buy',
          side: 'BUY_CRYPTO',
          statusLabel: 'Open',
          bondLabel: '10%',
          maker: '0xbuyer',
          makerFull: '0xbuyer',
          rate: 34,
          fiat: 'TRY',
          crypto: 'USDT',
          minFillAmount: 5,
          limitLabel: 'Min Fill 5 USDT • Remaining 20 USDT',
          tier: 1,
          trustSummary: { available: false, band: null, label: 'Signal unavailable', chipClass: 'text-slate-400' },
          paymentRiskSignal: null,
          tokenPolicy: { supported: true, allowSellOrders: true, allowBuyOrders: true },
        },
      ],
      orders: [{ crypto: 'USDT' }],
    });

    render(<div>{views.renderMarket()}</div>);

    expect(screen.getAllByText('Sell Order').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Buy Order').length).toBeGreaterThan(0);
    expect(screen.queryByText('SELL_CRYPTO')).not.toBeInTheDocument();
    expect(screen.queryByText('BUY_CRYPTO')).not.toBeInTheDocument();
  });


  it('toggles the desktop sidebar open and closed from the rail filter button', async () => {
    const user = userEvent.setup();

    const SidebarHarness = () => {
      const [sidebarOpen, setSidebarOpen] = React.useState(false);
      const views = buildAppViews({
        ...baseCtx,
        sidebarOpen,
        toggleSidebar: () => setSidebarOpen(prev => !prev),
        setSidebarOpen,
        activeEscrows: [],
      });
      return <div>{views.renderSlimRail()}{views.renderContextSidebar()}</div>;
    };

    const { container } = render(<SidebarHarness />);
    const filtersButton = within(container).getByTitle('Filters');

    expect(container.querySelector('[class*="w-0"][class*="opacity-0"]')).not.toBeNull();
    await user.click(filtersButton);
    expect(container.querySelector('[class*="w-[260px]"][class*="opacity-100"]')).not.toBeNull();
    await user.click(filtersButton);
    expect(container.querySelector('[class*="w-0"][class*="opacity-0"]')).not.toBeNull();
  });


  it('keeps an explicit sidebar close path when the contextual sidebar is open', async () => {
    const user = userEvent.setup();
    const setSidebarOpen = vi.fn();
    const views = buildAppViews({
      ...baseCtx,
      sidebarOpen: true,
      setSidebarOpen,
      activeEscrows: [],
    });

    const { container } = render(<div>{views.renderContextSidebar()}</div>);
    const mobileOverlay = container.querySelector('[class*="md:hidden"][class*="inset-0"]');

    expect(mobileOverlay).not.toBeNull();
    await user.click(mobileOverlay);
    expect(setSidebarOpen).toHaveBeenCalledWith(false);
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
    expect(screen.queryByText(/^COUNTERPARTY$/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Go to Marketplace/i }));
    expect(setCurrentView).toHaveBeenCalledWith('market');
  });


  it('renders passive trade decision disabled reasons with the real chain policy and a disabled panel report button', () => {
    const views = buildAppViews({
      ...baseCtx,
      currentView: 'tradeRoom',
      activeTrade: { id: 'trade-1', onchainId: 1, max: 100, fiat: 'TRY', crypto: 'USDT', rate: 10, maker: '0xmaker' },
      resolvedTradeState: 'LOCKED',
      tradeState: 'LOCKED',
      userRole: 'taker',
      paymentIpfsHash: '',
      chargebackAccepted: false,
      isSupportedChainId: () => false,
      gracePeriodTimer: { isFinished: false, hours: 1, minutes: 2, seconds: 3 },
    });

    render(<div>{views.renderTradeRoom()}</div>);

    expect(screen.getAllByText('Unsupported network.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Payment proof is required.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Chargeback acknowledgement is required.')).not.toBeInTheDocument();
    expect(screen.getByText('Timers')).toBeInTheDocument();
    expect(screen.getByText('01h 02m 03s')).toBeInTheDocument();
    const primaryGuidance = screen.getByTestId('trade-primary-guidance');
    expect(within(primaryGuidance).getByRole('button', { name: /Report Payment/i })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /Report Payment/i })).toHaveLength(2);
  });



  it('wires executable guidance panel callbacks without using settlement functions', async () => {
    const user = userEvent.setup();
    const handleReportPayment = vi.fn();
    const proposeSettlement = vi.fn();
    const acceptSettlement = vi.fn();
    const rejectSettlement = vi.fn();
    const withdrawSettlement = vi.fn();
    const expireSettlement = vi.fn();
    const views = buildAppViews({
      ...baseCtx,
      currentView: 'tradeRoom',
      activeTrade: { id: 'trade-5', onchainId: 5, max: 100, fiat: 'TRY', crypto: 'USDT', rate: 10, maker: '0xmaker' },
      resolvedTradeState: 'LOCKED',
      tradeState: 'LOCKED',
      userRole: 'taker',
      paymentIpfsHash: 'proof-hash',
      chargebackAccepted: false,
      handleReportPayment,
      proposeSettlement,
      acceptSettlement,
      rejectSettlement,
      withdrawSettlement,
      expireSettlement,
    });

    render(<div>{views.renderTradeRoom()}</div>);
    await user.click(within(screen.getByTestId('trade-primary-guidance')).getByRole('button', { name: /Report Payment/i }));

    expect(handleReportPayment).toHaveBeenCalledTimes(1);
    expect(proposeSettlement).not.toHaveBeenCalled();
    expect(acceptSettlement).not.toHaveBeenCalled();
    expect(rejectSettlement).not.toHaveBeenCalled();
    expect(withdrawSettlement).not.toHaveBeenCalled();
    expect(expireSettlement).not.toHaveBeenCalled();
  });

  it('disables every executable guidance button on the wrong chain', () => {
    const views = buildAppViews({
      ...baseCtx,
      currentView: 'tradeRoom',
      activeTrade: { id: 'trade-3', onchainId: 3, max: 100, fiat: 'TRY', crypto: 'USDT', rate: 10, maker: '0xmaker' },
      resolvedTradeState: 'PAID',
      tradeState: 'PAID',
      userRole: 'maker',
      chargebackAccepted: true,
      canMakerStartChallengeFlow: true,
      isSupportedChainId: () => false,
    });

    render(<div>{views.renderTradeRoom()}</div>);

    const panelButtons = [
      ...within(screen.getByTestId('trade-primary-guidance')).getAllByRole('button'),
      ...within(screen.getByTestId('trade-secondary-guidance')).getAllByRole('button'),
    ];
    expect(panelButtons.length).toBeGreaterThan(0);
    panelButtons.forEach((button) => expect(button).toBeDisabled());
    expect(screen.getAllByText('Unsupported network.').length).toBeGreaterThan(0);
  });


  it('keeps maker release blocked by chargeback acknowledgement in PAID state', () => {
    const views = buildAppViews({
      ...baseCtx,
      currentView: 'tradeRoom',
      activeTrade: { id: 'trade-release', onchainId: 44, max: 100, fiat: 'TRY', crypto: 'USDT', rate: 10, maker: '0xmaker' },
      resolvedTradeState: 'PAID',
      tradeState: 'PAID',
      userRole: 'maker',
      chargebackAccepted: false,
      canMakerStartChallengeFlow: true,
      isSupportedChainId: () => true,
    });

    render(<div>{views.renderTradeRoom()}</div>);

    const primaryGuidance = screen.getByTestId('trade-primary-guidance');
    expect(within(primaryGuidance).getByRole('button', { name: /Release Funds/i })).toBeDisabled();
    expect(screen.getAllByText('Chargeback acknowledgement is required.').length).toBeGreaterThan(0);
  });

  it('disables executable guidance buttons when on-chain trade ID is missing', () => {
    const views = buildAppViews({
      ...baseCtx,
      currentView: 'tradeRoom',
      activeTrade: { id: 'trade-4', max: 100, fiat: 'TRY', crypto: 'USDT', rate: 10, maker: '0xmaker' },
      resolvedTradeState: 'LOCKED',
      tradeState: 'LOCKED',
      userRole: 'taker',
      paymentIpfsHash: 'proof-hash',
      chargebackAccepted: true,
    });

    render(<div>{views.renderTradeRoom()}</div>);

    const primaryGuidance = screen.getByTestId('trade-primary-guidance');
    expect(within(primaryGuidance).getByRole('button', { name: /Report Payment/i })).toBeDisabled();
    expect(screen.getAllByText('Missing on-chain trade ID.').length).toBeGreaterThan(0);
  });

  it('renders CHALLENGED passive settlement guidance without introducing settlement action buttons', () => {
    const proposeSettlement = vi.fn();
    const acceptSettlement = vi.fn();
    const rejectSettlement = vi.fn();
    const withdrawSettlement = vi.fn();
    const expireSettlement = vi.fn();
    const views = buildAppViews({
      ...baseCtx,
      currentView: 'tradeRoom',
      activeTrade: { id: 'trade-2', onchainId: 2, max: 100, fiat: 'TRY', crypto: 'USDT', rate: 10, maker: '0xmaker' },
      resolvedTradeState: 'CHALLENGED',
      tradeState: 'CHALLENGED',
      userRole: 'maker',
      proposeSettlement,
      acceptSettlement,
      rejectSettlement,
      withdrawSettlement,
      expireSettlement,
    });

    render(<div>{views.renderTradeRoom()}</div>);

    expect(screen.getByText(/Araf is not an arbitrator/i)).toBeInTheDocument();
    expect(screen.getByText(/Follow settlement steps from the existing settlement card/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settlement guidance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /propose settlement|accept settlement|reject settlement|withdraw settlement|expire settlement/i })).not.toBeInTheDocument();
    expect(proposeSettlement).not.toHaveBeenCalled();
    expect(acceptSettlement).not.toHaveBeenCalled();
    expect(rejectSettlement).not.toHaveBeenCalled();
    expect(withdrawSettlement).not.toHaveBeenCalled();
    expect(expireSettlement).not.toHaveBeenCalled();
  });

  it('does not render payment complexity badge when all orders have null paymentRiskSignal', () => {
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
          trustSummary: { available: false, band: null, label: 'Signal unavailable', chipClass: 'text-slate-400' },
          paymentRiskSignal: null,
          tokenPolicy: { supported: true, allowSellOrders: true, allowBuyOrders: true },
        },
      ],
      orders: [{ crypto: 'USDT' }],
    });

    render(<div>{views.renderMarket()}</div>);
    expect(screen.queryAllByText(/Payment complexity/i)).toHaveLength(0);
  });
});
