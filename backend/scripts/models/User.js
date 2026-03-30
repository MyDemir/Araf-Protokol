"use strict";

const mongoose = require("mongoose");

/**
 * User Model
 *
 * V3 notu:
 *   - PII alanları AES-256-GCM ile şifreli tutulur; plaintext kalıcı depoya yazılmaz.
 *   - reputation_cache ve ban alanları authority değildir; bunlar UI / query kolaylığı için aynadır.
 *   - Nihai otorite hâlâ kontrattaki reputation mapping'idir.
 *
 * Bu modelde özellikle korunan ilkeler:
 *   - public profile asla PII sızdırmaz
 *   - checkBanExpiry yalnız local mirror cleanup yapar; ban authority üretmez
 *   - V3 order + child trade büyüse bile kullanıcı state'i on-chain ile senkron düşünülür
 *
 * Banka profil riski (anti-fraud / anti-triangulation) notu:
 *   - Bu alanlar KONTRAT authority'si değildir; tamamen off-chain risk sinyalidir.
 *   - Amaç, trade room içinde kullanıcıyı daha bilinçli release kararına yönlendirmektir.
 *   - Banka bilgisi değişim geçmişi PII'nin kendisini değil, değişim olayının zamanını taşır.
 *   - bank_change_history internal yardımcı alandır; public profile'a sızdırılmaz.
 */
const userSchema = new mongoose.Schema(
  {
    wallet_address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: /^0x[a-fA-F0-9]{40}$/,
      index: true,
    },

    // ── Şifreli PII (AES-256-GCM) ────────────────────────────────────────────
    // Ham değerler ASLA saklanmaz. Service katmanında şifrelenerek kaydedilir.
    pii_data: {
      bankOwner_enc: { type: String, default: null },
      iban_enc: { type: String, default: null },
      telegram_enc: { type: String, default: null },
    },

    // ── Banka Profili Risk Metadatası (off-chain signal, authority değil) ───
    // Sadece bankOwner / iban değişimlerinde güncellenir.
    // Telegram değişimi şimdilik bu risk modeline dahil edilmez.
    //
    // profileVersion:
    //   Her banka bilgisi değişiminde artar. LOCKED anında trade snapshot'a yazılır.
    //
    // lastBankChangeAt:
    //   Son banka profili değişim zamanı.
    //
    // bankChangeCount7d / bankChangeCount30d:
    //   Son 7 / 30 gündeki değişim sayısının denormalized cache alanlarıdır.
    //
    // bank_change_history:
    //   Rolling sayaçları doğru hesaplayabilmek için tutulan internal tarih dizisi.
    //   Bu alan public response'lara verilmez.
    profileVersion: { type: Number, default: 0, min: 0 },
    lastBankChangeAt: { type: Date, default: null },
    bankChangeCount7d: { type: Number, default: 0, min: 0 },
    bankChangeCount30d: { type: Number, default: 0, min: 0 },
    bank_change_history: {
      type: [Date],
      default: [],
    },

    // ── İtibar Aynası (display/query amaçlı — authority değildir) ────────────
    // Gerçek itibar ve enforcement on-chain'dedir.
    reputation_cache: {
      success_rate: { type: Number, default: 100, min: 0, max: 100 },
      total_trades: { type: Number, default: 0, min: 0 },
      successful_trades: { type: Number, default: 0, min: 0 },
      failed_disputes: { type: Number, default: 0, min: 0 },
      effective_tier: { type: Number, default: 0, min: 0, max: 4 },
      // [TR] Ağırlıklı başarısızlık puanı — burned gibi ağır olaylar daha yüksek skor taşır.
      failure_score: { type: Number, default: 0, min: 0 },
    },

    // [TR] Başarısızlıkların zaman içindeki audit izi.
    // Örnek: [{ type: 'burned', score: 50, date: '...', tradeId: 123 }]
    reputation_history: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },

    // ── Ban Aynası (authority değil, chain sync cache) ───────────────────────
    is_banned: { type: Boolean, default: false },
    banned_until: { type: Date, default: null },

    // [TR] Contract mirror alanları — display/debug amaçlıdır.
    consecutive_bans: { type: Number, default: 0, min: 0 },
    max_allowed_tier: { type: Number, default: 4, min: 0, max: 4 },
    last_onchain_sync_at: { type: Date, default: null },

    // ── Aktivite ──────────────────────────────────────────────────────────────
    last_login: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

// ── Index'ler ─────────────────────────────────────────────────────────────────
userSchema.index({ wallet_address: 1 });
userSchema.index({ is_banned: 1 });
userSchema.index({ lastBankChangeAt: -1 });

// [TR] TTL index: 2 yıl hareketsiz kullanıcıyı sil (GDPR uyumu)
userSchema.index({ last_login: 1 }, { expireAfterSeconds: 2 * 365 * 24 * 3600 });

// ── Metodlar ──────────────────────────────────────────────────────────────────

/**
 * Public profil döndürür — PII veya şifreli alanlar içermez.
 *
 * Fail-safe yaklaşım:
 *   Yalnız açıkça allowlist'e alınmış alanlar döner.
 *   Böylece şemaya sonradan eklenen hassas alanlar yanlışlıkla response'a sızmaz.
 *
 * Not:
 *   Banka risk metadatası burada bilinçli olarak döndürülmez.
 *   Bu sinyal trade-scoped üretilmeli; global public profile yüzeyine açılmamalıdır.
 */
userSchema.methods.toPublicProfile = function () {
  return {
    wallet_address: this.wallet_address,
    reputation_cache: {
      success_rate: this.reputation_cache.success_rate,
      total_trades: this.reputation_cache.total_trades,
      successful_trades: this.reputation_cache.successful_trades,
      failed_disputes: this.reputation_cache.failed_disputes,
      effective_tier: this.reputation_cache.effective_tier,
      failure_score: this.reputation_cache.failure_score,
    },
    is_banned: this.is_banned,
    consecutive_bans: this.consecutive_bans,
    max_allowed_tier: this.max_allowed_tier,
    created_at: this.created_at,
  };
};

/**
 * Ban süresinin dolup dolmadığını kontrol eder ve local DB aynasını düzeltir.
 *
 * Önemli ayrım:
 *   - Bu metod ban authority üretmez.
 *   - Sadece backend mirror alanını temizler.
 *   - Gerçek ban kararı kontrattadır.
 *
 * Kullanım (auth.js'te):
 *   if (await user.checkBanExpiry()) {
 *     // Ban aynası temizlendi, kullanıcıya bilgi verilebilir
 *   }
 *
 * @returns {Promise<boolean>} Ban aynası temizlendiyse true
 */
userSchema.methods.checkBanExpiry = async function () {
  if (this.is_banned && this.banned_until && new Date() > this.banned_until) {
    this.is_banned = false;
    this.banned_until = null;
    await this.save();
    return true;
  }
  return false;
};

/**
 * Rolling banka değişim sayaçlarını yeniden hesaplar.
 *
 * Neden gerekli?
 *   Yalnızca bankChangeCount7d / 30d integer tutmak yetmez; eski kayıtların
 *   pencereden çıkması gerekir. Bu yüzden internal bank_change_history tutulur.
 *
 * Davranış:
 *   - 30 günden eski kayıtları kırpar
 *   - Son 7 ve 30 gün sayaçlarını yeniden üretir
 *   - lastBankChangeAt alanını kalan son kayda göre normalize eder
 *
 * Bu metod save() çağırmaz; çağıran route/service kaydetmelidir.
 *
 * @param {Date} [now=new Date()]
 * @returns {{
 *   profileVersion: number,
 *   lastBankChangeAt: Date|null,
 *   bankChangeCount7d: number,
 *   bankChangeCount30d: number
 * }}
 */
userSchema.methods.recomputeBankChangeCounters = function (now = new Date()) {
  const safeNow = now instanceof Date ? now : new Date(now);

  const thirtyDaysAgo = new Date(safeNow.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(safeNow.getTime() - 7 * 24 * 60 * 60 * 1000);

  const normalizedHistory = Array.isArray(this.bank_change_history)
    ? this.bank_change_history
        .map((value) => (value instanceof Date ? value : new Date(value)))
        .filter((date) => !Number.isNaN(date.getTime()))
        .filter((date) => date >= thirtyDaysAgo)
        .sort((a, b) => a.getTime() - b.getTime())
    : [];

  this.bank_change_history = normalizedHistory;
  this.bankChangeCount30d = normalizedHistory.length;
  this.bankChangeCount7d = normalizedHistory.filter((date) => date >= sevenDaysAgo).length;
  this.lastBankChangeAt =
    normalizedHistory.length > 0 ? normalizedHistory[normalizedHistory.length - 1] : null;

  return {
    profileVersion: this.profileVersion,
    lastBankChangeAt: this.lastBankChangeAt,
    bankChangeCount7d: this.bankChangeCount7d,
    bankChangeCount30d: this.bankChangeCount30d,
  };
};

/**
 * Banka profili değişimini işler.
 *
 * Bu helper şu durumda çağrılmalıdır:
 *   - bankOwner gerçekten değiştiyse veya
 *   - iban gerçekten değiştiyse
 *
 * Telegram değişimi için çağrılmamalıdır.
 *
 * Davranış:
 *   - profileVersion artırır
 *   - değişim zamanını history'ye ekler
 *   - 7/30 günlük sayaçları yeniden üretir
 *
 * Bu metod save() çağırmaz; çağıran route/service kaydetmelidir.
 *
 * @param {Date} [now=new Date()]
 * @returns {{
 *   profileVersion: number,
 *   lastBankChangeAt: Date|null,
 *   bankChangeCount7d: number,
 *   bankChangeCount30d: number
 * }}
 */
userSchema.methods.markBankProfileChanged = function (now = new Date()) {
  const safeNow = now instanceof Date ? now : new Date(now);

  if (!Array.isArray(this.bank_change_history)) {
    this.bank_change_history = [];
  }

  this.profileVersion = Number.isInteger(this.profileVersion) ? this.profileVersion + 1 : 1;
  this.bank_change_history.push(safeNow);

  return this.recomputeBankChangeCounters(safeNow);
};

module.exports = mongoose.model("User", userSchema);
