"use strict";

const express = require("express");
const RewardEpoch = require("../models/RewardEpoch");
const RewardClaim = require("../models/RewardClaim");
const RewardFunding = require("../models/RewardFunding");
const RevenueEvent = require("../models/RevenueEvent");

const router = express.Router();

router.get("/epochs/current", async (_req, res, next) => {
  try {
    const nowEpoch = Math.floor(Date.now() / 1000 / (7 * 24 * 3600));
    const rows = await RewardEpoch.find({ epoch: String(nowEpoch) }).lean();
    return res.json({ epoch: String(nowEpoch), rows });
  } catch (err) { return next(err); }
});

router.get("/epochs/:epoch", async (req, res, next) => {
  try {
    const rows = await RewardEpoch.find({ epoch: String(req.params.epoch) }).lean();
    return res.json({ epoch: String(req.params.epoch), rows });
  } catch (err) { return next(err); }
});

router.get("/:wallet/claimable", async (req, res) => {
  return res.json({
    wallet: String(req.params.wallet || "").toLowerCase(),
    claimable: [],
    source: "ESTIMATE_UNAVAILABLE_USE_ONCHAIN_GETTER",
  });
});

router.get("/:wallet/history", async (req, res, next) => {
  try {
    const wallet = String(req.params.wallet || "").toLowerCase();
    const claims = await RewardClaim.find({ user: wallet }).sort({ block_number: -1, log_index: -1 }).limit(200).lean();
    return res.json({ wallet, claims });
  } catch (err) { return next(err); }
});

router.get("/funding/global", async (_req, res, next) => {
  try {
    const rows = await RewardFunding.find({ type: "GLOBAL" }).sort({ block_number: -1, log_index: -1 }).limit(200).lean();
    return res.json({ rows });
  } catch (err) { return next(err); }
});

router.get("/funding/product/:productId", async (req, res, next) => {
  try {
    const rows = await RewardFunding.find({ type: "PRODUCT", product_id: String(req.params.productId) })
      .sort({ block_number: -1, log_index: -1 })
      .limit(200)
      .lean();
    return res.json({ productId: String(req.params.productId), rows });
  } catch (err) { return next(err); }
});

router.get("/admin/revenue", async (_req, res, next) => {
  try {
    const rows = await RevenueEvent.find().sort({ block_number: -1, log_index: -1 }).limit(200).lean();
    return res.json({ rows });
  } catch (err) { return next(err); }
});

router.get("/admin/rewards/health", async (_req, res, next) => {
  try {
    const [epochs, claims, funding] = await Promise.all([
      RewardEpoch.countDocuments(),
      RewardClaim.countDocuments(),
      RewardFunding.countDocuments(),
    ]);
    return res.json({ mirror_only: true, counts: { epochs, claims, funding } });
  } catch (err) { return next(err); }
});

module.exports = router;
