"use strict";

/**
 * PII Route — IBAN Fetch (Most Security-Critical Endpoint)
 *
 * Two-step flow:
 *   1. POST /api/pii/request-token/:tradeId
 *      → Validates JWT auth, verifies caller is taker, issues PII token
 *
 *   2. GET  /api/pii/:tradeId
 *      → Requires PII token, decrypts and returns IBAN (not logged, not cached)
 *
 * Rate limit: 3 requests per 10 minutes per IP+wallet (applied in app.js)
 */

const express  = require("express");
const router   = express.Router();

const { requireAuth, requirePIIToken } = require("../middleware/auth");
const { piiLimiter }                   = require("../middleware/rateLimiter");
const { Trade }                        = require("../models/Trade");
const User                             = require("../models/User");
const { decryptPII }                   = require("../services/encryption");
const { issuePIIToken }                = require("../services/siwe");
const logger                           = require("../utils/logger");

// ─── Step 1: Request PII Token ────────────────────────────────────────────────
/**
 * POST /api/pii/request-token/:tradeId
 * Requires: Bearer auth JWT
 * Returns:  Short-lived PII token scoped to this tradeId
 */
router.post(
  "/request-token/:tradeId",
  requireAuth,
  piiLimiter,
  async (req, res, next) => {
    try {
      const { tradeId } = req.params;
      const callerWallet = req.wallet;

      // Validate tradeId format
      if (!/^[a-fA-F0-9]{24}$/.test(tradeId)) {
        return res.status(400).json({ error: "Invalid tradeId format" });
      }

      // Find trade
      const trade = await Trade.findById(tradeId).lean();
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }

      // Only the taker of this trade can request IBAN
      if (trade.taker_address !== callerWallet) {
        logger.warn(
          `[PII] Unauthorized PII token request: caller=${callerWallet} taker=${trade.taker_address} trade=${tradeId}`
        );
        return res.status(403).json({ error: "Only the taker of this trade can view PII" });
      }

      // Trade must be in LOCKED, PAID, or CHALLENGED state
      const allowedStates = ["LOCKED", "PAID", "CHALLENGED"];
      if (!allowedStates.includes(trade.status)) {
        return res.status(400).json({ error: `PII not available for trade in ${trade.status} state` });
      }

      // Issue trade-scoped PII token
      const piiToken = issuePIIToken(callerWallet, tradeId);

      logger.info(`[PII] Token issued: wallet=${callerWallet} trade=${tradeId}`);
      return res.json({ piiToken });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Step 2: Fetch Decrypted PII ──────────────────────────────────────────────
/**
 * GET /api/pii/:tradeId
 * Requires: Bearer PII token (from step 1)
 * Returns:  Decrypted IBAN, bankOwner, telegram (NOT logged, NOT cached)
 */
router.get(
  "/:tradeId",
  requirePIIToken,
  piiLimiter,
  async (req, res, next) => {
    try {
      const { tradeId }  = req.params;
      const callerWallet = req.wallet;

      // Find trade — only need maker_address
      const trade = await Trade.findById(tradeId).select("maker_address status taker_address").lean();
      if (!trade) {
        return res.status(404).json({ error: "Trade not found" });
      }

      // Double-check authorization (token verified in middleware, extra layer here)
      if (trade.taker_address !== callerWallet) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Fetch maker's encrypted PII
      const makerUser = await User.findOne({ wallet_address: trade.maker_address })
        .select("pii_data")
        .lean();

      if (!makerUser || !makerUser.pii_data) {
        return res.status(404).json({ error: "Seller has not configured payment details" });
      }

      // H-05 Fix: decryptPII artık async — await zorunlu
      // Decrypt PII — keys derived from maker's wallet, never stored
      const decrypted = await decryptPII(makerUser.pii_data, trade.maker_address);

      // Log access (wallets only, never the actual IBAN)
      logger.info(`[PII] Accessed: taker=${callerWallet} maker=${trade.maker_address} trade=${tradeId}`);

      // Return decrypted PII — NOT stored in response logs
      return res.json({
        bankOwner: decrypted.bankOwner,
        iban:      decrypted.iban,
        telegram:  decrypted.telegram,
        // Security notice for frontend display
        notice:    "This information is end-to-end encrypted. It is not stored on-chain or in logs.",
      });
    } catch (err) {
      // Decryption failures should not leak information
      if (err.message.includes("Unsupported state") || err.message.includes("Invalid auth tag")) {
        logger.error(`[PII] Decryption failed for trade=${req.params.tradeId}: ${err.message}`);
        return res.status(500).json({ error: "Decryption failed. Contact support." });
      }
      next(err);
    }
  }
);

module.exports = router;
