"use strict";

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const mongoSanitize = require("express-mongo-sanitize");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");

// [TR] Yapılandırma ve yardımcı araçlar
// [EN] Configuration and utility helpers
const { connectDB, setAllowProcessExitOnDisconnect } = require("./config/db");
const { connectRedis, closeRedis } = require("./config/redis");
const logger = require("./utils/logger");

// [TR] On-chain event'lerini MongoDB'ye yansıtan servis
// [EN] Service that mirrors on-chain events to MongoDB
const worker = require("./services/eventListener");

// [TR] V3 mutable protocol config'ini startup'ta on-chain'den yükler
// [EN] Loads V3 mutable protocol config from on-chain at startup
const { loadProtocolConfig } = require("./services/protocolConfig");

// [TR] Başarısız event'leri izleyen ve yeniden süren DLQ monitörü
// [EN] DLQ monitor that re-drives failed events
const { processDLQ } = require("./services/dlqProcessor");

// [TR] 90 günlük temiz sayfa kuralını on-chain'de tetikleyen periyodik görev
// [EN] Periodic job that triggers the 90-day clean slate rule on-chain
const { runReputationDecay } = require("./jobs/reputationDecay");

// [TR] Günlük V3 order + child-trade istatistik snapshot görevi
// [EN] Daily V3 order + child-trade snapshot job
const { runStatsSnapshot } = require("./jobs/statsSnapshot");


// [TR] Hassas veri retention cleanup job'ları
// [EN] Sensitive data retention cleanup jobs
const {
  runReceiptCleanup,
  runPIISnapshotCleanup,
} = require("./jobs/cleanupSensitiveData");

// [TR] User belgesindeki banka risk metadata'sını prune eder.
//      Amaç: bank_change_history kontrolsüz büyümesin, rolling sayaçlar normalize kalsın.
// [EN] Prunes bank risk metadata in User documents.
const {
  runUserBankRiskMetadataCleanup,
} = require("./jobs/cleanupUserBankRiskMetadata");

const { getReadiness, getLiveness } = require("./services/health");
const { verifyIdentityNormalization } = require("./services/identityNormalizationGuard");

// [TR] Global Express hata yakalayıcı
// [EN] Global Express error handler
const { globalErrorHandler } = require("./middleware/errorHandler");

// [TR] Shutdown sırasında AES master key'i RAM'den sıfırlar
// [EN] Zeroes out AES master key from RAM on shutdown
const { clearMasterKeyCache } = require("./services/encryption");

const app = express();
let server = null;
let isShuttingDown = false;
const FATAL_EXIT_TIMEOUT_MS = 8_000;

function _envMs(name, fallbackMs) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallbackMs;
}

function _resolveIdentityGuardMode() {
  const configured = (process.env.IDENTITY_NORMALIZATION_GUARD || "").trim().toLowerCase();
  if (configured) return configured;

  // [TR] Varsayılanı production'da enforce yapıyoruz ki migration unutulursa
  //      sessiz false-negative drift oluşmasın.
  // [EN] Default to enforce in production to avoid silent drift if migration is skipped.
  return process.env.NODE_ENV === "production" ? "enforce" : "warn";
}

// [TR] Proxy arkasında gerçek client IP'yi her ortamda doğru almak için trust proxy.
// [EN] trust proxy so real client IP is preserved behind reverse proxies.
app.set("trust proxy", 1);

// ── Güvenlik Middleware / Security Middleware ────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: process.env.NODE_ENV === "production"
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));

const rawAllowedOrigins = process.env.ALLOWED_ORIGINS;
const allowedOrigins = (rawAllowedOrigins || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

// [TR] Production'da CORS wildcard ve boş origin engellenir
// [EN] CORS wildcard and empty origins blocked in production
if (process.env.NODE_ENV === "production") {
  // [TR] Production fail-closed:
  //      ALLOWED_ORIGINS explicit tanımlı değilse localhost fallback'e güvenmeyiz.
  // [EN] Do not allow implicit localhost fallback in production.
  if (!rawAllowedOrigins || rawAllowedOrigins.trim().length === 0) {
    logger.error("[GÜVENLİK] ALLOWED_ORIGINS production'da zorunludur (fail-closed).");
    process.exit(1);
  }
  if (allowedOrigins.includes("*")) {
    logger.error("[GÜVENLİK] CORS wildcard (*) production'da kullanılamaz! Sunucu durduruluyor.");
    process.exit(1);
  }
  if (allowedOrigins.length === 0) {
    logger.error("[GÜVENLİK] ALLOWED_ORIGINS boş! En az bir origin tanımlayın.");
    process.exit(1);
  }
  if (allowedOrigins.length === 1 && allowedOrigins[0] === "http://localhost:5173") {
    logger.error("[GÜVENLİK] Production'da localhost fallback origin kullanılamaz.");
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

// [TR] JWT ve refresh token'ı httpOnly cookie'den okumak için
// [EN] Required to read JWT and refresh token from httpOnly cookie
app.use(cookieParser());

app.use(mongoSanitize({
  replaceWith: "_",
  onSanitize: ({ key }) => logger.warn(`[GÜVENLİK] Mongo injection denemesi engellendi: ${key}`),
}));

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  let dlqInterval = null;
  let reputationDecayDelay = null;
  let reputationDecayInterval = null;
  let statsSnapshotDelay = null;
  let statsSnapshotInterval = null;
  let sensitiveCleanupDelay = null;
  let sensitiveCleanupInterval = null;
  let userBankRiskCleanupDelay = null;
  let userBankRiskCleanupInterval = null;

  // [TR] Aynı job'ın üst üste binmesini engelleyen hafif scheduler lock'ları.
  // [EN] Lightweight scheduler locks to prevent overlapping runs.
  const jobLocks = {
    dlq: false,
    reputationDecay: false,
    statsSnapshot: false,
    sensitiveCleanup: false,
    userBankRiskCleanup: false,
  };

  const clearRuntimeSchedulers = () => {
    if (dlqInterval) clearInterval(dlqInterval);
    if (reputationDecayDelay) clearTimeout(reputationDecayDelay);
    if (reputationDecayInterval) clearInterval(reputationDecayInterval);
    if (statsSnapshotDelay) clearTimeout(statsSnapshotDelay);
    if (statsSnapshotInterval) clearInterval(statsSnapshotInterval);
    if (sensitiveCleanupDelay) clearTimeout(sensitiveCleanupDelay);
    if (sensitiveCleanupInterval) clearInterval(sensitiveCleanupInterval);
    if (userBankRiskCleanupDelay) clearTimeout(userBankRiskCleanupDelay);
    if (userBankRiskCleanupInterval) clearInterval(userBankRiskCleanupInterval);
  };

  /**
   * [TR] Job overlap engelleyici koruma katmanı.
   *      Aynı job henüz bitmemişse bir sonraki tick atlanır.
   *
   * [EN] Prevents overlapping job execution.
   *      If the same job is still running, the next tick is skipped.
   */
  const runScheduledJob = async (jobKey, jobFn) => {
    if (jobLocks[jobKey]) {
      logger.warn(`[Scheduler] ${jobKey} hâlâ çalışıyor — bu tick atlandı.`);
      return;
    }

    jobLocks[jobKey] = true;
    try {
      await jobFn();
    } catch (err) {
      logger.error(`[Scheduler] ${jobKey} başarısız: ${err.message}`, { stack: err.stack });
    } finally {
      jobLocks[jobKey] = false;
    }
  };

  /**
   * [TR] Hassas veri retention cleanup tek bir wrapper altında çalıştırılır.
   *      Böylece scheduler tarafında tek job gibi yönetilir.
   *
   * [EN] Sensitive-data retention cleanup runs under one wrapper,
   *      so the scheduler treats it as a single job.
   */
  const runSensitiveCleanupBundle = async () => {
    await runReceiptCleanup();
    await runPIISnapshotCleanup();
  };

  const shutdown = async ({ signal = "UNKNOWN", exitCode = 0, reason = null }) => {
    if (isShuttingDown) {
      logger.warn(`[ORCHESTRATOR] Shutdown zaten devam ediyor (${signal}). İkinci tetikleme yok sayıldı.`);
      return;
    }
    isShuttingDown = true;

    const isFatal = exitCode !== 0;
    if (isFatal) {
      logger.error(`[ORCHESTRATOR] FATAL shutdown başlatıldı (${signal}). Exit code=${exitCode}; restart bekleniyor.`);
      if (reason) {
        logger.error("[ORCHESTRATOR] FATAL nedeni:", reason);
      }
    } else {
      logger.info(`[ORCHESTRATOR] Graceful shutdown başlatıldı (${signal}). Exit code=${exitCode}; restart beklenmiyor.`);
    }

    clearMasterKeyCache();
    clearRuntimeSchedulers();

    const forceExitTimer = setTimeout(() => {
      logger.error(`[ORCHESTRATOR] Shutdown timeout (${FATAL_EXIT_TIMEOUT_MS}ms) aşıldı. process.exit(${exitCode}) zorlanıyor.`);
      process.exit(exitCode);
    }, FATAL_EXIT_TIMEOUT_MS);

    try {
      if (server && server.listening) {
        await new Promise((resolve) => server.close(resolve));
        logger.warn("[ORCHESTRATOR] Yeni istek kabulü durduruldu (server.close).");
      } else {
        logger.warn("[ORCHESTRATOR] HTTP sunucusu henüz dinlemede değil; yeni istek akışı yok.");
      }

      await worker.stop();
      logger.info("[ORCHESTRATOR] Worker stop tamamlandı.");

      if (mongoose.connection.readyState !== 0) {
        setAllowProcessExitOnDisconnect(false);
        await mongoose.connection.close();
        logger.info("[ORCHESTRATOR] MongoDB bağlantısı kapatıldı.");
      }

      await closeRedis();
    } catch (shutdownErr) {
      logger.error("[ORCHESTRATOR] Shutdown sırasında hata oluştu:", {
        message: shutdownErr.message,
        stack: shutdownErr.stack,
      });
    } finally {
      clearTimeout(forceExitTimer);
      logger.warn(`[ORCHESTRATOR] Shutdown tamamlandı. process.exit(${exitCode}) çağrılıyor.`);
      process.exit(exitCode);
    }
  };

  // [TR] Fatal process event'leri orchestration uyumlu şekilde kapatılır.
  // [EN] Fatal process events trigger orchestrator-friendly forced exit semantics.
  process.on("uncaughtException", (err) => {
    shutdown({
      signal: "uncaughtException",
      exitCode: 1,
      reason: { message: err.message, stack: err.stack },
    });
  });

  process.on("unhandledRejection", (reason) => {
    shutdown({
      signal: "unhandledRejection",
      exitCode: 1,
      reason: { reason },
    });
  });

  try {
    // [TR] Production'da SIWE_DOMAIN localhost olamaz
    // [EN] SIWE_DOMAIN cannot be localhost in production
    if (process.env.NODE_ENV === "production") {
      const siweDomain = process.env.SIWE_DOMAIN;
      if (!siweDomain || siweDomain === "localhost") {
        logger.error("[GÜVENLİK] SIWE_DOMAIN production'da 'localhost' olamaz! Gerçek domain ayarlayın.");
        process.exit(1);
      }
    }

    await connectDB();
    await connectRedis();
    logger.info("MongoDB ve Redis bağlantıları başarıyla sağlandı.");

    // [TR] Startup guard default'u production'da enforce:
    //      mixed identity ile sessiz bozuk runtime'a izin vermiyoruz.
    // [EN] Startup guard defaults to enforce in production to prevent silent drift.
    await verifyIdentityNormalization({
      mode: _resolveIdentityGuardMode(),
    });

    // [TR] V3 mutable protocol config mirror'ı yüklenir.
    //      Config yüklenemiyorsa server tamamen çökmez; route'lar CONFIG_UNAVAILABLE dönebilir.
    // [EN] V3 mutable protocol config mirror is loaded here.
    await loadProtocolConfig();

    await worker.start();
    logger.info("Event Listener aktif: V3 Order + Child Trade topology izleniyor.");

    // [TR] DLQ monitörü — her 60 saniyede başarısız event'leri kontrol eder
    // [EN] DLQ monitor — checks failed events every 60 seconds
    const DLQ_INTERVAL_MS = _envMs("JOB_DLQ_INTERVAL_MS", 60_000);
    const REPUTATION_DECAY_DELAY_MS = _envMs("JOB_REPUTATION_DECAY_DELAY_MS", 30_000);
    const REPUTATION_DECAY_INTERVAL_MS = _envMs("JOB_REPUTATION_DECAY_INTERVAL_MS", 24 * 60 * 60 * 1000);
    const STATS_SNAPSHOT_DELAY_MS = _envMs("JOB_STATS_SNAPSHOT_DELAY_MS", 60_000);
    const STATS_SNAPSHOT_INTERVAL_MS = _envMs("JOB_STATS_SNAPSHOT_INTERVAL_MS", 24 * 60 * 60 * 1000);
    const SENSITIVE_CLEANUP_DELAY_MS = _envMs("JOB_SENSITIVE_CLEANUP_DELAY_MS", 120_000);
    const SENSITIVE_CLEANUP_INTERVAL_MS = _envMs("JOB_SENSITIVE_CLEANUP_INTERVAL_MS", 30 * 60 * 1000);
    const USER_BANK_RISK_CLEANUP_DELAY_MS = _envMs("JOB_USER_BANK_RISK_CLEANUP_DELAY_MS", 150_000);
    const USER_BANK_RISK_CLEANUP_INTERVAL_MS = _envMs("JOB_USER_BANK_RISK_CLEANUP_INTERVAL_MS", 6 * 60 * 60 * 1000);

    dlqInterval = setInterval(() => {
      runScheduledJob("dlq", processDLQ);
    }, DLQ_INTERVAL_MS);

    // [TR] İlk çalıştırma 30 sn geciktirilir — cold start'ta DB'ye eş zamanlı yük binmesini önler
    // [EN] First run delayed by 30s — prevents simultaneous DB load on cold start
    reputationDecayDelay = setTimeout(() => {
      runScheduledJob("reputationDecay", runReputationDecay);
      logger.info("Periyodik İtibar İyileştirme görevi zamanlandı (her 24 saatte bir).");
    }, REPUTATION_DECAY_DELAY_MS);

    reputationDecayInterval = setInterval(() => {
      runScheduledJob("reputationDecay", runReputationDecay);
    }, REPUTATION_DECAY_INTERVAL_MS);

    statsSnapshotDelay = setTimeout(() => {
      runScheduledJob("statsSnapshot", runStatsSnapshot);
      logger.info("Periyodik V3 istatistik snapshot görevi zamanlandı (her 24 saatte bir).");
    }, STATS_SNAPSHOT_DELAY_MS);

    statsSnapshotInterval = setInterval(() => {
      runScheduledJob("statsSnapshot", runStatsSnapshot);
    }, STATS_SNAPSHOT_INTERVAL_MS);

    // [TR] Hassas veri retention cleanup — her 30 dakikada bir
    //      Trade üzerindeki:
    //        - şifreli dekont payload
    //        - PII snapshot
    //        - lock anındaki banka risk snapshot metadata
    //      süre dolunca temizlenir.
    // [EN] Sensitive-data retention cleanup every 30 minutes.
    sensitiveCleanupDelay = setTimeout(() => {
      runScheduledJob("sensitiveCleanup", runSensitiveCleanupBundle);
      logger.info("Receipt/PII snapshot retention cleanup görevi zamanlandı (her 30 dakikada bir).");
    }, SENSITIVE_CLEANUP_DELAY_MS);

    sensitiveCleanupInterval = setInterval(() => {
      runScheduledJob("sensitiveCleanup", runSensitiveCleanupBundle);
    }, SENSITIVE_CLEANUP_INTERVAL_MS);

    // [TR] User bank risk metadata prune — her 6 saatte bir
    //      Amaç:
    //        - bank_change_history dizisini 30 günlük pencere içinde tutmak
    //        - bankChangeCount7d / bankChangeCount30d alanlarını normalize etmek
    //        - kullanıcı bazlı risk metadata'nın gereksiz büyümesini önlemek
    //
    // [EN] User bank risk metadata prune every 6 hours.
    userBankRiskCleanupDelay = setTimeout(() => {
      runScheduledJob("userBankRiskCleanup", runUserBankRiskMetadataCleanup);
      logger.info("User bank risk metadata cleanup görevi zamanlandı (her 6 saatte bir).");
    }, USER_BANK_RISK_CLEANUP_DELAY_MS);

    userBankRiskCleanupInterval = setInterval(() => {
      runScheduledJob("userBankRiskCleanup", runUserBankRiskMetadataCleanup);
    }, USER_BANK_RISK_CLEANUP_INTERVAL_MS);

    // [TR] Rotalar DB ve Redis hazır olduktan sonra yüklenir
    // [EN] Routes loaded after DB and Redis are ready

    // [TR] Frontend senkronize log rotası (yük bindirmeyen yapı)
    const logRoutes = require("./routes/logs");

    const authRoutes = require("./routes/auth");
    const orderRoutes = require("./routes/orders");
    const tradeRoutes = require("./routes/trades");
    const piiRoutes = require("./routes/pii");
    const feedbackRoutes = require("./routes/feedback");
    const statsRoutes = require("./routes/stats");
    const receiptRoutes = require("./routes/receipts");

    // [TR] Log rotası en üstte tanımlanır
    app.use("/api/logs", logRoutes);

    app.use("/api/auth", authRoutes);
    app.use("/api/orders", orderRoutes);
    app.use("/api/trades", tradeRoutes);
    app.use("/api/pii", piiRoutes);
    app.use("/api/feedback", feedbackRoutes);
    app.use("/api/stats", statsRoutes);
    app.use("/api/receipts", receiptRoutes);

    app.get("/health", (_req, res) => res.json(getLiveness()));

    app.get("/ready", async (_req, res) => {
      const readiness = await getReadiness({ worker, provider: worker.provider });
      return res.status(readiness.ok ? 200 : 503).json(readiness);
    });

    app.use((_req, res) => res.status(404).json({ error: "İstenen endpoint bulunamadı" }));
    app.use(globalErrorHandler);

    const PORT = process.env.PORT || 4000;
    server = app.listen(PORT, () => {
      logger.info("===========================================================");
      logger.info(`🚀 Araf Protocol Backend Dinleniyor: Port ${PORT}`);
      logger.info(`🌍 Ortam: ${process.env.NODE_ENV || "development"}`);
      logger.info("🧭 Mimari: V3-native Order + Child Trade backend mirror");
      logger.info("🛡️  Güvenlik: Non-custodial backend (opsiyonel automation signer olabilir).");
      logger.info("🧹 Retention: receipt / PII snapshot / bank risk metadata cleanup aktif");
      logger.info("===========================================================");
    });

    process.on("SIGTERM", () => shutdown({ signal: "SIGTERM", exitCode: 0 }));
    process.on("SIGINT", () => shutdown({ signal: "SIGINT", exitCode: 0 }));
  } catch (err) {
    logger.error("Uygulama başlatılırken kritik hata oluştu:", {
      message: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
}

bootstrap();

module.exports = app;
module.exports._resolveIdentityGuardMode = _resolveIdentityGuardMode;
