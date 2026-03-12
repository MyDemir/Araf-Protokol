"use strict";

require("dotenv").config();
const express       = require("express");
const helmet        = require("helmet");
const cors          = require("cors");
const mongoSanitize = require("express-mongo-sanitize");
const mongoose      = require("mongoose"); // L-03 Fix: graceful shutdown için

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

// YENİ: Reputation Decay Job — zamanla itibarı iyileştirir
const { runReputationDecay } = require("./jobs/reputationDecay");


// YENİ: Stats Snapshot Job — günlük istatistikleri kaydeder
const { runStatsSnapshot } = require("./jobs/statsSnapshot");

// Hata Yönetimi
const { globalErrorHandler } = require("./middleware/errorHandler");

const app = express();

// ── SEC-04 Fix: Trust Proxy — Reverse proxy arkasında gerçek IP'yi al ─────────
// Cloudflare, Nginx veya AWS ALB arkasında çalışıyorsa X-Forwarded-For header'ını
// güvenilir kabul eder. Bu olmadan rate limiter req.ip olarak proxy IP'sini görür
// ve tüm kullanıcılar aynı IP'den geliyormuş gibi algılanır.
// Tek proxy katmanı için 1, birden fazla proxy varsa proxy sayısını girin.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// ── GÜVENLİK MIDDLEWARE ───────────────────────────────────────────────────────

/**
 * Helmet: HTTP başlıklarını güvenli hale getirir.
 * CSP ayarları frontend'in API ve görsel kaynaklarına erişimine izin verir.
 *
 * SEC-11 Fix: Production'da HSTS header'ı ekleyerek HTTPS zorlaması sağlar.
 */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "https:"],
    },
  },
  // SEC-11 Fix: HSTS — tarayıcıya "bu siteye sadece HTTPS üzerinden eriş" der.
  // max-age: 1 yıl, includeSubDomains: alt alan adları dahil.
  // Production'da reverse proxy (Nginx/Cloudflare) TLS termination yapar;
  // bu header tarayıcı tarafını güvence altına alır.
  hsts: process.env.NODE_ENV === "production"
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));

/**
 * SEC-03 Fix: CORS — Güçlendirilmiş origin doğrulaması.
 * Sadece izin verilen kökenlerden (Origins) gelen isteklere izin verir.
 * Codespaces veya local ortamlar için ALLOWED_ORIGINS .env içinde tanımlanmalıdır.
 *
 * Eklenen güvenlik katmanları:
 *   - Wildcard (*) kullanımı production'da engellenir
 *   - Boş veya geçersiz origin'ler filtrelenir
 *   - Origin listesi uygulama başlangıcında doğrulanır
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map(o => o.trim())
  .filter(o => o.length > 0);

// SEC-03 Fix: Production'da wildcard origin veya boş liste kontrolü
if (process.env.NODE_ENV === "production") {
  if (allowedOrigins.includes("*")) {
    logger.error("[GÜVENLİK] CORS wildcard (*) production'da kullanılamaz! Sunucu durduruluyor.");
    process.exit(1);
  }
  if (allowedOrigins.length === 0) {
    logger.error("[GÜVENLİK] ALLOWED_ORIGINS boş! En az bir origin tanımlayın.");
    process.exit(1);
  }
  // Her origin'in geçerli bir URL olup olmadığını kontrol et
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

// İstek gövdesi limitini 50kb ile sınırlayarak DoS saldırılarını önler.
app.use(express.json({ limit: "50kb" }));

/**
 * Mongo Sanitize: MongoDB Injection saldırılarını ($gt, $where vb.) engeller.
 */
app.use(mongoSanitize({
  replaceWith: "_",
  onSanitize: ({ key }) => logger.warn(`[GÜVENLİK] Mongo injection denemesi engellendi: ${key}`),
}));

// ── BAŞLATMA VE ROTA ENTEGRASYONU ─────────────────────────────────────────────

/**
 * bootstrap: Uygulamanın tüm bileşenlerini sırasıyla ayağa kaldırır.
 *
 * SEC-14 Fix: SIWE_DOMAIN production'da zorunlu — ayarlanmamışsa sunucu başlamaz.
 */
async function bootstrap() {
  try {
    // SEC-14 Fix: Production'da SIWE_DOMAIN kontrolü — phishing koruması için zorunlu
    if (process.env.NODE_ENV === "production") {
      const siweDomain = process.env.SIWE_DOMAIN;
      if (!siweDomain || siweDomain === "localhost") {
        logger.error("[GÜVENLİK] SIWE_DOMAIN production'da 'localhost' olamaz! Gerçek domain ayarlayın.");
        process.exit(1);
      }
    }

    // 1. ÖNCE Veritabanı ve Redis bağlantılarını kur (Sıralama kritiktir)
    await connectDB();
    await connectRedis();
    logger.info("MongoDB ve Redis bağlantıları başarıyla sağlandı.");

    // YENİ MİMARİ: Protokol parametrelerini on-chain'den yükle
    // Bu, diğer servisler başlamadan ÖNCE yapılmalıdır.
    await loadProtocolConfig();

    // 2. Event Listener'ı (Zincir Dinleyici) Başlat
    // DB ve Redis hazır olduktan sonra, kaçırılan blokları taramaya ve canlı dinlemeye başlar.
    await worker.start();
    logger.info("Event Listener (Zincir Dinleyici) aktif: Base L2 ağı izleniyor.");

    // H-06 Fix: DLQ processor — her 60 saniyede bir çalışır, biriken başarısız event'leri raporlar
    const dlqInterval = setInterval(processDLQ, 60_000);

    // YENİ: Reputation Decay Job — her 24 saatte bir çalışır
    // Sunucu başlar başlamaz ilk çalıştırmayı yap, sonra periyodik olarak devam et.
    runReputationDecay(); // İlk çalıştırma
    const reputationDecayInterval = setInterval(runReputationDecay, 24 * 60 * 60 * 1000); // 24 saat
    logger.info("Periyodik İtibar İyileştirme görevi zamanlandı (her 24 saatte bir).");

    // YENİ: Stats Snapshot Job — her 24 saatte bir çalışır
    runStatsSnapshot(); // Sunucu başlarken ilk çalıştırma
    const statsSnapshotInterval = setInterval(runStatsSnapshot, 24 * 60 * 60 * 1000); // 24 saat
    logger.info("Periyodik İstatistik Kaydetme görevi zamanlandı (her 24 saatte bir).");

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
    app.use("/api/stats",    statsRoutes);    // Herkese açık — auth gerektirmez

    // ── SAĞLIK KONTROLÜ VE HATA YÖNETİMİ ───────────────────────────────────────

    // Uygulamanın ve ağın durumunu kontrol etmek için
    app.get("/health", (req, res) => res.json({
      status:    "ok",
      worker:    "active",
      timestamp: new Date().toISOString(),
    }));

    // Tanımlanmayan rotalar için 404
    app.use((req, res) => res.status(404).json({ error: "İstenen endpoint bulunamadı" }));

    // Tüm uygulamayı kapsayan global hata yakalayıcı
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

    // L-03 Fix: Graceful shutdown — SIGTERM/SIGINT sinyallerinde temiz kapanış
    // Kubernetes/Docker ortamlarında pod'un sağlıklı kapanmasını sağlar.
    const shutdown = async (signal) => {
      logger.info(`${signal} alındı. Graceful shutdown başlıyor...`);
      clearInterval(dlqInterval);
      clearInterval(reputationDecayInterval); // Zamanlayıcıyı temizle
      clearInterval(statsSnapshotInterval); // Zamanlayıcıyı temizle
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
    process.exit(1); // Kritik hatada süreci durdur
  }
}

// Uygulamayı ateşle
bootstrap();

module.exports = app;
