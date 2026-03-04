"use strict";

const express   = require("express");
const Joi       = require("joi");
const router    = express.Router();
const mongoose  = require("mongoose");

const { requireAuth }    = require("../middleware/auth");
const { feedbackLimiter } = require("../middleware/rateLimiter");
const logger             = require("../utils/logger");

// ── Inline Schema (basit koleksiyon) ─────────────────────────────────────────
const feedbackSchema = new mongoose.Schema({
  wallet_address: { type: String, required: true, lowercase: true },
  rating:         { type: Number, required: true, min: 1, max: 5 },
  comment:        { type: String, maxlength: 1000, default: "" },
  created_at:     { type: Date,   default: Date.now },
});
// 1 yıl sonra otomatik silinir (GDPR)
feedbackSchema.index({ created_at: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });
const Feedback = mongoose.models.Feedback || mongoose.model("Feedback", feedbackSchema);

/**
 * POST /api/feedback
 * Kullanıcı geri bildirimi gönderir. Saatte max 3 istek.
 */
router.post("/", requireAuth, feedbackLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      rating:  Joi.number().integer().min(1).max(5).required(),
      comment: Joi.string().max(1000).allow("").optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    await Feedback.create({
      wallet_address: req.wallet,
      rating:         value.rating,
      comment:        value.comment || "",
    });

    logger.info(`[Feedback] ${req.wallet} → ${value.rating}/5`);
    return res.status(201).json({ success: true, message: "Geri bildirim alındı, teşekkürler!" });
  } catch (err) { next(err); }
});

module.exports = router;
