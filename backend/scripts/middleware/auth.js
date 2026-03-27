"use strict";

const { verifyJWT, isJWTBlacklisted, revokeRefreshToken } = require("../services/siwe");
const logger = require("../utils/logger");

/**
 * Yalnızca httpOnly auth cookie'den JWT okur.
 */
async function _getTokenPayload(req) {
  const token = req.cookies?.araf_jwt;

  if (!token) {
    const err = new Error("Oturum bulunamadı. Lütfen giriş yapın.");
    err.statusCode = 401;
    throw err;
  }

  const payload = verifyJWT(token);

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
 * PII token'ı Authorization header'dan okur.
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
 * Auth korumalı route'lar için JWT doğrulaması.
 * Sadece httpOnly cookie kabul edilir.
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
    return res
      .status(err.statusCode || 401)
      .json({ error: err.message || "Geçersiz veya süresi dolmuş token." });
  }
}

/**
 * Cookie ile doğrulanan session wallet ile istemcinin aktif bağlı cüzdanını eşleştirir.
 * Header hiçbir zaman tek başına auth kaynağı değildir.
 */
async function requireSessionWalletMatch(req, res, next) {
  const headerWalletRaw = req.headers["x-wallet-address"];

  if (!headerWalletRaw || typeof headerWalletRaw !== "string") {
    return res.status(401).json({
      error: "Aktif cüzdan bilgisi eksik. Güvenlik için yeniden giriş yapın.",
      code: "SESSION_WALLET_HEADER_MISSING",
    });
  }

  const headerWallet = headerWalletRaw.trim().toLowerCase();

  if (!/^0x[a-f0-9]{40}$/.test(headerWallet)) {
    return res.status(400).json({
      error: "Geçersiz cüzdan başlığı formatı.",
      code: "SESSION_WALLET_HEADER_INVALID",
    });
  }

  if (!req.wallet || req.wallet !== headerWallet) {
    logger.warn(
      `[Auth] Session-wallet mismatch: cookie=${req.wallet || "none"} header=${headerWallet}`
    );

    try {
      if (req.wallet) {
        await revokeRefreshToken(req.wallet);
      }
    } catch (revokeErr) {
      logger.warn(`[Auth] Mismatch revoke başarısız: ${revokeErr.message}`);
    }

    const cookieOpts = { httpOnly: true, sameSite: "lax", path: "/" };
    res.clearCookie("araf_jwt", { ...cookieOpts });
    res.clearCookie("araf_refresh", { ...cookieOpts, path: "/api/auth" });

    return res.status(409).json({
      error: "Oturum cüzdanı aktif bağlı cüzdanla eşleşmiyor. Lütfen yeniden giriş yapın.",
      code: "SESSION_WALLET_MISMATCH",
    });
  }

  next();
}

/**
 * IBAN / PII erişimi için trade-scoped token kontrolü.
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
    return res
      .status(err.statusCode || 401)
      .json({ error: err.message || "Geçersiz PII token." });
  }
}

module.exports = { requireAuth, requirePIIToken, requireSessionWalletMatch };
