import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import { buildAppModals } from '../app/AppModals';

afterEach(() => {
  cleanup();
});

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
  paymentRiskConfig: {
    TR: {
      TR_IBAN: {
        riskLevel: 'MEDIUM',
        minBondSurchargeBps: 0,
        feeSurchargeBps: 0,
        warningKey: 'BANK_TRANSFER_CONFIRMATION_REQUIRED',
        enabled: true,
        description: { TR: 'x', EN: 'y' },
      },
    },
  },
  userReputation: { effectiveTier: 3 },
  SUPPORTED_TOKEN_ADDRESSES: { USDT: '0x1' },
  onchainTokenMap: {},
  handleCreateOrder: vi.fn(),
  makerValidationError: null,
  makerPayoutRiskEntry: { riskLevel: 'MEDIUM', enabled: true, minBondSurchargeBps: 0, feeSurchargeBps: 0, warningKey: 'BANK_TRANSFER_CONFIRMATION_REQUIRED', description: { TR: 'x', EN: 'y' } },
  isCreateTemporarilyDisabledByRisk: false,
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
  payoutProfileDraft: {
    rail: 'TR_IBAN',
    country: 'TR',
    contact: { channel: null, value: null },
    fields: { account_holder_name: '', iban: null, routing_number: null, account_number: null, account_type: null, bic: null, bank_name: null },
  },
  setPayoutProfileDraft: vi.fn(),
  canonicalizePayoutProfileDraft: (v) => v,
  SEPA_COUNTRIES: ['DE', 'FR'],
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

    expect(screen.getByRole('button', { name: 'Selling Crypto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buying Crypto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SELL_CRYPTO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'BUY_CRYPTO' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Buy Order/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Selling Crypto' }));
    expect(setMakerSide).toHaveBeenCalledWith('SELL_CRYPTO');
  });


  it('renders maker modal as guided sections without raw TR order-side wording', () => {
    const modals = buildAppModals(makeCtx({ lang: 'TR', t: { createAd: 'Order Oluştur' }, profileTab: 'ayarlar', showProfileModal: false }));

    render(<div>{modals.renderMakerModal()}</div>);

    ['Order yönü', 'Varlık', 'Miktar', 'Kur', 'Limitler', 'Tier', 'Reserve önizlemesi', 'Ödeme yöntemi karmaşıklığı', 'Onay'].forEach((label) => {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Order Side')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kripto Satıyor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kripto Alıyor' })).toBeInTheDocument();
  });

  it('keeps submit disabled and readable when maker validation error exists', () => {
    const modals = buildAppModals(makeCtx({
      profileTab: 'ayarlar',
      showProfileModal: false,
      makerValidationError: 'Amount is required',
    }));

    render(<div>{modals.renderMakerModal()}</div>);

    const createButton = screen.getByRole('button', { name: /Open Sell Order/i });
    expect(createButton).toBeDisabled();
    expect(screen.getByText('Amount is required')).toBeInTheDocument();
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

  it('disables create order button when payout rail risk is restricted by config (non-authoritative)', () => {
    const modals = buildAppModals(makeCtx({
      profileTab: 'ayarlar',
      showProfileModal: false,
      makerPayoutRiskEntry: {
        riskLevel: 'RESTRICTED',
        minBondSurchargeBps: 0,
        feeSurchargeBps: 0,
        warningKey: 'RESTRICTED',
        enabled: false,
        description: { TR: 'x', EN: 'Restricted in UI config only.' },
      },
      isCreateTemporarilyDisabledByRisk: true,
      payoutProfileDraft: {
        rail: 'US_ACH',
        country: 'US',
        contact: { channel: null, value: null },
        fields: { account_holder_name: '', iban: null, routing_number: null, account_number: null, account_type: null, bic: null, bank_name: null },
      },
    }));
    render(<div>{modals.renderMakerModal()}</div>);
    const createButton = screen
      .getAllByRole('button', { name: /Open Sell Order|Open Buy Order|Order Aç/i })
      .find((btn) => btn.hasAttribute('disabled'));
    expect(createButton).toBeTruthy();
    expect(createButton).toBeDisabled();
    expect(screen.getByText(/not a contract authority rule|kontrat hükmü değildir/i)).toBeInTheDocument();
  });


  it('lets maker modal reveal payment-risk technical disclosure on demand', async () => {
    const user = userEvent.setup();
    const modals = buildAppModals(makeCtx({ profileTab: 'ayarlar', showProfileModal: false }));

    render(<div>{modals.renderMakerModal()}</div>);

    expect(screen.getAllByText(/Payment method complexity/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Medium').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not a user trust score/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/minBondSurchargeBps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/warningKey/i)).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /Show technical disclosure/i })[0]);

    expect(screen.getAllByText(/minBondSurchargeBps/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/feeSurchargeBps/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/warningKey/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/BANK_TRANSFER_CONFIRMATION_REQUIRED/i).length).toBeGreaterThan(0);
  });

  it('renders authoritative my orders fields', () => {
    const modals = buildAppModals(makeCtx({ showMakerModal: false }));
    render(<div>{modals.renderProfileModal()}</div>);

    expect(screen.getByText(/Buy Order · OPEN/)).toBeInTheDocument();
    expect(screen.queryByText(/BUY_CRYPTO · OPEN/)).not.toBeInTheDocument();
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

  it('renders agreed settlement copy as event history (non-penal reputation semantics)', async () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/AppModals.jsx'), 'utf8');
    expect(source).toContain('AGREED SETTLEMENT');
    expect(source).toContain('event-history marker, not a risk penalty');
    expect(source).toContain('Partial settlement');
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
    expect(screen.getByText('Trust Visibility')).toBeInTheDocument();
    expect(screen.getByText(/Informational only/i)).toBeInTheDocument();
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
    expect(screen.getByText(/No signal is available for active maker-linked trades/i)).toBeInTheDocument();
  });

  it('renders generic contact channel selector in settings form', () => {
    const modals = buildAppModals(makeCtx({ showMakerModal: false, profileTab: 'ayarlar' }));
    render(<div>{modals.renderProfileModal()}</div>);
    expect(screen.getByText(/Payout Profile & Contact/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'telegram' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'email' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'phone' })).toBeInTheDocument();
  });

  it('shows terminal outcome label copy from resolutionType on trade history cards', () => {
    const modals = buildAppModals(makeCtx({
      showMakerModal: false,
      profileTab: 'gecmis',
      tradeHistory: [
        {
          _id: 'trade-1',
          status: 'RESOLVED',
          resolutionType: 'PARTIAL_SETTLEMENT',
          onchain_escrow_id: '101',
          maker_address: '0xabc',
          financials: { crypto_amount: '1000000', crypto_asset: 'USDT' },
        },
      ],
    }));

    render(<div>{modals.renderProfileModal()}</div>);
    expect(screen.getByText('Closed by agreed partial settlement')).toBeInTheDocument();
  });

  it('applies rail-aware country options', () => {
    const modals = buildAppModals(makeCtx({
      showMakerModal: false,
      profileTab: 'ayarlar',
      payoutProfileDraft: {
        rail: 'TR_IBAN',
        country: 'TR',
        contact: { channel: null, value: null },
        fields: { account_holder_name: '', iban: null, routing_number: null, account_number: null, account_type: null, bic: null, bank_name: null },
      },
    }));
    render(<div>{modals.renderProfileModal()}</div>);
    expect(screen.getAllByRole('option', { name: 'TR' }).length).toBeGreaterThan(0);
  });

  it('canonicalizes draft when rail changes', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/AppModals.jsx'), 'utf8');
    expect(source).toContain("canonicalizePayoutProfileDraft({ ...prev, rail: nextRail })");
  });
});
