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
 * [TR] Number cache alanları analytics kolaylığı içindir; canonical authority değildir.
 *      Bu yüzden snapshot sırasında hem approximate Number hem de string-safe alan üretiriz.
 * [EN] Number cache fields are for analytics convenience only, not canonical authority.
 *      During snapshot we therefore produce both approximate Number and string-safe values.
 */
function _toSafeFixedNumber(value, digits = 6) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

function _sumDecimalStrings(values = []) {
  let total = 0n;
  for (const raw of values) {
    const normalized = String(raw ?? "0").trim();
    if (!/^-?\d+$/.test(normalized)) continue;
    total += BigInt(normalized);
  }
  return total.toString();
}

/**
 * V3 güncel istatistiklerini DB seviyesinde hesaplar.
 *
 * Notlar:
 *   - total_volume_usdt                = RESOLVED child trade hacmi (approximate Number cache)
 *   - total_volume_usdt_str            = RESOLVED child trade hacmi (string-safe toplam)
 *   - executed_volume_usdt             = spawn edilmiş (fill edilmiş) child trade hacmi (approximate)
 *   - executed_volume_usdt_str         = spawn edilmiş child trade hacmi (string-safe toplam)
 *   - completed_trades                 = RESOLVED child trade adedi
 *   - child_trade_count                = tüm child trade kayıtları
 *   - active_child_trades              = terminal state'e geçmemiş child trade adedi
 *   - open_sell/open_buy_orders        = halen fill edilebilir parent order sayıları
 */
async function computeCurrentStats() {
  const activeTradeStates = ["OPEN", "LOCKED", "PAID", "CHALLENGED"];
  const executedTradeStates = ["LOCKED", "PAID", "CHALLENGED", "RESOLVED", "CANCELED", "BURNED"];

  // [TR] "Açık emir" semantiğinde PARTIALLY_FILLED de halen fill edilebilir kabul edilir.
  // [EN] PARTIALLY_FILLED orders are still fillable, so they are included in "open" order semantics.
  const fillableOrderStates = ["OPEN", "PARTIALLY_FILLED"];

  const [
    resolvedAgg,
    executedAgg,
    burnedAgg,
    resolvedTrades,
    executedTrades,
    burnedTrades,
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
          totalVolumeApprox: { $sum: "$financials.crypto_amount_num" },
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
          totalExecutedVolumeApprox: { $sum: "$financials.crypto_amount_num" },
          count: { $sum: 1 },
        },
      },
    ]),
    Trade.aggregate([
      { $match: { status: "BURNED" } },
      {
        $group: {
          _id: null,
          totalDecayedApprox: { $sum: "$financials.total_decayed_num" },
        },
      },
    ]),
    Trade.find({ status: "RESOLVED" })
      .select("financials.crypto_amount")
      .lean(),
    Trade.find({ status: { $in: executedTradeStates } })
      .select("financials.crypto_amount")
      .lean(),
    Trade.find({ status: "BURNED" })
      .select("financials.total_decayed")
      .lean(),
    Trade.countDocuments({}),
    Trade.countDocuments({ status: { $in: activeTradeStates } }),
    Order.countDocuments({ side: "SELL_CRYPTO", status: { $in: fillableOrderStates } }),
    Order.countDocuments({ side: "BUY_CRYPTO", status: { $in: fillableOrderStates } }),
    Order.countDocuments({ status: "PARTIALLY_FILLED" }),
    Order.countDocuments({ status: "FILLED" }),
    Order.countDocuments({ status: "CANCELED" }),
  ]);

  const resolved = resolvedAgg[0] || { totalVolumeApprox: 0, count: 0, totalDurationMs: 0 };
  const executed = executedAgg[0] || { totalExecutedVolumeApprox: 0, count: 0 };
  const burned = burnedAgg[0] || { totalDecayedApprox: 0 };

  const totalVolumeStr = _sumDecimalStrings(
    resolvedTrades.map((trade) => trade?.financials?.crypto_amount || "0")
  );

  const executedVolumeStr = _sumDecimalStrings(
    executedTrades.map((trade) => trade?.financials?.crypto_amount || "0")
  );

  const burnedBondsStr = _sumDecimalStrings(
    burnedTrades.map((trade) => trade?.financials?.total_decayed || "0")
  );

  const avgTradeHours = resolved.count > 0
    ? _toSafeFixedNumber(resolved.totalDurationMs / resolved.count / (1000 * 3600), 2)
    : null;

  return {
    total_volume_usdt: _toSafeFixedNumber(resolved.totalVolumeApprox, 6),
    total_volume_usdt_str: totalVolumeStr,
    executed_volume_usdt: _toSafeFixedNumber(executed.totalExecutedVolumeApprox, 6),
    executed_volume_usdt_str: executedVolumeStr,
    completed_trades: resolved.count,
    child_trade_count: childTradeCount,
    active_child_trades: activeChildTrades,
    open_sell_orders: openSellOrders,
    open_buy_orders: openBuyOrders,
    partially_filled_orders: partiallyFilledOrders,
    filled_orders: filledOrders,
    canceled_orders: canceledOrders,
    burned_bonds_usdt: _toSafeFixedNumber(burned.totalDecayedApprox, 6),
    burned_bonds_usdt_str: burnedBondsStr,
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
    return { success: true };
  } catch (err) {
    logger.error(`[Job:StatsSnapshot] Görev başarısız oldu: ${err.message}`, { stack: err.stack });
    return { success: false, error: err.message };
  }
}

module.exports = {
  runStatsSnapshot,
  computeCurrentStats,
};
