"use strict";

const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════════════════════
// TRADE MODEL — V3 Child Trade Mirror
// ═══════════════════════════════════════════════════════════════════════════════
//
// V3 kuralı:
//   - Gerçek escrow işlemi artık "child trade" seviyesinde yaşar.
//   - Parent order kamusal emir katmanıdır; child trade ise gerçek escrow lifecycle'ıdır.
//   - Backend bu modeli authoritative olarak ÜRETMEZ; kontrattan mirror eder.
//
// Bu yüzden bu model:
//   1. on-chain trade kimliğini merkez alır,
//   2. varsa parent order bağını explicit saklar,
//   3. financial alanları BigInt-safe string olarak taşır,
//   4. PII snapshot ve dekont alanlarını child trade bağlamında tutar.
//
// Not:
//   ArafEscrow-yeni.sol hâlâ canonical direct escrow yolunu teknik olarak içerir.
//   Ancak V3 omurgası parent order + child trade'tir.
//   Bu model direct escrow'u "legacy authority" olarak değil,
//   kontratın izin verdiği ikincil kaynak olarak mirror edebilir.
//

const tradeSchema = new mongoose.Schema(
  {
    // [TR] Kontrattaki tradeId aynası — child trade için birincil kimlik.
    // [EN] Mirror of on-chain tradeId — primary identity for child trade.
    onchain_escrow_id: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      match: /^\d+$/,
    },

    // [TR] Parent order bağı. Child trade order fill ile doğduysa set edilir.
    //      Direct escrow akışında null kalabilir.
    // [EN] Parent order linkage. Populated when the trade is spawned from an order fill.
    parent_order_id: {
      type: String,
      default: null,
      index: true,
      match: /^\d+$/,
    },

    // [TR] Trade kökeni. V3'te ana yol ORDER_CHILD'dır.
    //      DIRECT_ESCROW yalnız kontratın canonical createEscrow yolu için saklanır.
    // [EN] Trade origin. ORDER_CHILD is the primary V3 path.
    //      DIRECT_ESCROW is retained only for the contract's canonical direct path.
    trade_origin: {
      type: String,
      enum: ["ORDER_CHILD", "DIRECT_ESCROW"],
      default: "ORDER_CHILD",
      index: true,
    },

    // [TR] Parent order yönü. Child trade market semantics'i için yararlıdır.
    // [EN] Parent order side. Useful for market semantics of the child trade.
    parent_order_side: {
      type: String,
      enum: ["SELL_CRYPTO", "BUY_CRYPTO", null],
      default: null,
      index: true,
    },

    maker_address: {
      type: String,
      required: true,
      lowercase: true,
      match: /^0x[a-fA-F0-9]{40}$/,
      index: true,
    },
    taker_address: {
      type: String,
      lowercase: true,
      match: /^0x[a-fA-F0-9]{40}$/,
      default: null,
      index: true,
    },

    token_address: {
      type: String,
      lowercase: true,
      default: null,
      match: /^0x[a-fA-F0-9]{40}$/,
      index: true,
    },

    // [TR] Canonical referanslar. listing_ref authority değildir; yalnız kontrat event'inden
    //      gelen referans izi olarak tutulur. Parent order akışında order_ref daha güçlü bağdır.
    // [EN] Canonical references. listing_ref is NOT an authority layer; it is only an event trace.
    canonical_refs: {
      listing_ref: {
        type: String,
        lowercase: true,
        default: null,
        match: /^0x[a-f0-9]{64}$/,
      },
      order_ref: {
        type: String,
        lowercase: true,
        default: null,
        match: /^0x[a-f0-9]{64}$/,
      },
    },

    // [TR] Fill'e özgü metadata. Child trade order fill'den doğduysa set edilir.
    // [EN] Fill-specific metadata. Present when the child trade is born from an order fill.
    fill_metadata: {
      fill_amount:      { type: String, default: null },
      fill_amount_num:  { type: Number, default: 0 },
      filler_address:   { type: String, lowercase: true, default: null },
      remaining_amount_after_fill:     { type: String, default: null },
      remaining_amount_after_fill_num: { type: Number, default: 0 },
    },

    // [TR] Kontrat snapshot'larının backend aynası.
    //      Ekonomi burada hesaplanmaz; yalnız kontrattan yansıtılır.
    // [EN] Mirror of contract snapshots.
    //      Economics are not computed here; only mirrored from the contract.
    fee_snapshot: {
      taker_fee_bps: { type: Number, default: null, min: 0 },
      maker_fee_bps: { type: Number, default: null, min: 0 },
    },

    financials: {
      // [TR] Otoritatif tutar: zincirdeki ham token miktarı (base units) String.
      // [EN] Authoritative amount: raw on-chain token amount (base units) as String.
      crypto_amount: { type: String, required: true },

      // [TR] Yaklaşık Number cache (analytics/UI aggregation). Enforcement amaçlı KULLANILMAZ.
      // [EN] Approximate Number cache (analytics/UI aggregation). NOT for enforcement.
      crypto_amount_num: { type: Number, default: 0 },

      maker_bond:     { type: String, default: "0" },
      maker_bond_num: { type: Number, default: 0 },
      taker_bond:     { type: String, default: "0" },
      taker_bond_num: { type: Number, default: 0 },

      // [TR] Fiat/rate canonical veri değildir. Bunlar opsiyonel enrichment alanlarıdır.
      // [EN] Fiat/rate are NOT canonical protocol values. They are optional enrichment fields.
      fiat_amount:   { type: Number, default: null },
      exchange_rate: { type: Number, default: null },
      crypto_asset:  { type: String, enum: ["USDT", "USDC", null], default: null },
      fiat_currency: { type: String, enum: ["TRY", "USD", "EUR", null], default: null },

      // [TR] Otoritatif kümülatif erime: String (BigInt güvenli).
      // [EN] Authoritative cumulative decay: String (BigInt-safe).
      total_decayed: { type: String, default: "0" },
      total_decayed_num: { type: Number, default: 0 },

      // [TR] İdempotency ve denetim için decay tx hash listesi.
      // [EN] Decay tx hash list for idempotency and audit.
      decay_tx_hashes: { type: [String], default: [] },
      decayed_amounts: { type: [String], default: [] },
    },

    status: {
      type: String,
      enum: ["OPEN", "LOCKED", "PAID", "CHALLENGED", "RESOLVED", "CANCELED", "BURNED"],
      default: "OPEN",
      index: true,
    },

    tier: { type: Number, enum: [0, 1, 2, 3, 4], required: true, index: true },

    timers: {
      created_at_onchain:    { type: Date, default: null },
      locked_at:             { type: Date, default: null },
      paid_at:               { type: Date, default: null },
      challenged_at:         { type: Date, default: null },
      resolved_at:           { type: Date, default: null },
      last_decay_at:         { type: Date, default: null },
      pinged_at:             { type: Date, default: null },
      challenge_pinged_at:   { type: Date, default: null },
    },

    pinged_by_taker:           { type: Boolean, default: false },
    challenge_pinged_by_maker: { type: Boolean, default: false },

    evidence: {
      // [TR] Kontrata giden hash: SHA-256(encrypted_data).
      //      "ipfs" prefix'i tarihsel — gerçek IPFS kullanılmıyor.
      //      Dekont public IPFS'e yüklenmez; backend'de AES-256-GCM ile şifrelenir.
      // [EN] Hash sent to contract: SHA-256(encrypted_data).
      //      "ipfs" prefix is historical — real IPFS is not used.
      //      Receipt is NOT on public IPFS; encrypted AES-256-GCM on backend.
      ipfs_receipt_hash: { type: String, default: null },

      // [TR] AES-256-GCM şifreli dekont verisi.
      //      Child trade çözüldükten sonra retention politikasıyla temizlenir.
      // [EN] AES-256-GCM encrypted receipt data.
      //      Cleared after child trade completion according to retention policy.
      receipt_encrypted: { type: String, default: null },
      receipt_timestamp: { type: Date, default: null },
      receipt_delete_at: { type: Date, default: null },
    },

    // [TR] Generic payout snapshot (rail-aware).
    //      Reveal ve risk değerlendirmesi bu snapshot üstünden yapılır.
    payout_snapshot: {
      maker: {
        rail: { type: String, default: null },
        country: { type: String, default: null },
        contact_channel: { type: String, default: null },
        contact_value_enc: { type: String, default: null },
        payout_details_enc: { type: String, default: null },
        fingerprint_hash_at_lock: { type: String, default: null },
        profile_version_at_lock: { type: Number, default: 0, min: 0 },
        bank_change_count_7d_at_lock: { type: Number, default: null, min: 0 },
        bank_change_count_30d_at_lock: { type: Number, default: null, min: 0 },
        last_bank_change_at_at_lock: { type: Date, default: null },
      },
      taker: {
        rail: { type: String, default: null },
        country: { type: String, default: null },
        contact_channel: { type: String, default: null },
        contact_value_enc: { type: String, default: null },
        payout_details_enc: { type: String, default: null },
        fingerprint_hash_at_lock: { type: String, default: null },
        profile_version_at_lock: { type: Number, default: 0, min: 0 },
        bank_change_count_7d_at_lock: { type: Number, default: null, min: 0 },
        bank_change_count_30d_at_lock: { type: Number, default: null, min: 0 },
        last_bank_change_at_at_lock: { type: Date, default: null },
      },
      captured_at: { type: Date, default: null },
      snapshot_delete_at: { type: Date, default: null },
      is_complete: { type: Boolean, default: true },
      incomplete_reason: { type: String, default: null },
    },

    cancel_proposal: {
      proposed_by:     { type: String, lowercase: true, default: null },
      proposed_at:     { type: Date,   default: null },
      approved_by:     { type: String, lowercase: true, default: null },
      maker_signed:    { type: Boolean, default: false },
      taker_signed:    { type: Boolean, default: false },
      maker_signature: { type: String, default: null },
      taker_signature: { type: String, default: null },
      deadline:        { type: Date,   default: null },
    },

    chargeback_ack: {
      acknowledged:    { type: Boolean, default: false },
      acknowledged_by: { type: String,  lowercase: true, default: null },
      acknowledged_at: { type: Date,    default: null },
      ip_hash:         { type: String,  default: null },
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
tradeSchema.index({ parent_order_id: 1, status: 1 });
tradeSchema.index({ maker_address: 1, status: 1 });
tradeSchema.index({ taker_address: 1, status: 1 });
tradeSchema.index({ trade_origin: 1, status: 1 });
tradeSchema.index({ parent_order_side: 1, status: 1 });
tradeSchema.index({ token_address: 1, status: 1 });
tradeSchema.index({ tier: 1, status: 1 });

// [TR] Trade'leri 1 yıl sonra sil — GDPR uyumu
// [EN] Delete trades after 1 year — GDPR compliance
tradeSchema.index(
  { "timers.resolved_at": 1 },
  {
    expireAfterSeconds: 365 * 24 * 3600,
    partialFilterExpression: { status: { $in: ["RESOLVED", "CANCELED", "BURNED"] } },
  }
);

// [TR] receipt_delete_at dolunca temizlenecek trade'leri bulmak için sparse index.
//      MongoDB TTL dokümanı siler, field'ı değil — cleanup job bu index'i kullanır.
// [EN] Sparse index to find trades with expired receipts for cleanup.
tradeSchema.index({ "evidence.receipt_delete_at": 1 }, { sparse: true });

// ── Virtuals ─────────────────────────────────────────────────────────────────
tradeSchema.virtual("isInGracePeriod").get(function () {
  if (this.status !== "CHALLENGED" || !this.timers?.challenged_at) return false;
  return Date.now() - this.timers.challenged_at.getTime() < 48 * 3600 * 1000;
});

tradeSchema.virtual("isInBleedingPhase").get(function () {
  if (this.status !== "CHALLENGED" || !this.timers?.challenged_at) return false;
  return Date.now() - this.timers.challenged_at.getTime() >= 48 * 3600 * 1000;
});

module.exports = mongoose.model("Trade", tradeSchema);
