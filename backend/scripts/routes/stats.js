"use strict";

/**
 * Stats Route — Protokol İstatistikleri
 *
 * Endpoint:
 *   GET /api/stats — Herkese açık, önbelleğe alınmış protokol istatistikleri
 *
 * Felsefe:
 *   - "Kod Kanundur": Tüm hesaplamalar backend'de yapılır. Frontend sadece veriyi gösterir.
 *   - Performans: İstatistikler, her istekte yeniden hesaplanmak yerine Redis'te
 *     1 saat süreyle önbelleğe alınır. Bu, veritabanı yükünü azaltır.
 *   - Tarihsel Değişim: 30 gün önceki verilerle karşılaştırma yapmak için
 *     `HistoricalStat` modelinden günlük anlık görüntüler kullanılır.
 */

const express = require("express");
const router  = express.Router();

const { getRedisClient } = require("../config/redis");
const logger             = require("../utils/logger");
const HistoricalStat     = require("../models/HistoricalStat");

const STATS_CACHE_KEY = "cache:protocol_stats";
const STATS_CACHE_TTL = 3600; // 1 saat

// ── GET /api/stats ─────────────────────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const redis = getRedisClient();

    // 1. Önbelleği kontrol et
    const cachedStats = await redis.get(STATS_CACHE_KEY);
    if (cachedStats) {
      logger.debug("[Stats] Önbellekten sunuldu.");
      return res.json({ stats: JSON.parse(cachedStats) });
    }

    logger.debug("[Stats] Önbellek boş, yeniden hesaplanıyor...");

    // 2. Canlı hesaplama yerine, en son kaydedilen anlık görüntüyü çek.
    // Bu, veritabanı yükünü büyük ölçüde azaltır.
    const currentStatsDoc = await HistoricalStat.findOne().sort({ date: -1 }).lean();
    if (!currentStatsDoc) {
      return res.json({ stats: {} }); // Henüz hiç anlık görüntü yoksa boş obje dön.
    }
    const { _id, date, __v, ...currentStats } = currentStatsDoc; // Mongo'ya özgü alanları kaldır

    // 3. 30 gün önceki anlık görüntü verisini çek
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateString30d = thirtyDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD

    const oldStats = await HistoricalStat.findOne({ date: dateString30d }).lean();

    // 4. Yüzde değişimlerini hesapla
    const changes_30d = {};
    if (oldStats) {
      const calculateChange = (current, previous) => {
        if (previous === 0 || previous == null) return current > 0 ? 100.0 : 0.0;
        return ((current - previous) / previous) * 100;
      };

      changes_30d.total_volume_usdt_pct = calculateChange(currentStats.total_volume_usdt, oldStats.total_volume_usdt);
      changes_30d.completed_trades_pct  = calculateChange(currentStats.completed_trades, oldStats.completed_trades);
      changes_30d.active_listings_pct   = calculateChange(currentStats.active_listings, oldStats.active_listings);
      changes_30d.burned_bonds_usdt_pct = calculateChange(currentStats.burned_bonds_usdt, oldStats.burned_bonds_usdt);
    }

    const finalStats = {
      ...currentStats,
      changes_30d,
    };

    // 5. Sonucu önbelleğe al ve döndür
    await redis.setEx(STATS_CACHE_KEY, STATS_CACHE_TTL, JSON.stringify(finalStats));

    return res.json({ stats: finalStats });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
