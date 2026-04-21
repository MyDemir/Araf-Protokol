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
const DEFAULT_BATCH_SIZE = 1000;

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

  let normalizedIntegerString = asString;
  if (asString.includes(".")) {
    const [integerPart, fractionalPart = ""] = asString.split(".");
    if (!/^\d+$/.test(fractionalPart)) {
      throw new Error(`IDENTITY_NOT_INTEGER:${asString}`);
    }
    if (!/^0+$/.test(fractionalPart)) {
      throw new Error(`IDENTITY_NOT_INTEGER:${asString}`);
    }
    normalizedIntegerString = integerPart;
  }

  const asBigInt = BigInt(normalizedIntegerString);
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

function resolveBatchSize(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return parsed;
}

async function forEachDocChunk(query, { batchSize = DEFAULT_BATCH_SIZE, onChunk }) {
  const cursor = query.cursor({ batchSize });
  let chunk = [];

  for await (const doc of cursor) {
    chunk.push(doc);
    if (chunk.length >= batchSize) {
      // [TR] Her adımda bounded chunk işlenir; tüm collection belleğe alınmaz.
      // [EN] Process bounded chunks to avoid full-collection materialization.
      await onChunk(chunk);
      chunk = [];
    }
  }

  if (chunk.length) {
    await onChunk(chunk);
  }
}

async function detectLogicalCollisions(Model, field, { allowNull = false, batchSize = DEFAULT_BATCH_SIZE } = {}) {
  const query = Model.find({
    [field]: {
      $exists: true,
      ...(allowNull ? {} : { $ne: null }),
      $type: ["string", ...NUMERIC_BSON_TYPES],
    },
  }).select(`_id ${field}`).lean();

  const counts = new Map();

  await forEachDocChunk(query, {
    batchSize,
    onChunk: async (docs) => {
      for (const doc of docs) {
        let normalized;
        try {
          normalized = normalizeIdentityValue(doc[field], { allowZero: true, toNullOnZero: false });
        } catch (err) {
          throw new Error(`IDENTITY_COLLISION_PREFLIGHT_INVALID:${field}:${doc._id}:${err.message}`);
        }
        if (normalized == null) continue;
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
      }
    }
  });

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .slice(0, 25)
    .map(([key, count]) => ({ _id: key, count }));
}

async function migrateFieldInBatches(Model, {
  field,
  findFilter,
  normalizeOptions,
  dryRun,
  batchSize,
}) {
  const query = Model.find(findFilter).select(`_id ${field}`).lean();

  let numericFound = 0;
  let willUpdate = 0;

  await forEachDocChunk(query, {
    batchSize,
    onChunk: async (docs) => {
      numericFound += docs.length;
      const plan = buildBulkOps(docs, field, normalizeOptions);
      willUpdate += plan.changed;
      if (!dryRun && plan.ops.length) {
        await Model.bulkWrite(plan.ops, { ordered: true });
      }
    },
  });

  return { numericFound, willUpdate };
}

async function run({ dryRun = false } = {}) {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGODB_URI/MONGO_URI tanımlı değil.");

  await mongoose.connect(mongoUri);
  const batchSize = resolveBatchSize(process.env.IDENTITY_MIGRATION_BATCH_SIZE);

  try {
    // [TR] Collision preflight: aynı mantıksal ID'nin birden çok dokümana düşmesi
    //      migration sonrası unique conflict üretebilir; fail-safe olarak duruyoruz.
    const [orderCollisions, tradeCollisions] = await Promise.all([
      detectLogicalCollisions(Order, "onchain_order_id", { batchSize }),
      detectLogicalCollisions(Trade, "onchain_escrow_id", { batchSize }),
    ]);

    if (orderCollisions.length || tradeCollisions.length) {
      throw new Error(
        `IDENTITY_COLLISION_DETECTED:${JSON.stringify({ orderCollisions, tradeCollisions })}`
      );
    }

    const [orderResult, escrowResult, parentResult] = await Promise.all([
      migrateFieldInBatches(Order, {
        field: "onchain_order_id",
        findFilter: { onchain_order_id: { $type: NUMERIC_BSON_TYPES } },
        normalizeOptions: { allowZero: false },
        dryRun,
        batchSize,
      }),
      migrateFieldInBatches(Trade, {
        field: "onchain_escrow_id",
        findFilter: { onchain_escrow_id: { $type: NUMERIC_BSON_TYPES } },
        normalizeOptions: { allowZero: false },
        dryRun,
        batchSize,
      }),
      migrateFieldInBatches(Trade, {
        field: "parent_order_id",
        findFilter: { parent_order_id: { $type: NUMERIC_BSON_TYPES } },
        normalizeOptions: {
          allowZero: true,
          toNullOnZero: true,
        },
        dryRun,
        batchSize,
      }),
    ]);

    const report = {
      dryRun,
      batchSize,
      ordersNumericFound: orderResult.numericFound,
      ordersWillUpdate: orderResult.willUpdate,
      tradesEscrowNumericFound: escrowResult.numericFound,
      tradesEscrowWillUpdate: escrowResult.willUpdate,
      tradesParentNumericFound: parentResult.numericFound,
      tradesParentWillUpdate: parentResult.willUpdate,
    };

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
  resolveBatchSize,
  forEachDocChunk,
  detectLogicalCollisions,
  migrateFieldInBatches,
  run,
};
