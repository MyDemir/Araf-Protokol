"use strict";

const { verifyJWT, isJWTBlacklisted } = require("../services/siwe");
const logger                           = require("../utils/logger");

/**
 * requireAuth Middleware
 *
 * ORTA-09 Fix: JWT Blacklist Kontrolü Eklendi.
 *   ÖNCEKİ: JWT geçerliyse her zaman kabul ediliyordu.
 *   Logout sonrası 15 dk'lık süre boyunca çalınan JWT kullanılabiliyordu.
 *   ŞİMDİ: Her doğrulamada JWT'nin jti değeri Redis blacklist'te kontrol ediliyor.
 *   Blacklist'teki (logout edilmiş) JWT'ler reddediliyor.
 *
 * Dual-Auth Smuggling Fix:
 *   ÖNCEKİ: Cookie yoksa Authorization: Bearer header'a fallback yapılıyordu.
 *   XSS ile localStorage'dan çalınan token header üzerinden kabul edilebiliyordu.
 *   ŞİMDİ: requireAuth yalnızca httpOnly cookie'yi kabul ediyor.
 *   Header fallback sadece PII token için ayrı middleware'de korunuyor.
 *
 * Not: requirePIIToken DEĞİŞMEDİ — PII token trade-scoped ve kısa ömürlü,
 * cookie'de saklanması uygun değil. Bearer header ile gönderilmeye devam eder.
 */

/**
 * @private JWT'yi sadece httpOnly cookie'den okur (header fallback KALDIRILDI).
 */
async function _getTokenPayload(req) {
  const token = req.cookies?.araf_jwt;

  if (!token) {
    const err = new Error("Oturum bulunamadı. Lütfen giriş yapın.");
    err.statusCode = 401;
    throw err;
  }

  const payload = verifyJWT(token);

  // ORTA-09 Fix: Blacklist kontrolü
  if (payload.jti) {
    const blacklisted = await isJWTBlacklisted(payload.jti);
    if (blacklisted) {
      const err = new Error("Oturum geçersiz kılınmış. Lütfen yeniden giriş yapın.");
      err.statusCode = 401;
      throw err;
    }
  }

  return payload;
}

/**
 * @private PII token'ı her zaman Authorization header'dan okur.
 */
function _getPIITokenPayload(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const err = new Error("PII Authorization header eksik.");
    err.statusCode = 401;
    throw err;
  }
  return verifyJWT(authHeader.slice(7));
}

/**
 * requireAuth — Korunan route'lar için JWT doğrulaması.
 * Sadece httpOnly cookie'yi okur — XSS koruması.
 */
async function requireAuth(req, res, next) {
  try {
    const payload = await _getTokenPayload(req);

    if (payload.type !== "auth") {
      return res.status(403).json({ error: "Geçersiz token tipi. 'auth' bekleniyordu." });
    }

    req.wallet = payload.sub.toLowerCase();
    next();
  } catch (err) {
    logger.warn(`[Auth] Token doğrulaması başarısız: ${err.message}`);
    return res.status(err.statusCode || 401).json({ error: err.message || "Geçersiz veya süresi dolmuş token." });
  }
}

/**
 * requirePIIToken — IBAN endpoint'i için daha sıkı kontrol.
 * Token tipi "pii" olmalı ve URL'deki tradeId ile eşleşmeli.
 */
function requirePIIToken(req, res, next) {
  try {
    if (!/^[a-fA-F0-9]{24}$/.test(req.params.tradeId || "")) {
      return res.status(400).json({ error: "Geçersiz tradeId formatı." });
    }

    const payload = _getPIITokenPayload(req);

    if (payload.type !== "pii") {
      return res.status(403).json({ error: "Geçersiz token tipi. 'pii' bekleniyordu." });
    }

    // [TR] Token sadece belirtilen tradeId için geçerli
    if (payload.tradeId !== req.params.tradeId) {
      logger.warn(
        `[GÜVENLİK] PII token manipülasyonu: caller=${payload.sub} ` +
        `token_trade=${payload.tradeId} requested_trade=${req.params.tradeId}`
      );
      return res.status(403).json({ error: "Token bu işlem için geçerli değil." });
    }

    req.wallet = payload.sub.toLowerCase();
    next();
  } catch (err) {
    logger.warn(`[PIIAuth] Token doğrulaması başarısız: ${err.message}`);
    return res.status(err.statusCode || 401).json({ error: err.message || "Geçersiz PII token." });
  }
}

module.exports = { requireAuth, requirePIIToken };
