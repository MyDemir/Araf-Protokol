"use strict";

/**
 * HistoricalStat Model — V3 Günlük Protokol İstatistikleri
 *
 * V3 ile birlikte order ve child trade katmanları ayrıldığı için,
 * istatistik modeli de bu ayrımı görünür kılar.
 */

const mongoose = require("mongoose");

const historicalStatSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true,
    unique: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },
  total_volume_usdt: { type: Number, required: true, default: 0 },
  executed_volume_usdt: { type: Number, required: true, default: 0 },
  completed_trades: { type: Number, required: true, default: 0 },
  child_trade_count: { type: Number, required: true, default: 0 },
  active_child_trades: { type: Number, required: true, default: 0 },
  open_sell_orders: { type: Number, required: true, default: 0 },
  open_buy_orders: { type: Number, required: true, default: 0 },
  partially_filled_orders: { type: Number, required: true, default: 0 },
  filled_orders: { type: Number, required: true, default: 0 },
  canceled_orders: { type: Number, required: true, default: 0 },
  burned_bonds_usdt: { type: Number, required: true, default: 0 },
  avg_trade_hours: { type: Number, default: null },
}, {
  timestamps: { createdAt: "created_at", updatedAt: false },
  collection: "historical_stats",
});

historicalStatSchema.index({ date: -1 });
module.exports = mongoose.model("HistoricalStat", historicalStatSchema);
