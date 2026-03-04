"use strict";

const mongoose = require("mongoose");

/**
 * User Model
 *
 * Security design:
 *   - pii_data fields stored as AES-256-GCM ciphertext (never plaintext)
 *   - reputation_cache is READ-ONLY display data; never used for authorization
 *   - nonces NOT stored here — they live in Redis with TTL
 */
const userSchema = new mongoose.Schema(
  {
    wallet_address: {
      type:      String,
      required:  true,
      unique:    true,
      lowercase: true,
      match:     /^0x[a-fA-F0-9]{40}$/, // Valid Ethereum address
      index:     true,
    },

    // ── Encrypted PII (AES-256-GCM) ──────────────────────────────────────────
    // Raw values NEVER stored. Encrypted at service layer before saving.
    pii_data: {
      bankOwner_enc: { type: String, default: null },
      iban_enc:      { type: String, default: null },
      telegram_enc:  { type: String, default: null },
    },

    // ── Reputation Cache (display only — NOT authoritative) ──────────────────
    // Real reputation lives on-chain. This cache is for fast UI rendering only.
    // MUST NOT be used for tier/bond authorization decisions.
    reputation_cache: {
      success_rate:  { type: Number, default: 100, min: 0, max: 100 },
      total_trades:  { type: Number, default: 0,   min: 0 },
      failed_disputes: { type: Number, default: 0, min: 0 },
    },

    // ── Ban Status (mirrors on-chain, refreshed by event listener) ───────────
    is_banned:   { type: Boolean, default: false },
    banned_until: { type: Date,   default: null  },

    // ── Activity ──────────────────────────────────────────────────────────────
    last_login: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
userSchema.index({ wallet_address: 1 });
userSchema.index({ is_banned: 1 });
// TTL index: remove inactive users after 2 years (GDPR compliance)
userSchema.index({ last_login: 1 }, { expireAfterSeconds: 2 * 365 * 24 * 3600 });

// ── Methods ───────────────────────────────────────────────────────────────────

/**
 * Returns safe public profile (no PII, no encrypted fields).
 */
userSchema.methods.toPublicProfile = function () {
  return {
    wallet_address:   this.wallet_address,
    reputation_cache: this.reputation_cache,
    is_banned:        this.is_banned,
    created_at:       this.created_at,
  };
};

/**
 * Check if user's ban has expired (lazily lifts ban).
 */
userSchema.methods.checkBanExpiry = function () {
  if (this.is_banned && this.banned_until && new Date() > this.banned_until) {
    this.is_banned    = false;
    this.banned_until = null;
    return true; // Ban was lifted
  }
  return false;
};

module.exports = mongoose.model("User", userSchema);
