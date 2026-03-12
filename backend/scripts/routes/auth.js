"use strict";

const express = require("express");
const Joi     = require("joi");
const router  = express.Router();

const { authLimiter }                        = require("../middleware/rateLimiter");
const { requireAuth }                        = require("../middleware/auth");
const {
  generateNonce,
  verifySiweSignature,
  issueJWT,
  // CON-04 Fix: Refresh token fonksiyonları import edildi
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} = require("../services/siwe");
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
    const { wallet } = req.query;
    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return res.status(400).json({ error: "Geçerli bir Ethereum adresi gir" });
    }
    const nonce = await generateNonce(wallet.toLowerCase());
    return res.json({ nonce });
  } catch (err) { next(err); }
});

/**
 * POST /api/auth/verify
 * Body: { message, signature }
 * SIWE imzasını doğrular, JWT döner.
 *
 * CON-04 Fix: Artık JWT ile birlikte refreshToken da döner.
 * Frontend bu refreshToken'ı güvenli bir şekilde saklayarak
 * JWT expire olduğunda /api/auth/refresh endpoint'ine gönderir.
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

    const token        = issueJWT(wallet);
    // CON-04 Fix: Login sırasında refresh token da üret
    const refreshToken = await issueRefreshToken(wallet);

    logger.info(`[Auth] Giriş başarılı: ${wallet}`);
    return res.json({ token, refreshToken, wallet, profile: user.toPublicProfile() });
  } catch (err) {
    logger.warn(`[Auth] SIWE başarısız: ${err.message}`);
    return res.status(401).json({ error: `Kimlik doğrulama başarısız: ${err.message}` });
  }
});

/**
 * CON-04 Fix: POST /api/auth/refresh
 * Body: { wallet, refreshToken }
 *
 * JWT expire olduğunda frontend bu endpoint'e refresh token gönderir.
 * Backend eski refresh token'ı siler (rotation) ve yeni JWT + refresh token döner.
 *
 * Güvenlik:
 *   - Refresh token Redis'te tek kullanımlık saklanır (getDel ile atomik silme)
 *   - Token mismatch → tüm oturumlar iptal edilir (çalınma koruması)
 *   - Rate limit: authLimiter ile korunur (dakikada 10 istek)
 */
router.post("/refresh", authLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      wallet:       Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
      refreshToken: Joi.string().length(64).hex().required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const result = await rotateRefreshToken(
      value.wallet.toLowerCase(),
      value.refreshToken
    );

    logger.info(`[Auth] Token yenilendi: ${value.wallet}`);
    return res.json({
      token:        result.token,
      refreshToken: result.refreshToken,
      wallet:       value.wallet.toLowerCase(),
    });
  } catch (err) {
    logger.warn(`[Auth] Refresh başarısız: ${err.message}`);
    return res.status(401).json({ error: err.message });
  }
});

/**
 * CON-04 Fix: POST /api/auth/logout
 * Body: (empty — wallet JWT'den alınır)
 *
 * Kullanıcının refresh token'ını iptal eder.
 * JWT kendiliğinden expire olacak (15 dakika) — ek invalidation gerekmez.
 */
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await revokeRefreshToken(req.wallet);
    logger.info(`[Auth] Çıkış: ${req.wallet}`);
    return res.json({ success: true, message: "Oturum kapatıldı." });
  } catch (err) { next(err); }
});

/**
 * PUT /api/auth/profile
 * Kullanıcının IBAN ve Telegram bilgisini günceller.
 * Veriler veritabanına YAZILMADAN önce AES-256 ile şifrelenir.
 */
router.put("/profile", requireAuth, async (req, res, next) => {
  try {
    const schema = Joi.object({
      bankOwner: Joi.string().max(100).allow("").optional(),
      iban:      Joi.string().max(34).allow("").optional(),
      telegram:  Joi.string().max(50).allow("").optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    // H-05 Fix: encryptPII artık async — await zorunlu
    const encrypted = await encryptPII(value, req.wallet);

    await User.findOneAndUpdate(
      { wallet_address: req.wallet },
      {
        $set: {
          "pii_data.bankOwner_enc": encrypted.bankOwner_enc,
          "pii_data.iban_enc":      encrypted.iban_enc,
          "pii_data.telegram_enc":  encrypted.telegram_enc,
        },
      }
    );

    logger.info(`[Auth] Profil güncellendi: ${req.wallet}`);
    return res.json({ success: true, message: "Profil bilgilerin güncellendi." });
  } catch (err) { next(err); }
});

module.exports = router;
