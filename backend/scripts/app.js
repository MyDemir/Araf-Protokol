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

// H-06 Fix: DLQ Processor — başarısız event'leri izler ve alert gönderir
const { processDLQ } = require("./services/dlqProcessor");

// Hata Yönetimi
const { globalErrorHandler } = require("./middleware/errorHandler");

const app = express();

// ── GÜVENLİK MIDDLEWARE ───────────────────────────────────────────────────────

/**
 * Helmet: HTTP başlıklarını güvenli hale getirir.
 * CSP ayarları frontend'in API ve görsel kaynaklarına erişimine izin verir.
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
}));

/**
 * CORS: Sadece izin verilen kökenlerden (Origins) gelen isteklere izin verir.
 * Codespaces veya local ortamlar için ALLOWED_ORIGINS .env içinde tanımlanmalıdır.
 */
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || "http://localhost:5173").split(","),
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
 */
async function bootstrap() {
  try {
    // 1. ÖNCE Veritabanı ve Redis bağlantılarını kur (Sıralama kritiktir)
    await connectDB();
    await connectRedis();
    logger.info("MongoDB ve Redis bağlantıları başarıyla sağlandı.");

    // 2. Event Listener'ı (Zincir Dinleyici) Başlat
    // DB ve Redis hazır olduktan sonra, kaçırılan blokları taramaya ve canlı dinlemeye başlar.
    await worker.start();
    logger.info("Event Listener (Zincir Dinleyici) aktif: Base L2 ağı izleniyor.");

    // H-06 Fix: DLQ processor — her 60 saniyede bir çalışır, biriken başarısız event'leri raporlar
    const dlqInterval = setInterval(processDLQ, 60_000);

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
