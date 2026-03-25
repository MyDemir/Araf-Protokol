"use strict";

const mongoose = require("mongoose");
const { isReady: isRedisReady, getRedisClient } = require("../config/redis");

const CHECKPOINT_KEY = "worker:last_block";
const LAST_SAFE_BLOCK_KEY = "worker:last_safe_block";

async function getReadiness({ worker, provider } = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  const mongoReady = mongoose.connection.readyState === 1;
  const redisReady = isRedisReady();
  const workerReady = Boolean(worker?.isRunning);
  let providerReady = false;

  try {
    if (provider) {
      await provider.getBlockNumber();
      providerReady = true;
    } else {
      providerReady = Boolean(worker?.provider);
    }
  } catch {
    providerReady = false;
  }

  const requiredConfig = [
    "MONGODB_URI",
    "REDIS_URL",
    "JWT_SECRET",
    "SIWE_DOMAIN",
  ];
  if (isProduction) {
    requiredConfig.push("ARAF_ESCROW_ADDRESS", "BASE_RPC_URL");
  }
  const missingConfig = requiredConfig.filter((key) => !process.env[key]);

  let replayBootstrapReady = true;
  if (isProduction) {
    const configuredStartRaw = process.env.ARAF_DEPLOYMENT_BLOCK ?? process.env.WORKER_START_BLOCK;
    const hasConfiguredStart = configuredStartRaw !== undefined && configuredStartRaw !== null && configuredStartRaw !== "";
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
  const wsRecommended = Boolean(process.env.BASE_WS_RPC_URL);

  return {
    ok: mongoReady && redisReady && workerReady && providerReady && configReady && replayBootstrapReady,
    checks: {
      mongo: mongoReady,
      redis: redisReady,
      worker: workerReady,
      provider: providerReady,
      config: configReady,
      replayBootstrap: replayBootstrapReady,
      wsRecommended,
    },
    missingConfig,
  };
}

function getLiveness() {
  return { status: "ok", timestamp: new Date().toISOString() };
}

module.exports = { getReadiness, getLiveness };
