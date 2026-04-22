"use strict";

/**
 * Sensitive Data Cleanup Jobs — V3 Child Trade Privacy Retention
 *
 * Generic payout snapshot ve dekont payload'ları retention süresi dolunca temizlenir.
 * On-chain referanslar korunur; decryptable içerik kaldırılır.
 */

const Trade = require("../models/Trade");
const logger = require("../utils/logger");
const TERMINAL_STATES = ["RESOLVED", "CANCELED", "BURNED"];

async function runReceiptCleanup(now = new Date()) {
  try {
    const result = await Trade.updateMany(
      {
        "evidence.receipt_delete_at": { $lte: now },
        status: { $in: TERMINAL_STATES },
        $or: [
          { "evidence.receipt_encrypted": { $ne: null } },
          { "evidence.receipt_timestamp": { $ne: null } },
        ],
      },
      {
        $set: {
          "evidence.receipt_encrypted": null,
          "evidence.receipt_timestamp": null,
          "evidence.receipt_delete_at": null,
        },
      }
    );

    if (result.modifiedCount > 0) {
      logger.info(
        `[Job:ReceiptCleanup] ${result.modifiedCount} child trade kaydında dekont payload temizlendi.`
      );
    }

    return { success: true, modifiedCount: result.modifiedCount };
  } catch (err) {
    logger.error(`[Job:ReceiptCleanup] Temizlik başarısız: ${err.message}`);
    return { success: false, modifiedCount: 0, error: err.message };
  }
}

async function runPIISnapshotCleanup(now = new Date()) {
  try {
    const result = await Trade.updateMany(
      {
        "payout_snapshot.snapshot_delete_at": { $lte: now },
        status: { $in: TERMINAL_STATES },
        $or: [
          { "payout_snapshot.maker.payout_details_enc": { $ne: null } },
          { "payout_snapshot.taker.payout_details_enc": { $ne: null } },
          { "payout_snapshot.captured_at": { $ne: null } },
        ],
      },
      {
        $set: {
          "payout_snapshot.maker.rail": null,
          "payout_snapshot.maker.country": null,
          "payout_snapshot.maker.contact_channel": null,
          "payout_snapshot.maker.contact_value_enc": null,
          "payout_snapshot.maker.payout_details_enc": null,
          "payout_snapshot.maker.fingerprint_hash_at_lock": null,
          "payout_snapshot.maker.profile_version_at_lock": 0,
          "payout_snapshot.maker.bank_change_count_7d_at_lock": null,
          "payout_snapshot.maker.bank_change_count_30d_at_lock": null,
          "payout_snapshot.maker.last_bank_change_at_at_lock": null,
          "payout_snapshot.maker.reputation_context_at_lock.success_rate": null,
          "payout_snapshot.maker.reputation_context_at_lock.failed_disputes": null,
          "payout_snapshot.maker.reputation_context_at_lock.effective_tier": null,
          "payout_snapshot.maker.reputation_context_at_lock.consecutive_bans": null,
          "payout_snapshot.maker.reputation_context_at_lock.is_banned": null,
          "payout_snapshot.maker.reputation_context_at_lock.banned_until": null,

          "payout_snapshot.taker.rail": null,
          "payout_snapshot.taker.country": null,
          "payout_snapshot.taker.contact_channel": null,
          "payout_snapshot.taker.contact_value_enc": null,
          "payout_snapshot.taker.payout_details_enc": null,
          "payout_snapshot.taker.fingerprint_hash_at_lock": null,
          "payout_snapshot.taker.profile_version_at_lock": 0,
          "payout_snapshot.taker.bank_change_count_7d_at_lock": null,
          "payout_snapshot.taker.bank_change_count_30d_at_lock": null,
          "payout_snapshot.taker.last_bank_change_at_at_lock": null,
          "payout_snapshot.taker.reputation_context_at_lock.success_rate": null,
          "payout_snapshot.taker.reputation_context_at_lock.failed_disputes": null,
          "payout_snapshot.taker.reputation_context_at_lock.effective_tier": null,
          "payout_snapshot.taker.reputation_context_at_lock.consecutive_bans": null,
          "payout_snapshot.taker.reputation_context_at_lock.is_banned": null,
          "payout_snapshot.taker.reputation_context_at_lock.banned_until": null,
          "payout_snapshot.captured_at": null,
          "payout_snapshot.snapshot_delete_at": null,
          "payout_snapshot.is_complete": true,
          "payout_snapshot.incomplete_reason": null,
        },
      }
    );

    if (result.modifiedCount > 0) {
      logger.info(
        `[Job:PIISnapshotCleanup] ${result.modifiedCount} child trade kaydında payout snapshot temizlendi.`
      );
    }

    return { success: true, modifiedCount: result.modifiedCount };
  } catch (err) {
    logger.error(`[Job:PIISnapshotCleanup] Temizlik başarısız: ${err.message}`);
    return { success: false, modifiedCount: 0, error: err.message };
  }
}

module.exports = {
  runReceiptCleanup,
  runPIISnapshotCleanup,
};
