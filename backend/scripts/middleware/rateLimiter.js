"use strict";

/*
## rateLimiter.js hardening

This PR updates `backend/scripts/middleware/rateLimiter.js` to preserve the previous Redis degradation strategy for general endpoints while introducing stricter protection for the auth surface.

### Previous behavior
The limiter used a single Redis availability strategy for all routes:

- if Redis was unavailable, `makeSkipFn()` skipped rate limiting entirely
- this kept the platform reachable
- but it also made auth endpoints effectively fail-open

That meant `/nonce`, `/verify`, and `/refresh` could become temporarily unprotected during Redis outages.

### Existing fix that remains
The earlier fix for proxy/load-balancer environments still stands:

- rate limit keys are still based on `req.ip`
- this assumes `trust proxy` is correctly enabled in `app.js`
- without that, all users behind the same proxy/load balancer could collapse into one IP bucket

That part is preserved and not changed here.

### New behavior
This PR keeps fail-open behavior for general/public routes, but separates auth from that policy.

New behavior:

- public and lower-risk routes still use the general Redis-based skip strategy
- auth routes now use a dedicated fallback path when Redis is unavailable
- an in-memory limiter is introduced for auth traffic
- if Redis is down, auth requests are no longer fully unbounded
- if the in-memory auth limit is exceeded, the request is rejected with `429`

### Effect
This keeps the original availability goal for the wider platform while preventing the auth surface from becoming completely unprotected during Redis degradation.

### Scope
Only `backend/scripts/middleware/rateLimiter.js` was targeted here.

### V3 note
Bu middleware, V3 order + child trade mimarisine göre adlandırma genişletmesi alır:
- market read yüzeyi,
- order creation yüzeyi,
- child trade / room yüzeyi
ayrı ama uyumlu limit kümeleriyle yönetilir.

Backend burada authority üretmez; yalnız abuse yüzeyini daraltır.
*/

const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { getRedisClient, isReady } = require("../config/redis");
const logger = require("../utils/logger");

/**
 * Redis store oluşturur.
 */
function makeStore(prefix) {
  return new RedisStore({
    sendCommand: (...args) => getRedisClient().sendCommand(args),
    prefix: `rl:${prefix}:`,
  });
}

/**
 * Genel endpoint'ler için Redis yoksa limiter geçici olarak devre dışı kalır.
 * Bu tercih public/read ağırlıklı yüzeylerde erişilebilirliği korur.
 */
function makeSkipFn() {
  return () => {
    if (!isReady()) {
      logger.warn("[RateLimit] Redis erişilemez — rate limiting geçici olarak devre dışı (fail-open).");
      return true;
    }
    return false;
  };
}

function onLimitReached(req) {
  logger.warn(
    `[RateLimit] Engellendi: ${req.ip} | ${req.path} | wallet: ${req.wallet || "anon"}`
  );
}

/**
 * In-memory fallback bucket yardımcıları.
 *
 * [TR] Redis down olduğunda auth / PII gibi hassas yüzeyleri tamamen serbest bırakmıyoruz.
 *      Bunun yerine proses-içi geçici sayaç kullanıyoruz.
 *
 * [EN] When Redis is down, sensitive surfaces such as auth / PII do not fail-open.
 *      They fall back to a process-local temporary counter.
 */
function makeInMemoryLimiter({
  label,
  windowMs,
  max,
  keyGenerator,
  errorMessage,
}) {
  const bucket = new Map(); // key -> { count, resetAt }

  function cleanupExpiredEntries() {
    const now = Date.now();
    for (const [key, entry] of bucket.entries()) {
      if (now > entry.resetAt) {
        bucket.delete(key);
      }
    }
  }

  // [TR] Cleanup timer prosesin kapanmasını engellemesin.
  // [EN] Timer should not keep the process alive on shutdown.
  const interval = setInterval(cleanupExpiredEntries, Math.max(windowMs, 60_000));
  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return function inMemoryLimiter(req, res, next) {
    const now = Date.now();
    const key = keyGenerator(req);
    const current = bucket.get(key);

    if (!current || now > current.resetAt) {
      bucket.set(key, { count: 1, resetAt: now + windowMs });
      logger.warn(`[RateLimit:${label}] Redis erişilemez — in-memory fallback aktif.`);
      return next();
    }

    current.count += 1;

    if (current.count > max) {
      logger.warn(`[RateLimit:${label}-FALLBACK] In-memory limit aşıldı: ${key}`);
      return res.status(429).json(errorMessage(req));
    }

    logger.warn(`[RateLimit:${label}] Redis erişilemez — in-memory fallback aktif.`);
    return next();
  };
}

/**
 * [TR] Redis varsa normal Redis-backed limiter, yoksa in-memory fallback çalıştırır.
 * [EN] Uses Redis-backed limiter when Redis is ready, otherwise falls back to in-memory protection.
 */
function makeSensitiveLimiter({
  label,
  redisLimiter,
  inMemoryLimiter,
}) {
  return (req, res, next) => {
    if (isReady()) {
      return redisLimiter(req, res, next);
    }
    return inMemoryLimiter(req, res, next);
  };
}

// ─── PII / IBAN Endpoint — En Sıkı ───────────────────────────────────────────
// 10 dakikada 3 istek — IP + wallet kombinasyonu
const piiRedisLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `${req.ip}:${req.wallet || "anon"}`,
  store: makeStore("pii"),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({
      error: "Çok fazla PII isteği. 10 dakikada maksimum 3 istek.",
      retryAfter: Math.ceil(10 * 60),
    });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const piiInMemoryLimiter = makeInMemoryLimiter({
  label: "PII",
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `${req.ip}:${req.wallet || "anon"}`,
  errorMessage: () => ({
    error: "Çok fazla PII isteği. 10 dakikada maksimum 3 istek.",
    retryAfter: Math.ceil(10 * 60),
  }),
});

const piiLimiter = makeSensitiveLimiter({
  label: "PII",
  redisLimiter: piiRedisLimiter,
  inMemoryLimiter: piiInMemoryLimiter,
});

// ─── SIWE Auth — Brute Force Koruması ────────────────────────────────────────
// 1 dakikada 10 istek — IP bazlı
const authRedisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip,
  store: makeStore("auth"),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Çok fazla auth isteği. 1 dakika sonra tekrar deneyin." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const authInMemoryLimiter = makeInMemoryLimiter({
  label: "AUTH",
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip,
  errorMessage: () => ({
    error: "Çok fazla auth isteği. 1 dakika sonra tekrar deneyin.",
  }),
});

const authLimiter = makeSensitiveLimiter({
  label: "AUTH",
  redisLimiter: authRedisLimiter,
  inMemoryLimiter: authInMemoryLimiter,
});

// ─── Market Read Surface — Public Okuma ─────────────────────────────────────
// 1 dakikada 100 istek — IP bazlı
const marketReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.ip,
  store: makeStore("market-read"),
  skip: makeSkipFn(),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Çok fazla istek. Yavaşlayın." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Orders Write Surface — Parent Order Oluşturma / Güncelleme ─────────────
// Saatte 5 istek — wallet bazlı
const ordersWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.wallet || req.ip,
  store: makeStore("orders-write"),
  skip: makeSkipFn(),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Order oluşturma limiti: Saatte 5 istek." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Trades / Child Trade Room Surface ──────────────────────────────────────
// 1 dakikada 30 istek — wallet bazlı
const tradesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.wallet || req.ip,
  store: makeStore("trades"),
  skip: makeSkipFn(),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Çok fazla trade isteği. Dakikada maksimum 30 istek." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Feedback — Spam Engeli ───────────────────────────────────────────────────
// Saatte 3 istek — wallet bazlı
const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.wallet || req.ip,
  store: makeStore("feedback"),
  skip: makeSkipFn(),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Geri bildirim limiti: Saatte 3 istek." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Backward-compatible aliases ──────────────────────────────────────────────
// [TR] Route katmanını bir turda tamamen taşımak zorunda kalmamak için alias veriyoruz.
// [EN] Aliases keep existing imports working while routes migrate toward V3 naming.
const listingsReadLimiter = marketReadLimiter;
const listingsWriteLimiter = ordersWriteLimiter;

module.exports = {
  piiLimiter,
  authLimiter,
  marketReadLimiter,
  ordersWriteLimiter,
  listingsReadLimiter,
  listingsWriteLimiter,
  tradesLimiter,
  feedbackLimiter,
};
