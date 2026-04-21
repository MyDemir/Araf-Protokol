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

const { requireAuth, requireSessionWalletMatch } = require("../middleware/auth");
const { marketReadLimiter, ordersReadLimiter, ordersWriteLimiter } = require("../middleware/rateLimiter");
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
  "tier",
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

const POSITIVE_NUMERIC_ID_RE = /^[1-9]\d*$/;
const DEFAULT_MY_ORDERS_LIMIT = 20;
const MAX_MY_ORDERS_LIMIT = 50;

function _parsePositiveOnchainId(rawId) {
  const normalized = String(rawId ?? "").trim();
  if (!POSITIVE_NUMERIC_ID_RE.test(normalized)) return null;
  return normalized;
}

function _buildIdentityLookup(field, idString) {
  return { [field]: idString };
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
        // [TR] onchain_order_id string olduğu için lexicographic drift'i önlemek adına
        //      tie-break'i deterministic _id ile yapıyoruz.
        // [EN] Use deterministic _id tie-break to avoid lexicographic drift on string IDs.
        .sort({ status: 1, "amounts.remaining_amount_num": -1, _id: -1 })
        .skip(skip)
        .limit(value.limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    return res.json({ orders, total, page: value.page, limit: value.limit });
  } catch (err) { next(err); }
});

// [TR] Kullanıcının kendi order listesi write-surface değil, paginated read-surface'tür.
//      Bu yüzden write limiter yerine read limiter uygulanır.
// [EN] User's own order listing is a paginated read surface, not a write surface.
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

router.get("/:id/trades", requireAuth, requireSessionWalletMatch, ordersWriteLimiter, async (req, res, next) => {
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

    const trades = await Trade.find(_buildIdentityLookup("parent_order_id", onchainOrderId))
      .select(SAFE_ORDER_TRADES_PROJECTION)
      .sort({ created_at: -1, _id: -1 })
      .lean();
    return res.json({ trades });
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
