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
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  blacklistJWT,   // ORTA-09 Fix
} = require("../services/siwe");
const { encryptPII }                         = require("../services/encryption");
const User                                   = require("../models/User");
const logger                                 = require("../utils/logger");

/**
 * YÜKS-16 Fix: SameSite=lax — Web3 Yönlendirme Uyumluluğu.
 *   ÖNCEKİ: sameSite: "strict" — MetaMask/TrustWallet uygulamalarından
 *   işlem onaylanıp DApp'e yönlendirme yapıldığında (cross-site navigation)
 *   tarayıcı JWT cookie'yi göndermiyordu → kullanıcı anında çıkış yapmış görünüyordu.
 *   ŞİMDİ: sameSite: "lax" — cross-site GET yönlendirmelerinde cookie gönderilir.
 *   State-changing (POST/PUT/DELETE) istekler için CSRF koruması yeterlidir
 *   çünkü bunlar zaten SIWE imzası veya JWT doğrulaması gerektiriyor.
 *
 * KRİT-14 Fix: PUT /profile rotasına authLimiter eklendi.
 *   ÖNCEKİ: authLimiter import edilmiş ama bu rotaya UYGULANMAMIŞTI.
 *   encryptPII = HKDF + AES-256-GCM → ağır kriptografi. Sınırsız istek
 *   Node.js CPU'sunu tamamen bloke edebiliyordu (Asymmetric DoS).
 *
 * ORTA-09 Fix: Logout'ta JWT blacklist'e alınıyor.
 *   Refresh token silinse bile 15 dk'lık JWT hâlâ geçerliydi.
 *   Artık logout'ta JWT'nin jti değeri 15 dk Redis blacklist'e alınıyor.
 */

const COOKIE_OPTIONS_BASE = {
  httpOnly: true,
  // YÜKS-16 Fix: strict → lax (Web3 yönlendirme uyumluluğu)
  sameSite: "lax",
  path:     "/",
};

function _getJwtCookieOptions() {
  return {
    ...COOKIE_OPTIONS_BASE,
    secure: process.env.NODE_ENV === "production",
    maxAge: 15 * 60 * 1000,
  };
}

function _getRefreshCookieOptions() {
  return {
    ...COOKIE_OPTIONS_BASE,
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path:   "/api/auth",
  };
}

/**
 * GET /api/auth/nonce?wallet=0x...
 *
 * KRİT-07 Fix (siwe.js'te): generateNonce artık mevcut nonce'ı korur.
 * AFS-010: siweDomain response'a eklendi.
 */
router.get("/nonce", authLimiter, async (req, res, next) => {
  try {
    const { wallet } = req.query;
    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return res.status(400).json({ error: "Geçerli bir Ethereum adresi gir." });
    }
    const nonce      = await generateNonce(wallet.toLowerCase());
    const siweDomain = process.env.SIWE_DOMAIN || "localhost";
    return res.json({ nonce, siweDomain });
  } catch (err) { next(err); }
});

/**
 * POST /api/auth/verify
 * SIWE imzasını doğrular, JWT ve Refresh Token'ı httpOnly cookie olarak set eder.
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

    // KRİT-11 Fix: checkBanExpiry artık async ve save() yapıyor
    await user.checkBanExpiry();

    const token        = issueJWT(wallet);
    const refreshToken = await issueRefreshToken(wallet);

    res.cookie("araf_jwt",     token,        _getJwtCookieOptions());
    res.cookie("araf_refresh", refreshToken, _getRefreshCookieOptions());

    logger.info(`[Auth] Giriş başarılı: ${wallet}`);
    return res.json({ wallet, profile: user.toPublicProfile() });
  } catch (err) {
    logger.warn(`[Auth] SIWE başarısız: ${err.message}`);
    return res.status(401).json({ error: `Kimlik doğrulama başarısız: ${err.message}` });
  }
});

/**
 * POST /api/auth/refresh
 * KRİT-01 Fix (siwe.js'te): rotateRefreshToken artık wallet eşleşmesini doğruluyor.
 */
router.post("/refresh", authLimiter, async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.araf_refresh;
    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token bulunamadı." });
    }

    // [TR] Wallet adresini expired JWT'den veya body'den al
    let wallet = req.body?.wallet;
    if (!wallet) {
      const jwtCookie = req.cookies?.araf_jwt;
      if (jwtCookie) {
        try {
          const parts   = jwtCookie.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
            wallet        = payload.sub;
          }
        } catch { /* decode hatası — wallet null kalır */ }
      }
    }

    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return res.status(400).json({ error: "Wallet adresi belirlenemedi." });
    }

    const result = await rotateRefreshToken(wallet.toLowerCase(), refreshToken);

    res.cookie("araf_jwt",     result.token,        _getJwtCookieOptions());
    res.cookie("araf_refresh", result.refreshToken, _getRefreshCookieOptions());

    logger.info(`[Auth] Token yenilendi: ${wallet}`);
    return res.json({ wallet: wallet.toLowerCase() });
  } catch (err) {
    logger.warn(`[Auth] Refresh başarısız: ${err.message}`);
    res.clearCookie("araf_jwt",     { ...COOKIE_OPTIONS_BASE, path: "/" });
    res.clearCookie("araf_refresh", { ...COOKIE_OPTIONS_BASE, path: "/api/auth" });
    return res.status(401).json({ error: err.message });
  }
});

/**
 * POST /api/auth/logout
 * ORTA-09 Fix: JWT blacklist'e alınıyor + cookie'ler temizleniyor.
 */
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    // ORTA-09 Fix: Mevcut JWT'yi blacklist'e al (15 dk kalan süre için geçersiz)
    const currentJWT = req.cookies?.araf_jwt;
    if (currentJWT) {
      await blacklistJWT(currentJWT);
    }

    await revokeRefreshToken(req.wallet);

    res.clearCookie("araf_jwt",     { ...COOKIE_OPTIONS_BASE, path: "/" });
    res.clearCookie("araf_refresh", { ...COOKIE_OPTIONS_BASE, path: "/api/auth" });

    logger.info(`[Auth] Çıkış yapıldı: ${req.wallet}`);
    return res.json({ success: true, message: "Oturum kapatıldı." });
  } catch (err) { next(err); }
});

/**
 * GET /api/auth/me
 * Cookie'deki JWT geçerliyse wallet adresini döndürür.
 */
router.get("/me", requireAuth, (req, res) => {
  return res.json({ wallet: req.wallet, authenticated: true });
});

/**
 * PUT /api/auth/profile
 * KRİT-14 Fix: authLimiter eklendi — ağır kriptografi CPU DoS koruması.
 *
 * ORTA-03 Fix: Joi validasyonu IBAN regex ve maxlength ile güçlendirildi.
 *   ÖNCEKİ: Sadece max:34 ve boşluk temizleme vardı.
 *   ŞİMDİ: TR IBAN formatı zorunlu, bankOwner min/max uzunluk kontrolü.
 */
router.put("/profile", requireAuth, authLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      // ORTA-03 Fix: IBAN format ve uzunluk doğrulaması
      bankOwner: Joi.string()
        .min(2).max(100)
        .pattern(/^[a-zA-ZğüşöçİĞÜŞÖÇ\s]+$/, "geçerli isim karakterleri")
        .allow("").optional()
        .messages({
          "string.pattern.name": "Banka sahibi adı sadece harf içerebilir.",
        }),
      iban: Joi.string()
        // ORTA-03 Fix: TR IBAN formatı zorunlu (TR + 24 rakam = 26 karakter)
        .pattern(/^TR\d{24}$/, "TR IBAN formatı")
        .allow("").optional()
        .messages({
          "string.pattern.name": "IBAN formatı geçersiz. Örnek: TR330006100519786457841326",
        }),
      telegram: Joi.string()
        .max(50)
        .pattern(/^[a-zA-Z0-9_]{5,}$/, "Telegram kullanıcı adı")
        .allow("").optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

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
