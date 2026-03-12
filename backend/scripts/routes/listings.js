"use strict";

/**
 * Listings Route — Pazar Yeri CRUD
 *
 * Endpoint'ler:
 *   GET    /api/listings          — Herkese açık ilan listesi (filtrelenebilir)
 *   POST   /api/listings          — Yeni ilan oluştur (auth gerekli)
 *   DELETE /api/listings/:id      — İlanı sil / dondur (sadece ilan sahibi)
 *
 * Felsefe:
 *   - İlan açmak bir on-chain işlem DEĞİLDİR — sadece pazar yeri kaydı.
 *   - Gerçek escrow createEscrow() kontrat çağrısıyla başlar.
 *   - Bond oranları burada saklanır ama kontrat bağımsız enforce eder.
 *   - Backend hiçbir zaman özel anahtar tutmaz (Zero Private Key mimarisi).
 */

const express = require("express");
const Joi     = require("joi");
const router  = express.Router();

const { requireAuth }                                = require("../middleware/auth");
const { listingsReadLimiter, listingsWriteLimiter }  = require("../middleware/rateLimiter");
const { Listing }                                    = require("../models/Trade");
const logger                                         = require("../utils/logger");
const { getConfig }                                  = require("../services/protocolConfig");

// ─── GET /api/listings ────────────────────────────────────────────────────────
/**
 * Pazar yeri ilanlarını listeler. Herkese açık.
 * Query parametreleri: fiat, amount, tier, page, limit
 */
router.get("/", listingsReadLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      fiat:   Joi.string().valid("TRY", "USD", "EUR").optional(),
      amount: Joi.number().positive().optional(),
      // 5 tier (0-4) — Tier 0 = bond yok (yeni kullanıcı teşviki)
      tier:   Joi.number().valid(0, 1, 2, 3, 4).optional(),
      page:   Joi.number().integer().min(1).default(1),
      limit:  Joi.number().integer().min(1).max(50).default(20),
    });

    const { error, value } = schema.validate(req.query);
    if (error) return res.status(400).json({ error: error.message });

    // Filtre oluştur
    const filter = { status: "OPEN" };
    if (value.fiat)   filter.fiat_currency = value.fiat;
    // Tier 0 dahil tam eşleşme filtresi
    if (value.tier !== undefined) filter["tier_rules.required_tier"] = value.tier;
    if (value.amount) {
      filter["limits.min"] = { $lte: value.amount };
      filter["limits.max"] = { $gte: value.amount };
    }

    const skip     = (value.page - 1) * value.limit;
    const listings = await Listing.find(filter)
      .sort({ exchange_rate: 1 })
      .skip(skip)
      .limit(value.limit)
      .lean();

    const total = await Listing.countDocuments(filter);
    return res.json({ listings, total, page: value.page, limit: value.limit });
  } catch (err) { next(err); }
});

// ─── POST /api/listings ───────────────────────────────────────────────────────
/**
 * Yeni ilan oluşturur. Auth (JWT) gerekli.
 * Body: { crypto_asset, fiat_currency, exchange_rate, limits, tier, token_address, onchain_escrow_id? }
 */
router.post("/", requireAuth, listingsWriteLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      crypto_asset:      Joi.string().valid("USDT", "USDC").required(),
      fiat_currency:     Joi.string().valid("TRY", "USD", "EUR").required(),
      exchange_rate:     Joi.number().positive().required(),
      limits:            Joi.object({
        min: Joi.number().positive().required(),
        max: Joi.number().positive().required(),
      }).required(),
      // Tier 0-4 — kontrat ile senkronize
      tier:              Joi.number().valid(0, 1, 2, 3, 4).required(),
      token_address:     Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
      // On-chain escrow ID — createEscrow() sonrası bağlanır, başlangıçta opsiyonel
      onchain_escrow_id: Joi.number().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    // limits.max > limits.min kontrolü (model pre-save hook'unda da var, çift güvenlik)
    if (value.limits.max <= value.limits.min) {
      return res.status(400).json({ error: "limits.max, limits.min'den büyük olmalı" });
    }

    // MİMARİ İYİLEŞTİRME: Hard-coded BOND_MAP yerine on-chain'den yüklenen config'i kullan.
    const config = getConfig();
    const bonds = config.bondMap[value.tier];

    const listing = await Listing.create({
      maker_address:     req.wallet,
      crypto_asset:      value.crypto_asset,
      fiat_currency:     value.fiat_currency,
      exchange_rate:     value.exchange_rate,
      limits:            value.limits,
      tier_rules: {
        required_tier:  value.tier,
        maker_bond_pct: bonds.maker,
        taker_bond_pct: bonds.taker,
      },
      token_address:     value.token_address,
      onchain_escrow_id: value.onchain_escrow_id || null,
    });

    logger.info(`[Listings] Yeni ilan: maker=${req.wallet} tier=${value.tier} asset=${value.crypto_asset}`);
    return res.status(201).json({ listing });
  } catch (err) { next(err); }
});

// ─── DELETE /api/listings/:id ─────────────────────────────────────────────────
/**
 * İlanı siler (soft delete — status: "DELETED").
 * Sadece ilan sahibi (maker) silebilir.
 * Aktif bir escrow varsa (LOCKED/PAID/CHALLENGED) silme engellenir.
 */
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    // MongoDB ObjectId format kontrolü
    if (!/^[a-fA-F0-9]{24}$/.test(req.params.id)) {
      return res.status(400).json({ error: "Geçersiz ilan ID formatı" });
    }

    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: "İlan bulunamadı" });

    if (listing.maker_address !== req.wallet) {
      logger.warn(`[Listings] Yetkisiz silme: caller=${req.wallet} maker=${listing.maker_address}`);
      return res.status(403).json({ error: "Bu ilan sana ait değil" });
    }

    // YENİ GÜVENLİK KONTROLÜ: İlanla ilişkili aktif bir işlem var mı?
    if (listing.onchain_escrow_id) {
      const activeTrade = await Trade.findOne({ onchain_escrow_id: listing.onchain_escrow_id });
      // Eğer işlem varsa ve durumu "OPEN" değilse (yani bir Taker tarafından kilitlenmişse), silmeyi engelle.
      if (activeTrade && activeTrade.status !== "OPEN") {
        logger.warn(`[Listings] Aktif işlem varken silme engellendi: id=${req.params.id} trade_status=${activeTrade.status}`);
        return res.status(409).json({ error: "Bu ilana bağlı aktif bir işlem varken ilan silinemez." });
      }
    }

    // Zaten silinmişse 409 döner
    if (listing.status === "DELETED") {
      return res.status(409).json({ error: "İlan zaten silinmiş" });
    }

    listing.status = "DELETED";
    await listing.save();

    logger.info(`[Listings] Silindi: id=${req.params.id} maker=${req.wallet}`);
    return res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
