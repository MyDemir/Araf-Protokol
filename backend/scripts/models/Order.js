"use strict";

const mongoose = require("mongoose");

/**
 * Order Model — V3 Parent Order Mirror
 *
 * V3 kuralı:
 *   - Parent order kamusal emir katmanıdır.
 *   - Child trade ise gerçek escrow lifecycle'ıdır.
 *   - Backend remaining amount veya reserve HESAPLAMAZ;
 *     bunları kontrattan mirror eder.
 *
 * Bu modelin görevi:
 *   1. on-chain order kimliğini taşımak,
 *   2. owner / side / amount / reserve snapshot'larını saklamak,
 *   3. order feed ve dashboard sorgularını hızlandırmak,
 *   4. child trade istatistiklerini yardımcı analiz katmanı olarak tutmak.
 */

const orderSchema = new mongoose.Schema(
  {
    onchain_order_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: /^\d+$/,
    },

    owner_address: {
      type: String,
      required: true,
      lowercase: true,
      match: /^0x[a-fA-F0-9]{40}$/,
      index: true,
    },

    side: {
      type: String,
      enum: ["SELL_CRYPTO", "BUY_CRYPTO"],
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELED"],
      required: true,
      index: true,
    },

    tier: {
      type: Number,
      enum: [0, 1, 2, 3, 4],
      required: true,
      index: true,
    },

    token_address: {
      type: String,
      required: true,
      lowercase: true,
      match: /^0x[a-fA-F0-9]{40}$/,
      index: true,
    },

    // [TR] UI/search enrichment alanları. Canonical truth değildir.
    // [EN] UI/search enrichment fields. Not canonical truth.
    market: {
      crypto_asset:  { type: String, enum: ["USDT", "USDC", null], default: null },
      fiat_currency: { type: String, enum: ["TRY", "USD", "EUR", null], default: null },
      exchange_rate: { type: Number, default: null },
    },

    amounts: {
      total_amount:            { type: String, required: true },
      total_amount_num:        { type: Number, default: 0 },
      remaining_amount:        { type: String, required: true },
      remaining_amount_num:    { type: Number, default: 0 },
      min_fill_amount:         { type: String, required: true },
      min_fill_amount_num:     { type: Number, default: 0 },
    },

    reserves: {
      remaining_maker_bond_reserve:     { type: String, default: "0" },
      remaining_maker_bond_reserve_num: { type: Number, default: 0 },
      remaining_taker_bond_reserve:     { type: String, default: "0" },
      remaining_taker_bond_reserve_num: { type: Number, default: 0 },
    },

    fee_snapshot: {
      taker_fee_bps: { type: Number, default: null, min: 0 },
      maker_fee_bps: { type: Number, default: null, min: 0 },
    },

    refs: {
      order_ref: {
        type: String,
        lowercase: true,
        required: true,
        match: /^0x[a-f0-9]{64}$/,
        index: true,
      },
    },

    stats: {
      child_trade_count:           { type: Number, default: 0, min: 0 },
      active_child_trade_count:    { type: Number, default: 0, min: 0 },
      resolved_child_trade_count:  { type: Number, default: 0, min: 0 },
      canceled_child_trade_count:  { type: Number, default: 0, min: 0 },
      burned_child_trade_count:    { type: Number, default: 0, min: 0 },
      total_filled_amount:         { type: String, default: "0" },
      total_filled_amount_num:     { type: Number, default: 0 },
    },

    timers: {
      created_at_onchain: { type: Date, default: null },
      last_filled_at:     { type: Date, default: null },
      canceled_at:        { type: Date, default: null },
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
orderSchema.index({ owner_address: 1, status: 1, side: 1 });
orderSchema.index({ side: 1, status: 1, tier: 1 });
orderSchema.index({ token_address: 1, side: 1, status: 1 });
orderSchema.index({ "refs.order_ref": 1 }, { unique: true });
orderSchema.index({ "timers.last_filled_at": -1 });

module.exports = mongoose.model("Order", orderSchema);
