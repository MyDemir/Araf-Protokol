// ─── config/db.js ─────────────────────────────────────────────────────────────
"use strict";

const mongoose = require("mongoose");
const logger   = require("../utils/logger");

let isConnected = false;
let listenersAttached = false;
let allowProcessExitOnDisconnect = true;

/**
 * MongoDB bağlantısını kurar.
 *
 * ALT-01 Fix: maxPoolSize 10 → 100 olarak güncellendi.
 *   ÖNCEKİ: maxPoolSize: 10 — eventListener replay sırasında paralel DB sorguları
 *   + gelen API istekleri 10 bağlantıyı tüketiyordu. Bağlantı havuzu dolunca tüm
 *   API istekleri serverSelectionTimeoutMS (5sn) sonra MongoTimeoutError ile çökertiyordu.
 *   ŞİMDİ: maxPoolSize: 100 — worker + API trafiğini kaldıracak kapasitede.
 *   (Gereksinimlere göre ayarlanabilir; production'da 50-200 arası önerilir.)
 *
 * ALT-04 Fix: socketTimeoutMS proxy süresiyle uyumlu hale getirildi.
 *   ÖNCEKİ: socketTimeoutMS: 45000 — Nginx/Cloudflare önündeki proxy genellikle
 *   30sn timeout ile bağlantıyı kesiyordu. 35sn süren bir sorgu için kullanıcı
 *   bağlantısı kopuyordu ama Mongoose beklemeye devam ediyordu (zombi sorgu).
 *   ŞİMDİ: socketTimeoutMS: 20000 — proxy zaman aşımının (30sn) altında.
 *
 * ALT-05 Fix: Disconnected event'inde Fail-Fast stratejisi.
 *   ÖNCEKİ: isConnected = false yapılıp sadece uyarı loglanıyordu. Mongoose
 *   otomatik reconnect yaparken başka yerden connectDB() çağrılırsa iki paralel
 *   bağlantı havuzu oluşuyor, "Topology Destroyed" hatası ve memory leak çıkıyordu.
 *   ŞİMDİ: Disconnected'da process.exit(1) — PM2/Docker container'ı temiz başlatır.
 *   Bu bulut mimarisinde en güvenilir yaklaşımdır (Fail-Fast).
 *
 * V3 Notu:
 *   Bu dosya protokol semantiğinden büyük ölçüde bağımsızdır.
 *   Parent Order + Child Trade mimarisi connection davranışını değiştirmez;
 *   fakat event replay + order/trade mirror yükü nedeniyle havuz kapasitesi ve
 *   fail-fast yaklaşımı daha da önemli hale gelir.
 */
async function connectDB() {
  if (isConnected || mongoose.connection.readyState === 1) {
    isConnected = true;
    return mongoose.connection;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI ortam değişkeni zorunludur.");

  // [TR] Sorgu davranışını daha öngörülebilir kıl.
  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    // ALT-01 Fix: Worker + API trafiğini kaldıracak bağlantı havuzu
    maxPoolSize:              100,
    // ALT-04 Fix: Proxy zaman aşımı (30sn) altında soket zaman aşımı
    socketTimeoutMS:          20_000,
    serverSelectionTimeoutMS:  5_000,
  });

  isConnected = true;
  // [TR] Kimlik bilgilerini loglamaktan kaçın (@ işaretinden sonrasını al)
  logger.info(`[DB] MongoDB bağlantısı kuruldu: ${uri.split("@").pop()}`);

  if (!listenersAttached) {
    mongoose.connection.on("error", (err) => {
      logger.error(`[DB] Bağlantı hatası: ${err.message}`);
    });

    // ALT-05 Fix: Bağlantı koptuğunda Fail-Fast — temiz yeniden başlatma
    // ÖNCEKİ: isConnected = false + uyarı logu → parallel reconnect riski
    // ŞİMDİ: process.exit(1) → PM2 veya Docker container'ı otomatik yeniden başlatır
    mongoose.connection.on("disconnected", () => {
      isConnected = false;
      if (allowProcessExitOnDisconnect) {
        logger.error("[DB] MongoDB bağlantısı koptu — süreç sonlandırılıyor (Fail-Fast).");
        logger.error("[DB] PM2 veya Docker bu süreci otomatik yeniden başlatmalı.");
        process.exit(1);
      } else {
        logger.warn("[DB] MongoDB disconnected during graceful shutdown; fail-fast exit suppressed.");
      }
    });

    listenersAttached = true;
  }

  return mongoose.connection;
}

function setAllowProcessExitOnDisconnect(allow) {
  allowProcessExitOnDisconnect = Boolean(allow);
}

module.exports = { connectDB, setAllowProcessExitOnDisconnect };
