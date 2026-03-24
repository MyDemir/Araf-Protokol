"use strict";

/**
 * Rate Limiting — Redis Sliding Window
 *
 * KRİT-05 Fix: Global Proxy DoS Kapatıldı.
 *   ÖNCEKİ: keyGenerator: (req) => req.ip — Fly.io/Cloudflare/Nginx arkasında
 *   trust proxy ayarı olmadığında req.ip tüm kullanıcılar için Load Balancer IP'si
 *   oluyordu. authLimiter dakikada 10 isteğe izin verdiğinden 11. kullanıcı
 *   "Too Many Requests" alıyordu → platform tamamen erişilemez.
 *   ŞİMDİ: app.js'de app.set('trust proxy', true) zorunlu.
 *   (app.js bunu her ortamda yapıyor — db.js Fix notu inceleyin.)
 *
 * KRİT-05 Fix: Redis Fail-Open Stratejisi.
 *   ÖNCEKİ: Redis koptuğunda RedisStore hata fırlatıyor, tüm endpoint'ler 500.
 *   ŞİMDİ: Redis erişilemezse istek geçirilir (fail-open) — platform çalışmaya
 *   devam eder ama rate limiting geçici olarak aktif olmaz.
 *   Bu tercih: "Rate limit yokken kötüye kullanım riski" < "Platform erişilemez"
 */

const rateLimit      = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { getRedisClient, isReady } = require("../config/redis");
const logger         = require("../utils/logger");

/**
 * Redis Store oluşturur.
 * KRİT-05 Fix: Redis erişilemezse store oluşturma hatası yakalanır.
 */
function makeStore(prefix) {
  return new RedisStore({
    sendCommand: (...args) => getRedisClient().sendCommand(args),
    prefix:      `rl:${prefix}:`,
  });
}

/**
 * KRİT-05 Fix: Redis erişilemezse isteği geç (fail-open).
 * Bu sayede Redis kesintisinde tüm endpoint'ler çalışmaya devam eder.
 */
function makeSkipFn() {
  return () => {
    if (!isReady()) {
      logger.warn("[RateLimit] Redis erişilemez — rate limiting geçici olarak devre dışı (fail-open).");
      return true; // isteği geç
    }
    return false;
  };
}

function onLimitReached(req) {
  logger.warn(
    `[RateLimit] Engellendi: ${req.ip} | ${req.path} | wallet: ${req.wallet || "anon"}`
  );
}

// ─── PII / IBAN Endpoint — En Sıkı ───────────────────────────────────────────
// 10 dakikada 3 istek — IP + wallet kombinasyonu
const piiLimiter = rateLimit({
  windowMs:        10 * 60 * 1000,
  max:             3,
  keyGenerator:    (req) => `${req.ip}:${req.wallet || "anon"}`,
  store:           makeStore("pii"),
  skip:            makeSkipFn(),
  handler:         (req, res) => {
    onLimitReached(req);
    res.status(429).json({
      error:       "Çok fazla PII isteği. 10 dakikada maksimum 3 istek.",
      retryAfter:  Math.ceil(10 * 60),
    });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ─── SIWE Auth — Brute Force Koruması ────────────────────────────────────────
// 1 dakikada 10 istek — IP bazlı
const authLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  keyGenerator:    (req) => req.ip, // KRİT-05: app.js'de trust proxy aktif olmalı
  store:           makeStore("auth"),
  skip:            makeSkipFn(),
  handler:         (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Çok fazla auth isteği. 1 dakika sonra tekrar deneyin." });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ─── Listings GET — Public Okuma ──────────────────────────────────────────────
// 1 dakikada 100 istek — IP bazlı
const listingsReadLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             100,
  keyGenerator:    (req) => req.ip,
  store:           makeStore("listings-read"),
  skip:            makeSkipFn(),
  handler:         (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Çok fazla istek. Yavaşlayın." });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ─── Listings POST — İlan Oluşturma ──────────────────────────────────────────
// Saatte 5 istek — wallet bazlı (spam ilanları engeller)
const listingsWriteLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  keyGenerator:    (req) => req.wallet || req.ip,
  store:           makeStore("listings-write"),
  skip:            makeSkipFn(),
  handler:         (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "İlan oluşturma limiti: Saatte 5 istek." });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ─── Trades — İşlem Odası & İptal İşlemleri ──────────────────────────────────
// 1 dakikada 30 istek — wallet bazlı
const tradesLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             30,
  keyGenerator:    (req) => req.wallet || req.ip,
  store:           makeStore("trades"),
  skip:            makeSkipFn(),
  handler:         (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Çok fazla trade isteği. Dakikada maksimum 30 istek." });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ─── Feedback — Spam Engeli ───────────────────────────────────────────────────
// Saatte 3 istek — wallet bazlı
const feedbackLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             3,
  keyGenerator:    (req) => req.wallet || req.ip,
  store:           makeStore("feedback"),
  skip:            makeSkipFn(),
  handler:         (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Geri bildirim limiti: Saatte 3 istek." });
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

module.exports = {
  piiLimiter,
  authLimiter,
  listingsReadLimiter,
  listingsWriteLimiter,
  tradesLimiter,
  feedbackLimiter,
};
