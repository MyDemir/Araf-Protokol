// ─── config/redis.js ──────────────────────────────────────────────────────────
"use strict";

const { createClient } = require("redis");
const logger = require("../utils/logger");

let redisClient = null;
let listenersAttached = false;
let connectPromise = null;

/**
 * Redis bağlantısını kurar.
 *
 * ALT-02 Fix: Rate Limiter için Tek Nokta Hatası ortadan kaldırıldı.
 *   ÖNCEKİ: Redis saniyelik kesintide RedisStore hata fırlatıyor, tüm
 *   rate limiter middleware'ler çöküyor, tüm endpoint'ler 500 dönüyordu.
 *   ŞİMDİ: isReady() fonksiyonu eklendi. rateLimiter.js bu fonksiyonu
 *   kontrol ederek Redis erişilemezse fail-open davranışına geçiyor.
 *
 * ALT-03 Fix: Üretim TLS desteği eklendi.
 *   ÖNCEKİ: createClient({ url }) — TLS ayarı yoktu. AWS ElastiCache,
 *   Upstash gibi managed servislerde rediss:// (TLS) zorunludur. Eksik
 *   TLS ayarı sertifika hatasıyla sessiz timeout'a yol açıyordu.
 *   ŞİMDİ: REDIS_URL'de "rediss://" prefix'i varsa otomatik TLS aktif.
 *   REDIS_TLS_SKIP_VERIFY=true ile self-signed sertifikaları da destekleniyor
 *   (sadece geliştirme için — production'da kullanmayın).
 *
 * V3 Notu:
 *   Redis artık yalnız rate limit için değil; event checkpoint, DLQ,
 *   mutable protocol config cache ve worker koordinasyonu için de kullanılıyor.
 *   Bu nedenle "bağlı mı?" sorusundan çok "hazır mı?" sorusu önemlidir.
 */
async function connectRedis() {
  if (redisClient?.isReady) {
    return redisClient;
  }

  if (connectPromise) {
    return connectPromise;
  }

  if (redisClient?.isOpen && !redisClient.isReady) {
    logger.warn("[Redis] Mevcut client açık ama hazır değil — hazır hale gelmesi bekleniyor.");
    return redisClient;
  }

  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";

  // ALT-03 Fix: TLS desteği — rediss:// prefix'i veya REDIS_TLS=true
  const useTLS = url.startsWith("rediss://") || process.env.REDIS_TLS === "true";

  const clientOptions = { url };

  if (useTLS) {
    clientOptions.socket = {
      tls: true,
      // [TR] REDIS_TLS_SKIP_VERIFY sadece self-signed sertifikaları olan
      // geliştirme ortamları için. PRODUCTION'DA KULLANMAYIN.
      rejectUnauthorized: process.env.REDIS_TLS_SKIP_VERIFY !== "true",
    };
    logger.info("[Redis] TLS modu aktif.");
  }

  redisClient = createClient(clientOptions);

  if (!listenersAttached) {
    redisClient.on("error",        (err) => logger.error(`[Redis] Hata: ${err.message}`));
    redisClient.on("connect",      ()    => logger.info("[Redis] Bağlantı kuruldu."));
    redisClient.on("reconnecting", ()    => logger.warn("[Redis] Yeniden bağlanıyor..."));
    redisClient.on("ready",        ()    => logger.info("[Redis] Hazır."));
    listenersAttached = true;
  }

  connectPromise = redisClient.connect()
    .then(() => redisClient)
    .finally(() => {
      connectPromise = null;
    });

  await connectPromise;
  return redisClient;
}

function getRedisClient() {
  if (!redisClient) {
    throw new Error("Redis başlatılmamış. Önce connectRedis() çağrılmalı.");
  }
  return redisClient;
}

/**
 * ALT-02 Fix: Redis'in kullanıma hazır olup olmadığını kontrol eder.
 * rateLimiter.js bu fonksiyonu kullanarak Redis erişilemezse
 * rate limiting'i atlayabilir (fail-open) — platform erişilemez olmasın.
 *
 * @returns {boolean} Redis bağlı ve hazırsa true
 */
function isReady() {
  try {
    return redisClient?.isReady === true;
  } catch {
    return false;
  }
}

/**
 * Uygulama kapanırken Redis istemcisini zarif şekilde kapatır.
 *
 * V3 Notu:
 *   Worker checkpoint ve DLQ flush mantığı shutdown sırasına bağımlı olabilir.
 *   Bu yüzden app.js tarafında mümkünse quit() çağrısı yapılmalıdır.
 */
async function closeRedis() {
  if (!redisClient) return;

  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
      logger.info("[Redis] Bağlantı kapatıldı.");
    }
  } catch (err) {
    logger.warn(`[Redis] Kapatma hatası: ${err.message}`);
  } finally {
    redisClient = null;
    listenersAttached = false;
    connectPromise = null;
  }
}

module.exports = { connectRedis, getRedisClient, isReady, closeRedis };
