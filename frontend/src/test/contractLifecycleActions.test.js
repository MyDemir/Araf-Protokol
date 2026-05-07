import { describe, expect, it, vi } from 'vitest';
import {
  buildMintAction,
  buildOrderActions,
  buildProfileActions,
  buildTradeRoomActions,
} from '../app/actions/contractLifecycleActions';

const baseTrade = { id: 'db-trade', onchainId: '9' };

const makeTradeRoomDeps = (overrides = {}) => ({
  lang: 'EN',
  activeTrade: baseTrade,
  activeEscrows: [],
  paymentIpfsHash: 'proof-hash',
  resolvedTradeState: 'PAID',
  chargebackAccepted: true,
  isContractLoading: false,
  canMakerStartChallengeFlow: true,
  canMakerChallenge: true,
  reportPayment: vi.fn().mockResolvedValue(undefined),
  signCancelProposal: vi.fn().mockResolvedValue({ signature: '0xsig', deadline: 123 }),
  proposeOrApproveCancel: vi.fn().mockResolvedValue(undefined),
  releaseFunds: vi.fn().mockResolvedValue(undefined),
  pingTakerForChallenge: vi.fn().mockResolvedValue(undefined),
  challengeTrade: vi.fn().mockResolvedValue(undefined),
  pingMaker: vi.fn().mockResolvedValue(undefined),
  autoRelease: vi.fn().mockResolvedValue(undefined),
  burnExpired: vi.fn().mockResolvedValue(undefined),
  authenticatedFetch: vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue({ bothSigned: false }) }),
  showToast: vi.fn(),
  fetchMyTrades: vi.fn().mockResolvedValue(undefined),
  setIsContractLoading: vi.fn(),
  setActiveTrade: vi.fn(),
  setTradeState: vi.fn(),
  setPaymentIpfsHash: vi.fn(),
  setCancelStatus: vi.fn(),
  setChargebackAccepted: vi.fn(),
  setCurrentView: vi.fn(),
  setLoadingText: vi.fn(),
  ...overrides,
});

describe('contract lifecycle action builders', () => {
  it('mint action resolves token address and wraps loading state', async () => {
    const deps = {
      lang: 'EN',
      isConnected: true,
      isFaucetEnabled: true,
      supportedTokenAddresses: { USDT: '0xtoken' },
      mintToken: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
      setIsContractLoading: vi.fn(),
      setLoadingText: vi.fn(),
    };

    await buildMintAction(deps)('USDT');

    expect(deps.setIsContractLoading).toHaveBeenNthCalledWith(1, true);
    expect(deps.mintToken).toHaveBeenCalledWith('0xtoken');
    expect(deps.showToast).toHaveBeenCalledWith('✅ Test USDT minted successfully!', 'success');
    expect(deps.setLoadingText).toHaveBeenLastCalledWith('');
  });

  it('trade-room report payment calls contract with BigInt trade id and clears proof', async () => {
    const deps = makeTradeRoomDeps();
    const actions = buildTradeRoomActions(deps);

    await actions.handleReportPayment();

    expect(deps.reportPayment).toHaveBeenCalledWith(9n, 'proof-hash');
    expect(deps.setTradeState).toHaveBeenCalledWith('PAID');
    expect(deps.setPaymentIpfsHash).toHaveBeenCalledWith('');
  });

  it('trade-room release, auto-release and burn finalize room state through module callbacks', async () => {
    const deps = makeTradeRoomDeps();
    const actions = buildTradeRoomActions(deps);

    await actions.handleRelease();
    await actions.handleAutoRelease('9');
    await actions.handleBurnExpired();

    expect(deps.releaseFunds).toHaveBeenCalledWith(9n);
    expect(deps.autoRelease).toHaveBeenCalledWith(9n);
    expect(deps.burnExpired).toHaveBeenCalledWith(9n);
    expect(deps.setTradeState).toHaveBeenCalledWith('RESOLVED');
    expect(deps.setTradeState).toHaveBeenCalledWith('BURNED');
    expect(deps.setCurrentView).toHaveBeenCalledWith('home');
  });

  it('trade-room challenge and maker ping preserve ping-path contract calls', async () => {
    const deps = makeTradeRoomDeps({
      activeTrade: { ...baseTrade, paidAt: new Date(Date.now() - 49 * 3600 * 1000).toISOString() },
    });
    const actions = buildTradeRoomActions(deps);

    await actions.handleChallenge();
    await actions.handlePingMaker('9');

    expect(deps.pingTakerForChallenge).toHaveBeenCalledWith(9n);
    expect(deps.fetchMyTrades).toHaveBeenCalledTimes(1);
    expect(deps.pingMaker).toHaveBeenCalledWith(9n);
  });

  it('profile actions update backend-owned payout profile and register wallet on-chain', async () => {
    const deps = {
      lang: 'EN',
      isContractLoading: false,
      isRegisteringWallet: false,
      isWalletRegistered: false,
      payoutProfileDraft: { rail: 'TR_IBAN' },
      requireSignedSessionForActiveWallet: vi.fn(() => true),
      authenticatedFetch: vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}) }),
      canonicalizePayoutProfileDraft: vi.fn(() => ({ rail: 'TR_IBAN', fields: {} })),
      registerWallet: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
      setIsContractLoading: vi.fn(),
      setIsRegisteringWallet: vi.fn(),
      setIsWalletRegistered: vi.fn(),
    };
    const actions = buildProfileActions(deps);

    await actions.handleUpdatePII({ preventDefault: vi.fn() });
    await actions.handleRegisterWallet();

    expect(deps.authenticatedFetch).toHaveBeenCalledWith(expect.stringContaining('/auth/profile'), expect.objectContaining({ method: 'PUT' }));
    expect(deps.registerWallet).toHaveBeenCalledTimes(1);
    expect(deps.setIsWalletRegistered).toHaveBeenCalledWith(true);
  });

  it('order actions cancel by side-aware contract function and remove local order records', async () => {
    const deps = {
      lang: 'EN',
      isContractLoading: false,
      requireSignedSessionForActiveWallet: vi.fn(() => true),
      fillSellOrder: vi.fn(),
      fillBuyOrder: vi.fn(),
      createSellOrder: vi.fn(),
      createBuyOrder: vi.fn(),
      cancelSellOrder: vi.fn().mockResolvedValue(undefined),
      cancelBuyOrder: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
      setIsContractLoading: vi.fn(),
      setOrders: vi.fn(),
      setMyOrders: vi.fn(),
      setConfirmDeleteId: vi.fn(),
    };

    await buildOrderActions(deps).handleDeleteOrder({ onchainId: '11', side: 'SELL_CRYPTO' });

    expect(deps.cancelSellOrder).toHaveBeenCalledWith(11n);
    expect(deps.setOrders).toHaveBeenCalledWith(expect.any(Function));
    expect(deps.setMyOrders).toHaveBeenCalledWith(expect.any(Function));
    expect(deps.setConfirmDeleteId).toHaveBeenCalledWith(null);
  });
});
