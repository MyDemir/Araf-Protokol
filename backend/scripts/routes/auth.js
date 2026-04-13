"use strict";
/**
 * Auth Route — SIWE + JWT
 *
 * V3 notu:
 *   - Order/child-trade mimarisi auth authority sınırını değiştirmez.
 *   - Cookie wallet authoritative olmaya devam eder.
 *
 * Bu sürümde:
 *   - eski V2 profil validation / normalization katmanı geri alındı
 *   - banka profili değişimi tespiti eklendi
 *   - aktif child trade varken bankOwner / IBAN değişimi engellendi
 *   - User.js içindeki profileVersion / bankChangeCount sayaçları entegre edildi
 *
 * Önemli ayrım:
 *   - Telegram değişimi banka risk modeline dahil değildir
 *   - Sadece bankOwner veya iban değişirse banka profili "değişti" sayılır
 */

const express = require("express");
const Joi = require("joi");
const router = express.Router();

const { authLimiter } = require("../middleware/rateLimiter");
const { requireAuth, requireSessionWalletMatch } = require("../middleware/auth");
const {
  generateNonce,
  verifySiweSignature,
  getSiweConfig,
  issueJWT,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  blacklistJWT,
} = require("../services/siwe");
const {
  encryptPayoutProfile,
  decryptPayoutProfile,
  buildPayoutFingerprint,
} = require("../services/encryption");
const User = require("../models/User");
const Trade = require("../models/Trade");
const logger = require("../utils/logger");
const { normalizeProfileBody, PROFILE_SCHEMA } = require("./profileUtils");

const COOKIE_OPTIONS_BASE = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
};

const ACTIVE_TRADE_STATUSES_FOR_BANK_PROFILE_LOCK = ["LOCKED", "PAID", "CHALLENGED"];

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
    path: "/api/auth",
  };
}

/**
 * Profil input'unu normalize eder.
 *
 * Not:
 *   - Banka sahibi adı: fazla boşluklar tek boşluğa düşürülür
 *   - IBAN: boşluklar silinir, uppercase yapılır
 *   - Telegram: baştaki @ temizlenir
 *
 * Boş / undefined alanlar "" olarak normalize edilir.
 */
/**
 * JWT cookie içinden wallet decode etmeye çalışır.
 * Refresh isteğinde body wallet yoksa fallback olarak kullanılır.
 *
 * Bu decode doğrulama yapmaz; yalnız UX kolaylığı için fallback üretir.
 */
function _tryDecodeWalletFromJwtCookie(jwtCookie) {
  if (!jwtCookie || typeof jwtCookie !== "string") return null;

  try {
    const parts = jwtCookie.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof payload?.sub !== "string") return null;

    return payload.sub.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * GET /api/auth/nonce?wallet=0x...
 * Nonce üretir ve SIWE config bilgisini döndürür.
 */
router.get("/nonce", authLimiter, async (req, res, next) => {
  try {
    const { wallet } = req.query;

    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return res.status(400).json({ error: "Geçerli bir Ethereum adresi gir." });
    }

    const nonce = await generateNonce(wallet.toLowerCase());
    const { domain: siweDomain, uri: siweUri } = getSiweConfig();

    return res.json({ nonce, siweDomain, siweUri });
  } catch (err) {
    if (/SIWE_/.test(err.message)) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/auth/verify
 * SIWE imzasını doğrular, JWT ve refresh token'ı httpOnly cookie olarak set eder.
 */
router.post("/verify", authLimiter, async (req, res) => {
  try {
    const schema = Joi.object({
      message: Joi.string().max(2000).required(),
      signature: Joi.string().pattern(/^0x[a-fA-F0-9]{130}$/).required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const wallet = await verifySiweSignature(value.message, value.signature);

    const user = await User.findOneAndUpdate(
      { wallet_address: wallet },
      { $set: { last_login: new Date() }, $setOnInsert: { wallet_address: wallet } },
      { upsert: true, new: true }
    );

    await user.checkBanExpiry();

    const token = issueJWT(wallet);
    const refreshToken = await issueRefreshToken(wallet);

    res.cookie("araf_jwt", token, _getJwtCookieOptions());
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
 * Refresh token ile yeni JWT ve yeni refresh token üretir.
 */
router.post("/refresh", authLimiter, async (req, res) => {
  try {
    const refreshToken = req.cookies?.araf_refresh;
    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token bulunamadı." });
    }

    let wallet = req.body?.wallet;

    // [TR] Body'de wallet yoksa JWT cookie payload'ından fallback dene.
    if (!wallet) {
      wallet = _tryDecodeWalletFromJwtCookie(req.cookies?.araf_jwt);
    }

    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return res.status(400).json({ error: "Wallet adresi belirlenemedi." });
    }

    const result = await rotateRefreshToken(wallet.toLowerCase(), refreshToken);

    res.cookie("araf_jwt", result.token, _getJwtCookieOptions());
    res.cookie("araf_refresh", result.refreshToken, _getRefreshCookieOptions());

    logger.info(`[Auth] Token yenilendi: ${wallet}`);
    return res.json({ wallet: wallet.toLowerCase() });
  } catch (err) {
    logger.warn(`[Auth] Refresh başarısız: ${err.message}`);
    res.clearCookie("araf_jwt", { ...COOKIE_OPTIONS_BASE, path: "/" });
    res.clearCookie("araf_refresh", { ...COOKIE_OPTIONS_BASE, path: "/api/auth" });
    return res.status(401).json({ error: err.message });
  }
});

/**
 * POST /api/auth/logout
 * Aktif JWT'yi blacklist'e alır, refresh token ailesini iptal eder ve cookie'leri temizler.
 */
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const currentJWT = req.cookies?.araf_jwt;
    if (currentJWT) {
      await blacklistJWT(currentJWT);
    }

    await revokeRefreshToken(req.wallet);

    res.clearCookie("araf_jwt", { ...COOKIE_OPTIONS_BASE, path: "/" });
    res.clearCookie("araf_refresh", { ...COOKIE_OPTIONS_BASE, path: "/api/auth" });

    logger.info(`[Auth] Çıkış yapıldı: ${req.wallet}`);
    return res.json({ success: true, message: "Oturum kapatıldı." });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Cookie'deki JWT geçerliyse wallet adresini döndürür.
 * Bağlı cüzdan header ile gelmişse, cookie wallet ile birebir eşleşmesi gerekir.
 */
router.get("/me", requireAuth, async (req, res) => {
  const headerWalletRaw = req.headers["x-wallet-address"];

  if (headerWalletRaw) {
    const headerWallet = headerWalletRaw.trim().toLowerCase();

    if (/^0x[a-f0-9]{40}$/.test(headerWallet) && headerWallet !== req.wallet) {
      logger.warn(
        `[Auth] /me wallet mismatch: cookie=${req.wallet} header=${headerWallet} — session geçersiz`
      );

      res.clearCookie("araf_jwt", { ...COOKIE_OPTIONS_BASE, path: "/" });
      res.clearCookie("araf_refresh", { ...COOKIE_OPTIONS_BASE, path: "/api/auth" });

      try {
        await revokeRefreshToken(req.wallet);
      } catch (_) {
        // revoke hatası mismatch cevabını engellemez
      }

      return res.status(409).json({
        error: "Oturum cüzdanı aktif bağlı cüzdanla eşleşmiyor.",
        code: "SESSION_WALLET_MISMATCH",
      });
    }
  }

  return res.json({ wallet: req.wallet, authenticated: true });
});

/**
 * PUT /api/auth/profile
 * PII alanlarını şifreleyerek kullanıcının profilini günceller.
 *
 * Bu sürümde ek olarak:
 *   - eski V2 validation/normalization korunur
 *   - bankOwner / iban gerçekten değiştiyse User.js risk sayaçları güncellenir
 *   - aktif LOCKED / PAID / CHALLENGED trade varken banka profili değişimi engellenir
 */
router.put("/profile", requireAuth, requireSessionWalletMatch, authLimiter, async (req, res, next) => {
  try {
    const normalizedBody = normalizeProfileBody(req.body);
    const { error, value } = PROFILE_SCHEMA.validate(normalizedBody);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    let user = await User.findOne({ wallet_address: req.wallet })
      .select(
        "wallet_address profileVersion lastBankChangeAt " +
        "bankChangeCount7d bankChangeCount30d bank_change_history payout_profile"
      );

    if (!user) {
      user = new User({ wallet_address: req.wallet });
    }

    // [TR] Şifreli profil varsa çözüp gerçek değişim olup olmadığını kıyaslıyoruz.
    let existingProfile = { bankOwner: "", iban: "", telegram: "", rail: "", country: "", details: {} };

    if (user.payout_profile?.payout_details_enc) {
      const dec = await decryptPayoutProfile(user.payout_profile, req.wallet);
      existingProfile = {
        bankOwner: dec.fields?.account_holder_name || "",
        iban: dec.fields?.iban || "",
        telegram: dec.contact?.channel === "telegram" ? dec.contact.value || "" : "",
        rail: dec.rail || "",
        country: dec.country || "",
        details: dec.fields || {},
      };
    }

    const bankOwnerChanged = existingProfile.bankOwner !== value.bankOwner;
    const ibanChanged = existingProfile.iban !== value.iban;
    const railChanged = existingProfile.rail !== value.rail;
    const countryChanged = (existingProfile.country || "") !== (value.country || "");

    const nextGenericDetails =
      value.rail === "US_ACH"
        ? {
            account_holder_name: value.bankOwner,
            routing_number: value.routingNumber,
            account_number: value.accountNumber,
            account_type: value.accountType,
            bank_name: value.bankName || null,
          }
        : value.rail === "SEPA_IBAN"
          ? {
              account_holder_name: value.bankOwner,
              iban: value.iban,
              bic: value.bic || null,
              bank_name: value.bankName || null,
            }
          : {
              account_holder_name: value.bankOwner,
              iban: value.iban,
              bank_name: value.bankName || null,
            };

    const detailsChanged =
      buildPayoutFingerprint(existingProfile.details || {}) !==
      buildPayoutFingerprint(nextGenericDetails);

    const bankProfileChanged = bankOwnerChanged || ibanChanged || railChanged || countryChanged || detailsChanged;

    // [TR] Telegram değişimi serbest; banka bilgisi değişimi aktif trade sırasında kilitli.
    if (bankProfileChanged) {
      const activeTradeExists = await Trade.exists({
        status: { $in: ACTIVE_TRADE_STATUSES_FOR_BANK_PROFILE_LOCK },
        $or: [
          { maker_address: req.wallet },
          { taker_address: req.wallet },
        ],
      });

      if (activeTradeExists) {
        return res.status(409).json({
          error:
            "Aktif LOCKED / PAID / CHALLENGED trade varken payout profile değiştirilemez.",
          code: "BANK_PROFILE_LOCKED_DURING_ACTIVE_TRADE",
        });
      }
    }

    // [TR] Sayaçlar rolling pencereye göre taze tutulur.
    const now = new Date();
    if (bankProfileChanged) {
      user.markBankProfileChanged(now);
    } else {
      user.recomputeBankChangeCounters(now);
    }

    const nextFingerprintVersion = Number.isInteger(user?.payout_profile?.fingerprint?.version)
      ? user.payout_profile.fingerprint.version + (bankProfileChanged ? 1 : 0)
      : bankProfileChanged ? 1 : 0;
    const genericProfile = await encryptPayoutProfile(
      {
        rail: value.rail || null,
        country: value.country || null,
        contact: {
          channel: value.contactChannel || (value.telegram ? "telegram" : null),
          value: value.contactValue || value.telegram || null,
        },
        details: nextGenericDetails,
        fingerprintVersion: nextFingerprintVersion,
      },
      req.wallet
    );

    user.payout_profile = genericProfile;

    await user.save();

    logger.info(
      `[Auth] Profil güncellendi: ${req.wallet} bank_profile_changed=${bankProfileChanged}`
    );

    return res.json({
      success: true,
      message: "Profil bilgilerin güncellendi.",
      bankProfileChanged,
      profileVersion: user.profileVersion,
      lastBankChangeAt: user.lastBankChangeAt,
      bankChangeCount7d: user.bankChangeCount7d,
      bankChangeCount30d: user.bankChangeCount30d,
      payoutProfile: {
        rail: user.payout_profile?.rail || null,
        country: user.payout_profile?.country || null,
        contactChannel: user.payout_profile?.contact?.channel || null,
        fingerprintVersion: user.payout_profile?.fingerprint?.version || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
