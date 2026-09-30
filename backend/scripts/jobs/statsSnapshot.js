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
const { getConfig } = require("../services/protocolConfig");

const DEFAULT_STABLE_DECIMALS = 6;

/**
 * [TR] Ham base-unit toplamlarını (token bazında) insan-okunur stable birimine çevirir.
 *      *_num alanları base-unit'tir (1 USDT = 1_000_000); ölçeklenmeden gösterilirse
 *      hacim 10^6 kat şişer. Decimals on-chain token config'ten okunur (fallback 6).
 * [EN] Converts per-token raw base-unit sums into human stable units using on-chain decimals.
 */
function _scaleByTokenDecimals(rows = [], field) {
  let tokenMap = {};
  try {
    tokenMap = getConfig().tokenMap || {};
  } catch (_) {
    tokenMap = {};
  }
  return rows.reduce((acc, row) => {
    const decimals = Number(tokenMap?.[String(row?._id || "").toLowerCase()]?.decimals);
    const safeDecimals = Number.isInteger(decimals) && decimals > 0 && decimals <= 18 ? decimals : DEFAULT_STABLE_DECIMALS;
    return acc + Number(row?.[field] || 0) / 10 ** safeDecimals;
  }, 0);
}

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

/**
 * [TR] Base-unit sayı metinlerini Mongo tarafında Decimal128 olarak toplar (belleğe trade çekilmez).
 *      Geçersiz/boş metinler 0 sayılır (önceki JS toplamasındaki "atla" davranışıyla aynı).
 * [EN] Sums digit-string amounts inside Mongo as Decimal128 ($group) instead of loading every trade.
 */
function _decimalSumExpr(paths) {
  const conv = (path) => ({ $convert: { input: path, to: "decimal", onError: 0, onNull: 0 } });
  return paths.length === 1 ? conv(paths[0]) : { $add: paths.map(conv) };
}

function _decimal128ToIntString(value) {
  if (value === null || value === undefined) return "0";
  const text = String(value);
  if (/^-?\d+$/.test(text)) return text;
  // Bilimsel gösterim (ör. "1.5E+3") — tam sayıya çevir.
  const m = /^(-?)(\d+)(?:\.(\d+))?E([+-]?\d+)$/i.exec(text);
  if (m) {
    const exp = Number(m[4]);
    const frac = m[3] || "";
    const digits = m[2] + frac;
    const shift = exp - frac.length;
    if (shift >= 0) return `${m[1] === "-" ? "-" : ""}${BigInt(digits) * 10n ** BigInt(shift)}`;
    return `${m[1] === "-" ? "-" : ""}${BigInt(digits) / 10n ** BigInt(-shift)}`;
  }
  const dot = text.split(".")[0];
  return /^-?\d+$/.test(dot) ? dot : "0";
}

async function _sumAmountStrings(match, paths) {
  const rows = await Trade.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: _decimalSumExpr(paths) } } },
  ]);
  return _decimal128ToIntString(rows[0]?.total);
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
    totalVolumeStr,
    executedVolumeStr,
    burnedBondsStr,
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
    _sumAmountStrings({ status: "RESOLVED" }, ["$financials.crypto_amount"]),
    _sumAmountStrings({ status: { $in: executedTradeStates } }, ["$financials.crypto_amount"]),
    _sumAmountStrings({ status: "BURNED" }, ["$financials.total_decayed", "$financials.burned_amount"]),
    Trade.countDocuments({}),
    Trade.countDocuments({ status: { $in: activeTradeStates } }),
    Order.countDocuments({ side: "SELL_CRYPTO", status: { $in: fillableOrderStates } }),
    Order.countDocuments({ side: "BUY_CRYPTO", status: { $in: fillableOrderStates } }),
    Order.countDocuments({ status: "PARTIALLY_FILLED" }),
    Order.countDocuments({ status: "FILLED" }),
    Order.countDocuments({ status: "CANCELED" }),
  ]);

  const [resolvedByToken, executedByToken, burnedByToken] = await Promise.all([
    Trade.aggregate([
      { $match: { status: "RESOLVED" } },
      { $group: { _id: "$token_address", volume: { $sum: "$financials.crypto_amount_num" } } },
    ]),
    Trade.aggregate([
      { $match: { status: { $in: executedTradeStates } } },
      { $group: { _id: "$token_address", volume: { $sum: "$financials.crypto_amount_num" } } },
    ]),
    // [TR] Eriyen hazine = tüm trade'lerde bleeding decay + burnExpired ile yakılan toplam.
    // [EN] Burned treasury = bleeding decay across all trades + totals burned by burnExpired.
    Trade.aggregate([
      {
        $group: {
          _id: "$token_address",
          burned: {
            $sum: {
              $add: [
                { $ifNull: ["$financials.total_decayed_num", 0] },
                { $ifNull: ["$financials.burned_amount_num", 0] },
              ],
            },
          },
        },
      },
    ]),
  ]);

  const resolved = resolvedAgg[0] || { totalVolumeApprox: 0, count: 0, totalDurationMs: 0 };

  const avgTradeHours = resolved.count > 0
    ? _toSafeFixedNumber(resolved.totalDurationMs / resolved.count / (1000 * 3600), 2)
    : null;

  return {
    total_volume_usdt: _toSafeFixedNumber(_scaleByTokenDecimals(resolvedByToken, "volume"), 2),
    total_volume_usdt_str: totalVolumeStr,
    executed_volume_usdt: _toSafeFixedNumber(_scaleByTokenDecimals(executedByToken, "volume"), 2),
    executed_volume_usdt_str: executedVolumeStr,
    completed_trades: resolved.count,
    child_trade_count: childTradeCount,
    active_child_trades: activeChildTrades,
    open_sell_orders: openSellOrders,
    open_buy_orders: openBuyOrders,
    partially_filled_orders: partiallyFilledOrders,
    filled_orders: filledOrders,
    canceled_orders: canceledOrders,
    burned_bonds_usdt: _toSafeFixedNumber(_scaleByTokenDecimals(burnedByToken, "burned"), 2),
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
  _decimal128ToIntString,
};
