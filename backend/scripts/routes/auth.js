"use strict";
/**
 * Auth Route — SIWE + JWT
 *
 * V3 notu:
 *   - Order/child-trade mimarisi auth authority sınırını değiştirmez.
 *   - Cookie wallet authoritative olmaya devam eder.
 *
 * Bu sürümde:
 *   - V3 nested payout profile validation / normalization katmanı eklendi
 *   - payout profile değişimi tespiti eklendi
 *   - aktif child trade varken payout profile değişimi engellendi
 *   - User.js içindeki profileVersion / bankChangeCount sayaçları entegre edildi
 *
 * Önemli ayrım:
 *   - Contact değişimi risk sayaçlarını tetiklemez
 *   - Payout details / rail / country değişimi banka profili değişimi sayılır
 */

const express = require("express");
const Joi = require("joi");
const router = express.Router();

const { authLimiter, nonceLimiter } = require("../middleware/rateLimiter");
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

const COOKIE_OPTIONS_BASE = {
  httpOnly: true,
  // [TR] Repo deploy modeli same-origin /api üzerine kurulu.
  //      Cross-origin cookie modu bilinçli olarak açılmadıkça SameSite=Lax kalır.
  // [EN] Same-origin /api is the default deployment model; keep SameSite=Lax.
  sameSite: "lax",
  path: "/",
};

const ACTIVE_TRADE_STATUSES_FOR_BANK_PROFILE_LOCK = ["LOCKED", "PAID", "CHALLENGED"];
const SEPA_COUNTRY_ALLOWLIST = new Set(["DE", "FR", "NL", "BE", "ES", "IT", "AT", "PT", "IE", "LU", "FI", "GR"]);

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

function _normalizePayoutProfileBody(rawBody = {}) {
  const profile = rawBody?.payoutProfile || {};
  const fields = profile?.fields || {};
  const contact = profile?.contact || {};
  const rawChannel =
    contact.channel == null
      ? null
      : typeof contact.channel === "string"
        ? contact.channel.trim().toLowerCase()
        : "";
  const rawContactValue =
    contact.value == null
      ? null
      : typeof contact.value === "string"
        ? contact.value.trim()
        : "";
  const normalizedContactValue =
    rawChannel === "telegram" && typeof rawContactValue === "string"
      ? rawContactValue.replace(/^@+/, "")
      : rawChannel === "phone" && typeof rawContactValue === "string"
        ? rawContactValue.replace(/\s+/g, "")
        : rawContactValue;
  return {
    payoutProfile: {
      rail: typeof profile.rail === "string" ? profile.rail.trim().toUpperCase() : "",
      country: typeof profile.country === "string" ? profile.country.trim().toUpperCase() : "",
      contact: {
        channel: rawChannel,
        value: normalizedContactValue,
      },
      fields: {
        account_holder_name:
          typeof fields.account_holder_name === "string"
            ? fields.account_holder_name.trim().replace(/\s+/g, " ")
            : "",
        iban:
          fields.iban == null
            ? null
            : typeof fields.iban === "string"
              ? fields.iban.replace(/\s+/g, "").toUpperCase()
              : "",
        routing_number:
          fields.routing_number == null
            ? null
            : typeof fields.routing_number === "string"
              ? fields.routing_number.replace(/\s+/g, "")
              : "",
        account_number:
          fields.account_number == null
            ? null
            : typeof fields.account_number === "string"
              ? fields.account_number.replace(/\s+/g, "")
              : "",
        account_type:
          fields.account_type == null
            ? null
            : typeof fields.account_type === "string"
              ? fields.account_type.trim().toLowerCase()
              : "",
        bic:
          fields.bic == null
            ? null
            : typeof fields.bic === "string"
              ? fields.bic.trim().toUpperCase()
              : "",
        bank_name:
          fields.bank_name == null
            ? null
            : typeof fields.bank_name === "string"
              ? fields.bank_name.trim()
              : "",
      },
    },
  };
}

function _buildCanonicalDetailsByRail(rail, fields = {}) {
  const base = {
    account_holder_name: fields.account_holder_name || "",
    iban: null,
    routing_number: null,
    account_number: null,
    account_type: null,
    bic: null,
    bank_name: fields.bank_name || null,
  };

  if (rail === "TR_IBAN") {
    return { ...base, iban: fields.iban || null };
  }
  if (rail === "SEPA_IBAN") {
    return { ...base, iban: fields.iban || null, bic: fields.bic || null };
  }
  return {
    ...base,
    routing_number: fields.routing_number || null,
    account_number: fields.account_number || null,
    account_type: fields.account_type || null,
  };
}

const PROFILE_SCHEMA = Joi.object({
  payoutProfile: Joi.object({
    rail: Joi.string().valid("TR_IBAN", "US_ACH", "SEPA_IBAN").required(),
    country: Joi.string().min(2).max(3).required(),
    contact: Joi.object({
      channel: Joi.string().valid("telegram", "email", "phone").allow(null).required(),
      value: Joi.string().max(120).allow(null).required(),
    }).required(),
    fields: Joi.object({
      account_holder_name: Joi.string()
        .min(2)
        .max(100)
        .pattern(/^[A-Za-zÀ-ÖØ-öø-ÿĀ-žĞğİıŞşÇçÑñŒœȘșȚțŽž\s.'’\-]+$/, "geçerli isim karakterleri")
        .required()
        .messages({
          "string.pattern.name": "Hesap sahibi adı harf, boşluk, apostrof, nokta ve tire içerebilir.",
        }),
      iban: Joi.string().allow(null).required(),
      routing_number: Joi.string().allow(null).required(),
      account_number: Joi.string().allow(null).required(),
      account_type: Joi.string().valid("checking", "savings").allow(null).required(),
      bic: Joi.string().allow(null).required(),
      bank_name: Joi.string().max(120).allow(null).required(),
    }).required(),
  }).required(),
}).custom((value, helpers) => {
  const { payoutProfile } = value;
  const { rail, contact, fields } = payoutProfile;
  const channel = contact?.channel || null;
  const cValue = contact?.value || null;

  if ((channel && !cValue) || (!channel && cValue)) {
    return helpers.error("any.invalid", { message: "Contact channel/value birlikte verilmelidir." });
  }

  if (rail === "TR_IBAN" && payoutProfile.country !== "TR") {
    return helpers.error("any.invalid", { message: "TR_IBAN yalnız TR country ile kullanılabilir." });
  }
  if (rail === "US_ACH" && payoutProfile.country !== "US") {
    return helpers.error("any.invalid", { message: "US_ACH yalnız US country ile kullanılabilir." });
  }
  if (rail === "SEPA_IBAN" && !SEPA_COUNTRY_ALLOWLIST.has(payoutProfile.country)) {
    return helpers.error("any.invalid", { message: "SEPA_IBAN için country allowlist dışı." });
  }

  if (channel === "telegram" && !/^[a-zA-Z0-9_]{5,32}$/.test(cValue || "")) {
    return helpers.error("any.invalid", { message: "Telegram kullanıcı adı geçersiz." });
  }
  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cValue || "")) {
    return helpers.error("any.invalid", { message: "Email formatı geçersiz." });
  }
  if (channel === "phone" && !/^\+?[0-9]{7,15}$/.test(cValue || "")) {
    return helpers.error("any.invalid", { message: "Telefon formatı geçersiz." });
  }

  if (rail === "TR_IBAN") {
    if (!/^TR\d{24}$/.test(fields.iban || "")) {
      return helpers.error("any.invalid", { message: "TR_IBAN için iban TR formatında olmalı." });
    }
  }
  if (rail === "SEPA_IBAN") {
    if (!/^[A-Z]{2}[A-Z0-9]{13,32}$/.test(fields.iban || "")) {
      return helpers.error("any.invalid", { message: "SEPA_IBAN için iban formatı geçersiz." });
    }
  }
  if (rail === "US_ACH") {
    if (!/^\d{9}$/.test(fields.routing_number || "") || !/^\d{4,17}$/.test(fields.account_number || "")) {
      return helpers.error("any.invalid", { message: "US_ACH için routing/account number geçersiz." });
    }
    if (!fields.account_type) {
      return helpers.error("any.invalid", { message: "US_ACH için account_type zorunludur." });
    }
  }
  return value;
});

/**
 * GET /api/auth/nonce?wallet=0x...
 * Nonce üretir ve SIWE config bilgisini döndürür.
 */
router.get("/nonce", authLimiter, nonceLimiter, async (req, res, next) => {
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

    let expectedWallet = req.body?.wallet;

    // [TR] Body wallet authority kaynağı değildir.
    //      Sadece backward-compat amaçlı "expected wallet" olarak doğrulama girdiği olur.
    // [EN] Body wallet is compatibility-only; authority comes from verified refresh token.
    if (expectedWallet == null || expectedWallet === "") expectedWallet = null;

    if (expectedWallet && !/^0x[a-fA-F0-9]{40}$/.test(expectedWallet)) {
      return res.status(400).json({ error: "Wallet formatı geçersiz." });
    }

    const result = await rotateRefreshToken(
      refreshToken,
      expectedWallet ? expectedWallet.toLowerCase() : null
    );

    res.cookie("araf_jwt", result.token, _getJwtCookieOptions());
    res.cookie("araf_refresh", result.refreshToken, _getRefreshCookieOptions());

    logger.info(`[Auth] Token yenilendi: ${result.wallet}`);
    return res.json({ wallet: result.wallet });
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
 * Bu sürümde:
 *   - yalnız V3 nested payoutProfile contract kabul edilir
 *   - payout profile gerçekten değiştiyse User.js risk sayaçları güncellenir
 *   - aktif LOCKED / PAID / CHALLENGED trade varken payout profile değişimi engellenir
 */
router.put("/profile", requireAuth, requireSessionWalletMatch, authLimiter, async (req, res, next) => {
  try {
    const normalizedBody = _normalizePayoutProfileBody(req.body);
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
    let existingProfile = { rail: "", country: "", contact: { channel: null, value: null }, details: {} };

    if (user.payout_profile?.payout_details_enc) {
      const dec = await decryptPayoutProfile(user.payout_profile, req.wallet);
      existingProfile = {
        rail: dec.rail || "",
        country: dec.country || "",
        contact: {
          channel: dec.contact?.channel || null,
          value: dec.contact?.value || null,
        },
        details: dec.fields || {},
      };
    }

    const incoming = value.payoutProfile;
    const railChanged = existingProfile.rail !== incoming.rail;
    const countryChanged = (existingProfile.country || "") !== (incoming.country || "");
    const existingGenericDetails = _buildCanonicalDetailsByRail(
      existingProfile.rail,
      existingProfile.details || {}
    );
    const nextGenericDetails = _buildCanonicalDetailsByRail(incoming.rail, incoming.fields);

    const detailsChanged =
      buildPayoutFingerprint(existingGenericDetails) !==
      buildPayoutFingerprint(nextGenericDetails);

    const bankProfileChanged = railChanged || countryChanged || detailsChanged;

    // [TR] Contact değişimi serbest; payout details değişimi aktif trade sırasında kilitli.
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
        rail: incoming.rail || null,
        country: incoming.country || null,
        contact: {
          channel: incoming.contact.channel || null,
          value: incoming.contact.value || null,
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
        contact: {
          channel: user.payout_profile?.contact?.channel || null,
        },
        fingerprintVersion: user.payout_profile?.fingerprint?.version || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
// [TR] Test yüzeyi: deploy/cookie policy regression doğrulaması.
// [EN] Expose cookie helpers for deploy-policy regression tests.
module.exports._getJwtCookieOptions = _getJwtCookieOptions;
module.exports._getRefreshCookieOptions = _getRefreshCookieOptions;
