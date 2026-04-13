"use strict";

const mongoose = require("mongoose");

jest.mock("../config/redis", () => ({
  isReady: jest.fn(() => true),
  getRedisClient: jest.fn(() => ({ get: jest.fn().mockResolvedValue("123") })),
}));

const { isReady, getRedisClient } = require("../config/redis");

describe("health service env parsing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("falls back to default lag threshold when WORKER_MAX_LAG_BLOCKS is invalid", async () => {
    process.env.WORKER_MAX_LAG_BLOCKS = "invalid";
    process.env.MONGODB_URI = "mongodb://localhost:27017/test";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.JWT_SECRET = "x".repeat(64);
    process.env.SIWE_DOMAIN = "example.com";

    mongoose.connection.readyState = 1;
    isReady.mockReturnValue(true);
    getRedisClient.mockReturnValue({
      get: jest
        .fn()
        .mockResolvedValueOnce("100")
        .mockResolvedValueOnce("100"),
    });

    const { getReadiness } = require("../services/health");

    const readiness = await getReadiness({
      worker: { isRunning: true, _state: "running", _lastSafeCheckpointBlock: 100, _lastSeenBlock: 100 },
      provider: { getBlockNumber: jest.fn().mockResolvedValue(110) },
    });

    expect(readiness.worker.maxAllowedLagBlocks).toBe(25);
  });
});
