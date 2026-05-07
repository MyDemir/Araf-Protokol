import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import AppShell from '../app/shell/AppShell';
import { SystemStatusBar } from '../app/shell/SystemStatusBar';
import { buildAppViews } from '../app/AppViews';
import { buildOperationsContextModel } from '../app/contexts/operations/operationsContextModel';
import OperationsCenterPage from '../app/contexts/operations/OperationsCenterPage';
import ActiveTradesPanel from '../app/contexts/profile/ActiveTradesPanel';
import { buildGoToTradeRoomAction } from '../app/actions/tradeNavigationActions';
import { isSupportedChainId } from '../app/chainPolicy';
import { buildTradeDecisionModel } from '../app/contexts/trade-room/tradeDecisionModel';
import TradeRoomPage from '../app/contexts/trade-room/TradeRoomPage';
import { getOrderSideCopy } from '../app/orderUiModel';
import PaymentRiskBadge from '../components/PaymentRiskBadge';
import { APP_THEME_STORAGE_KEY, getInitialThemeMode } from '../app/bootstrapState';
import { ThemeProvider, useThemeMode } from '../app/providers/ThemeProvider';

afterEach(() => cleanup());


describe('start trade action extraction regression', () => {
  it('keeps taker start-trade orchestration outside App.jsx while preserving AppViews wiring', () => {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    expect(appSource).toMatch(/import \{[^}]*buildStartTradeAction[^}]*\} from '\.\/app\/providers\/ContractActionProvider';/);
    expect(appSource).toContain('const handleStartTrade = React.useMemo(() => buildStartTradeAction({');
    expect(appSource).not.toMatch(/const\s+handleStartTrade\s*=\s*async/);
    expect(appSource).not.toContain('childListingRef');
    expect(appSource).toContain('handleStartTrade,');
  });
});

const baseViewCtx = {
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
  activeEscrowCounts: { LOCKED: 0, PAID: 0, CHALLENGED: 0, settlement: {} },
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

const makeTransitionSetters = () => ({
  setActiveTrade: vi.fn(),
  setUserRole: vi.fn(),
  setTradeState: vi.fn(),
  setChargebackAccepted: vi.fn(),
  setCurrentView: vi.fn(),
  setSidebarOpen: vi.fn(),
  setShowProfileModal: vi.fn(),
});

describe('frontend transition regression invariants', () => {
  it('migration_app_shell_routing_keeps_status_and_outlet_in_normal_flow', () => {
    render(
      <div className="flex flex-col h-screen">
        <AppShell
          status={{ isPaused: true, lang: 'EN' }}
          navigation={<nav aria-label="transition nav">Nav</nav>}
          panel={<aside>Panel</aside>}
          outlet={<main data-testid="route-outlet"><button>Market route</button></main>}
        />
      </div>,
    );

    expect(screen.getByTestId('system-status-bar')).toBeInTheDocument();
    expect(screen.getByTestId('route-outlet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Market route/i })).toBeVisible();

    const statusSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/shell/SystemStatusBar.jsx'), 'utf8');
    expect(statusSource).not.toMatch(/fixed[\s\S]*top-0|top-0[\s\S]*fixed/);
  });

  it('migration_system_status_bar_covers_wrong_chain_paused_auth_and_pending_sync_states', () => {
    render(
      <SystemStatusBar
        isConnected
        authChecked
        isAuthenticated={false}
        isSupportedChain={false}
        supportedChains={{ 8453: 'Base' }}
        isPaused
        activeTrade={{ _pendingBackendSync: true }}
      />,
    );

    const statusBar = screen.getByTestId('system-status-bar');
    expect(within(statusBar).getByText(/Unsupported Network/i)).toBeInTheDocument();
    expect(within(statusBar).getByText(/Protocol in Maintenance/i)).toBeInTheDocument();
    expect(within(statusBar).getByText(/Session Verification Required/i)).toBeInTheDocument();
    expect(within(statusBar).getByText(/Trade Sync Pending/i)).toBeInTheDocument();
  });

  it('migration_sidebar_can_toggle_open_and_closed_on_desktop_without_timer_contract', async () => {
    const user = userEvent.setup();
    const SidebarHarness = () => {
      const [sidebarOpen, setSidebarOpen] = React.useState(false);
      const views = buildAppViews({
        ...baseViewCtx,
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar: () => setSidebarOpen((v) => !v),
      });
      return <>{views.renderSlimRail()}{views.renderContextSidebar()}</>;
    };

    render(<SidebarHarness />);
    const toggle = screen.getByTitle('Filters');
    expect(toggle).toHaveClass('text-slate-500');

    await user.click(toggle);
    expect(screen.getByTitle('Filters')).toHaveClass('text-white');

    await user.click(screen.getByTitle('Filters'));
    expect(screen.getByTitle('Filters')).toHaveClass('text-slate-500');

    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    expect(appSource).not.toContain('sidebarTimerRef');
  });

  it('migration_odaya_git_shared_navigation_contract_sets_trade_room_state_and_closes_surfaces', () => {
    const setters = makeTransitionSetters();
    const rawTrade = { id: 'trade-1', onchainId: '77', chargebackAcked: true, settlementProposal: { state: 'PROPOSED' } };

    buildGoToTradeRoomAction({
      escrow: { id: 'escrow-1', role: 'maker', state: 'CHALLENGED', rawTrade, _pendingBackendSync: true },
      ...setters,
    })();

    expect(setters.setActiveTrade).toHaveBeenCalledWith(expect.objectContaining({
      id: 'trade-1',
      settlementProposal: { state: 'PROPOSED' },
      _pendingBackendSync: true,
    }));
    expect(setters.setUserRole).toHaveBeenCalledWith('maker');
    expect(setters.setTradeState).toHaveBeenCalledWith('CHALLENGED');
    expect(setters.setChargebackAccepted).toHaveBeenCalledWith(true);
    expect(setters.setCurrentView).toHaveBeenCalledWith('tradeRoom');
    expect(setters.setSidebarOpen).toHaveBeenCalledWith(false);
    expect(setters.setShowProfileModal).toHaveBeenCalledWith(false);
  });

  it('migration_operations_lanes_put_settlement_action_above_challenged_and_pending_sync_second', () => {
    const model = buildOperationsContextModel({
      activeEscrows: [
        { id: 'locked', state: 'LOCKED', role: 'maker', rawTrade: {} },
        { id: 'paid', state: 'PAID', role: 'maker', rawTrade: {} },
        { id: 'challenged', state: 'CHALLENGED', role: 'maker', rawTrade: {} },
        { id: 'action', state: 'CHALLENGED', role: 'taker', rawTrade: { settlementProposal: { state: 'PROPOSED', proposer: '0xother' } } },
        { id: 'waiting', state: 'LOCKED', role: 'maker', rawTrade: { settlementProposal: { state: 'PROPOSED', proposer: '0xviewer' } } },
      ],
      activeEscrowCounts: { LOCKED: 1, PAID: 1, CHALLENGED: 2, settlement: {} },
      activeTrade: { id: 'pending', onchainId: 88, _pendingBackendSync: true },
      address: '0xviewer',
      lang: 'EN',
    });

    expect(model.lanes.map((l) => l.key)).toEqual([
      'settlement_action_required',
      'pending_backend_sync',
      'challenged',
      'paid',
      'settlement_waiting',
      'locked',
    ]);
    expect(model.lanes[0].items[0].escrow.id).toBe('action');
  });

  it('migration_operations_pending_backend_sync_is_visible_and_navigable_without_fetching', async () => {
    const user = userEvent.setup();
    const setters = makeTransitionSetters();

    render(
      <OperationsCenterPage
        activeEscrows={[]}
        activeEscrowCounts={{ LOCKED: 0, PAID: 0, CHALLENGED: 0, settlement: {} }}
        activeTrade={{ id: null, onchainId: 99, role: 'taker', state: 'LOCKED', _pendingBackendSync: true }}
        address="0xviewer"
        lang="EN"
        {...setters}
      />,
    );

    expect(screen.getByRole('button', { name: /Pending Backend Sync \(1\)/i })).toBeInTheDocument();
    expect(screen.getByTestId('pending-sync-card')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Go to Room/i }));

    expect(setters.setActiveTrade).toHaveBeenCalledWith(expect.objectContaining({ onchainId: 99, _pendingBackendSync: true }));
    expect(setters.setCurrentView).toHaveBeenCalledWith('tradeRoom');

    const operationsSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/contexts/operations/OperationsCenterPage.jsx'), 'utf8');
    expect(operationsSource).not.toMatch(/\bfetch\s*\(/);
    expect(operationsSource).toContain('buildGoToTradeRoomAction({');
  });

  it('migration_trade_room_wrong_chain_disables_actions_using_real_chain_policy', () => {
    const wrongChainSupported = isSupportedChainId(999999);
    const model = buildTradeDecisionModel({
      trade: { id: 'trade-1', onchainId: 10 },
      tradeState: 'LOCKED',
      userRole: 'taker',
      chargebackAccepted: true,
      paymentIpfsHash: 'ipfs://proof',
      isConnected: true,
      isAuthenticated: true,
      isSupportedChain: wrongChainSupported,
      isPaused: false,
      lang: 'EN',
    });

    expect(wrongChainSupported).toBe(false);
    expect(model.disabledReasons).toContain('Unsupported network.');

    render(
      <TradeRoomPage
        decisionInput={{
          trade: { id: 'trade-1', onchainId: 10 },
          tradeState: 'LOCKED',
          userRole: 'taker',
          chargebackAccepted: true,
          paymentIpfsHash: 'ipfs://proof',
          isConnected: true,
          isAuthenticated: true,
          isSupportedChain: wrongChainSupported,
          isPaused: false,
          lang: 'EN',
        }}
        actionCallbacks={{ report_payment: { onClick: vi.fn(), label: 'Report guarded payment' } }}
      />,
    );

    expect(screen.getByRole('button', { name: /Report guarded payment/i })).toBeDisabled();
    expect(screen.getAllByText(/Unsupported network\./i).length).toBeGreaterThan(0);
  });


  it('migration_locked_taker_report_payment_requires_proof_not_chargeback_acknowledgement', () => {
    render(
      <TradeRoomPage
        decisionInput={{
          trade: { id: 'trade-ack', onchainId: 12 },
          tradeState: 'LOCKED',
          userRole: 'taker',
          chargebackAccepted: false,
          paymentIpfsHash: 'ipfs://proof',
          isConnected: true,
          isAuthenticated: true,
          isSupportedChain: true,
          isPaused: false,
          lang: 'EN',
        }}
        actionCallbacks={{ report_payment: { onClick: vi.fn(), label: 'Report without chargeback ack' } }}
      />,
    );

    expect(screen.getByRole('button', { name: /Report without chargeback ack/i })).toBeEnabled();
    expect(screen.queryByText(/Chargeback acknowledgement is required\./i)).not.toBeInTheDocument();

    cleanup();

    render(
      <TradeRoomPage
        decisionInput={{
          trade: { id: 'trade-no-proof', onchainId: 13 },
          tradeState: 'LOCKED',
          userRole: 'taker',
          chargebackAccepted: false,
          paymentIpfsHash: '',
          isConnected: true,
          isAuthenticated: true,
          isSupportedChain: true,
          isPaused: false,
          lang: 'EN',
        }}
        actionCallbacks={{ report_payment: { onClick: vi.fn(), label: 'Report missing proof' } }}
      />,
    );

    expect(screen.getByRole('button', { name: /Report missing proof/i })).toBeDisabled();
    expect(screen.getAllByText(/Payment proof is required\./i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Chargeback acknowledgement is required\./i)).not.toBeInTheDocument();
  });

  it('migration_static_guardrails_prevent_chain_hardcode_and_bare_settlement_handlers_before_extraction', () => {
    const appViewsSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/AppViews.jsx'), 'utf8');
    const settlementCardSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/SettlementProposalCard.jsx'), 'utf8');
    const settlementActionsSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/contexts/settlement/useSettlementActions.js'), 'utf8');
    const tradeRoomSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/contexts/trade-room/TradeRoomPage.jsx'), 'utf8');
    const primaryPanelSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/contexts/trade-room/PrimaryActionPanel.jsx'), 'utf8');
    const secondaryPanelSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/contexts/trade-room/SecondaryActionsPanel.jsx'), 'utf8');
    const nonSettlementUiSource = `${appViewsSource}\n${tradeRoomSource}\n${primaryPanelSource}\n${secondaryPanelSource}`;

    expect(appViewsSource).not.toMatch(/isSupportedChain:\s*true/);
    expect(appViewsSource).toContain('isSupportedChain: isSupportedChainId(chainId)');
    expect(nonSettlementUiSource).not.toMatch(/onClick=\{(?:acceptSettlement|rejectSettlement|withdrawSettlement|expireSettlement|proposeSettlement)/);
    expect(`${appViewsSource}\n${settlementCardSource}`).not.toMatch(/(?:acceptSettlement|rejectSettlement|withdrawSettlement|expireSettlement|proposeSettlement)\(\s*\)/);
    expect(settlementCardSource).toContain('useSettlementActions');
    expect(settlementActionsSource).toContain('contractFns.proposeSettlement(BigInt(context.onchainTradeId), Number(makerShareBps), Number(expiresAt))');
    expect(settlementActionsSource).toContain('contractFns.acceptSettlement(tradeId)');
    expect(settlementActionsSource).toContain('contractFns.rejectSettlement(tradeId)');
    expect(settlementActionsSource).toContain('contractFns.withdrawSettlement(tradeId)');
    expect(settlementActionsSource).toContain('contractFns.expireSettlement(tradeId)');
  });

  it('migration_order_side_copy_prevents_visible_raw_side_enums_in_market_cards', () => {
    expect(getOrderSideCopy('SELL_CRYPTO', 'display', 'EN')).not.toBe('SELL_CRYPTO');
    expect(getOrderSideCopy('BUY_CRYPTO', 'display', 'EN')).not.toBe('BUY_CRYPTO');

    const views = buildAppViews({
      ...baseViewCtx,
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
          bondLabel: '8%',
          maker: '0xbuyer',
          makerFull: '0xbuyer',
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
      ],
      orders: [{ crypto: 'USDT' }],
    });

    render(<div>{views.renderMarket()}</div>);
    expect(screen.queryByText('SELL_CRYPTO')).not.toBeInTheDocument();
    expect(screen.queryByText('BUY_CRYPTO')).not.toBeInTheDocument();
  });

  it('migration_payment_risk_compact_hides_technical_fields_until_disclosure', async () => {
    const user = userEvent.setup();
    const riskEntry = {
      riskLevel: 'HIGH',
      minBondSurchargeBps: 75,
      feeSurchargeBps: 25,
      warningKey: 'ACH_REVERSAL_WINDOW',
      source: 'config',
      configVersion: 'risk-v1',
      snapshotBlock: 123,
      description: { EN: 'ACH can have reversal windows.' },
    };

    const { rerender } = render(<PaymentRiskBadge lang="EN" compact riskEntry={riskEntry} />);
    expect(screen.getByText(/Payment method complexity/i)).toBeInTheDocument();
    expect(screen.queryByText(/minBondSurchargeBps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ACH_REVERSAL_WINDOW/i)).not.toBeInTheDocument();

    rerender(<PaymentRiskBadge lang="EN" riskEntry={riskEntry} />);
    expect(screen.queryByText(/minBondSurchargeBps/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show technical disclosure/i }));
    expect(screen.getByText(/minBondSurchargeBps/i)).toBeInTheDocument();
    expect(screen.getByText(/ACH_REVERSAL_WINDOW/i)).toBeInTheDocument();
  });

  it('migration_theme_bootstrap_survives_missing_match_media_and_persists_provider_mode', () => {
    const originalMatchMedia = window.matchMedia;
    window.localStorage.removeItem(APP_THEME_STORAGE_KEY);
    delete window.matchMedia;

    const ThemeHarness = () => {
      const { themeMode, setThemeMode } = useThemeMode();
      return <button type="button" onClick={() => setThemeMode('day')}>{themeMode}</button>;
    };

    expect(getInitialThemeMode()).toBe('system');
    render(<ThemeProvider><ThemeHarness /></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'system' }));
    expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('day');
    expect(document.documentElement.dataset.theme).toBe('day');

    window.matchMedia = originalMatchMedia;
  });

  it('migration_profile_active_trades_show_locked_paid_challenged_and_use_shared_navigation_action', async () => {
    const user = userEvent.setup();
    const setters = makeTransitionSetters();
    const activeEscrows = [
      { id: 'T-LOCKED', state: 'LOCKED', role: 'maker', rawTrade: { id: 'locked-raw', chargebackAcked: false } },
      { id: 'T-PAID', state: 'PAID', role: 'taker', rawTrade: { id: 'paid-raw', chargebackAcked: true } },
      { id: 'T-CHALLENGED', state: 'CHALLENGED', role: 'maker', rawTrade: { id: 'challenged-raw', chargebackAcked: true } },
    ];

    render(
      <ActiveTradesPanel
        lang="EN"
        activeTradesFilter="ALL"
        setActiveTradesFilter={vi.fn()}
        activeEscrows={activeEscrows}
        {...setters}
      />,
    );

    const cards = screen.getAllByTestId('operation-trade-card');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText('LOCKED')).toBeInTheDocument();
    expect(within(cards[1]).getByText('PAID')).toBeInTheDocument();
    expect(within(cards[2]).getByText('CHALLENGED')).toBeInTheDocument();

    await user.click(within(cards[0]).getByRole('button', { name: /Go to Room/i }));
    await user.click(within(cards[1]).getByRole('button', { name: /Go to Room/i }));
    await user.click(within(cards[2]).getByRole('button', { name: /Go to Room/i }));

    expect(setters.setTradeState.mock.calls.map(([state]) => state)).toEqual(['LOCKED', 'PAID', 'CHALLENGED']);
    expect(setters.setCurrentView).toHaveBeenCalledWith('tradeRoom');

    const panelSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/contexts/profile/ActiveTradesPanel.jsx'), 'utf8');
    expect(panelSource).toContain('OperationTradeCard');
    expect(panelSource).toContain('buildGoToTradeRoomAction');
  });

  it('migration_app_providers_wrap_app_without_moving_authority_logic_out_of_app', () => {
    const mainSource = fs.readFileSync(path.resolve(process.cwd(), 'src/main.jsx'), 'utf8');
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');

    expect(mainSource).toMatch(/<ErrorBoundary>[\s\S]*<AppProviders>[\s\S]*<App \/>[\s\S]*<\/AppProviders>[\s\S]*<\/ErrorBoundary>/);
    expect(mainSource).toMatch(/<WagmiProvider[\s\S]*<QueryClientProvider[\s\S]*<ErrorBoundary>/);
    expect(appSource).toContain('buildTradeRoomActions({');
    expect(appSource).not.toContain('const handleReportPayment = async () =>');
    expect(appSource).not.toContain('const handleRelease = async () =>');
    expect(appSource).not.toContain('const handleChallenge = async () =>');
    expect(appSource).toContain('proposeSettlement,');
    expect(appSource).toContain('acceptSettlement,');
    expect(appSource).toContain('<AppShell');
  });
});
