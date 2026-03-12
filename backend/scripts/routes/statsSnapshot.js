"use strict";

/**
 * Stats Snapshot Job — Günlük İstatistik Anlık Görüntüsü Alma Görevi
 *
 * Bu görev, her 24 saatte bir çalışarak güncel protokol istatistiklerini
 * hesaplar ve `historical_stats` koleksiyonuna kaydeder.
 *
 * app.js tarafından periyodik olarak tetiklenir.
 */

const { Trade, Listing } = require("../models/Trade");
const HistoricalStat     = require("../models/HistoricalStat");
const logger             = require("../utils/logger");

/**
 * Anlık protokol istatistiklerini hesaplar.
 * Bu mantık, /api/stats rotasındaki canlı veri hesaplamasıyla paylaşılabilir.
 */
async function computeCurrentStats() {
  const [
    completedTrades,
    burnedTrades,
    activeListings,
  ] = await Promise.all([
    Trade.find({ status: "RESOLVED" }).lean(),
    Trade.find({ status: "BURNED" }).lean(),
    Listing.countDocuments({ status: "OPEN" }),
  ]);

  const totalVolumeUsdt = completedTrades.reduce((sum, t) => sum + (t.financials?.crypto_amount || 0), 0);
  const burnedBondsUsdt = burnedTrades.reduce((sum, t) => sum + (t.financials?.total_decayed || 0), 0);

  // YENİ: Ortalama işlem süresini hesapla (saat cinsinden)
  const totalDurationMs = completedTrades.reduce((sum, t) => {
    if (t.timers?.locked_at && t.timers?.resolved_at) {
      return sum + (t.timers.resolved_at.getTime() - t.timers.locked_at.getTime());
    }
    return sum;
  }, 0);
  const avgTradeHours = completedTrades.length > 0
    ? parseFloat((totalDurationMs / completedTrades.length / (1000 * 3600)).toFixed(1))
    : null;

  return {
    total_volume_usdt: totalVolumeUsdt,
    completed_trades:  completedTrades.length,
    active_listings:   activeListings,
    burned_bonds_usdt: burnedBondsUsdt,
    avg_trade_hours:   avgTradeHours, // Hesaplanmış değeri ekle
  };
}

/**
 * İstatistikleri hesaplar ve `historical_stats` koleksiyonuna kaydeder/günceller.
 * Görev idempotenttir; aynı gün içinde birden çok kez çalıştırılsa bile
 * sadece tek bir kayıt oluşturur/günceller.
 */
async function runStatsSnapshot() {
  logger.info("[Job:StatsSnapshot] Günlük istatistik anlık görüntüsü oluşturuluyor...");
  try {
    const stats = await computeCurrentStats();

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    await HistoricalStat.findOneAndUpdate(
      { date: today },
      { $set: stats },
      { upsert: true, new: true }
    );

    logger.info(
      `[Job:StatsSnapshot] Anlık görüntü kaydedildi: date=${today}, ` +
      `volume=${stats.total_volume_usdt.toFixed(2)}, trades=${stats.completed_trades}`
    );
  } catch (err) {
    logger.error(`[Job:StatsSnapshot] Görev başarısız oldu: ${err.message}`, { stack: err.stack });
  }
}

module.exports = {
  runStatsSnapshot,
  computeCurrentStats, // Diğer modüllerin de kullanabilmesi için export edilebilir
};