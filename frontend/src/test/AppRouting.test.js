import { describe, it, expect, vi } from 'vitest';
import { removeOrderByOnchainId, resolveOrderActionFns } from '../app/orderModel';

describe('App routing side-aware contract selection', () => {
  const fns = {
    createSellOrder: vi.fn(),
    createBuyOrder: vi.fn(),
    cancelSellOrder: vi.fn(),
    cancelBuyOrder: vi.fn(),
    fillSellOrder: vi.fn(),
    fillBuyOrder: vi.fn(),
  };

  it('SELL_CRYPTO routes create/cancel/fill to sell handlers', () => {
    const resolved = resolveOrderActionFns('SELL_CRYPTO', fns);
    expect(resolved.createFn).toBe(fns.createSellOrder);
    expect(resolved.cancelFn).toBe(fns.cancelSellOrder);
    expect(resolved.fillFn).toBe(fns.fillSellOrder);
  });

  it('BUY_CRYPTO routes create/cancel/fill to buy handlers', () => {
    const resolved = resolveOrderActionFns('BUY_CRYPTO', fns);
    expect(resolved.createFn).toBe(fns.createBuyOrder);
    expect(resolved.cancelFn).toBe(fns.cancelBuyOrder);
    expect(resolved.fillFn).toBe(fns.fillBuyOrder);
  });

  it('UNKNOWN side fails closed and no fallback handler is returned', () => {
    expect(() => resolveOrderActionFns('UNKNOWN', fns)).toThrow(/Invalid order side/);
    expect(() => resolveOrderActionFns('MALFORMED', fns)).toThrow(/Invalid order side/);
  });

  it('cancel sync removes canceled order from both market and myOrders collections', () => {
    const market = [{ onchainId: 1 }, { onchainId: 2 }];
    const mine = [{ onchainId: 2 }, { onchainId: 3 }];

    expect(removeOrderByOnchainId(market, 2)).toStrictEqual([{ onchainId: 1 }]);
    expect(removeOrderByOnchainId(mine, 2)).toStrictEqual([{ onchainId: 3 }]);
  });
});
