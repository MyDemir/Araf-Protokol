"use strict";

jest.mock("../config/redis", () => ({
  isReady: jest.fn(),
  getRedisClient: jest.fn(),
}));

const mongoose = require("mongoose");
const { isReady, getRedisClient } = require("../config/redis");
const { getReadiness } = require("../services/health");

describe("health/readiness service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "production";
    process.env.MONGODB_URI = "mongodb://localhost/test";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.ARAF_ESCROW_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.BASE_RPC_URL = "https://mainnet.base.org";
    process.env.ARAF_DEPLOYMENT_BLOCK = "12345";
    delete process.env.WORKER_START_BLOCK;
    process.env.JWT_SECRET = "a".repeat(70) + "XYZ123!";
    process.env.SIWE_DOMAIN = "app.araf.io";
    delete process.env.BASE_WS_RPC_URL;
    getRedisClient.mockReturnValue({ get: jest.fn().mockResolvedValue(null) });
  });

  test("returns ok=true when all checks pass", async () => {
    mongoose.connection.readyState = 1;
    isReady.mockReturnValue(true);
    const provider = { getBlockNumber: jest.fn().mockResolvedValue(123) };

    const readiness = await getReadiness({ worker: { isRunning: true, provider }, provider });
    expect(readiness.ok).toBe(true);
    expect(readiness.missingConfig).toHaveLength(0);
    expect(readiness.checks.wsRecommended).toBe(false);
  });

  test("returns  missing config and failed checks", async () => {
    delete process.env.SIWE_DOMAIN;
    delete process.env.BASE_RPC_URL;
    delete process.env.ARAF_DEPLOYMENT_BLOCK;
    mongoose.connection.readyState = 0;
    isReady.mockReturnValue(false);

    const readiness = await getReadiness({ worker: { isRunning: false } });
    expect(readiness.ok).toBe(false);
    expect(readiness.checks.mongo).toBe(false);
    expect(readiness.checks.redis).toBe(false);
    expect(readiness.missingConfig).toContain("SIWE_DOMAIN");
    expect(readiness.missingConfig).toContain("BASE_RPC_URL");
    expect(readiness.missingConfig).toContain("ARAF_DEPLOYMENT_BLOCK_OR_WORKER_START_BLOCK_OR_CHECKPOINT");
  });

  test("allows dev dry-run without production-only replay bootstrap config", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.ARAF_ESCROW_ADDRESS;
    delete process.env.BASE_RPC_URL;
    delete process.env.ARAF_DEPLOYMENT_BLOCK;
    delete process.env.WORKER_START_BLOCK;
    mongoose.connection.readyState = 1;
    isReady.mockReturnValue(true);
    const provider = { getBlockNumber: jest.fn().mockResolvedValue(123) };

    const readiness = await getReadiness({ worker: { isRunning: true, provider }, provider });
    expect(readiness.ok).toBe(true);
    expect(readiness.checks.replayBootstrap).toBe(true);
    expect(readiness.missingConfig).not.toContain("BASE_RPC_URL");
  });
});
