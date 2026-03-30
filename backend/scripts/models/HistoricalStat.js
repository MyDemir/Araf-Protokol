"use strict";

/**
 * HistoricalStat Model — Günlük Protokol İstatistikleri Anlık Görüntüsü
 *
 * V3 notu:
 *   Bu koleksiyon artık yalnız "listing sayısı" odaklı bir snapshot değildir.
 *   Parent order + child trade dünyasında günlük analitik görünüm şu iki katmanı
 *   birlikte taşımalıdır:
 *
 *     1. Order katmanı  → açık sell/buy order'lar, partial fill durumu
 *     2. Child trade    → gerçekleşen hacim, resolved count, aktif trade yükü
 *
 *   Amaç enforcement üretmek değil; dashboard / stats route / trend ekranlarını
 *   tam koleksiyon taraması yapmadan beslemektir.
 *
 * Bu koleksiyon, her günün sonunda o günkü toplam metrikleri saklar.
 * /api/stats endpoint'i, geçmiş veriyle karşılaştırma yaparak yüzde değişimlerini
 * verimli bir şekilde hesaplamak için bu koleksiyonu kullanır.
 */

const mongoose = require("mongoose");

const historicalStatSchema = new mongoose.Schema({
  // Tarih (YYYY-MM-DD formatında) — benzersiz anahtar
  date: {
    type: String,
    required: true,
    unique: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },

  // ── V3 Order Katmanı Metrikleri ────────────────────────────────────────────
  open_sell_orders: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  open_buy_orders: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  partially_filled_orders: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  filled_orders: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  canceled_orders: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },

  // ── V3 Child Trade / Hacim Metrikleri ─────────────────────────────────────
  total_volume_usdt: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },

  // [TR] executed_volume_usdt alanı resolved/canceled/burned fark etmeksizin
  //      gün içinde spawn edilen/işlenen child trade hacmini trendlemek için tutulabilir.
  // [EN] Tracks processed child-trade volume regardless of exact terminal outcome.
  executed_volume_usdt: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },

  completed_trades: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },

  // [TR] Child trade sayısı — resolved olmasa bile gün içinde oluşan toplam child trade yükü.
  // [EN] Number of child trades created/observed during the day.
  child_trade_count: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },

  // Hâlen açık olan child trade yükü — ops dashboard için yararlıdır.
  active_child_trades: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },

  resolved_child_trades: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },

  canceled_child_trades: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },

  burned_child_trades: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },

  burned_bonds_usdt: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },

  // AFS-025 Fix korunur: Ortalama işlem süresi (saat cinsinden).
  // V3'te yorum: resolved child trade'lerin ortalama kapanış süresi.
  avg_trade_hours: {
    type: Number,
    default: null,
    min: 0,
  },

  // [TR] Ops / gözlemlenebilirlik alanı — snapshot hangi şema mantığıyla üretildi?
  // [EN] Operational traceability — which snapshot schema produced this row?
  snapshot_version: {
    type: String,
    default: "v3",
  },
}, {
  timestamps: { createdAt: "created_at", updatedAt: false }, // Sadece oluşturulma tarihi
  collection: "historical_stats",
  versionKey: false,
});

// Tarih alanına descending index — stats route'unda .sort({ date: -1 }) performansı
historicalStatSchema.index({ date: -1 });

// Dashboard tarafında order + trade yükünü birlikte çeken sorgular için yardımcı index.
historicalStatSchema.index({ date: -1, open_sell_orders: -1, open_buy_orders: -1, active_child_trades: -1 });

const HistoricalStat = mongoose.model("HistoricalStat", historicalStatSchema);

module.exports = HistoricalStat;
