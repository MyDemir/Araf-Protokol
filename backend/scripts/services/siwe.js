"use strict";

/**
 * SIWE (Sign-In with Ethereum) Authentication Service
 *
 * Flow:
 * 1. Frontend: GET /api/auth/nonce?address=0x...  -> receives nonce
 * 2. Frontend: Signs SIWE message with MetaMask
 * 3. Frontend: POST /api/auth/verify { message, signature }
 * 4. Backend:  Verifies signature -> issues JWT (15min) + refresh token
 *
 * Security:
 * - Nonce stored in Redis with 5-minute TTL (NOT MongoDB)
 * - Nonce invalidated immediately after use (prevents replay)
 * - JWT is short-lived (15 min); trade-scoped PII tokens even shorter
 */

const { SiweMessage }   = require("siwe");
const jwt               = require("jsonwebtoken");
const crypto            = require("crypto");
const { getRedisClient } = require("../config/redis");
const logger            = require("../utils/logger");

const JWT_SECRET      = process.env.JWT_SECRET;
const JWT_EXPIRES     = process.env.JWT_EXPIRES_IN      || "15m";
const PII_EXPIRES     = process.env.PII_TOKEN_EXPIRES_IN || "15m";
const NONCE_TTL_SECS  = 5 * 60; // 5 minutes

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET is missing or too short (min 32 chars)");
}

// ─── Nonce Management (Redis) ─────────────────────────────────────────────────

/**
 * Generates a cryptographically random nonce and stores it in Redis.
 * TTL: 5 minutes. After use, it is deleted immediately (single-use).
 *
 * @param {string} walletAddress - lowercase address
 * @returns {string} nonce
 */
async function generateNonce(walletAddress) {
  const redis  = getRedisClient();
  const nonce  = crypto.randomBytes(16).toString("hex");
  const key    = `nonce:${walletAddress.toLowerCase()}`;

  // Atomic set with TTL — overwrites previous nonce (prevents stacking)
  await redis.setEx(key, NONCE_TTL_SECS, nonce);

  logger.debug(`Nonce generated for ${walletAddress}`);
  return nonce;
}

/**
 * Retrieves and immediately invalidates the nonce (single-use).
 *
 * @param {string} walletAddress
 * @returns {string|null} nonce or null if expired/not found
 */
async function consumeNonce(walletAddress) {
  const redis = getRedisClient();
  const key   = `nonce:${walletAddress.toLowerCase()}`;

  // Atomic getdel — prevents race condition between get and delete
  const nonce = await redis.getDel(key);
  return nonce; // null if not found or expired
}

// ─── SIWE Verification ────────────────────────────────────────────────────────

/**
 * Verifies a SIWE signature and returns the authenticated wallet address.
 *
 * @param {string} message   - SIWE message string
 * @param {string} signature - Hex signature from MetaMask
 * @returns {string} Authenticated wallet address (lowercase)
 * @throws {Error} If verification fails
 */
async function verifySiweSignature(message, signature) {
  const siweMsg = new SiweMessage(message);

  // C-02 FIX: Null guard — consumeNonce returns null when TTL expired or not found
  const nonce = await consumeNonce(siweMsg.address);
  if (!nonce) {
    throw new Error("Nonce bulunamadı veya süresi doldu. Lütfen tekrar deneyin.");
  }

  // H-02 FIX: SIWE_DOMAIN zorunlu — production'da localhost kalmasın
  const domain = process.env.SIWE_DOMAIN;
  if (!domain && process.env.NODE_ENV === "production") {
    throw new Error("SIWE_DOMAIN ortam değişkeni production'da set edilmeli.");
  }

  // 🛡️ DİNAMİK PROTOKOL: Codespaces, Ngrok veya Localhost uyumu
  let expectedScheme = "https";
  if (process.env.NODE_ENV !== "production") {
    try {
      expectedScheme = new URL(siweMsg.uri).protocol.replace(":", "");
    } catch (e) {
      expectedScheme = "http";
    }
  }

  const result = await siweMsg.verify({
    signature,
    domain: domain || "localhost",
    nonce,
    scheme: expectedScheme,
  });

  if (!result.success) {
    // Tanımsız (undefined) hata mesajını önlemek için düzeltildi
    throw new Error(result.error?.message || result.error?.type || "İmza doğrulama başarısız.");
  }

  return siweMsg.address.toLowerCase();
}

// ─── JWT ──────────────────────────────────────────────────────────────────────

/**
 * Issues a short-lived JWT for an authenticated wallet.
 *
 * @param {string} walletAddress
 * @returns {string} signed JWT
 */
function issueJWT(walletAddress) {
  return jwt.sign(
    {
      sub:  walletAddress.toLowerCase(),
      type: "auth",
      iat:  Math.floor(Date.now() / 1000),
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES, algorithm: "HS256" }
  );
}

/**
 * Issues a trade-scoped, single-use PII access token.
 * Used exclusively for IBAN fetch endpoint.
 *
 * @param {string} walletAddress - The taker requesting PII
 * @param {string} tradeId       - MongoDB trade _id
 * @returns {string} signed PII token
 */
function issuePIIToken(walletAddress, tradeId) {
  return jwt.sign(
    {
      sub:      walletAddress.toLowerCase(),
      tradeId: tradeId.toString(),
      type:     "pii",
      iat:      Math.floor(Date.now() / 1000),
    },
    JWT_SECRET,
    { expiresIn: PII_EXPIRES, algorithm: "HS256" }
  );
}

/**
 * Verifies any JWT and returns the decoded payload.
 *
 * @param {string} token
 * @returns {object} decoded payload
 * @throws {Error} if invalid or expired
 */
function verifyJWT(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
}

module.exports = {
  generateNonce,
  consumeNonce,
  verifySiweSignature,
  issueJWT,
  issuePIIToken,
  verifyJWT,
};
