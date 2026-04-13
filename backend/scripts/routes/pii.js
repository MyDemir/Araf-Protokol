"use strict";

/**
 * PII Route — Child Trade Scoped PII Access
 *
 * V3'te PII erişimi parent order seviyesinde değil, gerçek child trade lifecycle'ı üstünde verilir.
 * Yani IBAN ve isim görünürlüğü, child trade'in aktif bir ödeme/uyuşmazlık penceresinde olmasına bağlıdır.
 *
 * Bu dosyada özellikle korunmak istenen güvenlik sınırı:
 *   - requireAuth            → geçerli cookie session var mı?
 *   - requireSessionWalletMatch → UI'daki aktif bağlı cüzdan gerçekten bu session'a mı ait?
 *   - requirePIIToken        → trade-scoped kısa ömürlü PII erişim bileti var mı?
 *
 * Böylece backend, kontratın yerine geçmeden yalnız dar kapsamlı bir PII erişim kapısı sağlar.
 */

const express = require("express");
const router = express.Router();

const { requireAuth, requirePIIToken, requireSessionWalletMatch } = require("../middleware/auth");
const { piiLimiter } = require("../middleware/rateLimiter");
const Trade = require("../models/Trade");
const User = require("../models/User");
const { decryptField, decryptPayoutProfile } = require("../services/encryption");
const { issuePIIToken } = require("../services/siwe");
const logger = require("../utils/logger");

// [TR] PII erişimine yalnız aktif child trade durumlarında izin verilir.
// [EN] PII is available only while the child trade is actively in-flight.
const ALLOWED_TRADE_STATES = ["LOCKED", "PAID", "CHALLENGED"];

// [TR] Snapshot zorunluluğu: V3 güvenlik sınırında current profile fallback kapalıdır.
//      Trade sırasında görülen PII, lock-anındaki snapshot ile sınırlı kalmalıdır.
// [EN] Snapshot is mandatory in V3. Current profile fallback is disabled to prevent post-lock drift.
function respondSnapshotUnavailable(res, message = "PII snapshot bu trade için hazır değil.") {
  return res.status(409).json({
    error: message,
    code: "SNAPSHOT_UNAVAILABLE",
  });
}

// [TR] Snapshot var mı ve ilgili maker alanları okunabilir mi kontrol eder.
//      Telegram burada trade-scoped optional kabul edilir; varsa snapshot'tan döner,
//      yoksa current profile fallback yapılmaz ve null kalır.
// [EN] Telegram is treated as optional trade-scoped snapshot data. No current-profile fallback.
function hasMakerPIISnapshot(trade) {
  return Boolean(trade?.payout_snapshot?.maker?.payout_details_enc);
}

// [TR] Taker-name route'u yalnız snapshot üstünden çalışır.
// [EN] Taker-name route is snapshot-only to keep child-trade visibility stable.
function hasTakerNameSnapshot(trade) {
  return Boolean(trade?.payout_snapshot?.taker?.payout_details_enc);
}

function hasCompletePayoutSnapshot(trade) {
  return trade?.payout_snapshot?.is_complete === true;
}

// ─── GET /api/pii/my ─────────────────────────────────────────────────────────
// [TR] Kullanıcının kendi kayıtlı PII profilini döndürür.
//      V3'te economic authority üretmez; yalnız şifreli profil bilgisini çözer.
router.get("/my", requireAuth, requireSessionWalletMatch, piiLimiter, async (req, res, next) => {
  try {
    const user = await User.findOne({ wallet_address: req.wallet })
      .select("payout_profile")
      .lean();

    if (!user || !user.payout_profile) {
      return res.json({ pii: null });
    }

    const decrypted = await decryptPayoutProfile(user.payout_profile, req.wallet);

    // [TR] Tüm wallet adresini log'a yazmıyoruz; yalnız kısaltılmış iz bırakıyoruz.
    logger.info(`[PII] /my accessed: wallet=${req.wallet.slice(0, 10)}...`);

    // [TR] Ara katman cache'leri hassas yanıtı saklamasın.
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("Pragma", "no-cache");

    return res.json({ pii: decrypted });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/pii/taker-name/:onchainId ──────────────────────────────────────
// [TR] Maker, aktif child trade'inde karşı tarafın banka sahibi adını görebilir.
//      Parent order değil, gerçek escrow/trade kimliği kullanılır.
router.get("/taker-name/:onchainId", requireAuth, requireSessionWalletMatch, piiLimiter, async (req, res, next) => {
  try {
    const onchainId = Number(req.params.onchainId);
    if (!Number.isInteger(onchainId) || onchainId <= 0) {
      return res.status(400).json({ error: "Geçersiz on-chain ID formatı." });
    }

    const trade = await Trade.findOne({ onchain_escrow_id: onchainId })
      .select("maker_address taker_address status payout_snapshot")
      .lean();

    if (!trade) {
      return res.status(404).json({ error: "Trade bulunamadı." });
    }

    if (trade.maker_address !== req.wallet) {
      logger.warn(`[PII] Yetkisiz taker-name erişimi: caller=${req.wallet.slice(0, 10)}...`);
      return res.status(403).json({ error: "Yalnızca maker alıcının ismini görebilir." });
    }

    if (!ALLOWED_TRADE_STATES.includes(trade.status)) {
      return res.status(400).json({
        error: `Taker bilgisi ${trade.status} durumunda alınamaz. Erişim yalnız aktif child trade'lerde geçerlidir.`,
      });
    }

    if (!trade.taker_address) {
      return res.json({ bankOwner: null });
    }

    // [TR] V3 güvenlik sınırında current profile fallback kapalıdır.
    //      Snapshot yoksa erişim kontrollü şekilde reddedilir.
    // [EN] Current profile fallback is disabled in V3. Missing snapshot returns a controlled error.
    if (!hasTakerNameSnapshot(trade)) {
      logger.warn(`[PII] taker-name snapshot unavailable: onchain=#${onchainId}`);
      return respondSnapshotUnavailable(
        res,
        "Karşı taraf isim snapshot'ı bu trade için hazır değil."
      );
    }

    if (!hasCompletePayoutSnapshot(trade)) {
      logger.warn(`[PII] taker-name snapshot incomplete: onchain=#${onchainId}`);
      return respondSnapshotUnavailable(
        res,
        `Karşı taraf payout snapshot'ı incomplete (${trade?.payout_snapshot?.incomplete_reason || "unknown"}).`
      );
    }

    const takerDetailsRaw = await decryptField(
      trade.payout_snapshot.taker.payout_details_enc,
      trade.taker_address
    );
    const takerDetails = JSON.parse(takerDetailsRaw);
    const bankOwner = takerDetails.account_holder_name || null;

    logger.info(`[PII] taker-name accessed: onchain=#${onchainId}`);

    // [TR] Ara katman cache'leri hassas yanıtı saklamasın.
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("Pragma", "no-cache");

    return res.json({ bankOwner });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/pii/request-token/:tradeId ────────────────────────────────────
// [TR] Taker, aktif child trade için kısa ömürlü trade-scoped PII token talep eder.
//      Bu token parent order'a değil, tek bir trade belgesine bağlıdır.
router.post("/request-token/:tradeId", requireAuth, requireSessionWalletMatch, piiLimiter, async (req, res, next) => {
  try {
    const { tradeId } = req.params;
    const callerWallet = req.wallet;

    if (!/^[a-fA-F0-9]{24}$/.test(tradeId)) {
      return res.status(400).json({ error: "Geçersiz tradeId formatı." });
    }

    const trade = await Trade.findById(tradeId).lean();
    if (!trade) {
      return res.status(404).json({ error: "Trade bulunamadı." });
    }

    if (trade.taker_address !== callerWallet) {
      logger.warn(`[PII] Yetkisiz token talebi: trade=${tradeId.slice(0, 8)}...`);
      return res.status(403).json({ error: "Yalnızca taker PII token talep edebilir." });
    }

    if (!ALLOWED_TRADE_STATES.includes(trade.status)) {
      return res.status(400).json({ error: `PII token ${trade.status} durumunda alınamaz.` });
    }

    const piiToken = issuePIIToken(callerWallet, tradeId);

    // [TR] Hassas detayları log'a dökmüyoruz; yalnız trade seviyesinde kısa iz bırakıyoruz.
    logger.info(`[PII] Token issued (onchain=#${trade.onchain_escrow_id})`);
    return res.json({ piiToken });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/pii/:tradeId ────────────────────────────────────────────────────
// [TR] Trade-scoped token ile maker'ın ödeme bilgilerini çözer.
//      Burada ek olarak anlık trade statüsü tekrar kontrol edilir; token tek başına yeterli değildir.
router.get(
  "/:tradeId",
  requireAuth,
  requireSessionWalletMatch,
  requirePIIToken,
  piiLimiter,
  async (req, res, next) => {
    try {
      const { tradeId } = req.params;
      const callerWallet = req.wallet;

      if (!/^[a-fA-F0-9]{24}$/.test(tradeId)) {
        return res.status(400).json({ error: "Geçersiz tradeId formatı." });
      }

      const trade = await Trade.findById(tradeId)
        .select("maker_address status taker_address payout_snapshot")
        .lean();

      if (!trade) {
        return res.status(404).json({ error: "Trade bulunamadı." });
      }

      if (trade.taker_address !== callerWallet) {
        return res.status(403).json({ error: "Yetkisiz erişim." });
      }

      // [TR] Token alındıktan sonra trade kapanmış olabilir.
      //      Bu yüzden şifre çözmeden önce canlı state tekrar kontrol edilir.
      if (!ALLOWED_TRADE_STATES.includes(trade.status)) {
        return res.status(403).json({
          error: `İşlem artık aktif değil (${trade.status}). PII erişimi kaldırıldı.`,
        });
      }

      // [TR] V3 güvenlik sınırında current profile fallback kapalıdır.
      //      Gerekli maker snapshot alanları yoksa kontrollü hata döneriz.
      // [EN] Current profile fallback is disabled in V3. Required maker snapshot fields must exist.
      if (!hasMakerPIISnapshot(trade)) {
        logger.warn(`[PII] snapshot unavailable: trade=${tradeId.slice(0, 8)}...`);
        return respondSnapshotUnavailable(
          res,
          "Satıcı ödeme snapshot'ı bu trade için hazır değil."
        );
      }

      if (!hasCompletePayoutSnapshot(trade)) {
        logger.warn(`[PII] snapshot incomplete: trade=${tradeId.slice(0, 8)}...`);
        return respondSnapshotUnavailable(
          res,
          `Satıcı payout snapshot'ı incomplete (${trade?.payout_snapshot?.incomplete_reason || "unknown"}).`
        );
      }

      const detailsJson = await decryptField(
        trade.payout_snapshot.maker.payout_details_enc,
        trade.maker_address
      );
      const details = JSON.parse(detailsJson);

      const contactValue = trade.payout_snapshot?.maker?.contact_value_enc
        ? await decryptField(trade.payout_snapshot.maker.contact_value_enc, trade.maker_address)
        : null;

      const payoutProfile = {
        rail: trade.payout_snapshot?.maker?.rail || null,
        country: trade.payout_snapshot?.maker?.country || null,
        contact: {
          channel: trade.payout_snapshot?.maker?.contact_channel || null,
          value: contactValue,
        },
        fields: details,
      };

      logger.info(`[PII] Accessed: trade=${tradeId.slice(0, 8)}...`);

      // [TR] Ara katman cache'leri hassas yanıtı saklamasın.
      res.set("Cache-Control", "no-store, max-age=0");
      res.set("Pragma", "no-cache");

      return res.json({
        payoutProfile,
        notice: "Bu bilgiler şifreli kanaldan iletildi. Blockchain'e veya loglara kaydedilmez.",
      });
    } catch (err) {
      if (err.message?.includes("Unsupported state") || err.message?.includes("Invalid auth tag")) {
        logger.error(`[PII] Şifre çözme hatası: trade=${req.params.tradeId.slice(0, 8)}...`);
        return res.status(500).json({ error: "Şifre çözme başarısız. Lütfen daha sonra tekrar deneyin." });
      }

      next(err);
    }
  }
);

module.exports = router;
