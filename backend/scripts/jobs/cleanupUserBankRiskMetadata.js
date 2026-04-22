"use strict";

/**
 * User Bank Risk Metadata Cleanup Job
 *
 * Amaç:
 *   - User belgesindeki bank_change_history alanının kontrolsüz büyümesini önlemek
 *   - Sadece son 30 güne ait değişim olaylarını tutmak
 *   - bankChangeCount7d / bankChangeCount30d / lastBankChangeAt alanlarını
 *     periyodik olarak normalize etmek
 *
 * Önemli tasarım notu:
 *   - profileVersion lifetime counter'dır; GERİYE SARILMAZ.
 *   - Bu job profileVersion'ı değiştirmez.
 *   - Bu job yalnız rolling pencere metadata'sını ve history dizisini budar.
 *
 * Bu neden gerekir?
 *   Auth/profile update route'u değişim anında sayaçları günceller.
 *   Ancak zaman geçtikçe eski kayıtlar 7g / 30g penceresinden çıkmalıdır.
 *   Bunu garanti etmek için periyodik prune gerekir.
 */

const User = require("../models/User");
const logger = require("../utils/logger");
const CLEANUP_CURSOR_BATCH_SIZE = Number(process.env.USER_BANK_RISK_CLEANUP_CURSOR_BATCH_SIZE || 200);

/**
 * Hangi kullanıcıları tarıyoruz?
 *
 * Yalnız aktif risk metadata taşıyan kullanıcıları.
 * Böylece tüm koleksiyonu sürekli taramayız.
 */
function buildCandidateQuery() {
  return {
    $or: [
      { bank_change_history: { $exists: true, $ne: [] } },
      { bankChangeCount7d: { $gt: 0 } },
      { bankChangeCount30d: { $gt: 0 } },
      { lastBankChangeAt: { $ne: null } },
    ],
  };
}

/**
 * Bu job:
 *   - 30 günden eski bank_change_history kayıtlarını budar
 *   - rolling sayaçları yeniden üretir
 *   - yalnız gerçekten değişen belgeleri kaydeder
 */
async function runUserBankRiskMetadataCleanup(now = new Date()) {
  let scanned = 0;
  let updated = 0;

  try {
    const cursor = User.find(buildCandidateQuery())
      .select(
        "profileVersion lastBankChangeAt bankChangeCount7d bankChangeCount30d bank_change_history"
      )
      .batchSize(Number.isFinite(CLEANUP_CURSOR_BATCH_SIZE) && CLEANUP_CURSOR_BATCH_SIZE > 0 ? CLEANUP_CURSOR_BATCH_SIZE : 200)
      .cursor();

    for await (const user of cursor) {
      scanned += 1;

      try {
        const beforeHistoryLength = Array.isArray(user.bank_change_history)
          ? user.bank_change_history.length
          : 0;
        const beforeLastBankChangeAt = user.lastBankChangeAt?.getTime?.() || null;
        const beforeCount7d = user.bankChangeCount7d || 0;
        const beforeCount30d = user.bankChangeCount30d || 0;

        user.recomputeBankChangeCounters(now);

        const afterHistoryLength = Array.isArray(user.bank_change_history)
          ? user.bank_change_history.length
          : 0;
        const afterLastBankChangeAt = user.lastBankChangeAt?.getTime?.() || null;
        const afterCount7d = user.bankChangeCount7d || 0;
        const afterCount30d = user.bankChangeCount30d || 0;

        const changed =
          beforeHistoryLength !== afterHistoryLength ||
          beforeLastBankChangeAt !== afterLastBankChangeAt ||
          beforeCount7d !== afterCount7d ||
          beforeCount30d !== afterCount30d;

        if (!changed) {
          continue;
        }

        await user.save();
        updated += 1;
      } catch (perUserErr) {
        logger.warn(
          `[Job:UserBankRiskCleanup] Kullanıcı atlandı: wallet=${user.wallet_address || "unknown"} err=${perUserErr.message}`
        );
      }
    }

    if (updated > 0) {
      logger.info(
        `[Job:UserBankRiskCleanup] ${updated} kullanıcı belgesinde bank risk metadata prune edildi (scanned=${scanned}).`
      );
    }

    return { success: true, scanned, updated };
  } catch (err) {
    logger.error(`[Job:UserBankRiskCleanup] Temizlik başarısız: ${err.message}`);
    return { success: false, scanned, updated, error: err.message };
  }
}

module.exports = {
  runUserBankRiskMetadataCleanup,
};
