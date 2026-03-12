"use strict";

const { verifyJWT } = require("../services/siwe");
const logger        = require("../utils/logger");

/**
 * @private
 * Helper to extract and verify JWT from Authorization header.
 * Throws specific errors for different failure cases.
 */
function _getTokenPayload(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const err = new Error("Authorization header missing");
    err.statusCode = 401;
    throw err;
  }

  const token = authHeader.slice(7);
  // verifyJWT will throw its own error if token is invalid/expired
  return verifyJWT(token);
}

/**
 * requireAuth — Validates Bearer JWT on protected routes.
 * Sets req.wallet = lowercase Ethereum address.
 */
function requireAuth(req, res, next) {
  try {
    const payload = _getTokenPayload(req);

    if (payload.type !== "auth") {
      return res.status(403).json({ error: "Geçersiz token tipi. 'auth' bekleniyordu." });
    }

    req.wallet = payload.sub.toLowerCase();
    next();
  } catch (err) {
    logger.warn(`[Auth] Token verification failed: ${err.message}`);
    return res.status(err.statusCode || 401).json({ error: err.message || "Invalid or expired token" });
  }
}

/**
 * requirePIIToken — Stricter check for the IBAN endpoint.
 * Token must be of type "pii" and match the requested tradeId.
 */
function requirePIIToken(req, res, next) {
  try {
    const payload = _getTokenPayload(req);

    // Must be PII-type token
    if (payload.type !== "pii") {
      return res.status(403).json({ error: "Geçersiz token tipi. 'pii' bekleniyordu." });
    }

    // Token must match the requested tradeId
    if (payload.tradeId !== req.params.tradeId) {
      logger.warn(`[GÜVENLİK] PII token manipülasyonu denemesi: caller=${payload.sub}, token_trade=${payload.tradeId}, requested_trade=${req.params.tradeId}`);
      return res.status(403).json({ error: "Token bu işlem için geçerli değil." });
    }

    req.wallet  = payload.sub.toLowerCase();
    next();
  } catch (err) {
    logger.warn(`[PIIAuth] Token verification failed: ${err.message}`);
    return res.status(err.statusCode || 401).json({ error: err.message || "Invalid or expired PII token" });
  }
}

module.exports = { requireAuth, requirePIIToken };
