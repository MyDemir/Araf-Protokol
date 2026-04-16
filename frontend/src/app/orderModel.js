import { formatUnits } from 'viem';

const DEFAULT_TOKEN_DECIMALS = 6;

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
  if (side === 'SELL_CRYPTO' || side === 'BUY_CRYPTO') return side;
  return 'UNKNOWN';
};

export const resolveOrderActionFns = (side, fns) => {
  if (side === 'BUY_CRYPTO') {
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

export const mapApiOrderToUi = ({ order, lang = 'TR', bondMap = {}, tokenMap = {}, formatAddress = (v) => v }) => {
  const side = normalizeOrderSide(order?.side);
  const sideMeta = SIDE_META[side];
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
  const sideBondPct = side === 'BUY_CRYPTO' ? takerBondPct : makerBondPct;

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
    sideLabel: sideMeta ? sideMeta.sideLabel[lang] : (lang === 'TR' ? 'Bilinmeyen Side' : 'Unknown Side'),
    status,
    statusLabel: statusMeta[lang] || status,
    ctaLabel: sideMeta ? sideMeta.ctaLabel[lang] : (lang === 'TR' ? 'İşlem' : 'Trade'),
    tier,
    crypto,
    fiat,
    rate,
    minFillAmount,
    remainingAmount,
    limitLabel,
    bondLabel: sideBondPct > 0 ? `${sideBondPct}%` : '—',
    tokenAddress,
    tokenPolicy,
    // legacy ui analytics fields
    successRate: Number(order?.stats?.fill_rate_pct ?? 100),
    txCount: Number(order?.stats?.fills_count ?? 0),
  };
};

export const getMakerModalCopy = (side, lang = 'TR') => {
  if (side === 'BUY_CRYPTO') {
    return {
      submitLabel: lang === 'TR' ? '🧾 Onayla ve Buy Order Aç' : '🧾 Approve & Open Buy Order',
      previewTitle: lang === 'TR' ? 'Buy Order Reserve Özeti' : 'Buy Order Reserve Summary',
      bondRoleLabel: lang === 'TR' ? 'Taker Reserve' : 'Taker Reserve',
    };
  }
  return {
    submitLabel: lang === 'TR' ? '🧾 Onayla ve Sell Order Aç' : '🧾 Approve & Open Sell Order',
    previewTitle: lang === 'TR' ? 'Sell Order Kilit Özeti' : 'Sell Order Lock Summary',
    bondRoleLabel: lang === 'TR' ? 'Maker Reserve' : 'Maker Reserve',
  };
};
