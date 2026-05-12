import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildStartTradeAction } from '../../frontend/src/app/actions/contractLifecycleActions';

const makeDeps = (overrides = {}) => ({
  lang: 'EN',
  address: '0xabc0000000000000000000000000000000000000',
  isBanned: false,
  isContractLoading: vi.fn(() => false),
  supportedTokenAddresses: { USDT: '0x0000000000000000000000000000000000000001' },
  getOrder: vi.fn(async () => ({
    tokenAddress: '0x0000000000000000000000000000000000000002',
    remainingAmount: 100_000_000n,
    minFillAmount: 10_000_000n,
  })),
  getAllowance: vi.fn(async () => 1_000_000_000n),
  approveToken: vi.fn(async () => undefined),
  fillSellOrder: vi.fn(async () => ({ tradeId: 77n })),
  fillBuyOrder: vi.fn(async () => ({ tradeId: 88n })),
  createSellOrder: vi.fn(),
  createBuyOrder: vi.fn(),
  cancelSellOrder: vi.fn(),
  cancelBuyOrder: vi.fn(),
  authenticatedFetch: vi.fn(async () => ({ ok: true, json: async () => ({ trade: { _id: 'backend-trade-77' } }) })),
  showToast: vi.fn(),
  setIsContractLoading: vi.fn(),
  setLoadingText: vi.fn(),
  setActiveTrade: vi.fn(),
  setTradeState: vi.fn(),
  setCancelStatus: vi.fn(),
  setChargebackAccepted: vi.fn(),
  setCurrentView: vi.fn(),
  confirmFn: vi.fn(() => true),
  sleep: vi.fn(async () => undefined),
  ...overrides,
});

const sellOrder = (overrides = {}) => ({
  id: 'order-1',
  onchainId: 12,
  crypto: 'USDT',
  side: 'SELL_CRYPTO',
  ...overrides,
});

const runAction = async (deps, order = sellOrder()) => buildStartTradeAction(deps)(order);

describe('start trade action', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('blocks missing onchainId before reading chain state', async () => {
    const deps = makeDeps();

    await runAction(deps, sellOrder({ onchainId: null }));

    expect(deps.getOrder).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('This order has no on-chain ID yet. Please try again later.', 'error');
  });

  it('requires user confirmation before any guard or chain action', async () => {
    const deps = makeDeps({ confirmFn: vi.fn(() => false), isBanned: true });

    await runAction(deps);

    expect(deps.confirmFn).toHaveBeenCalledWith('Do you confirm the transaction?');
    expect(deps.showToast).not.toHaveBeenCalled();
    expect(deps.getOrder).not.toHaveBeenCalled();
    expect(deps.setIsContractLoading).not.toHaveBeenCalled();
  });

  it('blocks banned takers before chain reads', async () => {
    const deps = makeDeps({ isBanned: true });

    await runAction(deps);

    expect(deps.getOrder).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('🚫 Taker restriction active. Check on-chain record for duration.', 'error');
  });

  it('respects an active contract loading guard before chain reads', async () => {
    const deps = makeDeps({ isContractLoading: true });

    await runAction(deps);

    expect(deps.getOrder).not.toHaveBeenCalled();
    expect(deps.setIsContractLoading).not.toHaveBeenCalled();
  });

  it('blocks missing token address lookup from supported token constants', async () => {
    const deps = makeDeps({ supportedTokenAddresses: {} });

    await runAction(deps, sellOrder({ crypto: 'USDC' }));

    expect(deps.getOrder).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('USDC token address not configured.', 'error');
    expect(deps.setIsContractLoading).toHaveBeenLastCalledWith(false);
    expect(deps.setLoadingText).toHaveBeenLastCalledWith('');
  });

  it('blocks invalid order side after on-chain remaining amount is read', async () => {
    const deps = makeDeps();

    await runAction(deps, sellOrder({ side: 'BROKEN_SIDE' }));

    expect(deps.getOrder).toHaveBeenCalledWith(12n);
    expect(deps.fillSellOrder).not.toHaveBeenCalled();
    expect(deps.fillBuyOrder).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('Invalid order side. Cannot start trade.', 'error');
  });

  it('blocks zero remaining amount before partial-fill validation and fill', async () => {
    const deps = makeDeps({ getOrder: vi.fn(async () => ({ remainingAmount: 0n, minFillAmount: 0n, tokenAddress: '0x0000000000000000000000000000000000000002' })) });

    await runAction(deps);

    expect(deps.fillSellOrder).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('Order appears filled/invalid. Please refresh order feed.', 'error');
  });

  it('fails closed for invalid partial fill input without falling back to remaining', async () => {
    const deps = makeDeps();

    await runAction(deps, sellOrder({ fillAmountRaw: 'not-a-number' }));

    expect(deps.fillSellOrder).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('Invalid partial fill amount. Please enter a numeric value.', 'error');
  });

  it('approves insufficient allowance then fills via side-aware fill function using chain token override', async () => {
    const deps = makeDeps({ getAllowance: vi.fn(async () => 0n) });

    await runAction(deps, sellOrder({ fillAmountRaw: '50000000' }));

    expect(deps.getAllowance).toHaveBeenCalledWith('0x0000000000000000000000000000000000000002', deps.address);
    expect(deps.approveToken).toHaveBeenCalledWith('0x0000000000000000000000000000000000000002', 100_000_000n);
    expect(deps.fillSellOrder).toHaveBeenCalledTimes(1);
    expect(deps.fillSellOrder.mock.calls[0][0]).toBe(12n);
    expect(deps.fillSellOrder.mock.calls[0][1]).toBe(50_000_000n);
    expect(deps.fillSellOrder.mock.calls[0][2]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(deps.fillBuyOrder).not.toHaveBeenCalled();
    expect(deps.setActiveTrade).toHaveBeenCalledWith(expect.objectContaining({ id: 'backend-trade-77', onchainId: '77' }));
    expect(deps.setTradeState).toHaveBeenCalledWith('LOCKED');
    expect(deps.setCancelStatus).toHaveBeenCalledWith(null);
    expect(deps.setChargebackAccepted).toHaveBeenCalledWith(false);
    expect(deps.setCurrentView).toHaveBeenCalledWith('tradeRoom');
    expect(deps.showToast).toHaveBeenCalledWith('🔒 Trade locked successfully!', 'success');
  });

  it('keeps env token when chain token is the zero address and reads order before fill', async () => {
    const calls = [];
    const deps = makeDeps({
      getOrder: vi.fn(async () => {
        calls.push('getOrder');
        return {
          tokenAddress: '0x0000000000000000000000000000000000000000',
          remainingAmount: 100_000_000n,
          minFillAmount: 10_000_000n,
        };
      }),
      getAllowance: vi.fn(async () => {
        calls.push('getAllowance');
        return 1_000_000_000n;
      }),
      fillSellOrder: vi.fn(async () => {
        calls.push('fillSellOrder');
        return { tradeId: 77n };
      }),
    });

    await runAction(deps);

    expect(calls).toEqual(['getOrder', 'getAllowance', 'fillSellOrder']);
    expect(deps.getAllowance).toHaveBeenCalledWith('0x0000000000000000000000000000000000000001', deps.address);
  });

  it('selects fillBuyOrder for BUY_CRYPTO without changing raw enum values', async () => {
    const deps = makeDeps();
    const order = sellOrder({ side: 'BUY_CRYPTO' });

    await runAction(deps, order);

    expect(order.side).toBe('BUY_CRYPTO');
    expect(deps.fillBuyOrder).toHaveBeenCalledTimes(1);
    expect(deps.fillSellOrder).not.toHaveBeenCalled();
  });

  it('fails closed when fill result has no child trade id', async () => {
    const deps = makeDeps({ fillSellOrder: vi.fn(async () => ({})) });

    await runAction(deps);

    expect(deps.authenticatedFetch).not.toHaveBeenCalled();
    expect(deps.setActiveTrade).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('Failed to read child trade id from OrderFilled event. Please retry.', 'error');
  });

  it('uses pending backend sync state when backend record is not ready without fake ids', async () => {
    const deps = makeDeps({ authenticatedFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })) });

    await runAction(deps);

    expect(deps.authenticatedFetch).toHaveBeenCalledTimes(6);
    expect(deps.authenticatedFetch.mock.calls[0][0]).toContain('trades/by-escrow/77');
    expect(deps.setActiveTrade).toHaveBeenCalledWith(expect.objectContaining({
      id: null,
      onchainId: '77',
      _pendingBackendSync: true,
    }));
    expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('backend record is not ready yet'), 'info');
  });

  it('keeps OrderFilled child trade id above Number.MAX_SAFE_INTEGER as a string identity', async () => {
    const unsafeTradeId = 900719925474099312345n;
    const deps = makeDeps({
      fillSellOrder: vi.fn(async () => ({ tradeId: unsafeTradeId })),
      authenticatedFetch: vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    });

    await runAction(deps);

    expect(deps.authenticatedFetch.mock.calls[0][0]).toContain(`trades/by-escrow/${unsafeTradeId.toString()}`);
    expect(deps.setActiveTrade).toHaveBeenCalledWith(expect.objectContaining({
      id: null,
      onchainId: unsafeTradeId.toString(),
      _pendingBackendSync: true,
    }));
  });

  it('rolls allowance back to zero when a failure occurs after approve', async () => {
    const deps = makeDeps({
      getAllowance: vi.fn(async () => 0n),
      fillSellOrder: vi.fn(async () => { throw new Error('fill failed'); }),
    });

    await runAction(deps);

    expect(deps.approveToken).toHaveBeenNthCalledWith(1, '0x0000000000000000000000000000000000000002', 200_000_000n);
    expect(deps.approveToken).toHaveBeenNthCalledWith(2, '0x0000000000000000000000000000000000000002', 0n);
    expect(deps.showToast).toHaveBeenCalledWith('fill failed', 'error');
  });

  it('keeps App.jsx from declaring handleStartTrade inline', () => {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    expect(appSource).toMatch(/import \{[^}]*buildStartTradeAction[^}]*\} from '\.\/app\/actions\/contractLifecycleActions';/);
    expect(appSource).toContain('const handleStartTrade = React.useMemo(() => buildStartTradeAction({');
    expect(appSource).not.toMatch(/const\s+handleStartTrade\s*=\s*async/);
    expect(appSource).not.toContain('childListingRef');
    expect(appSource).not.toContain('trades/by-escrow/${onchainTradeId}');
  });
});
