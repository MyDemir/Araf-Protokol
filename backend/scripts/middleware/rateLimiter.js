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
const User = require("../models/User");
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
 * Legacy skip helper.
 * [TR] Yeni public limiter'lar process-local fallback kullandığı için fail-open kullanılmaz.
 * [EN] New public limiters use process-local fallback; fail-open is not used there.
 */
function makeSkipFn() {
  return () => {
    if (!isReady()) {
      logger.warn("[RateLimit] Redis erişilemez — skip path çağrıldı.");
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

  let fallbackModeLogged = false;

  return function inMemoryLimiter(req, res, next) {
    const now = Date.now();
    const key = keyGenerator(req);
    const current = bucket.get(key);

    if (!fallbackModeLogged) {
      logger.warn(`[RateLimit:${label}] Redis down — process-local fallback enabled.`);
      fallbackModeLogged = true;
    }

    if (!current || now > current.resetAt) {
      bucket.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;

    if (current.count > max) {
      logger.warn(`[RateLimit:${label}-FALLBACK] In-memory limit aşıldı: ${key}`);
      return res.status(429).json(errorMessage(req));
    }

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

const RATE_LIMIT_TIER_CACHE_TTL_SECONDS = Number(process.env.RATE_LIMIT_TIER_CACHE_TTL_SECONDS || 120);
const DEFAULT_ANON_TIER = 0;
const MIN_TIER = 0;
const MAX_TIER = 4;

function _safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampTier(value) {
  const tier = _safeInt(value, DEFAULT_ANON_TIER);
  return Math.max(MIN_TIER, Math.min(MAX_TIER, tier));
}

function normalizeTierFromMirror(mirrorUser) {
  const effectiveTier = _safeInt(mirrorUser?.reputation_cache?.effective_tier, DEFAULT_ANON_TIER);
  const maxAllowedTier = mirrorUser?.max_allowed_tier;
  const boundedTier = maxAllowedTier === undefined || maxAllowedTier === null
    ? effectiveTier
    : Math.min(effectiveTier, _safeInt(maxAllowedTier, MAX_TIER));
  return clampTier(boundedTier);
}

async function resolveRequestTier(req) {
  if (typeof req?.rateLimitTier === "number") return req.rateLimitTier;
  if (req?._rateLimitTierPromise) return req._rateLimitTierPromise;

  req._rateLimitTierPromise = (async () => {
    const normalizedWallet = String(req?.wallet || "").toLowerCase().trim();
    if (!normalizedWallet) {
      req.rateLimitTier = DEFAULT_ANON_TIER;
      return req.rateLimitTier;
    }

    const cacheKey = `ratelimit:tier:${normalizedWallet}`;
    if (isReady()) {
      try {
        const cachedTier = await getRedisClient().get(cacheKey);
        if (cachedTier !== null) {
          req.rateLimitTier = clampTier(cachedTier);
          return req.rateLimitTier;
        }
      } catch (err) {
        logger.warn(`[RateLimit:TIER] Redis cache read başarısız: ${err.message}`);
      }
    }

    try {
      const mirrorUser = await User.findOne({ wallet_address: normalizedWallet })
        .select("reputation_cache.effective_tier max_allowed_tier")
        .lean();
      req.rateLimitTier = normalizeTierFromMirror(mirrorUser);
    } catch (err) {
      // [TR] Tier çözümü mirror/caching bağımlılığıdır; request'i kırmak yerine güvenli tier0'a düş.
      // [EN] Tier resolution is auxiliary mirror/cache logic; degrade safely to tier0 instead of failing request.
      logger.warn(`[RateLimit:TIER] Mirror fallback başarısız, tier0 uygulanıyor: ${err.message}`);
      req.rateLimitTier = DEFAULT_ANON_TIER;
    }

    if (isReady()) {
      try {
        await getRedisClient().setEx(cacheKey, RATE_LIMIT_TIER_CACHE_TTL_SECONDS, String(req.rateLimitTier));
      } catch (err) {
        logger.warn(`[RateLimit:TIER] Redis cache write başarısız: ${err.message}`);
      }
    }

    return req.rateLimitTier;
  })();

  try {
    return await req._rateLimitTierPromise;
  } finally {
    // [TR] Aynı request boyunca duplicate DB read'i önlemek için promise cache kullanıyoruz.
    //      Request bitiminde bu internal alan temizlenir.
    // [EN] Promise cache prevents duplicate reads within the same request scope.
    delete req._rateLimitTierPromise;
  }
}

function makeTieredSensitiveLimiter({
  label,
  windowMs,
  keyGenerator,
  storePrefix,
  limitsByTier,
  errorMessageFactory,
}) {
  const handlersByTier = limitsByTier.map((tierMax, tierIndex) => {
    const redisLimiter = rateLimit({
      windowMs,
      max: tierMax,
      keyGenerator,
      store: makeStore(`${storePrefix}:t${tierIndex}`),
      skip: makeSkipFn(),
      handler: (req, res) => {
        onLimitReached(req);
        res.status(429).json(errorMessageFactory(req, { tier: tierIndex, max: tierMax, windowMs }));
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

    const inMemoryLimiter = makeInMemoryLimiter({
      label: `${label}:T${tierIndex}`,
      windowMs,
      max: tierMax,
      keyGenerator,
      errorMessage: (req) => errorMessageFactory(req, { tier: tierIndex, max: tierMax, windowMs }),
    });

    return makeSensitiveLimiter({
      label: `${label}:T${tierIndex}`,
      redisLimiter,
      inMemoryLimiter,
    });
  });

  return async (req, res, next) => {
    let tier = DEFAULT_ANON_TIER;
    try {
      tier = await resolveRequestTier(req);
    } catch (err) {
      logger.warn(`[RateLimit:${label}] Tier çözümü beklenmedik hatayla düştü, tier0 uygulanıyor: ${err.message}`);
    }
    const normalizedTier = clampTier(tier);
    return handlersByTier[normalizedTier](req, res, next);
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

// ─── SIWE Nonce Surface — Daha Dar Koruma ───────────────────────────────────
// 1 dakikada 6 istek — IP + wallet(query) kombinasyonu
// [TR] Nonce endpoint'i auth yüzeyinde en sık çağrılan noktalardan biri olduğu için
//      authLimiter korunurken ek route-spesifik limiter uygulanır.
// [EN] Keep authLimiter, add a route-specific limiter for nonce spray resistance.
const nonceRedisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  keyGenerator: (req) => `${req.ip}:${String(req.query?.wallet || "anon").toLowerCase()}`,
  store: makeStore("auth-nonce"),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Çok fazla nonce isteği. Lütfen kısa bir süre sonra tekrar deneyin." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const nonceInMemoryLimiter = makeInMemoryLimiter({
  label: "AUTH-NONCE",
  windowMs: 60 * 1000,
  max: 6,
  keyGenerator: (req) => `${req.ip}:${String(req.query?.wallet || "anon").toLowerCase()}`,
  errorMessage: () => ({
    error: "Çok fazla nonce isteği. Lütfen kısa bir süre sonra tekrar deneyin.",
  }),
});

const nonceLimiter = makeSensitiveLimiter({
  label: "AUTH-NONCE",
  redisLimiter: nonceRedisLimiter,
  inMemoryLimiter: nonceInMemoryLimiter,
});

// ─── Market Read Surface — Public Okuma ─────────────────────────────────────
// 1 dakikada 100 istek — IP bazlı
const marketReadRedisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.ip,
  store: makeStore("market-read"),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Çok fazla istek. Yavaşlayın." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const marketReadInMemoryLimiter = makeInMemoryLimiter({
  label: "MARKET-READ",
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.ip,
  errorMessage: () => ({
    error: "Çok fazla istek. Yavaşlayın.",
  }),
});

const marketReadLimiter = makeSensitiveLimiter({
  label: "MARKET-READ",
  redisLimiter: marketReadRedisLimiter,
  inMemoryLimiter: marketReadInMemoryLimiter,
});

// ─── Stats Read Surface — Public/Lightweight Telemetry ─────────────────────
const statsReadRedisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.ip,
  store: makeStore("stats-read"),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Stats isteği limiti aşıldı. Lütfen kısa bir süre sonra tekrar deneyin." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const statsReadInMemoryLimiter = makeInMemoryLimiter({
  label: "STATS-READ",
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.ip,
  errorMessage: () => ({
    error: "Stats isteği limiti aşıldı. Lütfen kısa bir süre sonra tekrar deneyin.",
  }),
});

const statsReadLimiter = makeSensitiveLimiter({
  label: "STATS-READ",
  redisLimiter: statsReadRedisLimiter,
  inMemoryLimiter: statsReadInMemoryLimiter,
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

const ordersWriteInMemoryLimiter = makeInMemoryLimiter({
  label: "ORDERS-WRITE",
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.wallet || req.ip,
  errorMessage: () => ({
    error: "Order oluşturma limiti: Saatte 5 istek.",
  }),
});

const ordersWriteLimiterWithFallback = makeSensitiveLimiter({
  label: "ORDERS-WRITE",
  redisLimiter: ordersWriteLimiter,
  inMemoryLimiter: ordersWriteInMemoryLimiter,
});

// ─── Orders Read Surface — Kullanıcıya Ait Listeleme (Paginated) ───────────
// [TR] /api/orders/my artık sayfalı olduğu için write-limit (5/saat) bu endpoint için
//      fazla dar kalıyordu. Read odaklı ayrı limit kullanıyoruz.
// [EN] /api/orders/my is paginated now; write-limit (5/hour) is too restrictive for reads.
//      Use a dedicated read-oriented limiter for user list pagination.
const ordersReadLimiter = makeTieredSensitiveLimiter({
  label: "ORDERS-READ",
  windowMs: 60 * 1000,
  keyGenerator: (req) => req.wallet || req.ip,
  storePrefix: "orders-read",
  // [TR] Tier-aware throughput farkı yalnız abuse/fair-use içindir; authority üretmez.
  // [EN] Tier-aware throughput only tunes fair-use capacity and remains non-authoritative.
  limitsByTier: [70, 110, 150, 190, 230],
  errorMessageFactory: (_req, { max }) => ({
    error: `Order okuma limiti aşıldı. Bu seviye için dakikada maksimum ${max} istek.`,
  }),
});

// ─── Room / Child Trade Read Surface ────────────────────────────────────────
// 1 dakikada 30 istek — wallet bazlı
const roomReadLimiter = makeTieredSensitiveLimiter({
  label: "ROOM-READ",
  windowMs: 60 * 1000,
  keyGenerator: (req) => req.wallet || req.ip,
  storePrefix: "room-read",
  limitsByTier: [20, 30, 40, 55, 70],
  errorMessageFactory: (_req, { max }) => ({
    error: `Trade okuma limiti aşıldı. Bu seviye için dakikada maksimum ${max} istek.`,
  }),
});

// ─── Receipt Upload — Write-adjacent Coordination Surface ──────────────────
// [TR] Dekont yükleme trade-room read yüzeyinden ayrıdır; write-adjacent kabul edilir.
//      Redis down olduğunda fail-open yapılmaz, in-memory fallback ile korunur.
// [EN] Receipt upload is separate from room reads; it is write-adjacent and protected with
//      in-memory fallback when Redis is unavailable.
const receiptUploadLimiter = makeTieredSensitiveLimiter({
  label: "RECEIPT-UPLOAD",
  windowMs: 10 * 60 * 1000,
  keyGenerator: (req) => req.wallet || req.ip,
  storePrefix: "receipt-upload",
  limitsByTier: [6, 8, 10, 12, 14],
  errorMessageFactory: (_req, { max }) => ({
    error: `Dekont yükleme limiti aşıldı. Bu seviye için 10 dakikada maksimum ${max} istek.`,
  }),
});

// ─── Coordination Write Surface (Cancel/Ack vb.) ────────────────────────────
const coordinationWriteLimiter = makeTieredSensitiveLimiter({
  label: "COORDINATION-WRITE",
  windowMs: 10 * 60 * 1000,
  keyGenerator: (req) => req.wallet || req.ip,
  storePrefix: "coordination-write",
  limitsByTier: [8, 12, 16, 20, 24],
  errorMessageFactory: (_req, { max }) => ({
    error: `Koordinasyon yazım limiti aşıldı. Bu seviye için 10 dakikada maksimum ${max} istek.`,
  }),
});

// ─── Admin Read-only Observability Surface ──────────────────────────────────
// [TR] Admin endpoint'leri public değildir; read-only olsa da hassas operasyonel metrik taşır.
//      Redis down durumunda fail-open yerine in-memory fallback uygulanır.
// [EN] Admin endpoints are not public; even read-only observability is protected via in-memory fallback.
const adminReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.wallet || req.ip,
  store: makeStore("admin-read"),
  skip: makeSkipFn(),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Admin gözlem limiti aşıldı. Kısa süre sonra tekrar deneyin." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminReadInMemoryLimiter = makeInMemoryLimiter({
  label: "ADMIN-READ",
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.wallet || req.ip,
  errorMessage: () => ({
    error: "Admin gözlem limiti aşıldı. Kısa süre sonra tekrar deneyin.",
  }),
});

const adminReadLimiterWithFallback = makeSensitiveLimiter({
  label: "ADMIN-READ",
  redisLimiter: adminReadLimiter,
  inMemoryLimiter: adminReadInMemoryLimiter,
});

// ─── Client Error Log Surface — Public Write (Telemetry) ───────────────────
const clientLogRedisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip,
  store: makeStore("client-log"),
  handler: (req, res) => {
    onLimitReached(req);
    res.status(429).json({ error: "Client log limiti aşıldı. Lütfen daha sonra tekrar deneyin." });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const clientLogInMemoryLimiter = makeInMemoryLimiter({
  label: "CLIENT-LOG",
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip,
  errorMessage: () => ({
    error: "Client log limiti aşıldı. Lütfen daha sonra tekrar deneyin.",
  }),
});

const clientLogLimiter = makeSensitiveLimiter({
  label: "CLIENT-LOG",
  redisLimiter: clientLogRedisLimiter,
  inMemoryLimiter: clientLogInMemoryLimiter,
});

// ─── Feedback — Spam Engeli ───────────────────────────────────────────────────
// Saatte 3 istek — wallet bazlı
const feedbackLimiter = makeTieredSensitiveLimiter({
  label: "FEEDBACK",
  windowMs: 60 * 60 * 1000,
  keyGenerator: (req) => req.wallet || req.ip,
  storePrefix: "feedback",
  limitsByTier: [2, 3, 4, 5, 6],
  errorMessageFactory: (_req, { max }) => ({
    error: `Geri bildirim limiti aşıldı. Bu seviye için saatte maksimum ${max} istek.`,
  }),
});

module.exports = {
  piiLimiter,
  authLimiter,
  nonceLimiter,
  marketReadLimiter,
  statsReadLimiter,
  ordersReadLimiter,
  ordersWriteLimiter: ordersWriteLimiterWithFallback,
  roomReadLimiter,
  receiptUploadLimiter,
  coordinationWriteLimiter,
  adminReadLimiter: adminReadLimiterWithFallback,
  clientLogLimiter,
  feedbackLimiter,
  __private: {
    clampTier,
    normalizeTierFromMirror,
    resolveRequestTier,
    RATE_LIMIT_TIER_CACHE_TTL_SECONDS,
  },
};
