import { describe, it, expect, vi } from 'vitest';
import {
  assertOrderSide,
  buildMakerPreview,
  mapApiOrderToUi,
  mapOffchainHealthToUi,
  resolveOrderActionFns,
  resolvePaymentRiskEntry,
  deriveOrderPaymentRiskSignal,
} from '../app/orderUiModel';

describe('orderUiModel mapping', () => {
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

  it('invalid side is non-actionable and does not fake bond side', () => {
    const ui = mapApiOrderToUi({
      order: { ...baseOrder, side: 'MALFORMED_SIDE' },
      lang: 'EN',
      bondMap,
      tokenMap: {},
      formatAddress: (a) => a,
    });

    expect(ui.side).toBe('UNKNOWN');
    expect(ui.isActionable).toBe(false);
    expect(ui.ctaLabel).toBe('Unavailable');
    expect(ui.bondLabel).toBe('—');
  });

  it('builds sell vs buy maker preview with contract-aligned accounting', () => {
    const sell = buildMakerPreview({ side: 'SELL_CRYPTO', amountUi: 100, bondPct: 8 });
    const buy = buildMakerPreview({ side: 'BUY_CRYPTO', amountUi: 100, bondPct: 10 });

    expect(sell.reserveAmount).toBe(8);
    expect(sell.totalAmount).toBe(108);
    expect(sell.includesInventory).toBe(true);

    expect(buy.reserveAmount).toBe(10);
    expect(buy.totalAmount).toBe(10);
    expect(buy.includesInventory).toBe(false);
  });

  it('resolves side-aware action functions and fails closed on invalid side', () => {
    const fns = {
      createSellOrder: vi.fn(),
      createBuyOrder: vi.fn(),
      cancelSellOrder: vi.fn(),
      cancelBuyOrder: vi.fn(),
      fillSellOrder: vi.fn(),
      fillBuyOrder: vi.fn(),
    };

    expect(assertOrderSide('SELL_CRYPTO')).toBe('SELL_CRYPTO');
    expect(resolveOrderActionFns('SELL_CRYPTO', fns).createFn).toBe(fns.createSellOrder);
    expect(resolveOrderActionFns('BUY_CRYPTO', fns).cancelFn).toBe(fns.cancelBuyOrder);
    expect(resolveOrderActionFns('BUY_CRYPTO', fns).fillFn).toBe(fns.fillBuyOrder);
    expect(() => resolveOrderActionFns('UNKNOWN', fns)).toThrow(/Invalid order side/);
  });

  it('maps offchain health signal to deterministic UI-only severity', () => {
    const ui = mapOffchainHealthToUi({
      lang: 'EN',
      signal: {
        readOnly: true,
        nonBlocking: true,
        canBlockProtocolActions: false,
        explainableReasons: [
          'maker_profile_changed_after_lock',
          'partial_or_incomplete_snapshot',
        ],
      },
    });

    expect(ui.severityBand).toBe('YELLOW');
    expect(ui.severityLabel).toBe('Medium Signal');
    expect(ui.readOnly).toBe(true);
    expect(ui.nonBlocking).toBe(true);
    expect(ui.canBlockProtocolActions).toBe(false);
    expect(ui.reasonLabels.length).toBe(2);
  });

  it('maps compact trust summary for market hover without detailed reasons', () => {
    const ui = mapApiOrderToUi({
      order: {
        ...baseOrder,
        side: 'SELL_CRYPTO',
        trust_visibility_summary: {
          available: true,
          band: 'GREEN',
          label: 'Low Signal',
          readOnly: true,
          nonBlocking: true,
          canBlockProtocolActions: false,
        },
      },
      lang: 'EN',
      bondMap,
      tokenMap: {},
      formatAddress: (a) => a,
    });

    expect(ui.trustSummary.available).toBe(true);
    expect(ui.trustSummary.band).toBe('GREEN');
    expect(ui.trustSummary.label).toBe('Low Signal');
    expect(ui.trustSummary.readOnly).toBe(true);
    expect(ui.trustSummary.nonBlocking).toBe(true);
    expect(ui.trustSummary.canBlockProtocolActions).toBe(false);
    expect(ui.trustSummary.reasonLabels).toBeUndefined();
  });

  it('falls back to neutral compact summary when trust signal is unavailable', () => {
    const ui = mapApiOrderToUi({
      order: { ...baseOrder, side: 'BUY_CRYPTO' },
      lang: 'EN',
      bondMap,
      tokenMap: {},
      formatAddress: (a) => a,
    });
    expect(ui.trustSummary.available).toBe(false);
    expect(ui.trustSummary.label).toBe('Signal unavailable');
  });

  it('resolves payment risk entry with SEPA EU fallback safely', () => {
    const paymentRiskConfig = {
      EU: {
        SEPA_IBAN: { riskLevel: 'MEDIUM', enabled: true },
      },
    };
    const resolved = resolvePaymentRiskEntry({
      paymentRiskConfig,
      rail: 'SEPA_IBAN',
      country: 'DE',
    });
    expect(resolved?.riskLevel).toBe('MEDIUM');
  });

  it('derives generic payment complexity signal when order feed has no rail/country hint', () => {
    const paymentRiskConfig = {
      TR: {
        TR_IBAN: { riskLevel: 'MEDIUM', enabled: true },
      },
    };
    const signal = deriveOrderPaymentRiskSignal({
      order: { ...baseOrder, side: 'SELL_CRYPTO' },
      paymentRiskConfig,
    });
    expect(signal?.riskLevel).toBe('MEDIUM');
  });

});
