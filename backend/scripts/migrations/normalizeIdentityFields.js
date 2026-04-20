"use strict";

/**
 * Normalize identity fields to canonical string format.
 *
 * Target fields:
 *  - Order.onchain_order_id
 *  - Trade.onchain_escrow_id
 *  - Trade.parent_order_id
 *
 * Usage:
 *   node scripts/migrations/normalizeIdentityFields.js --dry-run
 *   node scripts/migrations/normalizeIdentityFields.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Trade = require("../models/Trade");

const NUMERIC_BSON_TYPES = ["int", "long", "double", "decimal"];

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

function normalizeIdentityValue(raw, { allowZero = false, toNullOnZero = false } = {}) {
  if (raw === null || raw === undefined || raw === "") return null;

  const asString = String(raw).trim();
  if (!asString.length) return null;

  if (!/^[-+]?\d+(?:\.\d+)?$/.test(asString)) {
    throw new Error(`IDENTITY_NOT_NUMERIC:${asString}`);
  }

  const asNumber = Number(asString);
  if (!Number.isFinite(asNumber) || !Number.isInteger(asNumber)) {
    throw new Error(`IDENTITY_NOT_INTEGER:${asString}`);
  }

  const asBigInt = BigInt(asString);
  if (asBigInt < 0n) throw new Error(`IDENTITY_NEGATIVE:${asString}`);
  if (!allowZero && asBigInt === 0n) throw new Error(`IDENTITY_ZERO_NOT_ALLOWED:${asString}`);
  if (toNullOnZero && asBigInt === 0n) return null;

  return asBigInt.toString();
}

function buildBulkOps(docs, field, opts = {}) {
  const ops = [];
  let changed = 0;

  for (const doc of docs) {
    const normalized = normalizeIdentityValue(doc[field], opts);
    if (normalized === doc[field]) continue;

    changed += 1;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { [field]: normalized } },
      },
    });
  }

  return { ops, changed };
}

async function detectLogicalCollisions(Model, field, { allowNull = false } = {}) {
  const match = {
    [field]: {
      $exists: true,
      ...(allowNull ? {} : { $ne: null }),
      $type: ["string", ...NUMERIC_BSON_TYPES],
    },
  };

  const collisions = await Model.aggregate([
    { $match: match },
    { $project: { normalized: { $toString: `$${field}` } } },
    { $group: { _id: "$normalized", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 25 },
  ]);

  return collisions;
}

async function run({ dryRun = false } = {}) {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGODB_URI/MONGO_URI tanımlı değil.");

  await mongoose.connect(mongoUri);

  try {
    // [TR] Collision preflight: aynı mantıksal ID'nin birden çok dokümana düşmesi
    //      migration sonrası unique conflict üretebilir; fail-safe olarak duruyoruz.
    const [orderCollisions, tradeCollisions] = await Promise.all([
      detectLogicalCollisions(Order, "onchain_order_id"),
      detectLogicalCollisions(Trade, "onchain_escrow_id"),
    ]);

    if (orderCollisions.length || tradeCollisions.length) {
      throw new Error(
        `IDENTITY_COLLISION_DETECTED:${JSON.stringify({ orderCollisions, tradeCollisions })}`
      );
    }

    const [orderDocs, tradeEscrowDocs, tradeParentDocs] = await Promise.all([
      Order.find({ onchain_order_id: { $type: NUMERIC_BSON_TYPES } }).select("_id onchain_order_id").lean(),
      Trade.find({ onchain_escrow_id: { $type: NUMERIC_BSON_TYPES } }).select("_id onchain_escrow_id").lean(),
      Trade.find({ parent_order_id: { $type: NUMERIC_BSON_TYPES } }).select("_id parent_order_id").lean(),
    ]);

    const orderPlan = buildBulkOps(orderDocs, "onchain_order_id", { allowZero: false });
    const escrowPlan = buildBulkOps(tradeEscrowDocs, "onchain_escrow_id", { allowZero: false });
    const parentPlan = buildBulkOps(tradeParentDocs, "parent_order_id", {
      allowZero: true,
      toNullOnZero: true,
    });

    const report = {
      dryRun,
      ordersNumericFound: orderDocs.length,
      ordersWillUpdate: orderPlan.changed,
      tradesEscrowNumericFound: tradeEscrowDocs.length,
      tradesEscrowWillUpdate: escrowPlan.changed,
      tradesParentNumericFound: tradeParentDocs.length,
      tradesParentWillUpdate: parentPlan.changed,
    };

    if (!dryRun) {
      if (orderPlan.ops.length) await Order.bulkWrite(orderPlan.ops, { ordered: true });
      if (escrowPlan.ops.length) await Trade.bulkWrite(escrowPlan.ops, { ordered: true });
      if (parentPlan.ops.length) await Trade.bulkWrite(parentPlan.ops, { ordered: true });
    }

    return report;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  const args = parseArgs();
  run(args)
    .then((report) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err.message || err);
      process.exit(1);
    });
}

module.exports = {
  NUMERIC_BSON_TYPES,
  parseArgs,
  normalizeIdentityValue,
  buildBulkOps,
  detectLogicalCollisions,
  run,
};
