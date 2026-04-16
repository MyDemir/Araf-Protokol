import { describe, it, expect, vi } from 'vitest';
import { mapApiOrderToUi, resolveOrderActionFns } from './orderModel';

describe('orderModel mapping', () => {
  const bondMap = {
    1: { maker: 8, taker: 10 },
  };

  const baseOrder = {
    _id: 'mongo-1',
    onchain_order_id: 11,
    owner_address: '0x1234567890123456789012345678901234567890',
    status: 'OPEN',
    tier: 1,
    token_address: '0x9999999999999999999999999999999999999999',
    market: { crypto_asset: 'USDT', fiat_currency: 'TRY', exchange_rate: '33.5' },
    amounts: { min_fill_amount_num: 10, remaining_amount_num: 40 },
  };

  it('maps SELL_CRYPTO with Buy CTA and maker bond side', () => {
    const ui = mapApiOrderToUi({
      order: { ...baseOrder, side: 'SELL_CRYPTO' },
      lang: 'EN',
      bondMap,
      tokenMap: {},
      formatAddress: (a) => `${a.slice(0, 6)}...`,
    });

    expect(ui.side).toBe('SELL_CRYPTO');
    expect(ui.ctaLabel).toBe('Buy');
    expect(ui.bondLabel).toBe('8%');
    expect(ui.limitLabel).toContain('Min Fill 10 USDT');
    expect(ui.limitLabel).toContain('Remaining 40 USDT');
    expect(ui.min).toBeUndefined();
    expect(ui.max).toBeUndefined();
  });

  it('maps BUY_CRYPTO with Sell CTA and taker bond side', () => {
    const ui = mapApiOrderToUi({
      order: { ...baseOrder, side: 'BUY_CRYPTO' },
      lang: 'EN',
      bondMap,
      tokenMap: {},
      formatAddress: (a) => `${a.slice(0, 6)}...`,
    });

    expect(ui.side).toBe('BUY_CRYPTO');
    expect(ui.ctaLabel).toBe('Sell');
    expect(ui.bondLabel).toBe('10%');
  });


  it('keeps tokenMap policy from /api/orders/config mirror', () => {
    const ui = mapApiOrderToUi({
      order: { ...baseOrder, side: 'SELL_CRYPTO', token_address: '0xAbCd000000000000000000000000000000000000' },
      lang: 'EN',
      bondMap,
      tokenMap: {
        '0xabcd000000000000000000000000000000000000': { supported: true, allowSellOrders: true, allowBuyOrders: false },
      },
      formatAddress: (a) => a,
    });
    expect(ui.tokenPolicy?.allowBuyOrders).toBe(false);
  });

  it('resolves side-aware action functions', () => {
    const fns = {
      createSellOrder: vi.fn(),
      createBuyOrder: vi.fn(),
      cancelSellOrder: vi.fn(),
      cancelBuyOrder: vi.fn(),
      fillSellOrder: vi.fn(),
      fillBuyOrder: vi.fn(),
    };

    expect(resolveOrderActionFns('SELL_CRYPTO', fns).createFn).toBe(fns.createSellOrder);
    expect(resolveOrderActionFns('BUY_CRYPTO', fns).cancelFn).toBe(fns.cancelBuyOrder);
    expect(resolveOrderActionFns('BUY_CRYPTO', fns).fillFn).toBe(fns.fillBuyOrder);
  });
});
