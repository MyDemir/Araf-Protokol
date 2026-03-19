"use strict";

/**
 * Receipts Route — Şifreli Ödeme Dekontu Yükleme
 *
 * [TR] Mimari (ARCHITECTURE_TR.md Bölüm 9.6–9.7):
 *      Dekont ASLA public IPFS'e veya zincire yüklenmez.
 *      Akış:
 *        1. Taker, dosyayı multipart/form-data olarak gönderir (field: "receipt").
 *           onchainEscrowId text field'ı ile hangi trade'e ait olduğu belirtilir.
 *        2. Dosya belleğe alınır (diske yazılmaz — multer memoryStorage).
 *        3. SHA-256(encrypted_data) hesaplanır.
 *        4. Dosya taker wallet DEK'i ile AES-256-GCM şifrelenir.
 *        5. Şifreli veri Receipt koleksiyonuna kaydedilir.
 *        6. Hash frontend'e döner; frontend reportPayment() ile bunu on-chain'e yazar.
 *      TTL (Unutulma Hakkı / GDPR-KVKK):
 *        - Varsayılan expires_at = yükleme anı + 30 gün.
 *        - eventListener, RESOLVED/CANCELED → +24 saat, CHALLENGED/BURNED → +30 gün olarak günceller.
 *        - MongoDB TTL index expires_at dolunca belgeyi otomatik siler.
 *
 * [EN] Architecture (ARCHITECTURE_EN.md Section 9.6–9.7):
 *      Receipt is NEVER uploaded to public IPFS or the blockchain.
 *      Flow:
 *        1. Taker sends file as multipart/form-data (field: "receipt").
 *           onchainEscrowId text field identifies which trade it belongs to.
 *        2. File is kept in memory (never written to disk — multer memoryStorage).
 *        3. SHA-256(encrypted_data) is computed.
 *        4. File is AES-256-GCM encrypted using taker wallet DEK.
 *        5. Encrypted data is saved to the Receipt collection.
 *        6. Hash returned to frontend; frontend writes it on-chain via reportPayment().
 *      TTL (Right to be Forgotten / GDPR-KVKK):
 *        - Default expires_at = upload time + 30 days.
 *        - eventListener updates to: RESOLVED/CANCELED → +24h, CHALLENGED/BURNED → +30d.
 *        - MongoDB TTL index auto-deletes when expires_at is reached.
 */

const express = require("express");
const multer  = require("multer");
const crypto  = require("crypto");
const router  = express.Router();

const { requireAuth }   = require("../middleware/auth");
const { tradesLimiter } = require("../middleware/rateLimiter");
const { encryptField }  = require("../services/encryption");
const { Trade }         = require("../models/Trade");
const Receipt           = require("../models/Receipt");
const logger            = require("../utils/logger");

// ── Multer config ─────────────────────────────────────────────────────────────

// [TR] Dosya yalnızca bellekte tutulur — diske asla yazılmaz
// [EN] File kept in memory only — never written to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "application/pdf",
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error(`UNSUPPORTED_MIME:${file.mimetype}`));
    }
    cb(null, true);
  },
});

// ── POST /api/receipts/upload ─────────────────────────────────────────────────

/**
 * [TR] Beklenen form alanları:
 *   - receipt       (file)   — dekont dosyası
 *   - onchainEscrowId (text) — aktivenin on-chain escrow ID'si
 *
 * [EN] Expected form fields:
 *   - receipt         (file) — receipt file
 *   - onchainEscrowId (text) — active trade's on-chain escrow ID
 *
 * Response: { hash: "<sha256_hex>" }
 */
router.post(
  "/upload",
  requireAuth,
  tradesLimiter,
  upload.single("receipt"),
  async (req, res, next) => {
    try {
      // ── 1. Dosya kontrolü / File check ────────────────────────────────────
      if (!req.file || !req.file.buffer || req.file.size === 0) {
        return res.status(400).json({ error: "Dekont dosyası eksik veya boş." });
      }

      // ── 2. onchainEscrowId doğrulama / Validate onchainEscrowId ───────────
      const rawId       = req.body?.onchainEscrowId;
      const onchainId   = Number(rawId);
      if (!rawId || !Number.isInteger(onchainId) || onchainId <= 0) {
        return res.status(400).json({ error: "Geçersiz veya eksik onchainEscrowId." });
      }

      // ── 3. Trade doğrulama / Trade validation ─────────────────────────────
      // [TR] Caller taker mı ve trade LOCKED durumunda mı?
      // [EN] Is caller the taker and is trade in LOCKED status?
      const trade = await Trade.findOne({ onchain_escrow_id: onchainId })
        .select("taker_address status")
        .lean();

      if (!trade) {
        return res.status(404).json({ error: `#${onchainId} numaralı trade bulunamadı.` });
      }
      if (trade.taker_address !== req.wallet) {
        logger.warn(`[Receipts] Yetkisiz yükleme: caller=${req.wallet} taker=${trade.taker_address} trade=#${onchainId}`);
        return res.status(403).json({ error: "Yalnızca taker dekont yükleyebilir." });
      }
      if (trade.status !== "LOCKED") {
        return res.status(400).json({
          error: `Dekont yalnızca LOCKED durumunda yüklenebilir (mevcut: ${trade.status}).`,
        });
      }

      // ── 4. Şifreleme / Encryption ─────────────────────────────────────────
      // [TR] Taker wallet DEK'i ile AES-256-GCM şifrele.
      //      Dosya buffer'ı base64'e çevrilip metin olarak şifrelenir.
      //      Context = taker wallet adresi → wallet'a özgü DEK.
      // [EN] AES-256-GCM encrypt with taker wallet DEK.
      //      File buffer is base64-encoded then encrypted as text.
      //      Context = taker wallet address → wallet-scoped DEK.
      const fileBuffer   = req.file.buffer;
      const encryptedHex = await encryptField(fileBuffer.toString("base64"), req.wallet);

      // ── 5. SHA-256 hash hesapla / Compute SHA-256 hash ────────────────────
      // [TR] SHA-256(encrypted_data) → on-chain'e yazılacak değer.
      //      "ipfsReceiptHash" alanı adında IPFS yok — sadece şifreli verinin parmak izi.
      // [EN] SHA-256(encrypted_data) → value to be written on-chain.
      //      "ipfsReceiptHash" field name has no IPFS — just a fingerprint of encrypted data.
      const sha256Hash = crypto
        .createHash("sha256")
        .update(encryptedHex)
        .digest("hex");

      // ── 6. Upsert — aynı hash varsa tekrar kaydetme / Upsert — skip if same hash ──
      await Receipt.findOneAndUpdate(
        { sha256_hash: sha256Hash },
        {
          $setOnInsert: {
            onchain_escrow_id: onchainId,
            taker_address:     req.wallet,
            encrypted_data:    encryptedHex,
            sha256_hash:       sha256Hash,
            original_filename: req.file.originalname ?? null,
            mime_type:         req.file.mimetype,
            // [TR] expires_at şema varsayılanı: +30 gün.
            //      eventListener trade sonuçlandığında gerçek değere günceller.
            // [EN] expires_at schema default: +30 days.
            //      eventListener updates to real value when trade concludes.
          },
        },
        { upsert: true, new: false }
      );

      logger.info(
        `[Receipts] Dekont kaydedildi: trade=#${onchainId} taker=${req.wallet} ` +
        `size=${fileBuffer.length}B mime=${req.file.mimetype} hash=${sha256Hash.slice(0, 8)}...`
      );

      // [TR] Frontend'e sadece hash döner — şifreli baytlar asla istemciye gitmez
      // [EN] Only hash returned to frontend — encrypted bytes never sent to client
      return res.status(201).json({ hash: sha256Hash });

    } catch (err) {
      if (err.message === "MulterError: LIMIT_FILE_SIZE" || err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "Dosya boyutu 5 MB sınırını aşıyor." });
      }
      if (err.message?.startsWith("UNSUPPORTED_MIME:")) {
        const mime = err.message.split(":")[1];
        return res.status(415).json({
          error: `Desteklenmeyen dosya tipi: ${mime}. İzin verilenler: JPEG, PNG, WebP, GIF, PDF`,
        });
      }
      next(err);
    }
  }
);

module.exports = router;
