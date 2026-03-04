"use strict";

const express = require("express");
const Joi     = require("joi");
const router  = express.Router();

const { requireAuth } = require("../middleware/auth");
const { Trade }       = require("../models/Trade");

/**
 * GET /api/trades/my
 * Kullanıcının aktif işlemlerini getirir.
 */
router.get("/my", requireAuth, async (req, res, next) => {
  try {
    const trades = await Trade.find({
      $or: [{ maker_address: req.wallet }, { taker_address: req.wallet }],
      status: { $nin: ["RESOLVED", "CANCELED", "BURNED"] },
    }).sort({ created_at: -1 }).lean();
    return res.json({ trades });
  } catch (err) { next(err); }
});

/**
 * GET /api/trades/:id
 * İşlem odası verisi. Sadece taraflar görebilir.
 */
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const trade = await Trade.findById(req.params.id).lean();
    if (!trade) return res.status(404).json({ error: "İşlem bulunamadı" });
    if (trade.maker_address !== req.wallet && trade.taker_address !== req.wallet) {
      return res.status(403).json({ error: "Erişim reddedildi" });
    }
    return res.json({ trade });
  } catch (err) { next(err); }
});

/**
 * POST /api/trades/propose-cancel
 * EIP-712 imzasını kaydeder. Her iki taraf imzaladığında iptal hazır.
 * Body: { tradeId, signature, deadline }
 */
router.post("/propose-cancel", requireAuth, async (req, res, next) => {
  try {
    const schema = Joi.object({
      tradeId:   Joi.string().length(24).hex().required(),
      signature: Joi.string().pattern(/^0x[a-fA-F0-9]+$/).required(),
      deadline:  Joi.number().integer().required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const trade = await Trade.findById(value.tradeId);
    if (!trade) return res.status(404).json({ error: "İşlem bulunamadı" });

    const isMaker = trade.maker_address === req.wallet;
    const isTaker = trade.taker_address === req.wallet;
    if (!isMaker && !isTaker) return res.status(403).json({ error: "Bu işlemin tarafı değilsin" });

    if (isMaker) {
      trade.cancel_proposal.maker_signed    = true;
      trade.cancel_proposal.maker_signature = value.signature;
    } else {
      trade.cancel_proposal.taker_signed    = true;
      trade.cancel_proposal.taker_signature = value.signature;
    }
    trade.cancel_proposal.proposed_by = req.wallet;
    trade.cancel_proposal.deadline    = new Date(value.deadline * 1000);
    await trade.save();

    const bothSigned = trade.cancel_proposal.maker_signed && trade.cancel_proposal.taker_signed;
    return res.json({
      success: true,
      bothSigned,
      message: bothSigned
        ? "Her iki taraf imzaladı. Kontrata gönderilebilir."
        : "Teklifin kaydedildi. Karşı tarafın imzası bekleniyor.",
    });
  } catch (err) { next(err); }
});

module.exports = router;
