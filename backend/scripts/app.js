"use strict";

require("dotenv").config();
const express       = require("express");
const helmet        = require("helmet");
const cors          = require("cors");
const mongoSanitize = require("express-mongo-sanitize");
const mongoose      = require("mongoose");
// AUDIT FIX F-01: httpOnly cookie desteği için cookie-parser
// Kurulum: npm install cookie-parser
const cookieParser  = require("cookie-parser");

// Yapılandırma ve Yardımcı Araçlar
const { connectDB }    = require("./config/db");
const { connectRedis } = require("./config/redis");
const logger           = require("./utils/logger");

// Zincir Dinleyici (Worker)
const worker = require("./services/eventListener");

// YENİ MİMARİ: On-Chain protokol parametrelerini yükler
const { loadProtocolConfig } = require("./services/protocolConfig");

// H-06 Fix: DLQ Processor — başarısız event'leri izler ve alert gönderir
const { processDLQ } = require("./services/dlqProcessor");

// AFS-008 Fix: Dosya artık doğru dizinde — backend/scripts/jobs/reputationDecay.js
// Önceki: backend/scripts/jops/reputationDecay.js (typo: jops → jobs)
// AUDIT FIX C-03B: Bu görev RELAYER_PRIVATE_KEY kullanıyor.
// Testnet: Dokümantasyon "Quasi-Zero Key" olarak güncellendi.
// Mainnet: Gelato/Chainlink Automation'a taşınacak (gerçek zero-key).
const { runReputationDecay } = require("./jobs/reputationDecay");

// AFS-007 Fix: Dosya artık doğru dizinde — backend/scripts/jobs/statsSnapshot.js
// Önceki: backend/scripts/routes/statsSnapshot.js (route değil, job)
const { runStatsSnapshot } = require("./jobs/statsSnapshot");

// Hata Yönetimi
const { globalErrorHandler } = require("./middleware/errorHandler");

const app = express();

// ── SEC-04 Fix: Trust Proxy ─────────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// ── GÜVENLİK MIDDLEWARE ───────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "https:"],
    },
  },
  hsts: process.env.NODE_ENV === "production"
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map(o => o.trim())
  .filter(o => o.length > 0);

if (process.env.NODE_ENV === "production") {
  if (allowedOrigins.includes("*")) {
    logger.error("[GÜVENLİK] CORS wildcard (*) production'da kullanılamaz! Sunucu durduruluyor.");
    process.exit(1);
  }
  if (allowedOrigins.length === 0) {
    logger.error("[GÜVENLİK] ALLOWED_ORIGINS boş! En az bir origin tanımlayın.");
    process.exit(1);
  }
  for (const origin of allowedOrigins) {
    if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
      logger.error(`[GÜVENLİK] Geçersiz CORS origin: "${origin}" — http:// veya https:// ile başlamalı.`);
      process.exit(1);
    }
  }
  logger.info(`[CORS] İzin verilen origin'ler: ${allowedOrigins.join(", ")}`);
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
}));

app.use(express.json({ limit: "50kb" }));

// AUDIT FIX F-01: Cookie parser — httpOnly JWT cookie'leri okumak için
app.use(cookieParser());

app.use(mongoSanitize({
  replaceWith: "_",
  onSanitize: ({ key }) => logger.warn(`[GÜVENLİK] Mongo injection denemesi engellendi: ${key}`),
}));

// ── BAŞLATMA VE ROTA ENTEGRASYONU ─────────────────────────────────────────────

async function bootstrap() {
  try {
    // SEC-14 Fix: Production'da SIWE_DOMAIN kontrolü
    if (process.env.NODE_ENV === "production") {
      const siweDomain = process.env.SIWE_DOMAIN;
      if (!siweDomain || siweDomain === "localhost") {
        logger.error("[GÜVENLİK] SIWE_DOMAIN production'da 'localhost' olamaz! Gerçek domain ayarlayın.");
        process.exit(1);
      }
    }

    // 1. Veritabanı ve Redis bağlantılarını kur
    await connectDB();
    await connectRedis();
    logger.info("MongoDB ve Redis bağlantıları başarıyla sağlandı.");

    // YENİ MİMARİ: Protokol parametrelerini on-chain'den yükle
    await loadProtocolConfig();

    // 2. Event Listener'ı Başlat
    await worker.start();
    logger.info("Event Listener (Zincir Dinleyici) aktif: Base L2 ağı izleniyor.");

    // H-06 Fix: DLQ processor — her 60 saniyede bir çalışır
    const dlqInterval = setInterval(processDLQ, 60_000);

    // AUDIT FIX B-05: Periyodik job'lar geciktirilmiş başlatma.
    // ÖNCEKİ: runReputationDecay() ve runStatsSnapshot() hemen çalışıyordu.
    //   Sorun: Sunucu başlarken event replay + config load + 3 paralel aggregation
    //   aynı anda MongoDB'ye ağır yük bindiriyordu → cold start timeout (Fly.io 15s).
    // ŞİMDİ: İlk çalıştırma 30 saniye geciktirildi.

    // Reputation Decay Job — her 24 saatte bir çalışır
    const reputationDecayDelay = setTimeout(() => {
      runReputationDecay(); // İlk çalıştırma (30s gecikme sonrası)
      logger.info("Periyodik İtibar İyileştirme görevi zamanlandı (her 24 saatte bir).");
    }, 30_000); // AUDIT FIX B-05: 30 saniye gecikme
    const reputationDecayInterval = setInterval(runReputationDecay, 24 * 60 * 60 * 1000);

    // Stats Snapshot Job — her 24 saatte bir çalışır
    const statsSnapshotDelay = setTimeout(() => {
      runStatsSnapshot(); // İlk çalıştırma (60s gecikme sonrası)
      logger.info("Periyodik İstatistik Kaydetme görevi zamanlandı (her 24 saatte bir).");
    }, 60_000); // AUDIT FIX B-05: 60 saniye gecikme (reputation decay'den 30s sonra)
    const statsSnapshotInterval = setInterval(runStatsSnapshot, 24 * 60 * 60 * 1000);

    // 3. Rotaları İçeri Aktar (Redis ve DB hazır olduktan sonra)
    const authRoutes     = require("./routes/auth");
    const listingRoutes  = require("./routes/listings");
    const tradeRoutes    = require("./routes/trades");
    const piiRoutes      = require("./routes/pii");
    const feedbackRoutes = require("./routes/feedback");
    const statsRoutes    = require("./routes/stats");

    // 4. API Endpoint'lerini Bağla
    app.use("/api/auth",     authRoutes);
    app.use("/api/listings", listingRoutes);
    app.use("/api/trades",   tradeRoutes);
    app.use("/api/pii",      piiRoutes);
    app.use("/api/feedback", feedbackRoutes);
    app.use("/api/stats",    statsRoutes);

    // ── SAĞLIK KONTROLÜ VE HATA YÖNETİMİ ───────────────────────────────────

    app.get("/health", (req, res) => res.json({
      status:    "ok",
      worker:    "active",
      timestamp: new Date().toISOString(),
    }));

    app.use((req, res) => res.status(404).json({ error: "İstenen endpoint bulunamadı" }));

    app.use(globalErrorHandler);

    // 5. SUNUCUYU BAŞLAT
    const PORT   = process.env.PORT || 4000;
    const server = app.listen(PORT, () => {
      logger.info(`===========================================================`);
      logger.info(`🚀 Araf Protocol Backend Dinleniyor: Port ${PORT}`);
      logger.info(`🌍 Ortam: ${process.env.NODE_ENV || 'development'}`);
      logger.warn(`🛡️  Güvenlik: Zero Private Key Modu Aktif.`);
      logger.info(`===========================================================`);
    });

    // L-03 Fix: Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} alındı. Graceful shutdown başlıyor...`);
      clearInterval(dlqInterval);
      clearTimeout(reputationDecayDelay);  // AUDIT FIX B-05
      clearInterval(reputationDecayInterval);
      clearTimeout(statsSnapshotDelay);    // AUDIT FIX B-05
      clearInterval(statsSnapshotInterval);
      server.close(async () => {
        await worker.stop();
        await mongoose.connection.close();
        logger.info("Tüm bağlantılar kapatıldı. Çıkış yapılıyor.");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT",  () => shutdown("SIGINT"));

  } catch (err) {
    logger.error("Uygulama başlatılırken kritik hata oluştu:", err);
    process.exit(1);
  }
}

bootstrap();

module.exports = app;
