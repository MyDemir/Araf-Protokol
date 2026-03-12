"use strict";

const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════════════════════
// LISTING MODEL — Pazar Yeri Vitrini
// ═══════════════════════════════════════════════════════════════════════════════

const listingSchema = new mongoose.Schema(
  {
    maker_address: {
      type:     String,
      required: true,
      lowercase: true,
      match:    /^0x[a-fA-F0-9]{40}$/,
      index:    true,
    },
    crypto_asset: {
      type:     String,
      required: true,
      enum:     ["USDT", "USDC"],
    },
    fiat_currency: {
      type:     String,
      required: true,
      enum:     ["TRY", "USD", "EUR"],
    },
    // Stored as Number (Float) — use Decimal128 in production for precision
    exchange_rate: {
      type:     Number,
      required: true,
      min:      0,
    },
    limits: {
      min: { type: Number, required: true, min: 0 },
      max: { type: Number, required: true, min: 0 },
    },
    tier_rules: {
      // H-01 Fix: 5 tier (0-4) destekleniyor. Contract ile senkronize.
      required_tier:   { type: Number, enum: [0, 1, 2, 3, 4], required: true },
      maker_bond_pct:  { type: Number, required: true },
      taker_bond_pct:  { type: Number, required: true },
    },
    status: {
      type:    String,
      enum:    ["OPEN", "PAUSED", "COMPLETED", "DELETED"],
      default: "OPEN",
      index:   true,
    },
    // Reference to on-chain escrow if one is active for this listing
    onchain_escrow_id: {
      type:    Number,
      default: null,
    },
    // Token contract address on Base
    token_address: {
      type:    String,
      lowercase: true,
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

// ── Compound Index — Core query: "Active TRY listings covering amount X" ──────
listingSchema.index({
  status:        1,
  fiat_currency: 1,
  "limits.min":  1,
  "limits.max":  1,
});

// ── Additional indexes ────────────────────────────────────────────────────────
listingSchema.index({ maker_address: 1, status: 1 });
listingSchema.index({ "tier_rules.required_tier": 1, status: 1 });

// ── Validation ────────────────────────────────────────────────────────────────
listingSchema.pre("save", function (next) {
  if (this.limits.max <= this.limits.min) {
    return next(new Error("limits.max must be greater than limits.min"));
  }
  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// TRADE MODEL — Aktif İşlemler ve Araf Odası
// ═══════════════════════════════════════════════════════════════════════════════

const tradeSchema = new mongoose.Schema(
  {
    // On-chain escrow ID (source of truth)
    onchain_escrow_id: {
      type:   Number,
      unique: true,
      sparse: true, // null until on-chain confirmed
    },

    listing_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "Listing",
    },

    maker_address: {
      type:      String,
      required:  true,
      lowercase: true,
      match:     /^0x[a-fA-F0-9]{40}$/,
    },
    taker_address: {
      type:      String,
      lowercase: true,
      match:     /^0x[a-fA-F0-9]{40}$/,
      default:   null,
    },

    financials: {
      crypto_amount:  { type: Number, required: true },
      fiat_amount:    { type: Number, default: null },
      exchange_rate:  { type: Number, required: true },
      crypto_asset:   { type: String, enum: ["USDT", "USDC"], required: true },
      fiat_currency:  { type: String, enum: ["TRY", "USD", "EUR"], required: true },
      // H-04 Fix: Bleeding Escrow decay takibi — display cache, autoritative değer on-chain.
      total_decayed:  { type: Number, default: 0 },
    },

    // Mirrors on-chain state machine
    status: {
      type:    String,
      enum:    ["OPEN", "LOCKED", "PAID", "CHALLENGED", "RESOLVED", "CANCELED", "BURNED"],
      default: "OPEN",
      index:   true,
    },

    timers: {
      locked_at:      { type: Date, default: null },
      paid_at:        { type: Date, default: null },
      challenged_at:  { type: Date, default: null },
      resolved_at:    { type: Date, default: null },
      // H-04 Fix: Son decay zamanı — frontend için bleeding progress hesabında kullanılır
      last_decay_at:  { type: Date, default: null },
    },

    // Taker's payment proof (IPFS hash — not payment verification)
    evidence: {
      ipfs_receipt_hash: { type: String, default: null },
      receipt_timestamp: { type: Date,   default: null },
    },

    // Collaborative Cancel tracking (EIP-712 signatures collected off-chain)
    cancel_proposal: {
      proposed_by:     { type: String, lowercase: true, default: null },
      maker_signed:    { type: Boolean, default: false },
      taker_signed:    { type: Boolean, default: false },
      maker_signature: { type: String, default: null },
      taker_signature: { type: String, default: null },
      deadline:        { type: Date,   default: null },
    },

    // ── M-01: Chargeback Acknowledgement Log ─────────────────────────────────
    // Maker "Ters İbraz Riskini Anladım" kutucuğunu işaretlediğinde buraya kaydedilir.
    // releaseFunds çağrısından ÖNCE bu kaydın oluşmuş olması beklenir.
    // İlerideki hukuki itirazlarda kanıt zinciri oluşturur.
    // ip_hash: SHA-256(raw_ip) — raw IP asla saklanmaz (GDPR uyumlu)
    chargeback_ack: {
      acknowledged:    { type: Boolean, default: false },
      acknowledged_by: { type: String,  lowercase: true, default: null }, // maker wallet
      acknowledged_at: { type: Date,    default: null },
      ip_hash:         { type: String,  default: null }, // SHA-256(IP) — GDPR uyumlu
    },

    // H-01 Fix: 5 tier (0-4) destekleniyor.
    // Tier 0 = yeni kullanıcı teşviki (bond yok, sadece crypto riski).
    // Tier 4 = premium, yüksek hacimli trader.
    tier: { type: Number, enum: [0, 1, 2, 3, 4], required: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
tradeSchema.index({ maker_address: 1, status: 1 });
tradeSchema.index({ taker_address: 1, status: 1 });
tradeSchema.index({ onchain_escrow_id: 1 });
// Auto-archive resolved/canceled trades after 1 year (GDPR)
tradeSchema.index(
  { "timers.resolved_at": 1 },
  { expireAfterSeconds: 365 * 24 * 3600, partialFilterExpression: { status: { $in: ["RESOLVED", "CANCELED", "BURNED"] } } }
);

// ── Virtual: is in bleeding phase? ───────────────────────────────────────────
tradeSchema.virtual("isInGracePeriod").get(function () {
  if (this.status !== "CHALLENGED" || !this.timers.challenged_at) return false;
  const elapsed = Date.now() - this.timers.challenged_at.getTime();
  return elapsed < 48 * 3600 * 1000;
});

tradeSchema.virtual("isInBleedingPhase").get(function () {
  if (this.status !== "CHALLENGED" || !this.timers.challenged_at) return false;
  const elapsed = Date.now() - this.timers.challenged_at.getTime();
  return elapsed >= 48 * 3600 * 1000;
});

module.exports = {
  Listing: mongoose.model("Listing", listingSchema),
  Trade:   mongoose.model("Trade",   tradeSchema),
};
