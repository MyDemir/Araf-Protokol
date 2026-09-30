"use strict";

/**
 * Orders Route — V3 Parent Order Read Layer
 *
 * Felsefe:
 *   - Parent order authoritative state'i backend üretmez.
 *   - Bu route yalnız Mongo mirror + on-chain sourced config'i sorgular.
 *   - Create/fill/cancel gibi state-changing aksiyonlar kontrat üstünde gerçekleşir.
 */

const express = require("express");
const { parsePositiveOnchainId: _parsePositiveOnchainId } = require("../utils/onchain");
const Joi = require("joi");
const router = express.Router();

const { requireAuth, requireSessionWalletMatch } = require("../middleware/auth");
const { marketReadLimiter, ordersReadLimiter, ordersWriteLimiter } = require("../middleware/rateLimiter");
const Order = require("../models/Order");
const Trade = require("../models/Trade");
const User = require("../models/User");
const logger = require("../utils/logger");
const { getConfig } = require("../services/protocolConfig");
const { buildTradeHealthSignals } = require("./tradeRisk");
const { ALLOWED_FIAT, normalizeMarketMeta, storePendingMarketMeta } = require("../services/orderMarketMeta");

const FILLABLE_ORDER_STATUSES = ["OPEN", "PARTIALLY_FILLED"];

const SAFE_ORDER_PROJECTION = [
  "_id",
  "onchain_order_id",
  "owner_address",
  "side",
  "status",
  "tier",
  "payment_risk_level",
  "token_address",
  "market",
  "amounts",
  "reserves",
  "fee_snapshot",
  "refs.order_ref",
  "stats",
  "timers",
].join(" ");
const SAFE_ORDER_PROJECTION_FIELDS = Object.fromEntries(SAFE_ORDER_PROJECTION.split(" ").map((f) => [f, 1]));

// [TR] min_amount token birimindedir; her token için kendi ondalığıyla ham birime çevrilir.
//      Ondalık bilinmiyorsa null döner (filtre güvenle uygulanamaz).
// [EN] min_amount is in token units, converted per token with its own decimals; null if unknown.
// [TR] Float çarpımı (x * 10**d) yerine ondalık metin üstünden tam sayı (BigInt) dönüşümü.
//      Ondalıktan fazla basamak varsa yukarı yuvarlanır (tutar en az istenen kadar olmalı).
// [EN] Integer-safe decimal→raw-unit conversion; extra fractional digits round up.
function _toRawUnits(amount, decimals) {
  const text = typeof amount === "string"
    ? amount.trim()
    : Number(amount).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const frac = m[2] || "";
  const kept = frac.slice(0, decimals).padEnd(decimals, "0");
  let raw = BigInt(m[1] + kept);
  if (/[1-9]/.test(frac.slice(decimals))) raw += 1n;
  const asNumber = Number(raw);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function _buildMinRemainingClauses(minAmount, tokenAddress) {
  let tokenMap;
  try {
    tokenMap = getConfig().tokenMap || {};
  } catch (_) {
    return null;
  }
  const byAddress = Object.fromEntries(Object.entries(tokenMap).map(([addr, cfg]) => [addr.toLowerCase(), cfg]));
  const tokens = tokenAddress ? [tokenAddress.toLowerCase()] : Object.keys(byAddress);
  const clauses = [];
  for (const token of tokens) {
    const decimals = Number(byAddress[token]?.decimals);
    if (!Number.isInteger(decimals) || decimals < 0) continue;
    // [TR] Tutar bu emirle tek fill'de alınabilmeli: kalan >= tutar ve (min fill <= tutar ya da tutar kalanın tamamı).
    // [EN] The amount must be fillable in one go: remaining >= amount and (min fill <= amount or it is the remainder).
    const raw = _toRawUnits(minAmount, decimals);
    if (raw === null) return null;
    clauses.push({
      token_address: token,
      "amounts.remaining_amount_num": { $gte: raw },
      $or: [{ "amounts.min_fill_amount_num": { $lte: raw } }, { "amounts.remaining_amount_num": raw }],
    });
  }
  return clauses.length ? clauses : null;
}

// [TR] Order sahibine ait child trade listesinde veri minimizasyonu.
//      Backend bu endpoint'te hakemlik üretmez; yalnız UI için gereken alanları döner.
//      PII snapshot, şifreli dekont payload ve ham imza alanları response'a girmez.
// [EN] Data minimization for child trades returned to order owners.
//      This endpoint remains read-only and non-authoritative.
const SAFE_ORDER_TRADES_PROJECTION = [
  "_id",
  "onchain_escrow_id",
  "parent_order_id",
  "maker_address",
  "taker_address",
  "status",
  "resolution_type",
  "tier",
  "payment_risk_level_snapshot",
  "token_address",
  "financials",
  "fee_snapshot",
  "timers",
  "cancel_proposal.proposed_by",
  "cancel_proposal.proposed_at",
  "cancel_proposal.approved_by",
  "cancel_proposal.deadline",
  "cancel_proposal.maker_signed",
  "cancel_proposal.taker_signed",
  "evidence.ipfs_receipt_hash",
  "evidence.receipt_timestamp",
  "chargeback_ack.acknowledged",
  "chargeback_ack.acknowledged_at",
].join(" ");

const DEFAULT_MY_ORDERS_LIMIT = 20;
const MAX_MY_ORDERS_LIMIT = 50;
const DEFAULT_ORDER_TRADES_LIMIT = 50;
const MAX_ORDER_TRADES_LIMIT = 100;
const LOCK_OR_SNAPSHOT_CAPTURED_MATCH = {
  $or: [
    { "timers.locked_at": { $exists: true, $ne: null } },
    { "payout_snapshot.captured_at": { $exists: true, $ne: null } },
  ],
};

function _deriveTrustBandFromReasons(reasons = []) {
  const severityScore = (Array.isArray(reasons) ? reasons : []).reduce((acc, reason) => {
    if (reason === "maker_ban_mirror_active") return acc + 2;
    if (reason === "maker_profile_changed_after_lock") return acc + 1;
    if (reason === "maker_frequent_recent_bank_changes_at_lock") return acc + 1;
    if (reason === "partial_or_incomplete_snapshot") return acc + 1;
    return acc;
  }, 0);
  if (severityScore >= 3) return "RED";
  if (severityScore >= 1) return "YELLOW";
  return "GREEN";
}

function _toCompactTrustSummary(signal) {
  if (!signal || typeof signal !== "object") {
    return { available: false, band: null, label: "Signal unavailable" };
  }
  const band = _deriveTrustBandFromReasons(signal.explainableReasons || []);
  const labelByBand = {
    GREEN: "Low Signal",
    YELLOW: "Medium Signal",
    RED: "High Signal",
  };
  // [TR] Market order feed için yalnız taker-facing, privacy-conscious kısa özet döneriz.
  // [EN] For market order feed we only return a taker-facing, privacy-conscious compact summary.
  return {
    available: true,
    band,
    label: labelByBand[band],
    readOnly: signal.readOnly === true,
    nonBlocking: signal.nonBlocking === true,
    canBlockProtocolActions: signal.canBlockProtocolActions === true,
  };
}

async function _attachMarketTrustVisibilitySummary(orders = []) {
  if (!Array.isArray(orders) || orders.length === 0) return [];

  const makerAddresses = [...new Set(orders.map((o) => o?.owner_address).filter(Boolean))];
  if (makerAddresses.length === 0) return orders;

  // [TR] B39: güven özeti "fiat alan / payout profili gösteren" tarafı anlatır. SELL_CRYPTO emrinde bu
  //      taraf emir sahibi = child trade MAKER'ıdır; BUY_CRYPTO emrinde sahip child trade'de TAKER olur
  //      (maker = doldurandır). Bu yüzden rol emrin yönüne göre seçilir.
  // [EN] B39: for BUY_CRYPTO orders the owner is the child-trade taker, so use taker-side trades/snapshot.
  const sellOwners = [...new Set(orders.filter((o) => o?.owner_address && o.side !== "BUY_CRYPTO").map((o) => o.owner_address))];
  const buyOwners = [...new Set(orders.filter((o) => o?.owner_address && o.side === "BUY_CRYPTO").map((o) => o.owner_address))];

  const latestByRole = (role, owners) => {
    if (owners.length === 0) return Promise.resolve([]);
    const addrField = `${role}_address`;
    const snapField = `payout_snapshot.${role}`;
    return Trade.aggregate([
      { $match: { [addrField]: { $in: owners }, ...LOCK_OR_SNAPSHOT_CAPTURED_MATCH } },
      { $sort: { [addrField]: 1, created_at: -1, _id: -1 } },
      { $project: { [addrField]: 1, "payout_snapshot.is_complete": 1, [snapField]: 1 } },
      { $unset: [`${snapField}.payout_details_enc`, `${snapField}.contact_value_enc`] },
      { $group: { _id: `$${addrField}`, trade: { $first: "$$ROOT" } } },
    ]);
  };

  const [makerUsers, latestSellRows, latestBuyRows] = await Promise.all([
    // [TR] B25: şifreli payout_profile blob'u çekilmez; risk sinyali yalnız fingerprint.version ister.
    User.find({ wallet_address: { $in: makerAddresses } })
      .select("wallet_address profileVersion payout_profile.fingerprint.version reputation_cache is_banned banned_until consecutive_bans")
      .lean(),
    // [TR] Güven sinyali trade'den yalnız payout_snapshot (maker özeti) okur. Tam belge ($$ROOT) yerine yalnız
    //      bu alanlar taşınır; şifreli ödeme alanları hiç çekilmez. Sıralama {maker_address, created_at}
    //      indeksine uyar, böylece $group her maker'ın ilk belgesini indeks sırasıyla alır.
    // [EN] The trust signal only reads payout_snapshot (maker summary). Carry just those fields (never the
    //      encrypted payout fields) instead of $$ROOT; the sort matches the {maker_address, created_at} index.
    latestByRole("maker", sellOwners),
    latestByRole("taker", buyOwners),
  ]);

  const userMap = new Map(makerUsers.map((u) => [u.wallet_address, u]));
  const toMap = (rows) => new Map(rows.filter((row) => row?._id && row?.trade).map((row) => [row._id, row.trade]));
  const sellTradeMap = toMap(latestSellRows);
  // [TR] Taker tarafı snapshot'ı, health-signal fonksiyonunun beklediği "maker" anahtarına taşınır.
  const buyTradeMap = new Map(
    [...toMap(latestBuyRows)].map(([addr, trade]) => [
      addr,
      { ...trade, payout_snapshot: { ...trade.payout_snapshot, maker: trade.payout_snapshot?.taker } },
    ])
  );

  return orders.map((order) => {
    const maker = order?.owner_address;
    const makerUser = userMap.get(maker) || null;
    const latestTrade = (order.side === "BUY_CRYPTO" ? buyTradeMap : sellTradeMap).get(maker) || null;
    const signal = latestTrade ? buildTradeHealthSignals(latestTrade, makerUser, null) : null;
    return {
      ...order,
      trust_visibility_summary: _toCompactTrustSummary(signal),
    };
  });
}


function _buildIdentityLookup(field, idString) {
  return { [field]: idString };
}

router.get("/config", marketReadLimiter, async (_req, res, next) => {
  try {
    const config = getConfig();
    return res.json({
      bondMap: config.bondMap,
      feeConfig: config.feeConfig,
      cooldownConfig: config.cooldownConfig,
      tokenMap: config.tokenMap || {},
      paymentRiskConfig: config.paymentRiskConfig || {},
      reputationPolicy: config.reputationPolicy || null,
      // [TR] Frontend kendi escrow adresi/zinciriyle karşılaştırır; farklıysa uyarı gösterir (deploy uyumu).
      // [EN] The frontend compares these with its own escrow/chain and warns on drift (deploy alignment).
      deployment: {
        escrowAddress: (process.env.ARAF_ESCROW_ADDRESS || "").toLowerCase() || null,
        chainId: Number(process.env.EXPECTED_CHAIN_ID) || null,
      },
      selectedOrderRiskLevel: {
        source: "onchain_order_snapshot",
        nonAuthoritative: true,
      },
    });
  } catch (err) {
    if (err.code === "CONFIG_UNAVAILABLE") return res.status(503).json({ error: err.message });
    next(err);
  }
});

router.get("/payment-risk-config", marketReadLimiter, async (_req, res, next) => {
  try {
    const config = getConfig();
    return res.json({
      paymentRiskConfig: config.paymentRiskConfig || {},
      selectedOrderRiskLevel: {
        source: "onchain_order_snapshot",
        nonAuthoritative: true,
      },
    });
  } catch (err) {
    if (err.code === "CONFIG_UNAVAILABLE") return res.status(503).json({ error: err.message });
    next(err);
  }
});

// [TR] Pazar yanıtı herkese açık ve tüm ziyaretçilerde aynıdır; istemciler 30 sn'de bir yokladığı için
//      aynı sorgu kısa süre bellekte tutulur (varsayılan 10 sn). Her istekte 4 Mongo sorgusu yerine
//      TTL başına bir kez çalışır. Testlerde varsayılan kapalıdır.
// [EN] The market response is public and identical for every visitor; clients poll every 30 s, so the
//      same query is kept in memory briefly (10 s default): 4 Mongo queries once per TTL instead of per request.
const MARKET_CACHE_TTL_MS = Number(process.env.MARKET_CACHE_TTL_MS ?? (process.env.NODE_ENV === "test" ? 0 : 10_000));
const MARKET_CACHE_MAX_ENTRIES = 200;
const marketCache = new Map();

function _marketCacheGet(key) {
  const hit = marketCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    marketCache.delete(key);
    return null;
  }
  return hit.body;
}

function _marketCacheSet(key, body) {
  if (!(MARKET_CACHE_TTL_MS > 0)) return;
  if (marketCache.size >= MARKET_CACHE_MAX_ENTRIES) marketCache.delete(marketCache.keys().next().value);
  marketCache.set(key, { body, expiresAt: Date.now() + MARKET_CACHE_TTL_MS });
}

router.get("/", marketReadLimiter, async (req, res, next) => {
  try {
    const cacheKey = req.originalUrl;
    const cached = _marketCacheGet(cacheKey);
    if (cached) {
      res.set("X-Cache", "HIT");
      return res.json(cached);
    }
    const schema = Joi.object({
      side: Joi.string().valid("SELL_CRYPTO", "BUY_CRYPTO").optional(),
      // [TR] ACTIVE = fill edilebilir (OPEN + PARTIALLY_FILLED). Pazar yeri bunu kullanır;
      //      filtresiz sorgu alfabetik status sıralamasıyla iptal/dolu emirleri öne çıkarıyordu.
      // [EN] ACTIVE = fillable (OPEN + PARTIALLY_FILLED), used by the marketplace feed.
      status: Joi.string().valid("ACTIVE", "OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELED").optional(),
      tier: Joi.number().valid(0, 1, 2, 3, 4).optional(),
      // [TR] Kullanıcının girebileceği emirler: tier <= max_tier. [EN] Orders the viewer can enter: tier <= max_tier.
      max_tier: Joi.number().valid(0, 1, 2, 3, 4).optional(),
      token_address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).optional(),
      owner_address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).optional(),
      // [TR] Sunucu tarafı pazar araması: fiat, token biriminde minimum kalan tutar ve en iyi kur sıralaması.
      //      İstemci yalnız ilk sayfayı çektiği için filtreler sunucuda uygulanmazsa sayfa dışı emirler kaybolur.
      // [EN] Server-side market search: fiat, minimum remaining amount (token units) and best-rate sort.
      fiat: Joi.string().valid("TRY", "USD", "EUR").optional(),
      min_amount: Joi.number().positive().optional(),
      sort: Joi.string().valid("default", "best_rate", "newest").default("default"),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(20),
    });
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    const filter = {};
    if (value.side) filter.side = value.side;
    if (value.status === "ACTIVE") filter.status = { $in: FILLABLE_ORDER_STATUSES };
    else if (value.status) filter.status = value.status;
    if (value.tier !== undefined) filter.tier = value.tier;
    else if (value.max_tier !== undefined) filter.tier = { $lte: value.max_tier };
    if (value.token_address) filter.token_address = value.token_address.toLowerCase();
    if (value.owner_address) filter.owner_address = value.owner_address.toLowerCase();
    if (value.fiat) filter["market.fiat_currency"] = value.fiat;
    if (value.min_amount !== undefined) {
      const minClauses = _buildMinRemainingClauses(value.min_amount, filter.token_address);
      if (minClauses === null) return res.status(503).json({ error: "Token decimals unavailable for min_amount filter." });
      filter.$or = minClauses;
    }

    const skip = (value.page - 1) * value.limit;
    if (value.sort === "best_rate") {
      // [TR] En iyi kur: kripto satan emirlerde (alıcı için) en düşük, kripto alanlarda en yüksek kur önce.
      //      Kuru olmayan emirler sona düşer; tie-break deterministic _id.
      // [EN] Best rate: lowest first for SELL_CRYPTO (buyer's view), highest first for BUY_CRYPTO.
      //      Orders without a rate go last; deterministic _id tie-break.
      const dir = value.side === "BUY_CRYPTO" ? -1 : 1;
      const [orders, total] = await Promise.all([
        Order.aggregate([
          { $match: filter },
          { $addFields: { _rateMissing: { $cond: [{ $gt: ["$market.exchange_rate", 0] }, 0, 1] } } },
          { $sort: { _rateMissing: 1, "market.exchange_rate": dir, _id: -1 } },
          { $skip: skip },
          { $limit: value.limit },
          { $project: SAFE_ORDER_PROJECTION_FIELDS },
        ]),
        Order.countDocuments(filter),
      ]);
      const ordersWithTrustSummary = await _attachMarketTrustVisibilitySummary(orders);
      const body = { orders: ordersWithTrustSummary, total, page: value.page, limit: value.limit };
      _marketCacheSet(cacheKey, body);
      return res.json(body);
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .select(SAFE_ORDER_PROJECTION)
        // [TR] onchain_order_id string olduğu için lexicographic drift'i önlemek adına
        //      tie-break'i deterministic _id ile yapıyoruz.
        // [EN] Use deterministic _id tie-break to avoid lexicographic drift on string IDs.
        .sort(value.sort === "newest" ? { created_at: -1, _id: -1 } : { status: 1, "amounts.remaining_amount_num": -1, _id: -1 })
        .skip(skip)
        .limit(value.limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    const ordersWithTrustSummary = await _attachMarketTrustVisibilitySummary(orders);
    const body = { orders: ordersWithTrustSummary, total, page: value.page, limit: value.limit };
    _marketCacheSet(cacheKey, body);
    return res.json(body);
  } catch (err) { next(err); }
});

// [TR] Kullanıcının kendi order listesi write-surface değil, paginated read-surface'tür.
//      Bu yüzden write limiter yerine read limiter uygulanır.
// [EN] User's own order list is a paginated read surface, not a write surface.
//      Apply read limiter instead of write limiter.
router.get("/my", requireAuth, requireSessionWalletMatch, ordersReadLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(MAX_MY_ORDERS_LIMIT).default(DEFAULT_MY_ORDERS_LIMIT),
    });
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    const filter = { owner_address: req.wallet };
    const skip = (value.page - 1) * value.limit;
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .select(SAFE_ORDER_PROJECTION)
        .sort({ updated_at: -1, _id: -1 })
        .skip(skip)
        .limit(value.limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    return res.json({ orders, total, page: value.page, limit: value.limit });
  } catch (err) { next(err); }
});

// ─── POST /api/orders/market-meta ────────────────────────────────────────────
// [TR] Maker'ın kur/fiat bilgisini (zincirde tutulmayan UI enrichment) set-once kaydeder.
//      Protokol otoritesi değildir; yalnız pazar yerinde fiyat gösterimi içindir.
// [EN] Stores the maker's off-chain fiat/rate (UI enrichment only) with set-once semantics.
router.post("/market-meta", requireAuth, requireSessionWalletMatch, ordersWriteLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      orderRef: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
      fiatCurrency: Joi.string().valid(...ALLOWED_FIAT).required(),
      exchangeRate: Joi.number().positive().max(1_000_000).required(),
    });
    const { error, value } = schema.validate(req.body || {});
    if (error) return res.status(400).json({ error: error.message });

    const meta = normalizeMarketMeta(value);
    if (!meta) return res.status(400).json({ error: "Geçersiz kur veya para birimi." });
    const orderRef = value.orderRef.toLowerCase();

    const existing = await Order.findOne({ "refs.order_ref": orderRef })
      .select("owner_address market")
      .lean();

    if (existing) {
      if (existing.owner_address !== req.wallet) {
        return res.status(403).json({ error: "Bu order sana ait değil." });
      }
      if (Number(existing.market?.exchange_rate) > 0) {
        return res.status(409).json({ error: "Kur bilgisi zaten kayıtlı.", code: "MARKET_META_ALREADY_SET" });
      }
      await Order.updateOne(
        { "refs.order_ref": orderRef, owner_address: req.wallet, "market.exchange_rate": null },
        { $set: { "market.fiat_currency": meta.fiat_currency, "market.exchange_rate": meta.exchange_rate } }
      );
      return res.status(201).json({ success: true, applied: true });
    }

    // [TR] Mirror henüz oluşmadıysa niyet Redis'e yazılır; worker OrderCreated'da sahibini doğrulayıp uygular.
    // [EN] Mirror not ready yet: store the intent; the worker verifies ownership on OrderCreated.
    const stored = await storePendingMarketMeta(orderRef, req.wallet, meta);
    if (!stored) {
      return res.status(409).json({ error: "Kur bilgisi zaten kayıtlı.", code: "MARKET_META_ALREADY_SET" });
    }
    logger.info(`[Orders] market meta niyeti kaydedildi: ref=${orderRef.slice(0, 10)}...`);
    return res.status(202).json({ success: true, applied: false });
  } catch (err) { next(err); }
});

// [TR] Parent order'a bağlı child trade listesi state-changing değildir; read surface'tür.
// [EN] Child trade list/read surface under a parent order is non-authoritative.
router.get("/:id/trades", requireAuth, requireSessionWalletMatch, ordersReadLimiter, async (req, res, next) => {
  try {
    const onchainOrderId = _parsePositiveOnchainId(req.params.id);
    if (!onchainOrderId) {
      return res.status(400).json({ error: "Geçersiz on-chain order ID formatı." });
    }

    const order = await Order.findOne(_buildIdentityLookup("onchain_order_id", onchainOrderId))
      .select("owner_address")
      .lean();
    if (!order) return res.status(404).json({ error: "Order bulunamadı." });
    if (order.owner_address !== req.wallet) return res.status(403).json({ error: "Bu order sana ait değil." });

    const pageSchema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(MAX_ORDER_TRADES_LIMIT).default(DEFAULT_ORDER_TRADES_LIMIT),
    });
    const { error, value } = pageSchema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    const tradeFilter = _buildIdentityLookup("parent_order_id", onchainOrderId);
    const [trades, total] = await Promise.all([
      Trade.find(tradeFilter)
        .select(SAFE_ORDER_TRADES_PROJECTION)
        .sort({ created_at: -1, _id: -1 })
        .skip((value.page - 1) * value.limit)
        .limit(value.limit)
        .lean(),
      Trade.countDocuments(tradeFilter),
    ]);
    return res.json({ trades, total, page: value.page, limit: value.limit });
  } catch (err) { next(err); }
});

router.get("/:id", marketReadLimiter, async (req, res, next) => {
  try {
    const onchainOrderId = _parsePositiveOnchainId(req.params.id);
    if (!onchainOrderId) {
      return res.status(400).json({ error: "Geçersiz on-chain order ID formatı." });
    }
    const order = await Order.findOne(_buildIdentityLookup("onchain_order_id", onchainOrderId))
      .select(SAFE_ORDER_PROJECTION)
      .lean();
    if (!order) return res.status(404).json({ error: "Order bulunamadı." });
    return res.json({ order });
  } catch (err) { next(err); }
});

module.exports = router;
