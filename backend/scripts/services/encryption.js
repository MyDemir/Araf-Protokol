"use strict";

/**
 * ArafEncryption — Envelope Encryption for PII (IBAN, Name, Telegram)
 *
 * Architecture:
 *   Master Key (env/KMS) → derives unique Data Encryption Key (DEK) per wallet
 *   DEK is NEVER stored. Re-derived on demand using HKDF.
 *   Encrypted data format: iv (12 bytes) + authTag (16 bytes) + ciphertext
 *
 * In production: replace Master Key derivation with AWS KMS / HashiCorp Vault API call.
 * The interface stays identical — only _getMasterKey() changes.
 *
 * H-05 Fix: HKDF implementasyonu Node.js native crypto.hkdf() ile değiştirildi.
 * Önceki implementasyon iki zincirlenmiş HMAC kullanıyordu (RFC 5869 uyumlu değil).
 * Mevcut şifreli veriler yeniden şifreleme gerektirir — migration planı yapılmalı.
 */

const crypto = require("crypto");
const { promisify } = require("util");

const ALGORITHM  = "aes-256-gcm";
const IV_LENGTH  = 12;    // GCM recommended
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;    // 256-bit

// H-05 Fix: Node.js native hkdf — callback tabanlı, promisify ile async kullanılır
const hkdfAsync = promisify(crypto.hkdf);

/**
 * @returns {Buffer} 32-byte master key from environment
 * PRODUCTION: replace with KMS.decrypt() call
 */
function _getMasterKey() {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    throw new Error("MASTER_ENCRYPTION_KEY is missing or too short (need 32 bytes / 64 hex chars)");
  }
  return Buffer.from(hex.slice(0, 64), "hex");
}

/**
 * Derives a wallet-specific DEK using HKDF (RFC 5869, SHA-256).
 * Same wallet always gets the same DEK — deterministic but unique per wallet.
 *
 * H-05 Fix: Node.js native crypto.hkdf() kullanılıyor (RFC 5869 tam uyumlu).
 * Önceki iki HMAC zinciri yerini aldı.
 *
 * @param {string} walletAddress - lowercase Ethereum address
 * @returns {Promise<Buffer>} 32-byte DEK
 */
async function _deriveDataKey(walletAddress) {
  const masterKey = _getMasterKey();
  const salt      = Buffer.alloc(32, 0); // deterministic salt (wallet adresi info'da)
  const info      = Buffer.from(`araf-pii-${walletAddress.toLowerCase()}`);

  const dek = await hkdfAsync("sha256", masterKey, salt, info, KEY_LENGTH);
  return Buffer.from(dek);
}

/**
 * Encrypts a plaintext string for a specific wallet.
 *
 * @param {string} plaintext     - Data to encrypt (IBAN, name, etc.)
 * @param {string} walletAddress - Wallet this data belongs to
 * @returns {Promise<string>} base64-encoded encrypted blob (iv + authTag + ciphertext)
 */
async function encrypt(plaintext, walletAddress) {
  if (!plaintext || typeof plaintext !== "string") {
    throw new TypeError("encrypt: plaintext must be a non-empty string");
  }

  const dek = await _deriveDataKey(walletAddress);
  const iv  = crypto.randomBytes(IV_LENGTH);

  const cipher    = crypto.createCipheriv(ALGORITHM, dek, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: iv | authTag | ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString("base64");
}

/**
 * Decrypts a previously encrypted blob for a specific wallet.
 *
 * @param {string} encryptedBase64 - base64 blob from encrypt()
 * @param {string} walletAddress   - Must match the wallet used during encryption
 * @returns {Promise<string>} Decrypted plaintext
 * @throws {Error} If decryption fails (wrong key, tampered data)
 */
async function decrypt(encryptedBase64, walletAddress) {
  if (!encryptedBase64 || typeof encryptedBase64 !== "string") {
    throw new TypeError("decrypt: encryptedBase64 must be a non-empty string");
  }

  const dek      = await _deriveDataKey(walletAddress);
  const combined = Buffer.from(encryptedBase64, "base64");

  if (combined.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("decrypt: invalid ciphertext length");
  }

  const iv         = combined.slice(0, IV_LENGTH);
  const authTag    = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),   // throws if auth tag invalid (tampered data)
  ]);

  // DEK is in local scope — cleared on function exit (no explicit zeroization in Node.js GC)
  return decrypted.toString("utf8");
}

/**
 * Encrypts an entire PII object for a wallet.
 *
 * @param {{ bankOwner, iban, telegram }} pii
 * @param {string} walletAddress
 * @returns {Promise<{ bankOwner_enc, iban_enc, telegram_enc }>}
 */
async function encryptPII(pii, walletAddress) {
  return {
    bankOwner_enc: pii.bankOwner ? await encrypt(pii.bankOwner, walletAddress) : null,
    iban_enc:      pii.iban      ? await encrypt(pii.iban,      walletAddress) : null,
    telegram_enc:  pii.telegram  ? await encrypt(pii.telegram,  walletAddress) : null,
  };
}

/**
 * Decrypts an encrypted PII object for a wallet.
 * Returns null for any missing/null field — never throws on missing data.
 *
 * @param {{ bankOwner_enc, iban_enc, telegram_enc }} encPII
 * @param {string} walletAddress
 * @returns {Promise<{ bankOwner, iban, telegram }>}
 */
async function decryptPII(encPII, walletAddress) {
  return {
    bankOwner: encPII.bankOwner_enc ? await decrypt(encPII.bankOwner_enc, walletAddress) : null,
    iban:      encPII.iban_enc      ? await decrypt(encPII.iban_enc,      walletAddress) : null,
    telegram:  encPII.telegram_enc  ? await decrypt(encPII.telegram_enc,  walletAddress) : null,
  };
}

module.exports = { encrypt, decrypt, encryptPII, decryptPII };
