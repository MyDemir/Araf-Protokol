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
const Joi = require("joi");
const router = express.Router();

const { requireAuth } = require("../middleware/auth");
const { listingsReadLimiter, listingsWriteLimiter } = require("../middleware/rateLimiter");
const Order = require("../models/Order");
const Trade = require("../models/Trade");
const { getConfig } = require("../services/protocolConfig");

const SAFE_ORDER_PROJECTION = [
  "_id",
  "onchain_order_id",
  "owner_address",
  "side",
  "status",
  "tier",
  "token_address",
  "market",
  "amounts",
  "reserves",
  "fee_snapshot",
  "refs.order_ref",
  "stats",
  "timers",
].join(" ");

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
      side: Joi.string().valid("SELL_CRYPTO", "BUY_CRYPTO").optional(),
      status: Joi.string().valid("OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELED").optional(),
      tier: Joi.number().valid(0, 1, 2, 3, 4).optional(),
      token_address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).optional(),
      owner_address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).optional(),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(20),
    });
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    const filter = {};
    if (value.side) filter.side = value.side;
    if (value.status) filter.status = value.status;
    if (value.tier !== undefined) filter.tier = value.tier;
    if (value.token_address) filter.token_address = value.token_address.toLowerCase();
    if (value.owner_address) filter.owner_address = value.owner_address.toLowerCase();

    const skip = (value.page - 1) * value.limit;
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .select(SAFE_ORDER_PROJECTION)
        .sort({ status: 1, "amounts.remaining_amount_num": -1, onchain_order_id: -1 })
        .skip(skip)
        .limit(value.limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    return res.json({ orders, total, page: value.page, limit: value.limit });
  } catch (err) { next(err); }
});

router.get("/my", requireAuth, listingsWriteLimiter, async (req, res, next) => {
  try {
    const orders = await Order.find({ owner_address: req.wallet })
      .select(SAFE_ORDER_PROJECTION)
      .sort({ updated_at: -1, onchain_order_id: -1 })
      .lean();
    return res.json({ orders });
  } catch (err) { next(err); }
});

router.get("/:id/trades", requireAuth, listingsWriteLimiter, async (req, res, next) => {
  try {
    const onchainOrderId = Number(req.params.id);
    if (!Number.isInteger(onchainOrderId) || onchainOrderId <= 0) {
      return res.status(400).json({ error: "Geçersiz on-chain order ID formatı." });
    }

    const order = await Order.findOne({ onchain_order_id: onchainOrderId })
      .select("owner_address")
      .lean();
    if (!order) return res.status(404).json({ error: "Order bulunamadı." });
    if (order.owner_address !== req.wallet) return res.status(403).json({ error: "Bu order sana ait değil." });

    const trades = await Trade.find({ parent_order_id: onchainOrderId })
      .sort({ created_at: -1, onchain_escrow_id: -1 })
      .lean();
    return res.json({ trades });
  } catch (err) { next(err); }
});

router.get("/:id", listingsReadLimiter, async (req, res, next) => {
  try {
    const onchainOrderId = Number(req.params.id);
    if (!Number.isInteger(onchainOrderId) || onchainOrderId <= 0) {
      return res.status(400).json({ error: "Geçersiz on-chain order ID formatı." });
    }
    const order = await Order.findOne({ onchain_order_id: onchainOrderId }).select(SAFE_ORDER_PROJECTION).lean();
    if (!order) return res.status(404).json({ error: "Order bulunamadı." });
    return res.json({ order });
  } catch (err) { next(err); }
});

module.exports = router;
