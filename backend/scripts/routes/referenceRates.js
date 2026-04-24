"use strict";

const express = require("express");
const router = express.Router();
const { marketReadLimiter } = require("../middleware/rateLimiter");
const { getReferenceTickerPayload } = require("../services/referenceTicker");

// [TR] Referans kur endpoint'i yalnız bilgilendirme amaçlıdır; settlement otoritesi değildir.
// [EN] Reference ticker endpoint is informational-only and non-authoritative for settlement.
router.get("/ticker", marketReadLimiter, async (_req, res, next) => {
  try {
    const payload = await getReferenceTickerPayload();
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
