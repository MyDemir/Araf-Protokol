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
const { getRedisClient } = require("../config/redis");
const HistoricalStat = require("../models/HistoricalStat");

const STATS_CACHE_KEY = "cache:protocol_stats:v3";
const STATS_CACHE_TTL = 3600;

function calculateChange(current, previous) {
  if (previous == null || previous === 0) return null;
  if (typeof current !== "number" || Number.isNaN(current)) return null;
  return parseFloat((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}

router.get("/", async (_req, res, next) => {
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

    const finalStats = { ...currentStats, changes_30d };
    await redis.setEx(STATS_CACHE_KEY, STATS_CACHE_TTL, JSON.stringify(finalStats));
    return res.json({ stats: finalStats });
  } catch (err) { next(err); }
});

module.exports = router;
