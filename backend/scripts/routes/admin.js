"use strict";

const express = require("express");
const Joi = require("joi");

const { requireAuth, requireSessionWalletMatch } = require("../middleware/auth");
const { getRedisClient } = require("../config/redis");
const { getReadiness } = require("../services/health");
const { getDlqMetrics } = require("../services/dlqProcessor");
const worker = require("../services/eventListener");
const Trade = require("../models/Trade");
const Feedback = require("../models/Feedback");
const HistoricalStat = require("../models/HistoricalStat");

const router = express.Router();

const TERMINAL_TRADE_STATUSES = ["RESOLVED", "CANCELED", "BURNED"];
const DLQ_KEY = "worker:dlq";

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

// [TR] Tüm admin yüzeyi read-only gözlem amaçlıdır; auth zinciri zorunludur.
// [EN] Entire admin surface is read-only observability and always gated by auth chain.
router.use(requireAuth, requireSessionWalletMatch, requireAdminWallet);

router.get("/summary", async (req, res, next) => {
  try {
    const readinessPromise = getReadiness({ worker, provider: worker.provider });
    const latestStatPromise = HistoricalStat.findOne()
      .sort({ date: -1 })
      .lean();

    const activeFilter = { status: { $nin: TERMINAL_TRADE_STATUSES } };

    const tradeCountsPromise = Promise.all([
      Trade.countDocuments(activeFilter),
      Trade.countDocuments({ status: "LOCKED" }),
      Trade.countDocuments({ status: "PAID" }),
      Trade.countDocuments({ status: "CHALLENGED" }),
      Trade.countDocuments({ "payout_snapshot.is_complete": false }),
    ]);

    const dlqDepthPromise = getRedisClient().lLen(DLQ_KEY);

    const [readiness, latestStat, tradeCounts, dlqDepth] = await Promise.all([
      readinessPromise,
      latestStatPromise,
      tradeCountsPromise,
      dlqDepthPromise,
    ]);

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

module.exports = router;
