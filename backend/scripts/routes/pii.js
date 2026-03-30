"use strict";

/**
 * PII Route — Child Trade Scoped PII Access
 *
 * V3'te PII erişimi parent order seviyesinde değil, gerçek child trade lifecycle'ı üstünde verilir.
 * Yani IBAN ve isim görünürlüğü, child trade'in aktif bir ödeme/uyuşmazlık penceresinde olmasına bağlıdır.
 */

const express = require("express");
const router = express.Router();

const { requireAuth, requirePIIToken } = require("../middleware/auth");
const { piiLimiter } = require("../middleware/rateLimiter");
const Trade = require("../models/Trade");
const User = require("../models/User");
const { decryptPII, decryptField } = require("../services/encryption");
const { issuePIIToken } = require("../services/siwe");
const logger = require("../utils/logger");

const ALLOWED_TRADE_STATES = ["LOCKED", "PAID", "CHALLENGED"];

router.get("/my", requireAuth, piiLimiter, async (req, res, next) => {
  try {
    const user = await User.findOne({ wallet_address: req.wallet }).select("pii_data").lean();
    if (!user || !user.pii_data) return res.json({ pii: null });
    const decrypted = await decryptPII(user.pii_data, req.wallet);
    logger.info(`[PII] /my accessed: wallet=${req.wallet.slice(0, 10)}...`);
    return res.json({ pii: decrypted });
  } catch (err) { next(err); }
});

router.get("/taker-name/:onchainId", requireAuth, piiLimiter, async (req, res, next) => {
  try {
    const onchainId = Number(req.params.onchainId);
    if (!Number.isInteger(onchainId) || onchainId <= 0) {
      return res.status(400).json({ error: "Geçersiz on-chain ID formatı." });
    }

    const trade = await Trade.findOne({ onchain_escrow_id: onchainId })
      .select("maker_address taker_address status pii_snapshot")
      .lean();
    if (!trade) return res.status(404).json({ error: "Trade bulunamadı." });
    if (trade.maker_address !== req.wallet) {
      logger.warn(`[PII] Yetkisiz taker-name erişimi: caller=${req.wallet.slice(0, 10)}...`);
      return res.status(403).json({ error: "Yalnızca maker alıcının ismini görebilir." });
    }
    if (!ALLOWED_TRADE_STATES.includes(trade.status)) {
      return res.status(400).json({ error: `Taker bilgisi ${trade.status} durumunda alınamaz.` });
    }
    if (!trade.taker_address) return res.json({ bankOwner: null });

    let bankOwner = null;
    if (trade.pii_snapshot?.taker_bankOwner_enc) {
      bankOwner = await decryptField(trade.pii_snapshot.taker_bankOwner_enc, trade.taker_address);
    } else {
      const takerUser = await User.findOne({ wallet_address: trade.taker_address }).select("pii_data").lean();
      if (takerUser?.pii_data?.bankOwner_enc) {
        const decrypted = await decryptPII(takerUser.pii_data, trade.taker_address);
        bankOwner = decrypted.bankOwner;
      }
    }

    logger.info(`[PII] taker-name accessed: onchain=#${onchainId}`);
    return res.json({ bankOwner });
  } catch (err) { next(err); }
});

router.post("/request-token/:tradeId", requireAuth, piiLimiter, async (req, res, next) => {
  try {
    const { tradeId } = req.params;
    const callerWallet = req.wallet;
    if (!/^[a-fA-F0-9]{24}$/.test(tradeId)) return res.status(400).json({ error: "Geçersiz tradeId formatı." });

    const trade = await Trade.findById(tradeId).lean();
    if (!trade) return res.status(404).json({ error: "Trade bulunamadı." });
    if (trade.taker_address !== callerWallet) return res.status(403).json({ error: "Yalnızca taker PII token talep edebilir." });
    if (!ALLOWED_TRADE_STATES.includes(trade.status)) return res.status(400).json({ error: `PII token ${trade.status} durumunda alınamaz.` });

    const piiToken = issuePIIToken(callerWallet, tradeId);
    logger.info(`[PII] Token issued (onchain=#${trade.onchain_escrow_id})`);
    return res.json({ piiToken });
  } catch (err) { next(err); }
});

router.get("/:tradeId", requirePIIToken, piiLimiter, async (req, res, next) => {
  try {
    const { tradeId } = req.params;
    const callerWallet = req.wallet;
    if (!/^[a-fA-F0-9]{24}$/.test(tradeId)) return res.status(400).json({ error: "Geçersiz tradeId formatı." });

    const trade = await Trade.findById(tradeId).select("maker_address status taker_address pii_snapshot").lean();
    if (!trade) return res.status(404).json({ error: "Trade bulunamadı." });
    if (trade.taker_address !== callerWallet) return res.status(403).json({ error: "Yetkisiz erişim." });
    if (!ALLOWED_TRADE_STATES.includes(trade.status)) {
      return res.status(403).json({ error: `İşlem artık aktif değil (${trade.status}). PII erişimi kaldırıldı.` });
    }

    let bankOwner = null;
    let iban = null;
    let telegram = null;
    if (trade.pii_snapshot?.maker_bankOwner_enc || trade.pii_snapshot?.maker_iban_enc) {
      if (trade.pii_snapshot?.maker_bankOwner_enc) bankOwner = await decryptField(trade.pii_snapshot.maker_bankOwner_enc, trade.maker_address);
      if (trade.pii_snapshot?.maker_iban_enc) iban = await decryptField(trade.pii_snapshot.maker_iban_enc, trade.maker_address);
    } else {
      const makerUser = await User.findOne({ wallet_address: trade.maker_address }).select("pii_data").lean();
      if (!makerUser || !makerUser.pii_data) return res.status(404).json({ error: "Satıcı ödeme bilgilerini henüz girmemiş." });
      const decrypted = await decryptPII(makerUser.pii_data, trade.maker_address);
      bankOwner = decrypted.bankOwner;
      iban = decrypted.iban;
      telegram = decrypted.telegram;
    }

    logger.info(`[PII] Accessed: trade=${tradeId.slice(0, 8)}...`);
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("Pragma", "no-cache");
    return res.json({ bankOwner, iban, telegram, notice: "Bu bilgiler şifreli kanaldan iletildi. Blockchain'e veya loglara kaydedilmez." });
  } catch (err) {
    if (err.message?.includes("Unsupported state") || err.message?.includes("Invalid auth tag")) {
      logger.error(`[PII] Şifre çözme hatası: trade=${req.params.tradeId.slice(0, 8)}...`);
      return res.status(500).json({ error: "Şifre çözme başarısız. Lütfen daha sonra tekrar deneyin." });
    }
    next(err);
  }
});

module.exports = router;
