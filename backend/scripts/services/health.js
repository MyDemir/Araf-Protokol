
"use strict";

const mongoose = require("mongoose");
const { isReady: isRedisReady, getRedisClient } = require("../config/redis");
const { EXPECTED_CHAIN_ENV, resolveExpectedChainIdOrThrow } = require("./expectedChain");

const CHECKPOINT_KEY = "worker:last_block";
const LAST_SAFE_BLOCK_KEY = "worker:last_safe_block";

// [TR] Worker ne kadar block gerideyse unhealthy sayılacağı.
// [EN] Max acceptable worker lag in blocks before readiness turns false.
function _parseMaxWorkerLag(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  return 25;
}

const MAX_WORKER_LAG_BLOCKS = _parseMaxWorkerLag(process.env.WORKER_MAX_LAG_BLOCKS);

async function getReadiness({ worker, provider } = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  const mongoReady = mongoose.connection.readyState === 1;
  const redisReady = isRedisReady();

  // [TR] Eski sürümde workerReady yalnız isRunning bayrağına bakıyordu.
  //      Yeni sürümde state ve lag bilgisi de readiness kararına dahil edilir.
  // [EN] Previously workerReady only checked isRunning.
  //      Now state and lag are also part of readiness.
  const workerRunning = Boolean(worker?.isRunning);

  let providerReady = false;
  let currentBlock = null;
  let providerChainId = null;
  let expectedChainId = null;
  let chainIdReady = false;

  try {
    if (provider) {
      currentBlock = await provider.getBlockNumber();
      providerReady = Number.isInteger(currentBlock);
      const network = await provider.getNetwork();
      providerChainId = Number(network?.chainId);
    } else {
      providerReady = Boolean(worker?.provider);
    }
  } catch {
    providerReady = false;
    currentBlock = null;
    providerChainId = null;
  }

  const requiredConfig = [
    "MONGODB_URI",
    "REDIS_URL",
    "JWT_SECRET",
    "SIWE_DOMAIN",
  ];

  if (isProduction) {
    requiredConfig.push("SIWE_URI", "ARAF_ESCROW_ADDRESS", "BASE_RPC_URL");
  }

  const missingConfig = requiredConfig.filter((key) => !process.env[key]);

  try {
    expectedChainId = resolveExpectedChainIdOrThrow({
      isProduction,
      rpcUrl: process.env.BASE_RPC_URL,
      surface: "HealthReadiness",
    });
    chainIdReady =
      expectedChainId === null ||
      (Number.isInteger(providerChainId) && providerChainId === expectedChainId);
  } catch (_err) {
    chainIdReady = false;
    missingConfig.push(EXPECTED_CHAIN_ENV);
  }

  // [TR] SIWE config drift'i production readiness'te açıkça görünmeli.
  // [EN] SIWE config drift should be visible in production readiness.
  if (isProduction && process.env.SIWE_DOMAIN && process.env.SIWE_URI) {
    try {
      const siweUri = new URL(process.env.SIWE_URI);

      if (siweUri.protocol !== "https:") {
        missingConfig.push("SIWE_URI_MUST_BE_HTTPS");
      }

      if (siweUri.host !== process.env.SIWE_DOMAIN) {
        missingConfig.push("SIWE_URI_HOST_MUST_MATCH_SIWE_DOMAIN");
      }
    } catch {
      missingConfig.push("SIWE_URI_INVALID");
    }
  }

  let replayBootstrapReady = true;
  if (isProduction) {
    const configuredStartRaw = process.env.ARAF_DEPLOYMENT_BLOCK ?? process.env.WORKER_START_BLOCK;
    const hasConfiguredStart =
      configuredStartRaw !== undefined &&
      configuredStartRaw !== null &&
      configuredStartRaw !== "";

    let hasCheckpoint = false;

    try {
      const redis = getRedisClient();
      const savedBlock = await redis.get(LAST_SAFE_BLOCK_KEY) ?? await redis.get(CHECKPOINT_KEY);
      hasCheckpoint = savedBlock !== null && savedBlock !== undefined && savedBlock !== "";
    } catch {
      hasCheckpoint = false;
    }

    replayBootstrapReady = hasCheckpoint || hasConfiguredStart;

    if (!replayBootstrapReady) {
      missingConfig.push("ARAF_DEPLOYMENT_BLOCK_OR_WORKER_START_BLOCK_OR_CHECKPOINT");
    }
  }

  const configReady = missingConfig.length === 0;

  // [TR] WebSocket artık zorunlu değil ama strongly recommended olarak raporlanır.
  // [EN] WebSocket is not strictly required, but reported as strongly recommended.
  const wsConfigured = Boolean(process.env.BASE_WS_RPC_URL);
  const wsRecommended = wsConfigured;

  // ── Worker Sağlık Ölçümleri ────────────────────────────────────────────────
  const workerState = worker?._state || "unknown";
  const lastSeenBlock = Number.isInteger(worker?._lastSeenBlock) ? worker._lastSeenBlock : null;
  const lastSafeBlock = Number.isInteger(worker?._lastSafeCheckpointBlock)
    ? worker._lastSafeCheckpointBlock
    : null;
  const livePollInProgress = Boolean(worker?._livePollInProgress);

  const workerStateHealthy =
    workerRunning &&
    !["stopped", "reconnecting"].includes(workerState);

  // [TR] Lag hesabı: provider current block ile worker safe checkpoint farkı.
  //      Safe block bilinmiyorsa seen block fallback olarak raporlanır ama ready için yeterli sayılmaz.
  // [EN] Lag is measured as provider current block minus worker safe checkpoint.
  let workerLagBlocks = null;
  if (Number.isInteger(currentBlock) && Number.isInteger(lastSafeBlock)) {
    workerLagBlocks = Math.max(0, currentBlock - lastSafeBlock);
  } else if (Number.isInteger(currentBlock) && Number.isInteger(lastSeenBlock)) {
    workerLagBlocks = Math.max(0, currentBlock - lastSeenBlock);
  }

  // [TR] Worker lag çok yüksekse readiness false döner.
  //      Geliştirmede biraz daha toleranslı olabilir, ama kural aynıdır.
  // [EN] If lag is too high, readiness becomes false.
  const workerLagHealthy =
    workerLagBlocks === null ? workerStateHealthy : workerLagBlocks <= MAX_WORKER_LAG_BLOCKS;

  // [TR] Replay sırasında sistem canlı olabilir ama tam "ready" kabul edilmez.
  //      Çünkü state mirror henüz geriden geliyor olabilir.
  // [EN] During replay the system may be live, but not fully "ready".
  const workerReplayHealthy = workerState !== "replaying";

  const workerReady =
    workerRunning &&
    workerStateHealthy &&
    workerLagHealthy &&
    workerReplayHealthy;

  return {
    ok:
      mongoReady &&
      redisReady &&
      providerReady &&
      chainIdReady &&
      configReady &&
      replayBootstrapReady &&
      workerReady,

    checks: {
      mongo: mongoReady,
      redis: redisReady,
      provider: providerReady,
      chainId: chainIdReady,
      config: configReady,
      replayBootstrap: replayBootstrapReady,
      worker: workerReady,
      workerRunning,
      workerStateHealthy,
      workerLagHealthy,
      workerReplayHealthy,
      wsConfigured,
      wsRecommended,
    },

    worker: {
      state: workerState,
      currentBlock,
      expectedChainId,
      providerChainId,
      lastSeenBlock,
      lastSafeBlock,
      lagBlocks: workerLagBlocks,
      maxAllowedLagBlocks: MAX_WORKER_LAG_BLOCKS,
      livePollInProgress,
    },

    missingConfig,
  };
}

function getLiveness() {
  return { status: "ok", timestamp: new Date().toISOString() };
}

module.exports = { getReadiness, getLiveness };
