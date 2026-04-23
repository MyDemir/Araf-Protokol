import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false, connector: null }),
  useConnect: () => ({ connect: vi.fn(), connectors: [] }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
  useChainId: () => 31337,
  usePublicClient: () => ({}),
}));

vi.mock('../hooks/useArafContract', () => ({
  useArafContract: () => ({
    releaseFunds: vi.fn(),
    challengeTrade: vi.fn(),
    autoRelease: vi.fn(),
    pingMaker: vi.fn(),
    pingTakerForChallenge: vi.fn(),
    fillSellOrder: vi.fn(),
    fillBuyOrder: vi.fn(),
    cancelSellOrder: vi.fn(),
    cancelBuyOrder: vi.fn(),
    signCancelProposal: vi.fn(),
    proposeOrApproveCancel: vi.fn(),
    getReputation: vi.fn(),
    getCurrentAmounts: vi.fn(),
    createSellOrder: vi.fn(),
    createBuyOrder: vi.fn(),
    registerWallet: vi.fn(),
    reportPayment: vi.fn(),
    burnExpired: vi.fn(),
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
    isAuthenticated: false,
    setIsAuthenticated: vi.fn(),
    authChecked: true,
    authenticatedWallet: null,
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

vi.mock('../app/AppViews', () => ({
  buildAppViews: () => ({
    renderHome: () => <div data-testid="home-view">home-view</div>,
    renderMarket: () => null,
    renderTradeRoom: () => null,
    renderSlimRail: () => null,
    renderContextSidebar: () => null,
    renderMobileNav: () => null,
    renderFooter: () => null,
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

import App from '../App.jsx';

describe('App smoke', () => {
  it('mounts and renders the home view without hitting ErrorBoundary path', () => {
    render(<App />);
    expect(screen.getByTestId('home-view')).toBeInTheDocument();
  });

  it('keeps profile tab default aligned with modal tabs', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    expect(source).toContain("useState('ayarlar')");
  });
});
