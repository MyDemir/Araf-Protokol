import { describe, it, expect } from 'vitest';
import { mapApiOrderToUi } from './orderModel';

describe('session mapping authoritative model', () => {
  const bondMap = { 1: { maker: 8, taker: 10 } };
  const tokenMap = {
    '0xtoken': { supported: true, allowSellOrders: true, allowBuyOrders: true },
  };

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

  it('SELL_CRYPTO maps authoritative fields and labels', () => {
    const ui = mapApiOrderToUi({
      order: { ...apiOrder, side: 'SELL_CRYPTO' },
      lang: 'EN',
      bondMap,
      tokenMap,
      formatAddress: (a) => a,
    });

    expect(ui.side).toBe('SELL_CRYPTO');
    expect(ui.sideLabel).toBe('Sell Order');
    expect(ui.ctaLabel).toBe('Buy');
    expect(ui.bondLabel).toBe('8%');
    expect(ui.tokenPolicy?.supported).toBe(true);
    expect(ui.limitLabel).toContain('Min Fill 12 USDT');
    expect(ui.limitLabel).toContain('Remaining 55 USDT');
    expect(ui.min).toBeUndefined();
    expect(ui.max).toBeUndefined();
  });

  it('BUY_CRYPTO maps authoritative fields and labels', () => {
    const ui = mapApiOrderToUi({
      order: { ...apiOrder, side: 'BUY_CRYPTO' },
      lang: 'EN',
      bondMap,
      tokenMap,
      formatAddress: (a) => a,
    });

    expect(ui.side).toBe('BUY_CRYPTO');
    expect(ui.sideLabel).toBe('Buy Order');
    expect(ui.ctaLabel).toBe('Sell');
    expect(ui.bondLabel).toBe('10%');
  });

  it('invalid side is safe and non-actionable', () => {
    const ui = mapApiOrderToUi({
      order: { ...apiOrder, side: 'INVALID_SIDE' },
      lang: 'EN',
      bondMap,
      tokenMap,
      formatAddress: (a) => a,
    });

    expect(ui.side).toBe('UNKNOWN');
    expect(ui.sideLabel).toBe('Invalid Side');
    expect(ui.ctaLabel).toBe('Unavailable');
    expect(ui.isActionable).toBe(false);
  });

  it('myOrders and market orders can use identical authoritative mapper', () => {
    const marketMapped = mapApiOrderToUi({ order: { ...apiOrder, side: 'SELL_CRYPTO' }, lang: 'EN', bondMap, tokenMap, formatAddress: (a) => a });
    const myMapped = mapApiOrderToUi({ order: { ...apiOrder, side: 'SELL_CRYPTO' }, lang: 'EN', bondMap, tokenMap, formatAddress: (a) => a });

    expect(myMapped).toStrictEqual(marketMapped);
  });
});
