"use strict";

/**
 * Sensitive Data Cleanup Jobs — V3 Child Trade Privacy Retention
 *
 * V3'te PII snapshot ve dekont payload'ları parent order üzerinde değil,
 * gerçek escrow lifecycle'ını taşıyan child trade üzerinde yaşar.
 * Bu job'lar da doğrudan Trade (child trade mirror) koleksiyonu üzerinde çalışır.
 *
 * Felsefe:
 *   - Backend hassas veriyi kalıcı otorite olarak tutmaz.
 *   - Kullanım amacı biten payload ve snapshot alanları retention süresi dolunca silinir.
 *   - On-chain referanslar (örn. receipt hash) korunur; plaintext / decryptable payload temizlenir.
 */

const Trade = require("../models/Trade");
const logger = require("../utils/logger");

/**
 * Şifreli dekont payload'larını temizler.
 *
 * Temizlik etkisi:
 *   - evidence.receipt_encrypted  -> null
 *   - evidence.receipt_timestamp  -> null
 *   - evidence.receipt_delete_at  -> null
 *
 * Bilinçli olarak korunur:
 *   - evidence.ipfs_receipt_hash
 *
 * Neden hash korunuyor?
 *   Çünkü bu alan on-chain rapor referansı ve denetim izi taşır;
 *   hassas payload değildir.
 */
async function runReceiptCleanup(now = new Date()) {
  try {
    const result = await Trade.updateMany(
      {
        "evidence.receipt_delete_at": { $lte: now },
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
    return result.modifiedCount;
  } catch (err) {
    logger.error(`[Job:ReceiptCleanup] Temizlik başarısız: ${err.message}`);
    return 0;
  }
}

/**
 * LOCKED anında alınan PII snapshot alanlarını temizler.
 *
 * Temizlik etkisi:
 *   - maker/taker şifreli snapshot alanları -> null
 *   - captured_at                         -> null
 *   - snapshot_delete_at                  -> null
 *
 * Böylece child trade analitiği ve state mirror'ı korunurken,
 * decryptable PII kalıcı depoda gereksiz yere yaşamaz.
 */
async function runPIISnapshotCleanup(now = new Date()) {
  try {
    const result = await Trade.updateMany(
      {
        "pii_snapshot.snapshot_delete_at": { $lte: now },
        $or: [
          { "pii_snapshot.maker_bankOwner_enc": { $ne: null } },
          { "pii_snapshot.maker_iban_enc": { $ne: null } },
          { "pii_snapshot.taker_bankOwner_enc": { $ne: null } },
          { "pii_snapshot.captured_at": { $ne: null } },
        ],
      },
      {
        $set: {
          "pii_snapshot.maker_bankOwner_enc": null,
          "pii_snapshot.maker_iban_enc": null,
          "pii_snapshot.taker_bankOwner_enc": null,
          "pii_snapshot.captured_at": null,
          "pii_snapshot.snapshot_delete_at": null,
        },
      }
    );

    if (result.modifiedCount > 0) {
      logger.info(
        `[Job:PIISnapshotCleanup] ${result.modifiedCount} child trade kaydında snapshot PII temizlendi.`
      );
    }
    return result.modifiedCount;
  } catch (err) {
    logger.error(`[Job:PIISnapshotCleanup] Temizlik başarısız: ${err.message}`);
    return 0;
  }
}

module.exports = {
  runReceiptCleanup,
  runPIISnapshotCleanup,
};
