"use strict";

const mongoose = require("mongoose");

/**
 * User Model
 *
 * V3 notu:
 *   - Bu model artık yalnız kullanıcı profili değil, kontratın ürettiği on-chain
 *     gerçekliğin güvenli bir read-model aynasıdır.
 *   - Ayna (mirror) olmak otorite olmak değildir:
 *       * ban durumu burada tutulabilir,
 *       * effective tier burada cache'lenebilir,
 *       * başarı/başarısızlık istatistiği burada gösterilebilir,
 *     ama nihai enforcement kaynağı yine kontrattır.
 *
 * KRİT-11 Fix korunur: checkBanExpiry veritabanına kaydeder.
 *   ÖNCEKİ: this.is_banned = false yapılıp await this.save() ÇAĞRILMIYORDU.
 *   Sadece bellekteki nesne değişiyordu — DB'de kullanıcı sonsuza kadar
 *   "yasaklı" kalıyordu. Kullanıcı oturum boyunca girebilir gibi görünse de
 *   sayfa her yenilendiğinde tekrar banlı görünüyordu.
 *   ŞİMDİ: Fonksiyon async yapıldı, DB güncellemesi yapıldı.
 *   auth.js içinde `if (await user.checkBanExpiry())` şeklinde çağrılmalı.
 *
 * Güvenlik tasarımı:
 *   - pii_data alanları AES-256-GCM şifreli (asla plaintext saklanmaz)
 *   - reputation_cache sadece görüntüleme amaçlı; yetkilendirmede KULLANILMAZ
 *   - Nonce'lar burada değil Redis'te saklanır (TTL ile)
 *   - On-chain kaynaklı alanlar backend tarafından "icat" edilmez; event listener
 *     veya kontrollü on-chain sync ile güncellenir.
 */
const userSchema = new mongoose.Schema(
  {
    wallet_address: {
      type:       String,
      required:   true,
      unique:     true,
      lowercase:  true,
      match:      /^0x[a-fA-F0-9]{40}$/,
      index:      true,
    },

    // ── Şifreli PII (AES-256-GCM) ────────────────────────────────────────────
    // Ham değerler ASLA saklanmaz. Service katmanında şifrelenerek kaydedilir.
    pii_data: {
      bankOwner_enc: { type: String, default: null },
      iban_enc:      { type: String, default: null },
      telegram_enc:  { type: String, default: null },
    },

    // ── İtibar Önbelleği (sadece görüntüleme — YETKİLENDİRMEDE KULLANILMAZ) ──
    // Gerçek itibar kontratta/on-chain yaşar. Bu önbellek hızlı UI render ve
    // analytics için tutulur.
    reputation_cache: {
      // Başarı oranı yüzdesi (0-100) — ekran kartları / profil görünümü için.
      success_rate:       { type: Number, default: 100, min: 0, max: 100 },

      // V3'te "tamamlanan işlem" dili child trade dünyasına kayar. Bu alan,
      // resolved/başarılı child trade toplamını göstermek için kullanılabilir.
      successful_trades:  { type: Number, default: 0, min: 0 },

      // UI uyumluluğu için toplam trade sayısı cache'i korunur.
      total_trades:       { type: Number, default: 0, min: 0 },

      // Kontratın failed dispute / failed outcome sayısının görüntüleme aynası.
      failed_disputes:    { type: Number, default: 0, min: 0 },

      // [TR] Ağırlıklı başarısızlık puanı — 'burned' gibi ciddi olaylar daha yüksek puana sahip.
      // [EN] Weighted failure score — severe outcomes like 'burned' carry higher weight.
      failure_score:      { type: Number, default: 0, min: 0 },

      // Efektif tier cache'i — route/UI hızlandırma içindir, otoriter enforcement alanı değildir.
      effective_tier:     { type: Number, default: 0, min: 0, max: 4 },

      // İlk başarılı trade zamanı — V3'te MIN_ACTIVE_PERIOD ve kullanıcı ilerleme ekranlarında yararlıdır.
      first_successful_trade_at: { type: Date, default: null },

      // Son on-chain senkron zamanı — debug / gözlemlenebilirlik için.
      last_onchain_sync_at: { type: Date, default: null },
    },

    // [TR] Başarısızlıkların zamanla etkisini yitirmesi için geçmiş kaydı.
    // [EN] Historical record for failure decay over time.
    // Örnek: [{ type: 'burned', score: 50, date: '...', tradeId: 123 }]
    reputation_history: {
      type:    [mongoose.Schema.Types.Mixed],
      default: [],
    },

    // ── Ban Durumu (on-chain yansıması — event listener tarafından güncellenir) ──
    is_banned:    { type: Boolean, default: false },
    banned_until: { type: Date,    default: null  },

    // [TR] H-03: Consecutive ban takibi — kontrat ile senkronize.
    // Bu alanlar display/cache amaçlıdır; otoriter değer on-chain'dir.
    consecutive_bans: { type: Number, default: 0, min: 0 },
    max_allowed_tier: { type: Number, default: 4, min: 0, max: 4 },

    // ── V3 Operasyonel / Gözlemlenebilirlik Yardımcı Alanları ────────────────
    // Bu alanlar enforcement üretmez; worker/debug/read-model senkronu içindir.
    onchain_mirror: {
      wallet_registered_at: { type: Date, default: null },
      last_seen_block:      { type: Number, default: null },
      last_seen_tx_hash:    { type: String, default: null },
      mirror_version:       { type: String, default: "v3" },
    },

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
userSchema.index({ max_allowed_tier: 1, is_banned: 1 });
// [TR] TTL index: 2 yıl hareketsiz kullanıcıyı sil (GDPR uyumu)
userSchema.index({ last_login: 1 }, { expireAfterSeconds: 2 * 365 * 24 * 3600 });

// ── Metodlar ──────────────────────────────────────────────────────────────────

/**
 * Public profil döndürür — PII veya şifreli alanlar içermez.
 * Fail-safe: Sadece açıkça belirlenen alanlar döner.
 * Gelecekte eklenen yeni alanların yanlışlıkla sızmasını önler.
 */
userSchema.methods.toPublicProfile = function () {
  return {
    wallet_address: this.wallet_address,
    reputation_cache: {
      success_rate:              this.reputation_cache.success_rate,
      successful_trades:         this.reputation_cache.successful_trades,
      total_trades:              this.reputation_cache.total_trades,
      failed_disputes:           this.reputation_cache.failed_disputes,
      failure_score:             this.reputation_cache.failure_score,
      effective_tier:            this.reputation_cache.effective_tier,
      first_successful_trade_at: this.reputation_cache.first_successful_trade_at,
      last_onchain_sync_at:      this.reputation_cache.last_onchain_sync_at,
    },
    is_banned:        this.is_banned,
    banned_until:     this.banned_until,
    consecutive_bans: this.consecutive_bans,
    max_allowed_tier: this.max_allowed_tier,
    onchain_mirror: {
      wallet_registered_at: this.onchain_mirror?.wallet_registered_at || null,
      mirror_version:       this.onchain_mirror?.mirror_version || "v3",
    },
    created_at:       this.created_at,
  };
};

/**
 * KRİT-11 Fix: Ban süresinin dolup dolmadığını kontrol eder ve DB'ye kaydeder.
 *
 * ÖNCEKİ: Senkron, save() yoktu → DB'de ban sonsuza kalıyordu.
 * ŞİMDİ: Async, ban kalkınca hem bellekte hem DB'de güncelleniyor.
 *
 * V3 notu:
 *   Bu fonksiyon on-chain authority üretmez; yalnız read-model cache'ini temizler.
 *   Eğer kontrat kullanıcıyı yeniden banlı gösteriyorsa, event listener sonraki sync'te
 *   bu alanları tekrar güncelleyecektir.
 *
 * Kullanım (auth.js'te):
 *   if (await user.checkBanExpiry()) {
 *     // Ban kalktı, bilgi ver
 *   }
 *
 * @returns {Promise<boolean>} Ban kalktıysa true
 */
userSchema.methods.checkBanExpiry = async function () {
  if (this.is_banned && this.banned_until && new Date() > this.banned_until) {
    this.is_banned    = false;
    this.banned_until = null;
    // KRİT-11 Fix: Değişikliği veritabanına kaydet
    await this.save();
    return true; // Ban kalktı
  }
  return false;
};

module.exports = mongoose.model("User", userSchema);
