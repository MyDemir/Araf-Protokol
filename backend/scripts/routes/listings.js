"use strict";

const express = require("express");
const Joi     = require("joi");
const router  = express.Router();

const { requireAuth }                                  = require("../middleware/auth");
const { listingsReadLimiter, listingsWriteLimiter }    = require("../middleware/rateLimiter");
const { Listing }                                      = require("../models/Trade");

/**
 * GET /api/listings
 * Pazar yeri ilanlarını listeler. Herkese açık.
 * Query: fiat, amount, tier, page, limit
 */
router.get("/", listingsReadLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      fiat:   Joi.string().valid("TRY", "USD", "EUR").optional(),
      amount: Joi.number().positive().optional(),
      tier:   Joi.number().valid(1, 2, 3).optional(),
      page:   Joi.number().integer().min(1).default(1),
      limit:  Joi.number().integer().min(1).max(50).default(20),
    });
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    const filter = { status: "OPEN" };
    if (value.fiat)   filter.fiat_currency = value.fiat;
    if (value.tier)   filter["tier_rules.required_tier"] = value.tier;
    if (value.amount) {
      filter["limits.min"] = { $lte: value.amount };
      filter["limits.max"] = { $gte: value.amount };
    }

    const skip     = (value.page - 1) * value.limit;
    const listings = await Listing.find(filter)
      .sort({ exchange_rate: 1 })
      .skip(skip)
      .limit(value.limit)
      .lean();

    const total = await Listing.countDocuments(filter);
    return res.json({ listings, total, page: value.page, limit: value.limit });
  } catch (err) { next(err); }
});

/**
 * POST /api/listings
 * Yeni ilan oluşturur. Auth gerekli.
 */
router.post("/", requireAuth, listingsWriteLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      crypto_asset:      Joi.string().valid("USDT", "USDC").required(),
      fiat_currency:     Joi.string().valid("TRY", "USD", "EUR").required(),
      exchange_rate:     Joi.number().positive().required(),
      limits:            Joi.object({ min: Joi.number().positive().required(), max: Joi.number().positive().required() }).required(),
      tier:              Joi.number().valid(1, 2, 3).required(),
      token_address:     Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
      onchain_escrow_id: Joi.number().optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    if (value.limits.max <= value.limits.min) {
      return res.status(400).json({ error: "limits.max, limits.min'den büyük olmalı" });
    }

    const bondMap = { 1: { maker: 18, taker: 0 }, 2: { maker: 15, taker: 12 }, 3: { maker: 10, taker: 8 } };
    const bonds   = bondMap[value.tier];

    const listing = await Listing.create({
      maker_address:     req.wallet,
      crypto_asset:      value.crypto_asset,
      fiat_currency:     value.fiat_currency,
      exchange_rate:     value.exchange_rate,
      limits:            value.limits,
      tier_rules:        { required_tier: value.tier, maker_bond_pct: bonds.maker, taker_bond_pct: bonds.taker },
      token_address:     value.token_address,
      onchain_escrow_id: value.onchain_escrow_id || null,
    });

    return res.status(201).json({ listing });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/listings/:id
 * İlanı siler (soft delete). Sadece ilancı yapabilir.
 */
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: "İlan bulunamadı" });
    if (listing.maker_address !== req.wallet) return res.status(403).json({ error: "Bu ilan sana ait değil" });

    listing.status = "DELETED";
    await listing.save();
    return res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
