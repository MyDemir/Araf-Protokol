"use strict";

/**
 * DLQ Processor — Dead Letter Queue Monitor
 *
 * H-06 Fix: Başarısız event'ler eventListener tarafından Redis DLQ'ya yazılır.
 * Bu servis periyodik olarak DLQ'yu kontrol eder, birikmiş entry'leri loglar
 * ve eşik aşıldığında uyarı verir.
 *
 * app.js tarafından setInterval(processDLQ, 60_000) ile çağrılır.
 *
 * Gelecek: Slack/PagerDuty webhook entegrasyonu için ALERT_WEBHOOK_URL .env'e eklenebilir.
 */

const { getRedisClient } = require("../config/redis");
const logger             = require("../utils/logger");

const DLQ_KEY         = "worker:dlq";
const ALERT_THRESHOLD = 5; // Bu sayının üzerinde entry varsa uyarı ver

/**
 * DLQ'daki tüm entry'leri okur, loglar ve eşik aşıldıysa alert gönderir.
 * Entry'leri kuyruktan çıkarmaz — sadece izler (non-destructive monitoring).
 */
async function processDLQ() {
  try {
    const redis  = getRedisClient();
    const length = await redis.lLen(DLQ_KEY);

    if (length === 0) {
      logger.debug("[DLQ] Kuyruk temiz.");
      return;
    }

    logger.warn(`[DLQ] ${length} işlenemeyen event bulundu.`);

    // Son 10 entry'yi logla (listeyi boşaltmadan)
    const entries = await redis.lRange(DLQ_KEY, 0, 9);
    for (const raw of entries) {
      try {
        const entry = JSON.parse(raw);
        logger.error(`[DLQ] Event: ${entry.eventName} | tx: ${entry.txHash} | blok: ${entry.blockNumber} | hata: ${entry.error} | zaman: ${entry.timestamp}`);
      } catch {
        logger.error(`[DLQ] Ham entry parse edilemedi: ${raw}`);
      }
    }

    // Eşik aşıldıysa daha acil uyarı ver
    if (length >= ALERT_THRESHOLD) {
      logger.error(`[DLQ] ⚠ KRİTİK: DLQ'da ${length} event birikti! Manuel müdahale gerekebilir.`);
      // TODO: Slack/PagerDuty webhook gönderimi buraya eklenecek
      // await sendAlert(`DLQ kritik seviye: ${length} işlenemeyen event`);
    }
  } catch (err) {
    logger.error(`[DLQ] Processor hatası: ${err.message}`);
  }
}

module.exports = { processDLQ };
