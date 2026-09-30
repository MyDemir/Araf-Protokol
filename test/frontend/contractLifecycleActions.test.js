import { describe, expect, it, vi } from 'vitest';
import {
  buildMintAction,
  buildOrderActions,
  buildProfileActions,
  buildTradeRoomActions,
} from '../../frontend/src/app/actions/contractLifecycleActions';

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
  expirePaymentWindow: vi.fn().mockResolvedValue(undefined),
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
    expect(deps.showToast).toHaveBeenCalledWith('Test USDT minted successfully!', 'success');
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

  it('trade-room write actions fail closed for zero on-chain trade id before contract calls', async () => {
    const deps = makeTradeRoomDeps({ activeTrade: { ...baseTrade, onchainId: '0' } });
    const actions = buildTradeRoomActions(deps);

    await actions.handleReportPayment();
    await actions.handleProposeCancel();
    await actions.handleRelease();
    await actions.handleChallenge();
    await actions.handlePingMaker('0');
    await actions.handleAutoRelease('0');
    await actions.handleBurnExpired();

    expect(deps.reportPayment).not.toHaveBeenCalled();
    expect(deps.proposeOrApproveCancel).not.toHaveBeenCalled();
    expect(deps.releaseFunds).not.toHaveBeenCalled();
    expect(deps.pingTakerForChallenge).not.toHaveBeenCalled();
    expect(deps.challengeTrade).not.toHaveBeenCalled();
    expect(deps.pingMaker).not.toHaveBeenCalled();
    expect(deps.autoRelease).not.toHaveBeenCalled();
    expect(deps.burnExpired).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('On-chain trade ID not found.', 'error');
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

  it('release skips the chargeback-ack call when the backend id is not known yet and names the real token (F15)', async () => {
    const deps = makeTradeRoomDeps({ activeTrade: { onchainId: '9', id: null, crypto: 'USDC' } });
    await buildTradeRoomActions(deps).handleRelease();
    expect(deps.authenticatedFetch).not.toHaveBeenCalled();
    expect(deps.releaseFunds).toHaveBeenCalledWith(9n);
    expect(deps.showToast).toHaveBeenCalledWith('USDC successfully released!', 'success');
  });

  it('ping patches go through an id-checked updater that leaves other or null trades alone (F15)', async () => {
    const deps = makeTradeRoomDeps({ resolvedTradeState: 'LOCKED' });
    await buildTradeRoomActions(deps).handlePingMaker('9');
    const updater = deps.setActiveTrade.mock.calls[0][0];
    expect(updater(null)).toBeNull();
    const other = { onchainId: '10' };
    expect(updater(other)).toBe(other);
    expect(updater({ onchainId: '9' })).toMatchObject({ onchainId: '9', pingedAt: expect.any(String) });
  });

  it('a failing fetchMyTrades does not turn a confirmed challenge into a failure toast (F15)', async () => {
    const deps = makeTradeRoomDeps({
      activeTrade: { ...baseTrade, challengePingedAt: '2020-01-01T00:00:00Z' },
      fetchMyTrades: vi.fn().mockRejectedValue(new Error('backend down')),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await buildTradeRoomActions(deps).handleChallenge();
    expect(deps.challengeTrade).toHaveBeenCalledWith(9n);
    expect(deps.showToast).toHaveBeenCalledWith('Challenge opened. Bleeding Escrow active.', 'success');
    expect(deps.showToast).not.toHaveBeenCalledWith('backend down', 'error');
  });

  it('reads the state from the chain after the tx and pins it; a stale RPC read falls back to the expected state (F6)', async () => {
    const pinTradeState = vi.fn();
    const getTrade = vi.fn().mockResolvedValue({ state: 1 }); // RPC still says LOCKED
    const deps = makeTradeRoomDeps({ getTrade, pinTradeState });
    await buildTradeRoomActions(deps).handleReportPayment();
    expect(getTrade).toHaveBeenCalledWith('9');
    expect(pinTradeState).toHaveBeenCalledWith('9', 'PAID');
    expect(deps.setTradeState).toHaveBeenCalledWith('PAID');
  });

  it('uses the authoritative chain state when it is ahead of the expectation (F6)', async () => {
    const pinTradeState = vi.fn();
    const deps = makeTradeRoomDeps({ getTrade: vi.fn().mockResolvedValue({ state: 3 }), pinTradeState });
    await buildTradeRoomActions(deps).handleReportPayment();
    expect(deps.setTradeState).toHaveBeenCalledWith('CHALLENGED');
    expect(pinTradeState).toHaveBeenCalledWith('9', 'CHALLENGED');
  });

  it('finishing a trade pins the terminal state and clears the #/trade hash (F5, F6)', async () => {
    window.location.hash = '#/trade/9';
    const pinTradeState = vi.fn();
    const deps = makeTradeRoomDeps({ pinTradeState });
    await buildTradeRoomActions(deps).handleRelease();
    expect(pinTradeState).toHaveBeenCalledWith('9', 'RESOLVED');
    expect(window.location.hash).toBe('');
    expect(deps.setCurrentView).toHaveBeenCalledWith('home');
  });

  it('mutual cancel decides from the chain state instead of the mirrored cancelStatus (F6)', async () => {
    const stale = makeTradeRoomDeps({ cancelStatus: 'proposed_by_other', getTrade: vi.fn().mockResolvedValue({ state: 2 }) });
    await buildTradeRoomActions(stale).handleProposeCancel();
    expect(stale.setCurrentView).not.toHaveBeenCalledWith('home');
    expect(stale.setCancelStatus).toHaveBeenCalledWith('proposed_by_me');

    const executed = makeTradeRoomDeps({ cancelStatus: null, getTrade: vi.fn().mockResolvedValue({ state: 5 }) });
    await buildTradeRoomActions(executed).handleProposeCancel();
    expect(executed.setCurrentView).toHaveBeenCalledWith('home');
  });

  it('profile update: a non-session 409 shows the active-trade message; SESSION_WALLET_MISMATCH stays silent; bad JSON is safe (F1, F22)', async () => {
    const make = (res) => ({
      lang: 'EN', isContractLoading: false, isRegisteringWallet: false, isWalletRegistered: false, payoutProfileDraft: {},
      requireSignedSessionForActiveWallet: vi.fn(() => true),
      authenticatedFetch: vi.fn().mockResolvedValue(res),
      canonicalizePayoutProfileDraft: vi.fn(() => ({})),
      registerWallet: vi.fn(), showToast: vi.fn(), setIsContractLoading: vi.fn(), setIsRegisteringWallet: vi.fn(), setIsWalletRegistered: vi.fn(),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const locked = make({ ok: false, status: 409, json: async () => ({ code: 'BANK_PROFILE_LOCKED_DURING_ACTIVE_TRADE' }) });
    await buildProfileActions(locked).handleUpdatePII({ preventDefault: vi.fn() });
    expect(locked.showToast).toHaveBeenCalledWith('Payout profile cannot be changed during active trades.', 'error');

    const mismatch = make({ ok: false, status: 409, json: async () => ({ code: 'SESSION_WALLET_MISMATCH' }) });
    await buildProfileActions(mismatch).handleUpdatePII({ preventDefault: vi.fn() });
    expect(mismatch.showToast).not.toHaveBeenCalled();

    const badJson = make({ ok: false, status: 500, json: async () => { throw new Error('html'); } });
    await buildProfileActions(badJson).handleUpdatePII({ preventDefault: vi.fn() });
    expect(badJson.showToast).toHaveBeenCalledWith('Update failed.', 'error');
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
