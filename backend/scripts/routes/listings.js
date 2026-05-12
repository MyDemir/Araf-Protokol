"use strict";

/**
 * Deprecated Listings Route — read-only V3 compatibility alias
 *
 * V3 canonical market primitive is Parent Order, not Listing. This file is kept
 * only for old read clients that still call /api/listings directly in isolated
 * compatibility tests; it is not part of the canonical app.js mount surface.
 *
 * Contract authority: ArafEscrow parent-order functions create/cancel orders.
 * Backend role: mirror/read-model projection only.
 *
 * Compatibility guarantees:
 *   - GET / and GET /config remain read-only projections over Order documents.
 *   - POST/DELETE write routes are permanently deprecated and return 410.
 *   - No route in this file is a canonical V3 write API.
 */

const express = require("express");
const Joi = require("joi");
const router = express.Router();

const { marketReadLimiter, ordersWriteLimiter } = require("../middleware/rateLimiter");
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

router.get("/", marketReadLimiter, async (req, res, next) => {
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
        // [TR] onchain_order_id string olduğu için lexicographic sıra yanılmasını önlüyoruz.
        // [EN] Avoid lexicographic drift from string onchain_order_id by using _id tie-break.
        .sort({ "market.exchange_rate": 1, _id: 1 })
        .skip(skip)
        .limit(value.limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    return res.json({ listings: orders.map(_toListingCard), total, page: value.page, limit: value.limit });
  } catch (err) { next(err); }
});

// [TR] Deprecated compatibility write yüzeyi: V3'te parent order create/cancel
//      sadece kontrat otoritesiyle yürür; backend burada 410 döner.
// [EN] Deprecated compatibility write surface: V3 parent order create/cancel
//      is contract-authoritative; backend returns 410 here.
router.post("/", requireAuth, requireSessionWalletMatch, ordersWriteLimiter, async (_req, res) => {
  return res.status(410).json({
    error: "Deprecated /api/listings write route. Use the canonical order-first createSellOrder/createBuyOrder flow.",
    code: "LISTINGS_WRITE_DEPRECATED_IN_V3",
  });
});

router.delete("/:id", requireAuth, requireSessionWalletMatch, ordersWriteLimiter, async (req, res) => {
  logger.warn(`[Listings] Deprecated delete çağrısı: caller=${req.wallet} id=${req.params.id}`);
  return res.status(410).json({
    error: "Deprecated /api/listings delete route. Use the canonical order-first cancelSellOrder/cancelBuyOrder flow.",
    code: "LISTINGS_DELETE_DEPRECATED_IN_V3",
  });
});

module.exports = router;
