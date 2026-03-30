"use strict";

/**
 * Receipts Route — Child Trade Scoped Encrypted Receipt Upload
 *
 * V3'te dekont parent order'a değil, gerçek child trade'e yazılır.
 * Bu yüzden bütün guard'lar onchainEscrowId / taker_address / LOCKED child trade state'i üstünde uygulanır.
 */

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const os = require("os");
const router = express.Router();

const { requireAuth, requireSessionWalletMatch } = require("../middleware/auth");
const { tradesLimiter } = require("../middleware/rateLimiter");
const { encryptField } = require("../services/encryption");
const Trade = require("../models/Trade");
const logger = require("../utils/logger");
const { promises: fsp } = fs;

const tmpDir = path.join(os.tmpdir(), "araf-receipts");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir),
  filename: (_req, _file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
    if (!allowed.includes(file.mimetype)) return cb(new Error(`UNSUPPORTED_MIME:${file.mimetype}`));
    cb(null, true);
  },
});

const MAGIC_BYTES_BY_MIME = {
  "image/jpeg": [(buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff],
  "image/png": [(buf) => buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))],
  "image/webp": [(buf) => buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP"],
  "image/gif": [(buf) => buf.length >= 6 && (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a")],
  "application/pdf": [(buf) => buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-"],
};

async function validateFileMagicBytes(filePath, mimeType) {
  const validators = MAGIC_BYTES_BY_MIME[mimeType];
  if (!validators?.length) return false;
  const handle = await fsp.open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const used = header.subarray(0, bytesRead);
    return validators.some((fn) => fn(used));
  } finally { await handle.close(); }
}

async function encryptFileFromDisk(filePath, wallet) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = fs.createReadStream(filePath, { encoding: "base64" });
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", async () => {
      try {
        const base64Content = chunks.join("");
        const encryptedHex = await encryptField(base64Content, wallet);
        const sha256Hash = crypto.createHash("sha256").update(encryptedHex).digest("hex");
        resolve({ encryptedHex, sha256Hash });
      } catch (err) { reject(err); }
    });
    stream.on("error", reject);
  });
}

router.post("/upload", requireAuth, requireSessionWalletMatch, tradesLimiter, upload.single("receipt"), async (req, res, next) => {
  const tempFilePath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: "Dekont dosyası eksik veya boş." });

    const rawId = req.body?.onchainEscrowId;
    const onchainId = Number(rawId);
    if (!rawId || !Number.isInteger(onchainId) || onchainId <= 0) {
      return res.status(400).json({ error: "Geçersiz veya eksik onchainEscrowId." });
    }

    const signatureOk = await validateFileMagicBytes(tempFilePath, req.file.mimetype);
    if (!signatureOk) return res.status(415).json({ error: "Dosya içeriği bildirilen MIME tipiyle eşleşmiyor." });

    const { encryptedHex, sha256Hash } = await encryptFileFromDisk(tempFilePath, req.wallet);

    const updatedTrade = await Trade.findOneAndUpdate(
      {
        onchain_escrow_id: onchainId,
        taker_address: req.wallet,
        status: "LOCKED",
        "evidence.receipt_encrypted": null,
      },
      {
        $set: {
          "evidence.receipt_encrypted": encryptedHex,
          "evidence.ipfs_receipt_hash": sha256Hash,
          "evidence.receipt_timestamp": new Date(),
          "evidence.receipt_delete_at": new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      },
      { new: false }
    );

    if (!updatedTrade) {
      const existing = await Trade.findOne({ onchain_escrow_id: onchainId }).select("taker_address status evidence.receipt_encrypted").lean();
      if (!existing) return res.status(404).json({ error: `#${onchainId} numaralı trade bulunamadı.` });
      if (existing.taker_address !== req.wallet) return res.status(403).json({ error: "Yalnızca taker dekont yükleyebilir." });
      if (existing.evidence?.receipt_encrypted) return res.status(409).json({ error: "Bu işlem için dekont zaten yüklendi. Üzerine yazılamaz." });
      if (existing.status !== "LOCKED") {
        return res.status(400).json({ error: `Dekont yalnızca LOCKED durumunda yüklenebilir (mevcut: ${existing.status}).` });
      }
      return res.status(500).json({ error: "Dekont kaydedilemedi. Lütfen tekrar deneyin." });
    }

    logger.info(`[Receipts] Dekont kaydedildi: trade=#${onchainId} mime=${req.file.mimetype} hash=${sha256Hash.slice(0, 8)}...`);
    return res.status(201).json({ hash: sha256Hash });
  } catch (err) {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Dosya boyutu 5 MB sınırını aşıyor." });
    if (err.message?.startsWith("UNSUPPORTED_MIME:")) {
      const mime = err.message.split(":")[1];
      return res.status(415).json({ error: `Desteklenmeyen dosya tipi: ${mime}. İzin verilenler: JPEG, PNG, WebP, GIF, PDF` });
    }
    next(err);
  } finally {
    if (tempFilePath) {
      try { await fsp.unlink(tempFilePath); } catch (cleanupErr) { if (cleanupErr.code !== "ENOENT") logger.warn(`[Receipts] Geçici dosya silinemedi: ${tempFilePath}`); }
    }
  }
});

module.exports = router;
