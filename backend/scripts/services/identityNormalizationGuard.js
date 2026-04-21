"use strict";

const Order = require("../models/Order");
const Trade = require("../models/Trade");
const logger = require("../utils/logger");

const NUMERIC_BSON_TYPES = ["int", "long", "double", "decimal"];
const VALID_GUARD_MODES = ["off", "warn", "enforce"];

function normalizeGuardMode(mode) {
  const requestedMode = String(mode || "off").trim().toLowerCase();
  if (!VALID_GUARD_MODES.includes(requestedMode)) {
    // [TR] Mode typo'larında warn'a sessiz düşmek production fail-safe'i zayıflatır.
    // [EN] Never silently downgrade invalid mode to warn; fail-safe by rejecting config.
    throw new Error(`IDENTITY_GUARD_INVALID_MODE:${requestedMode}`);
  }
  return requestedMode;
}

async function verifyIdentityNormalization({ mode = "off" } = {}) {
  const normalizedMode = normalizeGuardMode(mode);
  if (normalizedMode === "off") return { mode: normalizedMode, checked: false };

  const [ordersNumeric, tradesEscrowNumeric, tradesParentNumeric] = await Promise.all([
    Order.countDocuments({ onchain_order_id: { $type: NUMERIC_BSON_TYPES } }),
    Trade.countDocuments({ onchain_escrow_id: { $type: NUMERIC_BSON_TYPES } }),
    Trade.countDocuments({ parent_order_id: { $type: NUMERIC_BSON_TYPES } }),
  ]);

  const total = ordersNumeric + tradesEscrowNumeric + tradesParentNumeric;
  const summary = { ordersNumeric, tradesEscrowNumeric, tradesParentNumeric, total };

  if (total === 0) {
    logger.info(`[IdentityGuard] OK: mixed numeric identity yok. mode=${normalizedMode}`);
    return { mode: normalizedMode, checked: true, ok: true, ...summary };
  }

  const msg = `[IdentityGuard] Mixed legacy numeric identity bulundu: ${JSON.stringify(summary)}.`;
  if (normalizedMode === "enforce") {
    throw new Error(`${msg} scripts/migrations/normalizeIdentityFields.js çalıştırılmalı.`);
  }

  logger.warn(`${msg} Migration önerisi: npm run migrate:identity`);
  return { mode: normalizedMode, checked: true, ok: false, ...summary };
}

module.exports = {
  verifyIdentityNormalization,
  NUMERIC_BSON_TYPES,
  VALID_GUARD_MODES,
  normalizeGuardMode,
};
