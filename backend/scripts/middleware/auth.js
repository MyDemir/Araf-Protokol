"use strict";

const { verifyJWT } = require("../services/siwe");
const logger        = require("../utils/logger");

/**
 * requireAuth — Validates Bearer JWT on protected routes.
 * Sets req.wallet = lowercase Ethereum address.
 */
function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header missing" });
    }

    const token   = authHeader.slice(7);
    const payload = verifyJWT(token);

    if (payload.type !== "auth") {
      return res.status(401).json({ error: "Invalid token type" });
    }

    req.wallet = payload.sub.toLowerCase();
    next();
  } catch (err) {
    logger.warn(`[Auth] Token verification failed: ${err.message}`);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * requirePIIToken — Stricter check for the IBAN endpoint.
 * Token must be of type "pii" and match the requested tradeId.
 */
function requirePIIToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization header missing" });
    }

    const token   = authHeader.slice(7);
    const payload = verifyJWT(token);

    // Must be PII-type token
    if (payload.type !== "pii") {
      return res.status(403).json({ error: "PII token required" });
    }

    // Token must match the requested tradeId
    if (payload.tradeId !== req.params.tradeId) {
      return res.status(403).json({ error: "Token not valid for this trade" });
    }

    req.wallet  = payload.sub.toLowerCase();
    req.tradeId = payload.tradeId;
    next();
  } catch (err) {
    logger.warn(`[PIIAuth] Token verification failed: ${err.message}`);
    return res.status(401).json({ error: "Invalid or expired PII token" });
  }
}

module.exports = { requireAuth, requirePIIToken };
