import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { orderSide as orderSideCopy } from '../../frontend/src/app/copy';
import { buildAppModals } from '../../frontend/src/app/AppModals';
import MyOrdersPanel from '../../frontend/src/app/contexts/profile/MyOrdersPanel';
import { getOrderSideCopy, mapApiOrderToUi } from '../../frontend/src/app/orderUiModel';

const makeMakerCtx = (overrides = {}) => ({
  lang: 'EN',
  t: { createAd: 'Create Order' },
  showWalletModal: false,
  connectors: [],
  showFeedbackModal: false,
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
  paymentRiskConfig: {},
  userReputation: { effectiveTier: 3 },
  SUPPORTED_TOKEN_ADDRESSES: { USDT: '0x1' },
  onchainTokenMap: {},
  handleCreateOrder: vi.fn(),
  isContractLoading: false,
  loadingText: '',
  showProfileModal: false,
  isConnected: true,
  isAuthenticated: true,
  termsAccepted: true,
  isRegisteringWallet: false,
  isWalletRegistered: true,
  sybilStatus: { funded: true },
  walletAgeRemainingDays: null,
  payoutProfileDraft: { rail: 'TR_IBAN', country: 'TR' },
  tokenDecimalsMap: { USDT: 6 },
  DEFAULT_TOKEN_DECIMALS: 6,
  formatTokenAmountFromRaw: () => '0',
  ...overrides,
});

const apiOrder = {
  _id: 'id-1',
  onchain_order_id: 7,
  owner_address: '0xabc',
  status: 'OPEN',
  tier: 1,
  token_address: '0xToken',
  market: { crypto_asset: 'USDT', fiat_currency: 'TRY', exchange_rate: '33.2' },
  amounts: { min_fill_amount_num: 12, remaining_amount_num: 55 },
};

describe('order side copy', () => {
  it.each([
    ['SELL_CRYPTO', 'Kripto Satıyor', 'Selling Crypto', 'Satın Al', 'Buy', 'Satış emri', 'Sell Order'],
    ['BUY_CRYPTO', 'Kripto Alıyor', 'Buying Crypto', 'Sat', 'Sell', 'Alış emri', 'Buy Order'],
  ])('maps %s display/action/order labels in TR and EN', (side, displayTR, displayEN, actionTR, actionEN, orderTR, orderEN) => {
    expect(orderSideCopy[side]).toEqual({ TR: displayTR, EN: displayEN });
    expect(getOrderSideCopy(side, 'display', 'TR')).toBe(displayTR);
    expect(getOrderSideCopy(side, 'display', 'EN')).toBe(displayEN);
    expect(getOrderSideCopy(side, 'action', 'TR')).toBe(actionTR);
    expect(getOrderSideCopy(side, 'action', 'EN')).toBe(actionEN);
    expect(getOrderSideCopy(side, 'order', 'TR')).toBe(orderTR);
    expect(getOrderSideCopy(side, 'order', 'EN')).toBe(orderEN);
  });

  it('maker side selector does not render raw enum labels as visible text', () => {
    const modals = buildAppModals(makeMakerCtx());
    render(<div>{modals.renderMakerModal()}</div>);

    expect(screen.getByRole('button', { name: 'Selling Crypto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buying Crypto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SELL_CRYPTO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'BUY_CRYPTO' })).not.toBeInTheDocument();
    expect(screen.getByTestId('maker-side-SELL_CRYPTO')).toHaveTextContent('Selling Crypto');
    expect(screen.getByTestId('maker-side-BUY_CRYPTO')).toHaveTextContent('Buying Crypto');
  });


  it('profile order cards keep enum internally but render display label', () => {
    render(<MyOrdersPanel myOrders={[{ id: 'o1', side: 'BUY_CRYPTO' }]} lang="EN" setConfirmDeleteId={vi.fn()} />);

    expect(screen.getByText(/Buy Order/)).toBeInTheDocument();
    expect(screen.queryByText(/BUY_CRYPTO/)).not.toBeInTheDocument();
  });

  it('market mapping keeps internal enum but exposes display labels', () => {
    const sell = mapApiOrderToUi({ order: { ...apiOrder, side: 'SELL_CRYPTO' }, lang: 'TR', bondMap: { 1: { maker: 8, taker: 10 } }, tokenMap: {}, formatAddress: (a) => a });
    const buy = mapApiOrderToUi({ order: { ...apiOrder, side: 'BUY_CRYPTO' }, lang: 'TR', bondMap: { 1: { maker: 8, taker: 10 } }, tokenMap: {}, formatAddress: (a) => a });

    expect(sell.side).toBe('SELL_CRYPTO');
    expect(buy.side).toBe('BUY_CRYPTO');
    expect(sell.sideLabel).toBe('Satış emri');
    expect(buy.sideLabel).toBe('Alış emri');
    expect(sell.ctaLabel).toBe('Satın Al');
    expect(buy.ctaLabel).toBe('Sat');
    expect(sell.ownerSideHint).toContain('Kripto Satıyor');
    expect(buy.ownerSideHint).toContain('Kripto Alıyor');
  });
});
