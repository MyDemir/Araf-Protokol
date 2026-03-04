"use strict";

const express = require("express");
const Joi     = require("joi");
const router  = express.Router();

const { authLimiter }                        = require("../middleware/rateLimiter");
const { requireAuth }                        = require("../middleware/auth");
const { generateNonce, verifySiweSignature, issueJWT } = require("../services/siwe");
const { encryptPII }                         = require("../services/encryption");
const User                                   = require("../models/User");
const logger                                 = require("../utils/logger");

/**
 * GET /api/auth/nonce?address=0x...
 * Frontend MetaMask imzalamadan önce bu nonce'u çeker.
 * Nonce Redis'te 5 dakika yaşar — tek kullanımlık.
 */
router.get("/nonce", authLimiter, async (req, res, next) => {
  try {
    const { address } = req.query;
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: "Geçerli bir Ethereum adresi gir" });
    }
    const nonce = await generateNonce(address.toLowerCase());
    return res.json({ nonce });
  } catch (err) { next(err); }
});

/**
 * POST /api/auth/verify
 * Body: { message, signature }
 * SIWE imzasını doğrular, JWT döner.
 */
router.post("/verify", authLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      message:   Joi.string().max(2000).required(),
      signature: Joi.string().pattern(/^0x[a-fA-F0-9]{130}$/).required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const wallet = await verifySiweSignature(value.message, value.signature);

    const user = await User.findOneAndUpdate(
      { wallet_address: wallet },
      { $set: { last_login: new Date() }, $setOnInsert: { wallet_address: wallet } },
      { upsert: true, new: true }
    );

    if (user.checkBanExpiry()) await user.save();

    const token = issueJWT(wallet);
    logger.info(`[Auth] Giriş başarılı: ${wallet}`);
    return res.json({ token, wallet, profile: user.toPublicProfile() });
  } catch (err) {
    logger.warn(`[Auth] SIWE başarısız: ${err.message}`);
    return res.status(401).json({ error: `Kimlik doğrulama başarısız: ${err.message}` });
  }
});

/**
 * PUT /api/auth/profile
 * Kullanıcının IBAN ve Telegram bilgisini günceller.
 * Veriler veritabanına YAZILMADAN önce AES-256 ile şifrelenir.
 */
router.put("/profile", requireAuth, async (req, res, next) => {
  try {
    const schema = Joi.object({
      bankOwner: Joi.string().max(100).optional(),
      iban:      Joi.string().max(34).pattern(/^TR\d{24}$/).optional(),
      telegram:  Joi.string().max(32).pattern(/^[a-zA-Z0-9_]{1,32}$/).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const encPII = encryptPII(value, req.wallet);
    await User.findOneAndUpdate(
      { wallet_address: req.wallet },
      { $set: { pii_data: encPII } },
      { upsert: true }
    );

    return res.json({ success: true, message: "Banka bilgileri güvenli şekilde kaydedildi." });
  } catch (err) { next(err); }
});

module.exports = router;
