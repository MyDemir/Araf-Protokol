"use strict";

/**
 * Listings Route — V3 Marketplace Feed Alias
 *
 * V3'te authoritative public market nesnesi "Listing" değil, "Order"dur.
 * Bu route, eski frontend kart akışları için read-only bir uyumluluk katmanı sunar.
 *
 * Önemli:
 *   - POST/DELETE listing write yolları artık authoritative değildir.
 *   - Yeni create/cancel akışları kontrat üstündeki order fonksiyonları ile yürür.
 *   - Bu route yalnız OPEN / PARTIALLY_FILLED SELL order'ları kart formatına projekte eder.
 */

const express = require("express");
const Joi = require("joi");
const router = express.Router();

const { listingsReadLimiter, listingsWriteLimiter } = require("../middleware/rateLimiter");
const { requireAuth, requireSessionWalletMatch } = require("../middleware/auth");
const Order = require("../models/Order");
const logger = require("../utils/logger");
const { getConfig } = require("../services/protocolConfig");

function _toListingCard(order) {
  return {
    _id: String(order._id),
    onchain_order_id: order.onchain_order_id,
    maker_address: order.owner_address,
    crypto_asset: order.market?.crypto_asset || null,
    fiat_currency: order.market?.fiat_currency || null,
    exchange_rate: order.market?.exchange_rate || null,
    limits: {
      min: order.amounts?.min_fill_amount_num || 0,
      max: order.amounts?.remaining_amount_num || 0,
    },
    tier_rules: {
      required_tier: order.tier,
      maker_bond_pct: null,
      taker_bond_pct: null,
    },
    status: order.status,
    token_address: order.token_address,
    order_ref: order.refs?.order_ref || null,
    source: "V3_ORDER_FEED",
  };
}

router.get("/config", async (_req, res, next) => {
  try {
    const config = getConfig();
    return res.json({
      bondMap: config.bondMap,
      feeConfig: config.feeConfig,
      cooldownConfig: config.cooldownConfig,
      tokenMap: config.tokenMap || {},
    });
  } catch (err) {
    if (err.code === "CONFIG_UNAVAILABLE") return res.status(503).json({ error: err.message });
    next(err);
  }
});

router.get("/", listingsReadLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      fiat: Joi.string().valid("TRY", "USD", "EUR").optional(),
      amount: Joi.number().positive().optional(),
      tier: Joi.number().valid(0, 1, 2, 3, 4).optional(),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(20),
    });
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    const filter = { side: "SELL_CRYPTO", status: { $in: ["OPEN", "PARTIALLY_FILLED"] } };
    if (value.fiat) filter["market.fiat_currency"] = value.fiat;
    if (value.tier !== undefined) filter.tier = value.tier;
    if (value.amount) filter["amounts.remaining_amount_num"] = { $gte: value.amount };

    const skip = (value.page - 1) * value.limit;
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ "market.exchange_rate": 1, onchain_order_id: 1 })
        .skip(skip)
        .limit(value.limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    return res.json({ listings: orders.map(_toListingCard), total, page: value.page, limit: value.limit });
  } catch (err) { next(err); }
});

// [TR] Listing write yüzeyi artık authoritative değildir. Frontend create/fill/cancel
//      akışları V3 contract fonksiyonlarına taşınmalıdır.
router.post("/", requireAuth, requireSessionWalletMatch, listingsWriteLimiter, async (_req, res) => {
  return res.status(410).json({
    error: "Listing create route V3'te deprecated. createSellOrder/createBuyOrder akışını kullanın.",
    code: "LISTINGS_WRITE_DEPRECATED_IN_V3",
  });
});

router.delete("/:id", requireAuth, requireSessionWalletMatch, listingsWriteLimiter, async (req, res) => {
  logger.warn(`[Listings] Deprecated delete çağrısı: caller=${req.wallet} id=${req.params.id}`);
  return res.status(410).json({
    error: "Listing delete route V3'te deprecated. cancelSellOrder/cancelBuyOrder akışını kullanın.",
    code: "LISTINGS_DELETE_DEPRECATED_IN_V3",
  });
});

module.exports = router;
