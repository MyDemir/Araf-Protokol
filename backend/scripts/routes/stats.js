"use strict";

/**
 * Stats Route — Protokol İstatistikleri
 *
 * GET /api/stats
 *   Herkese açık. Auth gerektirmez.
 *   Redis'te STATS_TTL süre cache'lenir.
 *   Cache yoksa MongoDB'den hesaplanır, Redis'e yazılır.
 *
 * Metrikler:
 *   total_volume_usdt    — RESOLVED işlemlerin toplam kripto hacmi
 *   completed_trades     — RESOLVED işlem sayısı
 *   active_listings      — OPEN ilan sayısı
 *   burned_bonds_usdt    — BURNED işlemlerdeki toplam eriyik miktar
 *   avg_trade_hours      — LOCKED → RESOLVED ortalama süresi (saat)
 */

const express = require("express");
const router  = express.Router();

const { getRedisClient }        = require("../config/redis");
const { Listing, Trade }        = require("../models/Trade");
const logger                    = require("../utils/logger");

const CACHE_KEY  = "proto:stats:v1";
const STATS_TTL  = 60 * 60; // 1 saat (saniye)

// ── Hesaplama fonksiyonu ──────────────────────────────────────────────────────
async function computeStats() {
  const [
    totalVolumeResult,
    completedTrades,
    activeListings,
    burnedResult,
    avgTimeResult,
  ] = await Promise.all([

    // 1. Toplam USDT hacmi — tüm RESOLVED işlemler
    Trade.aggregate([
      { $match: { status: "RESOLVED" } },
      { $group: { _id: null, total: { $sum: "$financials.crypto_amount" } } },
    ]),

    // 2. Başarıyla tamamlanan işlem sayısı
    Trade.countDocuments({ status: "RESOLVED" }),

    // 3. Aktif ilan sayısı
    Listing.countDocuments({ status: "OPEN" }),

    // 4. Yakılan teminat toplamı — BURNED işlemlerdeki total_decayed
    Trade.aggregate([
      { $match: { status: "BURNED" } },
      { $group: { _id: null, total: { $sum: "$financials.total_decayed" } } },
    ]),

    // 5. Ortalama işlem süresi: locked_at → resolved_at (saat)
    Trade.aggregate([
      {
        $match: {
          status: "RESOLVED",
          "timers.locked_at":   { $ne: null },
          "timers.resolved_at": { $ne: null },
        },
      },
      {
        $project: {
          durationMs: {
            $subtract: ["$timers.resolved_at", "$timers.locked_at"],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgMs: { $avg: "$durationMs" },
        },
      },
    ]),

  ]);

  const totalVolumeUsdt  = totalVolumeResult[0]?.total  ?? 0;
  const burnedBondsUsdt  = burnedResult[0]?.total        ?? 0;
  const avgMs            = avgTimeResult[0]?.avgMs        ?? null;
  const avgTradeHours    = avgMs !== null
    ? parseFloat((avgMs / (1000 * 60 * 60)).toFixed(1))
    : null;

  return {
    total_volume_usdt:  parseFloat(totalVolumeUsdt.toFixed(2)),
    completed_trades:   completedTrades,
    active_listings:    activeListings,
    burned_bonds_usdt:  parseFloat(burnedBondsUsdt.toFixed(2)),
    avg_trade_hours:    avgTradeHours,
    cached_at:          new Date().toISOString(),
  };
}

// ── GET /api/stats ─────────────────────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const redis = getRedisClient();

    // 1. Cache'e bak
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return res.json({ stats: JSON.parse(cached), source: "cache" });
    }

    // 2. Cache yok — MongoDB'den hesapla
    logger.info("[Stats] Cache miss — MongoDB'den hesaplanıyor");
    const stats = await computeStats();

    // 3. Redis'e yaz (1 saat TTL)
    await redis.setEx(CACHE_KEY, STATS_TTL, JSON.stringify(stats));

    return res.json({ stats, source: "computed" });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
