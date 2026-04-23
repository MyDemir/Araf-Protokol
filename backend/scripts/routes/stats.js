"use strict";

/**
 * Stats Route — V3 Protokol İstatistikleri
 *
 * V3 ile birlikte istatistik dili de değişti:
 *   - active_listings yerine open_sell_orders / open_buy_orders
 *   - trade sayıları artık child trade lifecycle'ı üzerinden okunur
 *   - order ve child trade metrikleri ayrı ayrı raporlanır
 */

const express = require("express");
const router = express.Router();
const { statsReadLimiter } = require("../middleware/rateLimiter");
const { getRedisClient } = require("../config/redis");
const HistoricalStat = require("../models/HistoricalStat");

const STATS_CACHE_KEY = "cache:protocol_stats:v3";
const STATS_CACHE_TTL = 300; // [TR] 1 saat yerine 5 dakika — freshness / drift görünürlüğü için daha güvenli.

function calculateChange(current, previous) {
  if (previous == null || previous === 0) return null;
  if (typeof current !== "number" || Number.isNaN(current)) return null;
  return parseFloat((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}

// [TR] Stats endpoint'i public read yüzeyidir; dedicated lightweight bucket ile ayrıştırılır.
// [EN] Stats endpoint is public read surface with dedicated lightweight bucket.
router.get("/", statsReadLimiter, async (_req, res, next) => {
  try {
    const redis = getRedisClient();
    const cachedStats = await redis.get(STATS_CACHE_KEY);
    if (cachedStats) return res.json({ stats: JSON.parse(cachedStats) });

    const currentStatsDoc = await HistoricalStat.findOne().sort({ date: -1 }).lean();
    if (!currentStatsDoc) return res.json({ stats: {} });

    const { _id, date, __v, created_at, ...currentStats } = currentStatsDoc;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateString30d = thirtyDaysAgo.toISOString().split("T")[0];
    const oldStats = await HistoricalStat.findOne({ date: dateString30d }).lean();

    const changes_30d = {};
    if (oldStats) {
      const fields = [
        "total_volume_usdt",
        "executed_volume_usdt",
        "completed_trades",
        "open_sell_orders",
        "open_buy_orders",
        "partially_filled_orders",
        "active_child_trades",
        "child_trade_count",
        "filled_orders",
        "canceled_orders",
        "burned_bonds_usdt",
      ];
      for (const field of fields) {
        changes_30d[`${field}_pct`] = calculateChange(currentStats[field], oldStats[field]);
      }
    }

    // [TR] Approximate alanların yanına string-safe analytics alanlarını da döndürüyoruz.
    //      Frontend isterse approximate sayıyı gösterir, isterse raw string alanları da kullanabilir.
    const finalStats = {
      ...currentStats,
      changes_30d,
      meta: {
        cache_ttl_seconds: STATS_CACHE_TTL,
        open_order_semantics: "OPEN + PARTIALLY_FILLED",
        numeric_fields_are_approximate: true,
      },
    };

    await redis.setEx(STATS_CACHE_KEY, STATS_CACHE_TTL, JSON.stringify(finalStats));
    return res.json({ stats: finalStats });
  } catch (err) { next(err); }
});

module.exports = router;
