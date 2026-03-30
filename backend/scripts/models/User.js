"use strict";

const mongoose = require("mongoose");

/**
 * User Model
 *
 * V3 notu:
 *   - PII alanları şifreli tutulur.
 *   - reputation_cache ve ban alanları authority değil, mirror/cache katmanıdır.
 *   - Order ve child trade büyüse de kullanıcı otoritesi hâlâ on-chain reputation mapping'idir.
 */
const userSchema = new mongoose.Schema(
  {
    wallet_address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: /^0x[a-fA-F0-9]{40}$/,
      index: true,
    },
    pii_data: {
      bankOwner_enc: { type: String, default: null },
      iban_enc: { type: String, default: null },
      telegram_enc: { type: String, default: null },
    },
    reputation_cache: {
      success_rate: { type: Number, default: 100, min: 0, max: 100 },
      total_trades: { type: Number, default: 0, min: 0 },
      successful_trades: { type: Number, default: 0, min: 0 },
      failed_disputes: { type: Number, default: 0, min: 0 },
      effective_tier: { type: Number, default: 0, min: 0, max: 4 },
      failure_score: { type: Number, default: 0, min: 0 },
    },
    reputation_history: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    is_banned: { type: Boolean, default: false },
    banned_until: { type: Date, default: null },
    consecutive_bans: { type: Number, default: 0, min: 0 },
    max_allowed_tier: { type: Number, default: 4, min: 0, max: 4 },
    last_onchain_sync_at: { type: Date, default: null },
    last_login: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

userSchema.index({ wallet_address: 1 });
userSchema.index({ is_banned: 1 });
userSchema.index({ last_login: 1 }, { expireAfterSeconds: 2 * 365 * 24 * 3600 });

userSchema.methods.toPublicProfile = function () {
  return {
    wallet_address: this.wallet_address,
    reputation_cache: {
      success_rate: this.reputation_cache.success_rate,
      total_trades: this.reputation_cache.total_trades,
      successful_trades: this.reputation_cache.successful_trades,
      failed_disputes: this.reputation_cache.failed_disputes,
      effective_tier: this.reputation_cache.effective_tier,
      failure_score: this.reputation_cache.failure_score,
    },
    is_banned: this.is_banned,
    consecutive_bans: this.consecutive_bans,
    max_allowed_tier: this.max_allowed_tier,
    created_at: this.created_at,
  };
};

userSchema.methods.checkBanExpiry = async function () {
  if (this.is_banned && this.banned_until && new Date() > this.banned_until) {
    this.is_banned = false;
    this.banned_until = null;
    await this.save();
    return true;
  }
  return false;
};

module.exports = mongoose.model("User", userSchema);
