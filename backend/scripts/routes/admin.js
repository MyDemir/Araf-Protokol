"use strict";

const express = require("express");
const Joi = require("joi");

const { requireAuth, requireSessionWalletMatch } = require("../middleware/auth");
const { adminReadLimiter } = require("../middleware/rateLimiter");
const { getRedisClient } = require("../config/redis");
const { getReadiness } = require("../services/health");
const { getDlqMetrics } = require("../services/dlqProcessor");
const worker = require("../services/eventListener");
const Trade = require("../models/Trade");
const User = require("../models/User");
const Feedback = require("../models/Feedback");
const HistoricalStat = require("../models/HistoricalStat");
const { buildBankProfileRisk, buildTradeHealthSignals } = require("./tradeRisk");

const router = express.Router();

const TERMINAL_TRADE_STATUSES = ["RESOLVED", "CANCELED", "BURNED"];
const DLQ_KEY = "worker:dlq";
const ADMIN_TRADES_STATUS_VALUES = ["ALL", "LOCKED", "PAID", "CHALLENGED", "RESOLVED", "CANCELED", "BURNED"];
const ADMIN_TRADES_ORIGIN_VALUES = ["ALL", "ORDER_CHILD", "DIRECT_ESCROW"];
const ADMIN_TRADES_SNAPSHOT_VALUES = ["ALL", "true", "false"];
const ADMIN_TRADES_MAX_CANDIDATE_SCAN = 1000;

const ADMIN_TRADE_PROJECTION = [
  "_id",
  "onchain_escrow_id",
  "parent_order_id",
  "trade_origin",
  "maker_address",
  "taker_address",
  "token_address",
  "status",
  "tier",
  "created_at",
  "payout_snapshot.maker.rail",
  "payout_snapshot.maker.country",
  "payout_snapshot.maker.profile_version_at_lock",
  "payout_snapshot.maker.bank_change_count_7d_at_lock",
  "payout_snapshot.maker.bank_change_count_30d_at_lock",
  "payout_snapshot.maker.last_bank_change_at_at_lock",
  "payout_snapshot.maker.reputation_context_at_lock.success_rate",
  "payout_snapshot.maker.reputation_context_at_lock.failed_disputes",
  "payout_snapshot.maker.reputation_context_at_lock.effective_tier",
  "payout_snapshot.maker.reputation_context_at_lock.consecutive_bans",
  "payout_snapshot.maker.reputation_context_at_lock.is_banned",
  "payout_snapshot.maker.reputation_context_at_lock.banned_until",
  "payout_snapshot.maker.reputation_context_at_lock.manual_release_count",
  "payout_snapshot.maker.reputation_context_at_lock.burn_count",
  "payout_snapshot.maker.reputation_context_at_lock.auto_release_count",
  "payout_snapshot.maker.reputation_context_at_lock.mutual_cancel_count",
  "payout_snapshot.maker.reputation_context_at_lock.disputed_resolved_count",
  "payout_snapshot.maker.reputation_context_at_lock.disputed_but_resolved_count",
  "payout_snapshot.maker.reputation_context_at_lock.dispute_win_count",
  "payout_snapshot.maker.reputation_context_at_lock.dispute_loss_count",
  "payout_snapshot.maker.reputation_context_at_lock.risk_points",
  "payout_snapshot.taker.rail",
  "payout_snapshot.taker.country",
  "payout_snapshot.taker.profile_version_at_lock",
  "payout_snapshot.taker.bank_change_count_7d_at_lock",
  "payout_snapshot.taker.bank_change_count_30d_at_lock",
  "payout_snapshot.taker.reputation_context_at_lock.success_rate",
  "payout_snapshot.taker.reputation_context_at_lock.failed_disputes",
  "payout_snapshot.taker.reputation_context_at_lock.effective_tier",
  "payout_snapshot.taker.reputation_context_at_lock.consecutive_bans",
  "payout_snapshot.taker.reputation_context_at_lock.is_banned",
  "payout_snapshot.taker.reputation_context_at_lock.banned_until",
  "payout_snapshot.taker.reputation_context_at_lock.manual_release_count",
  "payout_snapshot.taker.reputation_context_at_lock.burn_count",
  "payout_snapshot.taker.reputation_context_at_lock.auto_release_count",
  "payout_snapshot.taker.reputation_context_at_lock.mutual_cancel_count",
  "payout_snapshot.taker.reputation_context_at_lock.disputed_resolved_count",
  "payout_snapshot.taker.reputation_context_at_lock.disputed_but_resolved_count",
  "payout_snapshot.taker.reputation_context_at_lock.dispute_win_count",
  "payout_snapshot.taker.reputation_context_at_lock.dispute_loss_count",
  "payout_snapshot.taker.reputation_context_at_lock.risk_points",
  "payout_snapshot.is_complete",
  "payout_snapshot.incomplete_reason",
  "payout_snapshot.captured_at",
].join(" ");

function requireAdminWallet(req, res, next) {
  const allowed = String(process.env.ADMIN_WALLETS || "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

  if (!req.wallet || allowed.length === 0 || !allowed.includes(req.wallet)) {
    return res.status(403).json({ error: "Admin erişimi reddedildi." });
  }

  return next();
}

async function _attachAdminTradeRisk(trades) {
  if (!Array.isArray(trades) || trades.length === 0) return [];

  const participantAddresses = [
    ...new Set(
      trades
        .flatMap((trade) => [trade?.maker_address, trade?.taker_address])
        .filter(Boolean)
    ),
  ];

  const users = await User.find({ wallet_address: { $in: participantAddresses } })
    .select(
      "wallet_address profileVersion bankChangeCount7d bankChangeCount30d " +
      "payout_profile reputation_cache reputation_breakdown is_banned banned_until consecutive_bans"
    )
    .lean();

  const userMap = new Map(users.map((user) => [user.wallet_address, user]));

  return trades.map((trade) => {
    const makerUser = userMap.get(trade.maker_address) || null;
    const takerUser = userMap.get(trade.taker_address) || null;

    return {
      ...trade,
      bank_profile_risk: buildBankProfileRisk(trade, makerUser),
      offchain_health_score_input: buildTradeHealthSignals(trade, makerUser, takerUser),
    };
  });
}

function _toMillisSafe(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function _sortAdminTradesDeterministic(trades) {
  return [...trades].sort((a, b) => {
    const challengedA = a?.status === "CHALLENGED" ? 0 : 1;
    const challengedB = b?.status === "CHALLENGED" ? 0 : 1;
    if (challengedA !== challengedB) return challengedA - challengedB;

    const incompleteA = a?.payout_snapshot?.is_complete === false ? 0 : 1;
    const incompleteB = b?.payout_snapshot?.is_complete === false ? 0 : 1;
    if (incompleteA !== incompleteB) return incompleteA - incompleteB;

    const highRiskA = a?.bank_profile_risk?.highRiskBankProfile ? 0 : 1;
    const highRiskB = b?.bank_profile_risk?.highRiskBankProfile ? 0 : 1;
    if (highRiskA !== highRiskB) return highRiskA - highRiskB;

    const createdAtDiff = _toMillisSafe(b?.created_at) - _toMillisSafe(a?.created_at);
    if (createdAtDiff !== 0) return createdAtDiff;

    return String(a?.onchain_escrow_id || "").localeCompare(String(b?.onchain_escrow_id || ""));
  });
}

// [TR] Tüm admin yüzeyi read-only gözlem amaçlıdır; auth zinciri zorunludur.
// [EN] Entire admin surface is read-only observability and always gated by auth chain.
router.use(requireAuth, requireSessionWalletMatch, requireAdminWallet);
router.use(adminReadLimiter);

router.get("/summary", async (req, res, next) => {
  try {
    const degraded = {
      isDegraded: false,
      sources: {
        latestStatFallbackUsed: false,
        tradeCountsFallbackUsed: false,
        dlqDepthFallbackUsed: false,
      },
      errors: [],
    };

    let readiness = null;
    try {
      readiness = await getReadiness({ worker, provider: worker.provider });
    } catch (err) {
      degraded.isDegraded = true;
      degraded.errors.push({
        source: "readiness",
        message: err.message,
      });
      readiness = {
        ok: false,
        degraded: true,
        error: "readiness_unavailable",
      };
    }

    let latestStat = null;
    try {
      latestStat = await HistoricalStat.findOne().sort({ date: -1 }).lean();
    } catch (err) {
      degraded.isDegraded = true;
      degraded.sources.latestStatFallbackUsed = true;
      degraded.errors.push({
        source: "latest_stat",
        message: err.message,
      });
      latestStat = null;
    }

    const activeFilter = { status: { $nin: TERMINAL_TRADE_STATUSES } };
    let tradeCounts = [0, 0, 0, 0, 0];
    try {
      tradeCounts = await Promise.all([
        Trade.countDocuments(activeFilter),
        Trade.countDocuments({ status: "LOCKED" }),
        Trade.countDocuments({ status: "PAID" }),
        Trade.countDocuments({ status: "CHALLENGED" }),
        Trade.countDocuments({ "payout_snapshot.is_complete": false }),
      ]);
    } catch (err) {
      degraded.isDegraded = true;
      degraded.sources.tradeCountsFallbackUsed = true;
      degraded.errors.push({
        source: "trade_counts",
        message: err.message,
      });
    }

    let dlqDepth = 0;
    try {
      dlqDepth = await getRedisClient().lLen(DLQ_KEY);
    } catch (err) {
      degraded.isDegraded = true;
      degraded.sources.dlqDepthFallbackUsed = true;
      degraded.errors.push({
        source: "dlq_depth",
        message: err.message,
      });
    }

    const schedulerState = req.app.locals.schedulerState || {};

    return res.json({
      timestamp: new Date().toISOString(),
      readiness,
      stats: {
        date: latestStat?.date || null,
        total_volume_usdt: latestStat?.total_volume_usdt ?? 0,
        total_volume_usdt_str: latestStat?.total_volume_usdt_str || "0",
        executed_volume_usdt: latestStat?.executed_volume_usdt ?? 0,
        executed_volume_usdt_str: latestStat?.executed_volume_usdt_str || "0",
        completed_trades: latestStat?.completed_trades ?? 0,
        child_trade_count: latestStat?.child_trade_count ?? 0,
        active_child_trades: latestStat?.active_child_trades ?? 0,
        // [TR] Frontend admin overview için HistoricalStat alanlarını eksiksiz döndürürüz.
        // [EN] Return complete HistoricalStat fields for frontend admin overview.
        open_sell_orders: latestStat?.open_sell_orders ?? 0,
        open_buy_orders: latestStat?.open_buy_orders ?? 0,
        partially_filled_orders: latestStat?.partially_filled_orders ?? 0,
        filled_orders: latestStat?.filled_orders ?? 0,
        canceled_orders: latestStat?.canceled_orders ?? 0,
        burned_bonds_usdt: latestStat?.burned_bonds_usdt ?? 0,
        burned_bonds_usdt_str: latestStat?.burned_bonds_usdt_str || "0",
        avg_trade_hours: latestStat?.avg_trade_hours ?? null,
      },
      tradeCounts: {
        active: tradeCounts[0],
        locked: tradeCounts[1],
        paid: tradeCounts[2],
        challenged: tradeCounts[3],
        incompleteSnapshot: tradeCounts[4],
      },
      dlq: {
        depth: Number(dlqDepth) || 0,
        ...getDlqMetrics(),
      },
      scheduler: {
        reputationDecayLastRunAt: schedulerState.reputationDecayLastRunAt || null,
        statsSnapshotLastRunAt: schedulerState.statsSnapshotLastRunAt || null,
        sensitiveCleanupLastRunAt: schedulerState.sensitiveCleanupLastRunAt || null,
        userBankRiskCleanupLastRunAt: schedulerState.userBankRiskCleanupLastRunAt || null,
      },
      degraded,
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/feedback", async (req, res, next) => {
  try {
    const schema = Joi.object({
      category: Joi.string().valid("bug", "suggestion", "ui/ux", "other").optional(),
      rating: Joi.number().integer().min(1).max(5).optional(),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(20),
    });

    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    const filter = {};
    if (value.category) filter.category = value.category;
    if (value.rating) filter.rating = value.rating;

    const skip = (value.page - 1) * value.limit;

    const [feedback, total] = await Promise.all([
      Feedback.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(value.limit)
        .lean(),
      Feedback.countDocuments(filter),
    ]);

    return res.json({
      feedback,
      total,
      page: value.page,
      limit: value.limit,
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/trades", async (req, res, next) => {
  try {
    const schema = Joi.object({
      status: Joi.string().valid(...ADMIN_TRADES_STATUS_VALUES).default("CHALLENGED"),
      tier: Joi.number().integer().min(0).max(4).optional(),
      origin: Joi.string().valid(...ADMIN_TRADES_ORIGIN_VALUES).default("ALL"),
      riskOnly: Joi.boolean().truthy("true").falsy("false").default(false),
      snapshotComplete: Joi.string().valid(...ADMIN_TRADES_SNAPSHOT_VALUES).default("ALL"),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(20),
    });

    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    const filter = {};

    if (value.status !== "ALL") filter.status = value.status;
    if (typeof value.tier === "number") filter.tier = value.tier;
    if (value.origin !== "ALL") filter.trade_origin = value.origin;
    if (value.snapshotComplete === "true") filter["payout_snapshot.is_complete"] = true;
    if (value.snapshotComplete === "false") filter["payout_snapshot.is_complete"] = false;

    const skip = (value.page - 1) * value.limit;

    if (!value.riskOnly) {
      const [rows, total] = await Promise.all([
        Trade.find(filter)
          .select(ADMIN_TRADE_PROJECTION)
          .sort({ created_at: -1, _id: -1 })
          .skip(skip)
          .limit(value.limit)
          .lean(),
        Trade.countDocuments(filter),
      ]);

      const enrichedPage = await _attachAdminTradeRisk(rows);

      return res.json({
        trades: enrichedPage,
        total,
        page: value.page,
        limit: value.limit,
        paginationScope: {
          mode: "global_db_order",
          order: "created_at_desc_id_desc",
          totalRepresents: "global_query_total",
          isWindowed: false,
        },
      });
    }

    // [TR] riskOnly modu enrichment tabanlı olduğu için bounded pencereyi açıkça işaretleriz.
    // [EN] riskOnly mode is enrichment-driven; response explicitly signals bounded-window semantics.
    const candidateTrades = await Trade.find(filter)
      .select(ADMIN_TRADE_PROJECTION)
      .sort({ created_at: -1, _id: -1 })
      .limit(ADMIN_TRADES_MAX_CANDIDATE_SCAN)
      .lean();

    const enriched = await _attachAdminTradeRisk(candidateTrades);
    const highRiskOnly = enriched.filter((trade) => trade?.bank_profile_risk?.highRiskBankProfile === true);
    const sorted = _sortAdminTradesDeterministic(highRiskOnly);

    return res.json({
      trades: sorted.slice(skip, skip + value.limit),
      total: sorted.length,
      page: value.page,
      limit: value.limit,
      paginationScope: {
        mode: "risk_only_bounded_window",
        order: "derived_risk_priority",
        isWindowed: true,
        windowSize: ADMIN_TRADES_MAX_CANDIDATE_SCAN,
        totalRepresents: "window_filtered_total",
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
