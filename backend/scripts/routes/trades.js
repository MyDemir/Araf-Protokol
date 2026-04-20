"use strict";

const express = require("express");
const Joi = require("joi");
const crypto = require("crypto");
const { ethers } = require("ethers");
const router = express.Router();

const { requireAuth, requireSessionWalletMatch } = require("../middleware/auth");
const { tradesLimiter } = require("../middleware/rateLimiter");
const Trade = require("../models/Trade");
const User = require("../models/User");
const logger = require("../utils/logger");
const { buildBankProfileRisk } = require("./tradeRisk");

const CANCEL_VERIFY_ABI = [
  "function sigNonces(address) view returns (uint256)",
  "function domainSeparator() view returns (bytes32)",
];
const CANCEL_TYPES = {
  CancelProposal: [
    { name: "tradeId", type: "uint256" },
    { name: "proposer", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};
const CONTRACT_CANCEL_ALLOWED_STATUSES = new Set(["LOCKED", "PAID", "CHALLENGED"]);

let cancelVerifyProvider = null;
let cancelVerifyContract = null;

function _getCancelVerifyContract() {
  if (cancelVerifyContract && cancelVerifyProvider) {
    return { provider: cancelVerifyProvider, contract: cancelVerifyContract };
  }

  const rpcUrl = process.env.BASE_RPC_URL;
  const contractAddress = process.env.ARAF_ESCROW_ADDRESS;
  if (!rpcUrl || !contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  cancelVerifyProvider = new ethers.JsonRpcProvider(rpcUrl);
  cancelVerifyContract = new ethers.Contract(contractAddress, CANCEL_VERIFY_ABI, cancelVerifyProvider);
  return { provider: cancelVerifyProvider, contract: cancelVerifyContract };
}

async function _verifyCancelSignatureOrThrow({
  wallet,
  signature,
  tradeOnchainId,
  deadline,
}) {
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    const err = new Error("İmza formatı geçersiz.");
    err.statusCode = 400;
    throw err;
  }

  const verifier = _getCancelVerifyContract();
  if (!verifier) {
    const err = new Error("Cancel signature doğrulaması için RPC/contract yapılandırması eksik.");
    err.statusCode = 503;
    throw err;
  }

  const { provider, contract } = verifier;
  const network = await provider.getNetwork();
  const nonce = await contract.sigNonces(wallet);

  const domain = {
    name: "ArafEscrow",
    version: "1",
    chainId: Number(network.chainId),
    verifyingContract: process.env.ARAF_ESCROW_ADDRESS,
  };

  const onchainDomainSeparator = await contract.domainSeparator();
  const computedDomainSeparator = ethers.TypedDataEncoder.hashDomain(domain);
  if (onchainDomainSeparator !== computedDomainSeparator) {
    const err = new Error("EIP-712 domain uyuşmazlığı. Cancel signature doğrulaması güvenli değil.");
    err.statusCode = 503;
    throw err;
  }

  const value = {
    tradeId: BigInt(tradeOnchainId),
    proposer: wallet,
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
  };

  const recovered = ethers.verifyTypedData(domain, CANCEL_TYPES, value, signature);
  if (recovered.toLowerCase() !== wallet.toLowerCase()) {
    const err = new Error("İmza doğrulaması başarısız. İmza oturum cüzdanıyla eşleşmiyor.");
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Trades Route — V3 Child Trade Read Layer
 *
 * V3'te bu route parent order değil, gerçek escrow lifecycle'ı taşıyan child trade'leri döndürür.
 * State-changing aksiyonlar yine kontrat üstünde gerçekleşir; backend burada yalnız
 * PII coordination, cancel signature coordination ve audit destek yüzeyi sağlar.
 *
 * Önemli kavramsal ayrım:
 *   - orderId  = parent order kimliği
 *   - tradeId  = child trade / escrow kimliği
 *   - /by-escrow/:onchainId yalnız TRADE/ESCROW id ile çalışır
 *
 * Bu route, parent order authority üretmez ve order book kurallarını yeniden yorumlamaz.
 *
 * Banka profil riski notu:
 *   - highRiskBankProfile DB'de kalıcı ayrı bir state olarak tutulmaz
 *   - her response'ta trade snapshot + güncel maker profileVersion birlikte değerlendirilir
 *   - amaç UI'a karar desteği vermektir; protocol authority üretmek değildir
 */

const SAFE_TRADE_PROJECTION = [
  "_id",
  "onchain_escrow_id",
  "parent_order_id",
  "trade_origin",
  "parent_order_side",
  "canonical_refs",
  "maker_address",
  "taker_address",
  "token_address",
  "status",
  "tier",
  "fee_snapshot",
  "fill_metadata",
  "financials",
  "timers",
  "payout_snapshot.maker.rail",
  "payout_snapshot.maker.country",
  "payout_snapshot.maker.fingerprint_hash_at_lock",
  "payout_snapshot.maker.profile_version_at_lock",
  "payout_snapshot.maker.bank_change_count_7d_at_lock",
  "payout_snapshot.maker.bank_change_count_30d_at_lock",
  "payout_snapshot.maker.last_bank_change_at_at_lock",
  "cancel_proposal.proposed_by",
  "cancel_proposal.proposed_at",
  "cancel_proposal.approved_by",
  "cancel_proposal.deadline",
  "cancel_proposal.maker_signed",
  "cancel_proposal.taker_signed",
  "evidence.ipfs_receipt_hash",
  "evidence.receipt_timestamp",
  "chargeback_ack.acknowledged",
  "chargeback_ack.acknowledged_at",
].join(" ");

const POSITIVE_NUMERIC_ID_RE = /^[1-9]\d*$/;
const DEFAULT_MY_TRADES_LIMIT = 20;
const MAX_MY_TRADES_LIMIT = 50;

function _parsePositiveOnchainId(rawId) {
  const normalized = String(rawId ?? "").trim();
  if (!POSITIVE_NUMERIC_ID_RE.test(normalized)) return null;
  return normalized;
}

function _buildIdentityLookup(field, idString) {
  // [TR] Legacy numeric + yeni string kimlikleri tek filtreden güvenilir eşlemek için
  //      cast-bağımsız $expr + $toString kullanıyoruz.
  // [EN] Cast-independent matcher for both legacy numeric and new string identities.
  return {
    $expr: {
      $eq: [{ $toString: `$${field}` }, idString],
    },
  };
}

/**
 * Trade listesine trade-scoped banka risk sinyalini ekler.
 *
 * Neden ayrı helper?
 *   - /my
 *   - /history
 *   - /by-escrow
 *   - /:id
 * hepsi aynı risk üretimini paylaşsın; tekrar olmasın.
 */
async function _attachBankProfileRisk(trades) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return [];
  }

  const makerAddresses = [
    ...new Set(
      trades
        .map((trade) => trade?.maker_address)
        .filter(Boolean)
    ),
  ];

  const makerUsers = await User.find({ wallet_address: { $in: makerAddresses } })
    .select("wallet_address profileVersion lastBankChangeAt payout_profile")
    .lean();

  const makerMap = new Map(
    makerUsers.map((user) => [user.wallet_address, user])
  );

  return trades.map((trade) => {
    const makerUser = makerMap.get(trade.maker_address) || null;
    const bankProfileRisk = buildBankProfileRisk(trade, makerUser);

    // [TR] Internal snapshot alanlarını response'ta doğrudan açmıyoruz;
    //      onun yerine türetilmiş risk nesnesi veriyoruz.
    const { payout_snapshot, ...safeTrade } = trade;

    return {
      ...safeTrade,
      bank_profile_risk: bankProfileRisk,
    };
  });
}

// ─── GET /api/trades/my ───────────────────────────────────────────────────────
router.get("/my", requireAuth, requireSessionWalletMatch, tradesLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(MAX_MY_TRADES_LIMIT).default(DEFAULT_MY_TRADES_LIMIT),
    });
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    const filter = {
      $or: [{ maker_address: req.wallet }, { taker_address: req.wallet }],
      status: { $nin: ["RESOLVED", "CANCELED", "BURNED"] },
    };
    const skip = (value.page - 1) * value.limit;

    const [trades, total] = await Promise.all([
      Trade.find(filter)
        .select(SAFE_TRADE_PROJECTION)
        .sort({ created_at: -1, _id: -1 })
        .skip(skip)
        .limit(value.limit)
        .lean(),
      Trade.countDocuments(filter),
    ]);

    const enrichedTrades = await _attachBankProfileRisk(trades);
    return res.json({ trades: enrichedTrades, total, page: value.page, limit: value.limit });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/trades/history ──────────────────────────────────────────────────
router.get("/history", requireAuth, requireSessionWalletMatch, tradesLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(10),
    });
    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    const filter = {
      $or: [{ maker_address: req.wallet }, { taker_address: req.wallet }],
      status: { $in: ["RESOLVED", "CANCELED", "BURNED"] },
    };
    const skip = (value.page - 1) * value.limit;

    const [trades, total] = await Promise.all([
      Trade.find(filter)
        .select(SAFE_TRADE_PROJECTION)
        .sort({ "timers.resolved_at": -1, onchain_escrow_id: -1 })
        .skip(skip)
        .limit(value.limit)
        .lean(),
      Trade.countDocuments(filter),
    ]);

    const enrichedTrades = await _attachBankProfileRisk(trades);

    return res.json({
      trades: enrichedTrades,
      total,
      page: value.page,
      limit: value.limit,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/trades/by-escrow/:onchainId ────────────────────────────────────
// [TR] GET /:id'den önce tanımlanmalı — yoksa Express yanlış route'a girebilir.
// [TR] Buradaki kimlik parent order id değil, child trade / escrow id'dir.
router.get("/by-escrow/:onchainId", requireAuth, requireSessionWalletMatch, tradesLimiter, async (req, res, next) => {
  try {
    const onchainId = _parsePositiveOnchainId(req.params.onchainId);
    if (!onchainId) {
      return res.status(400).json({ error: "Geçersiz on-chain ID formatı." });
    }

    const trade = await Trade.findOne(_buildIdentityLookup("onchain_escrow_id", onchainId))
      .select(SAFE_TRADE_PROJECTION)
      .lean();

    if (!trade) {
      return res.status(404).json({ error: "Trade bulunamadı." });
    }

    if (trade.maker_address !== req.wallet && trade.taker_address !== req.wallet) {
      return res.status(403).json({ error: "Erişim reddedildi." });
    }

    const [enrichedTrade] = await _attachBankProfileRisk([trade]);
    return res.json({ trade: enrichedTrade });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/trades/:id ──────────────────────────────────────────────────────
router.get("/:id", requireAuth, requireSessionWalletMatch, tradesLimiter, async (req, res, next) => {
  try {
    if (!/^[a-fA-F0-9]{24}$/.test(req.params.id)) {
      return res.status(400).json({ error: "Geçersiz trade ID formatı." });
    }

    const trade = await Trade.findById(req.params.id)
      .select(SAFE_TRADE_PROJECTION)
      .lean();

    if (!trade) {
      return res.status(404).json({ error: "İşlem bulunamadı." });
    }

    if (trade.maker_address !== req.wallet && trade.taker_address !== req.wallet) {
      return res.status(403).json({ error: "Erişim reddedildi." });
    }

    const [enrichedTrade] = await _attachBankProfileRisk([trade]);
    return res.json({ trade: enrichedTrade });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/trades/propose-cancel ─────────────────────────────────────────
/**
 * propose-cancel backend'in kontrat adına iptal YAPTIĞI bir yüzey değildir.
 * Bu route yalnız iki tarafın imza koordinasyonunu ve audit izini tutar.
 *
 * Kontrat authoritative kalır; backend burada yalnız off-chain coordination sağlar.
 */
router.post("/propose-cancel", requireAuth, requireSessionWalletMatch, tradesLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      tradeId: Joi.string().length(24).hex().required(),
      signature: Joi.string().pattern(/^0x[a-fA-F0-9]+$/).required(),
      deadline: Joi.number().integer().required(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const now = Math.floor(Date.now() / 1000);
    const MAX_DEADLINE_SECONDS = 7 * 24 * 60 * 60;
    if (value.deadline <= now) {
      return res.status(400).json({ error: "Deadline geçmiş bir zamana ayarlanamaz." });
    }
    if (value.deadline > now + MAX_DEADLINE_SECONDS) {
      return res.status(400).json({ error: "Deadline çok uzak. Maksimum 7 gün sonrası kabul edilir." });
    }

    const trade = await Trade.findById(value.tradeId);
    if (!trade) return res.status(404).json({ error: "İşlem bulunamadı." });
    // [TR] Kontrat authority'si ile birebir hizalama:
    //      proposeOrApproveCancel() yalnız LOCKED/PAID/CHALLENGED kabul eder.
    //      Backend'in bu kapıyı genişletmesi false-success üretir.
    // [EN] Keep backend precheck aligned with on-chain authority.
    if (!CONTRACT_CANCEL_ALLOWED_STATUSES.has(trade.status)) {
      return res.status(409).json({
        error: `İptal imzası bu trade durumunda kabul edilmez (mevcut: ${trade.status}).`,
        code: "CANCEL_STATE_NOT_ALLOWED",
      });
    }
    const normalizedEscrowId = _parsePositiveOnchainId(trade.onchain_escrow_id);
    if (!normalizedEscrowId) {
      return res.status(409).json({ error: "Trade on-chain kimliği bulunamadı. İptal imzası doğrulanamaz." });
    }

    const isMaker = trade.maker_address === req.wallet;
    const isTaker = trade.taker_address === req.wallet;
    if (!isMaker && !isTaker) {
      return res.status(403).json({ error: "Bu işlemin tarafı değilsin." });
    }

    await _verifyCancelSignatureOrThrow({
      wallet: req.wallet,
      signature: value.signature,
      tradeOnchainId: normalizedEscrowId,
      deadline: value.deadline,
    });

    // [TR] İlk teklif deadline'ı sabitler; ikinci taraf aynı deadline ile gelmelidir.
    const existingDeadline = trade.cancel_proposal.deadline;
    if (existingDeadline) {
      const existingTs = Math.floor(new Date(existingDeadline).getTime() / 1000);
      if (Math.abs(existingTs - value.deadline) > 60) {
        logger.warn(
          `[Trades] Deadline manipülasyon denemesi: mevcut=${existingTs} gelen=${value.deadline} wallet=${req.wallet}`
        );
        return res.status(400).json({
          error: "Deadline mevcut teklifle uyuşmuyor. Manipülasyon girişimi tespit edildi.",
        });
      }
    } else {
      trade.cancel_proposal.deadline = new Date(value.deadline * 1000);
    }

    if (!trade.cancel_proposal.proposed_by) {
      trade.cancel_proposal.proposed_by = req.wallet;
    }
    if (!trade.cancel_proposal.approved_by && trade.cancel_proposal.proposed_by !== req.wallet) {
      trade.cancel_proposal.approved_by = req.wallet;
    }

    if (isMaker) {
      trade.cancel_proposal.maker_signed = true;
      trade.cancel_proposal.maker_signature = value.signature;
    } else {
      trade.cancel_proposal.taker_signed = true;
      trade.cancel_proposal.taker_signature = value.signature;
    }

    await trade.save();

    const bothSigned = trade.cancel_proposal.maker_signed && trade.cancel_proposal.taker_signed;
    return res.json({
      success: true,
      bothSigned,
      message: bothSigned
        ? "Her iki taraf imzaladı. Kontrat precheck koşulları sağlandı."
        : "Teklifin kaydedildi. Karşı tarafın imzası bekleniyor.",
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/trades/:id/chargeback-ack ─────────────────────────────────────
// [TR] Bu endpoint yalnızca audit/log içindir. On-chain release akışına veto uygulamaz.
//      Başarısızlığı kontrat çağrısını engelleyecek bir protocol gate olarak kullanılmamalıdır.

/**
 * Gerçek IP belirleme fonksiyonu.
 * app.js'de trust proxy aktif olduğunda req.ip zaten doğru IP'yi döndürür.
 * Bu fonksiyon ek güvence katmanı sağlar.
 */
function _getRealIP(req) {
  // [TR] x-forwarded-for header'ını doğrudan güvenmeyiz.
  //      app.js'de trust proxy açık; Express req.ip'i güvenli şekilde normalize eder.
  // [EN] Do not trust raw x-forwarded-for header directly.
  //      trust proxy is enabled in app.js, so req.ip is the normalized source.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

router.post("/:id/chargeback-ack", requireAuth, requireSessionWalletMatch, tradesLimiter, async (req, res, next) => {
  try {
    if (!/^[a-fA-F0-9]{24}$/.test(req.params.id)) {
      return res.status(400).json({ error: "Geçersiz trade ID formatı." });
    }

    const rawIp = _getRealIP(req);
    const ipHash = crypto.createHash("sha256").update(rawIp).digest("hex");

    const updatedTrade = await Trade.findOneAndUpdate(
      {
        _id: req.params.id,
        maker_address: req.wallet,
        status: { $in: ["PAID", "CHALLENGED"] },
        "chargeback_ack.acknowledged": { $ne: true },
      },
      {
        $set: {
          "chargeback_ack.acknowledged": true,
          "chargeback_ack.acknowledged_by": req.wallet,
          "chargeback_ack.acknowledged_at": new Date(),
          "chargeback_ack.ip_hash": ipHash,
        },
      },
      { new: true }
    );

    if (!updatedTrade) {
      const existing = await Trade.findById(req.params.id)
        .select("maker_address status chargeback_ack")
        .lean();

      if (!existing) return res.status(404).json({ error: "İşlem bulunamadı." });
      if (existing.maker_address !== req.wallet) {
        return res.status(403).json({ error: "Bu işlem için yetkiniz yok." });
      }
      if (existing.chargeback_ack?.acknowledged) {
        return res.status(409).json({
          error: "Bu işlem için onay zaten kaydedildi.",
          acknowledged_at: existing.chargeback_ack.acknowledged_at,
        });
      }
      return res.status(400).json({ error: `Chargeback onayı bu durumda yapılamaz (mevcut: ${existing.status}).` });
    }

    logger.info(`[ChargebackAck] Kaydedildi: maker=${req.wallet} trade=${req.params.id}`);
    return res.status(201).json({
      success: true,
      acknowledged_at: updatedTrade.chargeback_ack.acknowledged_at,
      message: "Ters ibraz riski onayı kaydedildi.",
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
