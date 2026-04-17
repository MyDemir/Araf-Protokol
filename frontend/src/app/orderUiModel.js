/**
 * Frontend UI model/adapter helpers for order rendering & view actions.
 * NOTE: This is NOT the backend DB model (see backend/scripts/models/Order.js).
 */

import { formatUnits } from 'viem';

const DEFAULT_TOKEN_DECIMALS = 6;
const VALID_ORDER_SIDES = new Set(['SELL_CRYPTO', 'BUY_CRYPTO']);

export const SIDE_META = {
  SELL_CRYPTO: {
    sideLabel: { TR: 'Sell Order', EN: 'Sell Order' },
    ctaLabel: { TR: 'Satın Al', EN: 'Buy' },
  },
  BUY_CRYPTO: {
    sideLabel: { TR: 'Buy Order', EN: 'Buy Order' },
    ctaLabel: { TR: 'Sat', EN: 'Sell' },
  },
};

export const STATUS_META = {
  OPEN: { TR: 'Açık', EN: 'Open' },
  PARTIALLY_FILLED: { TR: 'Kısmi Dolu', EN: 'Partially Filled' },
  FILLED: { TR: 'Dolu', EN: 'Filled' },
  CANCELED: { TR: 'İptal', EN: 'Canceled' },
  UNKNOWN: { TR: 'Bilinmiyor', EN: 'Unknown' },
};

export const normalizeOrderSide = (side) => {
  if (VALID_ORDER_SIDES.has(side)) return side;
  return 'UNKNOWN';
};

export const assertOrderSide = (side) => {
  const normalized = normalizeOrderSide(side);
  if (normalized === 'UNKNOWN') {
    throw new Error(`Invalid order side: ${String(side ?? 'undefined')}`);
  }
  return normalized;
};

export const resolveOrderActionFns = (side, fns) => {
  const validSide = assertOrderSide(side);

  if (validSide === 'BUY_CRYPTO') {
    return {
      createFn: fns.createBuyOrder,
      cancelFn: fns.cancelBuyOrder,
      fillFn: fns.fillBuyOrder,
    };
  }

  return {
    createFn: fns.createSellOrder,
    cancelFn: fns.cancelSellOrder,
    fillFn: fns.fillSellOrder,
  };
};

const rawToNumber = (raw, decimals = DEFAULT_TOKEN_DECIMALS) => {
  try {
    return Number(formatUnits(BigInt(raw ?? 0), decimals));
  } catch {
    return 0;
  }
};

export const getMakerModalCopy = (side, lang = 'TR') => {
  if (side === 'BUY_CRYPTO') {
    return {
      submitLabel: lang === 'TR' ? '🧾 Onayla ve Buy Order Aç' : '🧾 Approve & Open Buy Order',
      previewTitle: lang === 'TR' ? 'Buy Order Reserve Özeti' : 'Buy Order Reserve Summary',
      bondRoleLabel: lang === 'TR' ? 'Taker Reserve' : 'Taker Reserve',
      totalLabel: lang === 'TR' ? 'Toplam Reserve' : 'Total Reserve',
      previewHint: lang === 'TR' ? 'Kontrat buy order oluştururken yalnız taker reserve tutar.' : 'Contract only locks taker reserve when creating a buy order.',
    };
  }
  return {
    submitLabel: lang === 'TR' ? '🧾 Onayla ve Sell Order Aç' : '🧾 Approve & Open Sell Order',
    previewTitle: lang === 'TR' ? 'Sell Order Kilit Özeti' : 'Sell Order Lock Summary',
    bondRoleLabel: lang === 'TR' ? 'Maker Reserve' : 'Maker Reserve',
    totalLabel: lang === 'TR' ? 'Toplam Kilitlenecek' : 'Total Locked',
    previewHint: lang === 'TR' ? 'Kontrat sell order oluştururken inventory + maker reserve kilitler.' : 'Contract locks inventory + maker reserve when creating a sell order.',
  };
};

export const buildMakerPreview = ({ side, amountUi, bondPct }) => {
  const safeAmount = Number(amountUi || 0);
  const safeBondPct = Number(bondPct || 0);
  const reserveAmount = Math.ceil(safeAmount * safeBondPct / 100);

  if (side === 'BUY_CRYPTO') {
    return {
      reserveAmount,
      totalAmount: reserveAmount,
      includesInventory: false,
    };
  }

  return {
    reserveAmount,
    totalAmount: safeAmount + reserveAmount,
    includesInventory: true,
  };
};


export const removeOrderByOnchainId = (orders = [], onchainId) => {
  return orders.filter((o) => o?.onchainId !== onchainId);
};

export const mapApiOrderToUi = ({ order, lang = 'TR', bondMap = {}, tokenMap = {}, formatAddress = (v) => v }) => {
  const side = normalizeOrderSide(order?.side);
  const sideMeta = SIDE_META[side] || null;
  const status = order?.status || 'UNKNOWN';
  const statusMeta = STATUS_META[status] || STATUS_META.UNKNOWN;

  const crypto = order?.market?.crypto_asset || 'USDT';
  const fiat = order?.market?.fiat_currency || 'TRY';
  const rate = Number(order?.market?.exchange_rate || 0);

  const minFillAmountRaw = order?.amounts?.min_fill_amount;
  const remainingAmountRaw = order?.amounts?.remaining_amount;
  const minFillAmount = Number(order?.amounts?.min_fill_amount_num ?? rawToNumber(minFillAmountRaw));
  const remainingAmount = Number(order?.amounts?.remaining_amount_num ?? rawToNumber(remainingAmountRaw));

  const tier = order?.tier ?? 0;
  const makerBondPct = Number(bondMap?.[tier]?.maker ?? 0);
  const takerBondPct = Number(bondMap?.[tier]?.taker ?? 0);
  const sideBondPct = side === 'BUY_CRYPTO'
    ? takerBondPct
    : side === 'SELL_CRYPTO'
      ? makerBondPct
      : null;

  const limitLabel = lang === 'TR'
    ? `Min Fill ${minFillAmount} ${crypto} • Kalan ${remainingAmount} ${crypto}`
    : `Min Fill ${minFillAmount} ${crypto} • Remaining ${remainingAmount} ${crypto}`;

  const ownerAddress = order?.owner_address || '';
  const tokenAddress = order?.token_address || '';
  const tokenPolicy = tokenAddress ? (tokenMap?.[tokenAddress.toLowerCase()] || null) : null;

  return {
    id: order?._id,
    onchainId: order?.onchain_order_id ?? null,
    ownerAddress,
    ownerDisplay: formatAddress(ownerAddress),
    maker: formatAddress(ownerAddress),
    makerFull: ownerAddress,
    side,
    sideLabel: sideMeta ? sideMeta.sideLabel[lang] : (lang === 'TR' ? 'Geçersiz Side' : 'Invalid Side'),
    status,
    statusLabel: statusMeta[lang] || status,
    ctaLabel: sideMeta ? sideMeta.ctaLabel[lang] : (lang === 'TR' ? 'Kullanılamaz' : 'Unavailable'),
    isActionable: Boolean(sideMeta),
    tier,
    crypto,
    fiat,
    rate,
    minFillAmount,
    remainingAmount,
    limitLabel,
    bondLabel: sideBondPct != null && sideBondPct > 0 ? `${sideBondPct}%` : '—',
    tokenAddress,
    tokenPolicy,
    // legacy ui analytics fields
    successRate: Number(order?.stats?.fill_rate_pct ?? 100),
    txCount: Number(order?.stats?.fills_count ?? 0),
  };
};
