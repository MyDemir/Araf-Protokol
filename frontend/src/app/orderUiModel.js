/**
 * Frontend UI model/adapter helpers for order rendering & view actions.
 * NOTE: This is NOT the backend DB model (see backend/scripts/models/Order.js).
 */

import { formatUnits } from 'viem';

const DEFAULT_TOKEN_DECIMALS = 6;
const VALID_ORDER_SIDES = new Set(['SELL_CRYPTO', 'BUY_CRYPTO']);
const SEPA_COUNTRIES = new Set(['DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'AT', 'PT', 'IE', 'LU', 'FI', 'GR']);

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

export const resolvePaymentRiskEntry = ({ paymentRiskConfig = {}, rail, country }) => {
  const safeRail = String(rail || '').toUpperCase();
  const safeCountry = String(country || '').toUpperCase();
  if (!safeRail || !paymentRiskConfig || typeof paymentRiskConfig !== 'object') return null;
  const direct = paymentRiskConfig?.[safeCountry]?.[safeRail];
  if (direct) return direct;
  if (safeRail === 'SEPA_IBAN' && SEPA_COUNTRIES.has(safeCountry)) {
    return paymentRiskConfig?.EU?.SEPA_IBAN || null;
  }
  const genericEntry = Object.values(paymentRiskConfig)
    .find((bucket) => bucket && typeof bucket === 'object' && bucket[safeRail]);
  return genericEntry?.[safeRail] || null;
};

export const deriveOrderPaymentRiskSignal = ({ order, paymentRiskConfig = {} }) => {
  const rail = order?.payment_method?.rail
    || order?.payment_rail
    || order?.settlement_profile?.rail
    || null;
  const country = order?.payment_method?.country
    || order?.payment_country
    || order?.settlement_profile?.country
    || null;
  const hasExplicitRailCountry = Boolean(rail && country);
  if (!hasExplicitRailCountry) {
    // [TR] Feed rail/country taşımıyorsa order-specific risk sinyali üretilmez.
    // [EN] If feed lacks explicit rail/country, do not fabricate an order-specific risk signal.
    return null;
  }

  const resolved = resolvePaymentRiskEntry({ paymentRiskConfig, rail, country });
  if (!resolved) return null;
  return {
    ...resolved,
    generic: resolved?.generic === true,
    orderSpecific: resolved?.generic === true ? false : true,
  };
};


export const removeOrderByOnchainId = (orders = [], onchainId) => {
  return orders.filter((o) => o?.onchainId !== onchainId);
};

const HEALTH_REASON_COPY = {
  maker_profile_changed_after_lock: {
    TR: 'Maker profil sürümü lock sonrası değişmiş.',
    EN: 'Maker profile version changed after lock.',
  },
  maker_frequent_recent_bank_changes_at_lock: {
    TR: 'Lock anında maker banka değişimi sıklığı eşik üstünde.',
    EN: 'At lock time, maker bank-change frequency exceeded threshold.',
  },
  partial_or_incomplete_snapshot: {
    TR: 'Snapshot eksik/kısmi olabilir; yorum dikkatle okunmalı.',
    EN: 'Snapshot may be partial/incomplete; interpret carefully.',
  },
  maker_ban_mirror_active: {
    TR: 'Maker ban mirror sinyali lock bağlamında aktif görünüyor.',
    EN: 'Maker ban mirror signal appears active in lock context.',
  },
  counterparty_high_partial_settlement_ratio: {
    TR: 'Karşı taraf geçmişinde uzlaşmalı kapanış oranı yüksek (ceza değil, davranış sinyali).',
    EN: 'Counterparty has a high agreed-settlement ratio (behavioral signal, not a penalty).',
  },
};

export const mapOffchainHealthToUi = ({ signal, lang = 'TR' }) => {
  if (!signal || typeof signal !== 'object') return null;

  const reasons = Array.isArray(signal.explainableReasons) ? signal.explainableReasons : [];

  // [TR] Deterministik, UI-only şiddet eşlemesi. Bu puan authority üretmez.
  // [EN] Deterministic UI-only severity mapping. This score never creates authority.
  const severityScore = reasons.reduce((acc, reason) => {
    if (reason === 'maker_ban_mirror_active') return acc + 2;
    if (reason === 'maker_profile_changed_after_lock') return acc + 1;
    if (reason === 'maker_frequent_recent_bank_changes_at_lock') return acc + 1;
    if (reason === 'partial_or_incomplete_snapshot') return acc + 1;
    if (reason === 'counterparty_high_partial_settlement_ratio') return acc;
    return acc;
  }, 0);

  const severityBand = severityScore >= 3 ? 'RED' : severityScore >= 1 ? 'YELLOW' : 'GREEN';
  const severityMeta = {
    GREEN: { TR: 'Düşük Sinyal', EN: 'Low Signal', chipClass: 'text-emerald-400 border-emerald-700/60 bg-emerald-900/20' },
    YELLOW: { TR: 'Orta Sinyal', EN: 'Medium Signal', chipClass: 'text-amber-400 border-amber-700/60 bg-amber-900/20' },
    RED: { TR: 'Yüksek Sinyal', EN: 'High Signal', chipClass: 'text-red-400 border-red-700/60 bg-red-900/20' },
  }[severityBand];

  return {
    severityBand,
    severityLabel: severityMeta[lang] || severityMeta.EN,
    severityChipClass: severityMeta.chipClass,
    reasons,
    reasonLabels: reasons.map((reason) => HEALTH_REASON_COPY?.[reason]?.[lang] || reason),
    readOnly: signal.readOnly === true,
    nonBlocking: signal.nonBlocking === true,
    canBlockProtocolActions: signal.canBlockProtocolActions === true,
    maker: signal.maker || null,
    snapshot: signal.snapshot || null,
  };
};

export const mapCompactTrustSummary = ({ compactSummary, signal, lang = 'TR' }) => {
  // [TR] Öncelik backend'in market-safe compact özet alanındadır.
  // [EN] Prefer backend-provided market-safe compact summary field.
  if (compactSummary && typeof compactSummary === 'object' && compactSummary.available === true) {
    const band = compactSummary.band || null;
    const fallbackChip = 'text-slate-400 border-slate-700/60 bg-slate-900/20';
    const chipByBand = {
      GREEN: 'text-emerald-400 border-emerald-700/60 bg-emerald-900/20',
      YELLOW: 'text-amber-400 border-amber-700/60 bg-amber-900/20',
      RED: 'text-red-400 border-red-700/60 bg-red-900/20',
    };
    return {
      available: true,
      band,
      label: compactSummary.label || (lang === 'TR' ? 'Sinyal' : 'Signal'),
      chipClass: chipByBand[band] || fallbackChip,
      readOnly: compactSummary.readOnly === true,
      nonBlocking: compactSummary.nonBlocking === true,
      canBlockProtocolActions: compactSummary.canBlockProtocolActions === true,
    };
  }

  const mapped = mapOffchainHealthToUi({ signal, lang });
  if (!mapped) {
    return {
      available: false,
      band: null,
      label: lang === 'TR' ? 'Sinyal yok' : 'Signal unavailable',
      chipClass: 'text-slate-400 border-slate-700/60 bg-slate-900/20',
    };
  }

  // [TR] Hover'da gizlilik için nedenleri göstermiyoruz; yalnız band + kısa etiket döneriz.
  // [EN] For hover privacy we do not expose reasons; only band + short label are returned.
  return {
    available: true,
    band: mapped.severityBand,
    label: mapped.severityLabel,
    chipClass: mapped.severityChipClass,
    readOnly: mapped.readOnly,
    nonBlocking: mapped.nonBlocking,
    canBlockProtocolActions: mapped.canBlockProtocolActions,
  };
};

export const mapApiOrderToUi = ({ order, lang = 'TR', bondMap = {}, tokenMap = {}, paymentRiskConfig = {}, formatAddress = (v) => v }) => {
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
  const ownerSideHint = side === 'SELL_CRYPTO'
    ? (lang === 'TR' ? 'Order sahibi kripto satıyor' : 'Order owner is selling crypto')
    : side === 'BUY_CRYPTO'
      ? (lang === 'TR' ? 'Order sahibi kripto alıyor' : 'Order owner is buying crypto')
      : (lang === 'TR' ? 'Order sahibi rolü doğrulanamadı' : 'Order owner side could not be verified');
  const fillsCount = Number(order?.stats?.fills_count ?? 0);
  const trustSummary = mapCompactTrustSummary({
    compactSummary: order?.trust_visibility_summary || null,
    signal: order?.offchain_health_score_input || null,
    lang,
  });
  const paymentRiskSignal = deriveOrderPaymentRiskSignal({ order, paymentRiskConfig });
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
    // [TR] V3 market hover kartı için taraf-bağımlı kısa açıklama (seller-only dilinden kaçınır).
    // [EN] Side-aware summary hint for V3 hover card (avoids seller-only terminology).
    ownerSideHint,
    trustSummary,
    paymentRiskSignal,
    // legacy ui analytics fields
    successRate: Number(order?.stats?.fill_rate_pct ?? 100),
    txCount: fillsCount,
    totalTrades: fillsCount,
  };
};
