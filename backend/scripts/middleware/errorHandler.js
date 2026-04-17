// ─── middleware/errorHandler.js ───────────────────────────────────────────────
"use strict";

const logger = require("../utils/logger");

// [TR] Loglanmadan önce temizlenecek PII / hassas alanlar
// [EN] PII / sensitive field names to scrub before logging
const PII_FIELD_NAMES = new Set([
  "bankOwner", "bankOwner_enc",
  "iban", "iban_enc",
  "telegram", "telegram_enc",
  "password", "token", "refreshToken", "signature",
  "piiToken", "receipt_encrypted",
  "payoutProfile", "payout_profile", "payout_snapshot",
  "payout_details_enc", "contact_value_enc", "routingNumber",
  "accountNumber", "bic", "swiftCode", "sortCode",
]);

const SENSITIVE_VALUE_PATTERNS = [
  /TR\d{24}/gi, // TR IBAN
  /\b[A-Z]{2}[A-Z0-9]{13,32}\b/g, // generic IBAN
  /\b\d{9}\b/g, // routing
  /\b\d{4,17}\b/g, // account-like
  /0x[a-fA-F0-9]{40}/g, // wallet
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // email
  /(bearer\s+)[a-zA-Z0-9\-\._~\+\/]+=*/gi, // bearer
  /\b(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+)\b/g, // jwt
];

function scrubSensitiveText(value) {
  if (typeof value !== "string") return value;
  let clean = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    clean = clean.replace(pattern, "[REDACTED]");
  }
  return clean;
}

/**
 * req.body'den PII alanlarını temizler.
 * Log dosyasına IBAN ve isim bilgisi yazılmasını önler.
 *
 * ORTA-09 Fix: errorHandler.js Plaintext PII Log Sızıntısı kapatıldı.
 *   ÖNCEKİ: development'ta `body: req.body` doğrudan loglanıyordu.
 *   PUT /api/auth/profile gönderilen bankOwner, iban plaintext log dosyasına yazılıyordu.
 *   ŞİMDİ: Bilinen PII alanları [REDACTED] ile değiştiriliyor.
 *
 * V3 notu:
 * Parent order / child trade geçişinde de log katmanı authority üretmez.
 * Buradaki amaç yalnız hata ayıklama sağlamak ve hassas veriyi log yüzeyinden uzak tutmaktır.
 */
function scrubBody(body) {
  if (typeof body === "string") {
    return scrubSensitiveText(body);
  }
  if (!body || typeof body !== "object") return body;
  const clean = Array.isArray(body) ? [] : {};

  for (const [key, value] of Object.entries(body)) {
    if (PII_FIELD_NAMES.has(key)) {
      clean[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      clean[key] = scrubBody(value); // nested obje
    } else if (typeof value === "string") {
      clean[key] = scrubSensitiveText(value);
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

/**
 * Global Error Handler — Merkezi Hata Yönetimi
 *
 * ORTA-09 Fix: Üretimde AND geliştirmede req.body PII scrub edildi.
 *
 * Ek Fix: Eksik fallback response kapatıldı.
 *   ÖNCEKİ: Tanınmayan hata tiplerinde (TypeError, SyntaxError, DB kopukluğu)
 *   if bloklarına uymayan hatalar için fallback res.status(500) YOKtu.
 *   İstek (request) zaman aşımına uğrayana kadar (2-5 dakika) asılı kalıyordu.
 *   Kullanıcılar sonsuz "Yükleniyor..." spinner'ı ile karşılaşıyordu.
 *   ŞİMDİ: Fonksiyon sonunda her zaman yanıt dönen fallback eklendi.
 */
function globalErrorHandler(err, req, res, next) {
  // [TR] Yanıt zaten gönderildiyse Express'in varsayılan hata işleyicisine devret
  if (res.headersSent) {
    return next(err);
  }

  // 1. Hata Detaylarını Hazırla — PII scrub edilmiş body ile
  const errorDetails = {
    message: err.message,
    path: req.path,
    method: req.method,
    ip: req.ip,
    wallet: req.wallet || "anon",
    // ORTA-09 Fix: Her ortamda scrub — plaintext PII loglanmaz
    body: scrubBody(req.body),
    stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    timestamp: new Date().toISOString(),
  };

  logger.error("[SERVER ERROR]", errorDetails);

  // 2. Mongoose Validation Hataları
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ error: "Doğrulama başarısız.", details: messages });
  }

  // 3. Mongoose Duplicate Key
  if (err.code === 11000) {
    return res.status(409).json({
      error: "Duplicate entry",
      message: "Bu veri zaten mevcut.",
    });
  }

  // 4. JWT Hataları
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return res.status(401).json({
      error: "Geçersiz veya süresi dolmuş token.",
      message: "Lütfen yeniden giriş yapın.",
    });
  }

  // 5. İstemci hataları (özel statusCode ile fırlatılanlar)
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return res.status(err.statusCode).json({
      error: err.message || "İstek hatası.",
    });
  }

  // 6. Fallback — Tüm diğer beklenmeyen hatalar
  // [TR] Eklendi: Önceki kodda bu fallback yoktu → istek asılı kalıyordu!
  return res.status(500).json({
    error: "Internal server error",
    message: "Sunucu tarafında beklenmedik bir sorun oluştu.",
  });
}

module.exports = { globalErrorHandler, scrubBody, scrubSensitiveText };
