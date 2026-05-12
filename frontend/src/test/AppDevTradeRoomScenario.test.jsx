import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const contractMocks = vi.hoisted(() => ({
  releaseFunds: vi.fn(),
  challengeTrade: vi.fn(),
  autoRelease: vi.fn(),
  pingMaker: vi.fn(),
  pingTakerForChallenge: vi.fn(),
  reportPayment: vi.fn(),
  burnExpired: vi.fn(),
  proposeOrApproveCancel: vi.fn(),
  signCancelProposal: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0xTaker000000000000000000000000000000000001', isConnected: true, connector: null }),
  useConnect: () => ({ connect: vi.fn(), connectors: [] }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useChainId: () => 31337,
  usePublicClient: () => ({}),
}));

vi.mock('../hooks/useArafContract', () => ({
  useArafContract: () => ({
    releaseFunds: contractMocks.releaseFunds,
    challengeTrade: contractMocks.challengeTrade,
    autoRelease: contractMocks.autoRelease,
    pingMaker: contractMocks.pingMaker,
    pingTakerForChallenge: contractMocks.pingTakerForChallenge,
    reportPayment: contractMocks.reportPayment,
    burnExpired: contractMocks.burnExpired,
    proposeOrApproveCancel: contractMocks.proposeOrApproveCancel,
    signCancelProposal: contractMocks.signCancelProposal,
    fillSellOrder: vi.fn(),
    fillBuyOrder: vi.fn(),
    cancelSellOrder: vi.fn(),
    cancelBuyOrder: vi.fn(),
    getReputation: vi.fn(),
    getCurrentAmounts: vi.fn(),
    createSellOrder: vi.fn(),
    createBuyOrder: vi.fn(),
    registerWallet: vi.fn(),
    approveToken: vi.fn(),
    getAllowance: vi.fn(),
    getTokenDecimals: vi.fn(),
    getOrder: vi.fn(),
    getPaused: vi.fn(),
    decayReputation: vi.fn(),
    antiSybilCheck: vi.fn(),
    getCooldownRemaining: vi.fn(),
    getWalletRegisteredAt: vi.fn(),
    getTakerFeeBps: vi.fn(),
    mintToken: vi.fn(),
    getFirstSuccessfulTradeAt: vi.fn(),
  }),
}));

vi.mock('../app/useAppSessionData', () => ({
  useAppSessionData: () => ({
    isAuthenticated: true,
    setIsAuthenticated: vi.fn(),
    authChecked: true,
    authenticatedWallet: '0xTaker000000000000000000000000000000000001',
    setAuthenticatedWallet: vi.fn(),
    isWalletRegistered: true,
    setIsWalletRegistered: vi.fn(),
    isRegisteringWallet: false,
    setIsRegisteringWallet: vi.fn(),
    isLoggingIn: false,
    setIsLoggingIn: vi.fn(),
    userReputation: null,
    payoutProfileDraft: {
      rail: 'TR_IBAN',
      country: 'TR',
      contact: { channel: null, value: null },
      fields: { account_holder_name: '', iban: null, routing_number: null, account_number: null, account_type: null, bic: null, bank_name: null },
    },
    setPayoutProfileDraft: vi.fn(),
    tradeHistory: [],
    historyLoading: false,
    tradeHistoryPage: 1,
    setTradeHistoryPage: vi.fn(),
    tradeHistoryTotal: 0,
    tradeHistoryLimit: 10,
    activeTrade: null,
    setActiveTrade: vi.fn(),
    resolvedTradeState: 'LOCKED',
    paymentIpfsHash: '',
    setPaymentIpfsHash: vi.fn(),
    sybilStatus: null,
    walletAgeRemainingDays: null,
    takerName: '',
    isPaused: false,
    protocolStats: null,
    statsLoading: false,
    statsError: false,
    onchainBondMap: null,
    onchainTokenMap: {},
    takerFeeBps: 10,
    tokenDecimalsMap: { USDT: 6, USDC: 6 },
    bleedingAmounts: null,
    orders: [],
    myOrders: [],
    setMyOrders: vi.fn(),
    setOrders: vi.fn(),
    activeEscrows: [],
    loading: false,
    setLoading: vi.fn(),
    clearLocalSessionState: vi.fn(),
    bestEffortBackendLogout: vi.fn(),
    authenticatedFetch: vi.fn(),
    fetchStats: vi.fn(),
    fetchMyTrades: vi.fn(),
    tradeState: 'LOCKED',
    setTradeState: vi.fn(),
    userRole: 'taker',
    setUserRole: vi.fn(),
    isBanned: false,
    setIsBanned: vi.fn(),
    cancelStatus: null,
    setCancelStatus: vi.fn(),
    chargebackAccepted: false,
    setChargebackAccepted: vi.fn(),
    formatAddress: (v) => v || '—',
    filteredOrders: [],
    activeEscrowCounts: { LOCKED: 0, PAID: 0, CHALLENGED: 0 },
    gracePeriodTimer: { isFinished: true, days: 0, hours: 0, minutes: 0, seconds: 0 },
    bleedingTimer: { isFinished: true, days: 0, hours: 0, minutes: 0, seconds: 0 },
    principalProtectionTimer: { isFinished: true, days: 0, hours: 0, minutes: 0, seconds: 0 },
    makerPingTimer: { isFinished: true, days: 0, hours: 0, minutes: 0, seconds: 0 },
    canMakerPing: false,
    makerChallengePingTimer: { isFinished: true, days: 0, hours: 0, minutes: 0, seconds: 0 },
    canMakerStartChallengeFlow: false,
    makerChallengeTimer: { isFinished: true, days: 0, hours: 0, minutes: 0, seconds: 0 },
    canMakerChallenge: false,
  }),
}));

vi.mock('../app/AppModals', () => ({
  EnvWarningBanner: () => null,
  buildAppModals: () => ({
    renderWalletModal: () => null,
    renderFeedbackModal: () => null,
    renderMakerModal: () => null,
    renderProfileModal: () => null,
    renderTermsModal: () => null,
  }),
}));

vi.mock('../app/shell/AppShell', () => ({
  default: ({ navigation, panel, mobileBottom, outlet, modals }) => (
    <div>
      {navigation}
      {panel}
      {mobileBottom}
      {outlet}
      {modals}
    </div>
  ),
}));

import AppProviders from '../app/providers/AppProviders.jsx';
import App from '../App.jsx';

const renderApp = () => render(<AppProviders><App /></AppProviders>);

const applyTradeRoomScenario = async (label) => {
  fireEvent.click(screen.getByRole('button', { name: /Open dev scenario controller/i }));
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply to real App view' }));
  await waitFor(() => expect(screen.getByText(/Active: tradeRoom/i)).toBeInTheDocument());
};

const openActionLog = () => {
  const controller = screen.getByTestId('dev-scenario-controller');
  return within(controller).getByTestId('ui-lab-action-log');
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('App-level Trade Room dev scenarios', () => {
  it('renders locked-taker through the real TradeRoomPage flow with payment proof guidance', async () => {
    renderApp();

    await applyTradeRoomScenario('LOCKED / taker');

    expect(screen.getByText('Payment proof is needed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Report Payment' })).toBeInTheDocument();
    expect(screen.getAllByText('Payment proof is required.').length).toBeGreaterThan(0);
  });

  it('renders paid-maker release CTA and logs the mock action instead of calling real contracts', async () => {
    renderApp();

    await applyTradeRoomScenario('PAID / maker');
    fireEvent.click(screen.getByRole('button', { name: 'Release Funds' }));

    expect(contractMocks.releaseFunds).not.toHaveBeenCalled();
    expect(contractMocks.challengeTrade).not.toHaveBeenCalled();
    expect(openActionLog()).toHaveTextContent('release_funds');
    expect(openActionLog()).toHaveTextContent('paid-maker');
  });

  it('renders challenged-maker settlement guidance inside the real TradeRoomPage flow', async () => {
    renderApp();

    await applyTradeRoomScenario('CHALLENGED / maker');

    expect(screen.getAllByText('Follow settlement steps from the existing settlement card.').length).toBeGreaterThan(0);
    expect(screen.getByText(/Araf is not an arbitrator/i)).toBeInTheDocument();
    expect(screen.getAllByText(/What is happening\?/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Value at risk/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Remaining time/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Next action/i).length).toBeGreaterThan(0);
  });
});
