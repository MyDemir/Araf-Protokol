import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import { buildAppModals } from '../app/AppModals';

const makeCtx = (overrides = {}) => ({
  lang: 'EN',
  t: { createAd: 'Create Order' },
  showWalletModal: false,
  setShowWalletModal: vi.fn(),
  connectors: [],
  connect: vi.fn(),
  getWalletIcon: () => '👛',
  showFeedbackModal: false,
  setShowFeedbackModal: vi.fn(),
  feedbackRating: 0,
  setFeedbackRating: vi.fn(),
  feedbackCategory: '',
  setFeedbackCategory: vi.fn(),
  setFeedbackError: vi.fn(),
  feedbackText: '',
  setFeedbackText: vi.fn(),
  feedbackError: '',
  FEEDBACK_MIN_LENGTH: 10,
  submitFeedback: vi.fn(),
  isSubmittingFeedback: false,
  showMakerModal: true,
  setShowMakerModal: vi.fn(),
  makerTier: 1,
  setMakerTier: vi.fn(),
  makerToken: 'USDT',
  setMakerToken: vi.fn(),
  makerSide: 'SELL_CRYPTO',
  setMakerSide: vi.fn(),
  makerAmount: '100',
  setMakerAmount: vi.fn(),
  makerRate: '34',
  setMakerRate: vi.fn(),
  makerMinLimit: '100',
  setMakerMinLimit: vi.fn(),
  makerMaxLimit: '1000',
  setMakerMaxLimit: vi.fn(),
  makerFiat: 'TRY',
  setMakerFiat: vi.fn(),
  onchainBondMap: { 1: { maker: 8, taker: 10 } },
  userReputation: { effectiveTier: 3 },
  SUPPORTED_TOKEN_ADDRESSES: { USDT: '0x1' },
  onchainTokenMap: {},
  handleCreateOrder: vi.fn(),
  isContractLoading: false,
  setIsContractLoading: vi.fn(),
  loadingText: '',
  showProfileModal: true,
  setShowProfileModal: vi.fn(),
  profileTab: 'ilanlarim',
  setProfileTab: vi.fn(),
  isBanned: false,
  tradeHistory: [],
  historyLoading: false,
  tradeHistoryPage: 1,
  setTradeHistoryPage: vi.fn(),
  tradeHistoryTotal: 0,
  tradeHistoryLimit: 10,
  orders: [],
  myOrders: [{ id: 'o1', side: 'BUY_CRYPTO', status: 'OPEN', crypto: 'USDT', fiat: 'TRY', rate: 34, remainingAmount: 50, minFillAmount: 10, tier: 1 }],
  address: '0xabc',
  confirmDeleteId: null,
  setConfirmDeleteId: vi.fn(),
  handleDeleteOrder: vi.fn(),
  activeTradesFilter: 'ALL',
  setActiveTradesFilter: vi.fn(),
  activeEscrows: [],
  setActiveTrade: vi.fn(),
  setUserRole: vi.fn(),
  setTradeState: vi.fn(),
  setChargebackAccepted: vi.fn(),
  setCurrentView: vi.fn(),
  handleUpdatePII: vi.fn(),
  piiBankOwner: '',
  setPiiBankOwner: vi.fn(),
  piiIban: '',
  setPiiIban: vi.fn(),
  piiTelegram: '',
  setPiiTelegram: vi.fn(),
  getSafeTelegramUrl: () => '#',
  handleLogoutAndDisconnect: vi.fn(),
  isConnected: true,
  isAuthenticated: true,
  termsAccepted: true,
  setTermsAccepted: vi.fn(),
  connector: null,
  isRegisteringWallet: false,
  handleRegisterWallet: vi.fn(),
  isWalletRegistered: true,
  sybilStatus: null,
  walletAgeRemainingDays: null,
  decayReputation: vi.fn(),
  tokenDecimalsMap: { USDT: 6 },
  DEFAULT_TOKEN_DECIMALS: 6,
  formatTokenAmountFromRaw: () => '0',
  showToast: vi.fn(),
  ...overrides,
});

describe('AppModals side-aware behaviors', () => {
  it('shows side selector and side-specific submit label', async () => {
    const user = userEvent.setup();
    const setMakerSide = vi.fn();
    const modals = buildAppModals(makeCtx({ profileTab: 'ayarlar', showProfileModal: false, setMakerSide, makerSide: 'BUY_CRYPTO' }));

    render(<div>{modals.renderMakerModal()}</div>);

    expect(screen.getByRole('button', { name: 'SELL_CRYPTO' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BUY_CRYPTO' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Buy Order/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'SELL_CRYPTO' }));
    expect(setMakerSide).toHaveBeenCalledWith('SELL_CRYPTO');
  });


  it('buy preview accounting differs from sell preview accounting', () => {
    const buyModals = buildAppModals(makeCtx({ profileTab: 'ayarlar', showProfileModal: false, makerSide: 'BUY_CRYPTO', makerAmount: '100' }));
    const { rerender } = render(<div>{buyModals.renderMakerModal()}</div>);

    expect(screen.getAllByText(/Total Reserve:/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10 USDT/).length).toBeGreaterThan(0);

    const sellModals = buildAppModals(makeCtx({ profileTab: 'ayarlar', showProfileModal: false, makerSide: 'SELL_CRYPTO', makerAmount: '100' }));
    rerender(<div>{sellModals.renderMakerModal()}</div>);

    expect(screen.getAllByText(/Total Locked:/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/108 USDT/).length).toBeGreaterThan(0);
  });

  it('renders authoritative my orders fields', () => {
    const modals = buildAppModals(makeCtx({ showMakerModal: false }));
    render(<div>{modals.renderProfileModal()}</div>);

    expect(screen.getByText(/BUY_CRYPTO · OPEN/)).toBeInTheDocument();
    expect(screen.getByText(/Remaining: 50 USDT/)).toBeInTheDocument();
    expect(screen.getByText(/Min Fill: 10 USDT/)).toBeInTheDocument();
  });

  it('does not trigger profile modal setter during render when auth is missing', () => {
    const setShowProfileModal = vi.fn();
    const modals = buildAppModals(makeCtx({
      showMakerModal: false,
      showProfileModal: true,
      isConnected: false,
      isAuthenticated: false,
      setShowProfileModal,
    }));

    render(<div>{modals.renderProfileModal()}</div>);
    expect(setShowProfileModal).not.toHaveBeenCalled();
  });

  it('uses 90-day clean-slate copy and wires decayReputation handler from context', async () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/AppModals.jsx'), 'utf8');
    expect(source).toContain('const cleanSlateTime = bannedUntil + (90 * 24 * 60 * 60);');
    expect(source).toContain('90 days have passed');
    expect(source).toContain('decayReputation,');
  });

  it('renders Trust Visibility Layer in profile reputation tab with non-authoritative semantics', () => {
    const modals = buildAppModals(makeCtx({
      showMakerModal: false,
      profileTab: 'itibar',
      activeEscrows: [
        {
          onchainId: '321',
          role: 'maker',
          rawTrade: {
            offchainHealthScoreInput: {
              readOnly: true,
              nonBlocking: true,
              canBlockProtocolActions: false,
              explainableReasons: ['maker_frequent_recent_bank_changes_at_lock'],
            },
          },
        },
      ],
    }));

    render(<div>{modals.renderProfileModal()}</div>);
    expect(screen.getByText('TRUST VISIBILITY LAYER')).toBeInTheDocument();
    expect(screen.getByText(/Informational layer/i)).toBeInTheDocument();
    expect(screen.getByText(/readOnly: true/i)).toBeInTheDocument();
    expect(screen.getByText(/nonBlocking: true/i)).toBeInTheDocument();
    expect(screen.getByText(/canBlockProtocolActions: false/i)).toBeInTheDocument();
  });

  it('fails soft when trust payload is missing', () => {
    const modals = buildAppModals(makeCtx({
      showMakerModal: false,
      profileTab: 'itibar',
      activeEscrows: [{ onchainId: '111', role: 'maker', rawTrade: {} }],
    }));

    render(<div>{modals.renderProfileModal()}</div>);
    expect(screen.getByText(/No offchain health signal is available yet/i)).toBeInTheDocument();
  });
});
