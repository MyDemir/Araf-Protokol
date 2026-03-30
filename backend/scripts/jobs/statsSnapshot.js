"use strict";

/**
 * Stats Snapshot Job — V3 Günlük Order + Child Trade Snapshot
 *
 * V3 ile birlikte istatistik dili değişti:
 *   - public market katmanı artık Order üzerinden okunur
 *   - gerçek escrow lifecycle'ı child trade üzerinden ölçülür
 *   - analytics katmanı bunları AYRI raporlar
 *
 * Bu job her çalıştığında güncel V3 metriklerini hesaplar ve
 * `historical_stats` koleksiyonunda ilgili güne upsert eder.
 */

const Trade = require("../models/Trade");
const Order = require("../models/Order");
const HistoricalStat = require("../models/HistoricalStat");
const logger = require("../utils/logger");

/**
 * V3 güncel istatistiklerini DB seviyesinde hesaplar.
 *
 * Notlar:
 *   - total_volume_usdt      = RESOLVED child trade hacmi
 *   - executed_volume_usdt   = spawn edilmiş (fill edilmiş) child trade hacmi
 *   - completed_trades       = RESOLVED child trade adedi
 *   - child_trade_count      = tüm child trade kayıtları
 *   - active_child_trades    = terminal state'e geçmemiş child trade adedi
 *   - open_sell/open_buy     = açık parent order sayıları
 */
async function computeCurrentStats() {
  const activeTradeStates = ["OPEN", "LOCKED", "PAID", "CHALLENGED"];
  const executedTradeStates = ["LOCKED", "PAID", "CHALLENGED", "RESOLVED", "CANCELED", "BURNED"];

  const [
    resolvedAgg,
    executedAgg,
    burnedAgg,
    childTradeCount,
    activeChildTrades,
    openSellOrders,
    openBuyOrders,
    partiallyFilledOrders,
    filledOrders,
    canceledOrders,
  ] = await Promise.all([
    Trade.aggregate([
      { $match: { status: "RESOLVED" } },
      {
        $group: {
          _id: null,
          totalVolume: { $sum: "$financials.crypto_amount_num" },
          count: { $sum: 1 },
          totalDurationMs: {
            $sum: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ["$timers.locked_at", null] },
                    { $ne: ["$timers.resolved_at", null] },
                  ],
                },
                then: { $subtract: ["$timers.resolved_at", "$timers.locked_at"] },
                else: 0,
              },
            },
          },
        },
      },
    ]),
    Trade.aggregate([
      { $match: { status: { $in: executedTradeStates } } },
      {
        $group: {
          _id: null,
          totalExecutedVolume: { $sum: "$financials.crypto_amount_num" },
          count: { $sum: 1 },
        },
      },
    ]),
    Trade.aggregate([
      { $match: { status: "BURNED" } },
      {
        $group: {
          _id: null,
          totalDecayed: { $sum: "$financials.total_decayed_num" },
        },
      },
    ]),
    Trade.countDocuments({}),
    Trade.countDocuments({ status: { $in: activeTradeStates } }),
    Order.countDocuments({ side: "SELL_CRYPTO", status: "OPEN" }),
    Order.countDocuments({ side: "BUY_CRYPTO", status: "OPEN" }),
    Order.countDocuments({ status: "PARTIALLY_FILLED" }),
    Order.countDocuments({ status: "FILLED" }),
    Order.countDocuments({ status: "CANCELED" }),
  ]);

  const resolved = resolvedAgg[0] || { totalVolume: 0, count: 0, totalDurationMs: 0 };
  const executed = executedAgg[0] || { totalExecutedVolume: 0, count: 0 };
  const burned = burnedAgg[0] || { totalDecayed: 0 };

  const avgTradeHours = resolved.count > 0
    ? parseFloat((resolved.totalDurationMs / resolved.count / (1000 * 3600)).toFixed(1))
    : null;

  return {
    total_volume_usdt: resolved.totalVolume,
    executed_volume_usdt: executed.totalExecutedVolume,
    completed_trades: resolved.count,
    child_trade_count: childTradeCount,
    active_child_trades: activeChildTrades,
    open_sell_orders: openSellOrders,
    open_buy_orders: openBuyOrders,
    partially_filled_orders: partiallyFilledOrders,
    filled_orders: filledOrders,
    canceled_orders: canceledOrders,
    burned_bonds_usdt: burned.totalDecayed,
    avg_trade_hours: avgTradeHours,
  };
}

async function runStatsSnapshot() {
  logger.info("[Job:StatsSnapshot] V3 günlük istatistik anlık görüntüsü oluşturuluyor...");
  try {
    const stats = await computeCurrentStats();
    const today = new Date().toISOString().split("T")[0];

    await HistoricalStat.findOneAndUpdate(
      { date: today },
      { $set: stats },
      { upsert: true, new: true }
    );

    logger.info(
      `[Job:StatsSnapshot] Snapshot kaydedildi: date=${today}, ` +
      `resolved_volume=${Number(stats.total_volume_usdt || 0).toFixed(2)}, ` +
      `executed_volume=${Number(stats.executed_volume_usdt || 0).toFixed(2)}, ` +
      `child_trades=${stats.child_trade_count}`
    );
  } catch (err) {
    logger.error(`[Job:StatsSnapshot] Görev başarısız oldu: ${err.message}`, { stack: err.stack });
  }
}

module.exports = {
  runStatsSnapshot,
  computeCurrentStats,
};
