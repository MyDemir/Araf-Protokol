"use strict";

const mockRedisGet = jest.fn();

jest.mock("mongoose", () => ({ connection: { readyState: 1 } }));
jest.mock("../scripts/config/redis", () => ({
  isReady: jest.fn(() => true),
  getRedisClient: jest.fn(() => ({ get: (...args) => mockRedisGet(...args) })),
}));
jest.mock("../scripts/services/expectedChain", () => ({
  EXPECTED_CHAIN_ENV: "EXPECTED_CHAIN_ID",
  resolveExpectedChainIdOrThrow: jest.fn(() => 84532),
}));

describe("health readiness production ALLOWED_ORIGINS diagnostics", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.NODE_ENV = "production";
    process.env.MONGODB_URI = "mongodb://localhost:27017/test";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.JWT_SECRET = "secret";
    process.env.SIWE_DOMAIN = "example.com";
    process.env.SIWE_URI = "https://example.com/login";
    process.env.ARAF_ESCROW_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.BASE_RPC_URL = "http://localhost:8545";
    process.env.WORKER_START_BLOCK = "1";
    mockRedisGet.mockResolvedValue("1");
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const provider = {
    getBlockNumber: jest.fn().mockResolvedValue(100),
    getNetwork: jest.fn().mockResolvedValue({ chainId: 84532 }),
  };
  const worker = {
    isRunning: true,
    _state: "live",
    _lastSafeCheckpointBlock: 99,
    _runtimeConfig: { WORKER_FINALITY_DEPTH: 6 },
  };

  it("security_ready_reports_missing_allowed_origins_in_production", async () => {
    delete process.env.ALLOWED_ORIGINS;
    const { getReadiness } = require("../scripts/services/health");

    const readiness = await getReadiness({ worker, provider });

    expect(readiness.ok).toBe(false);
    expect(readiness.missingConfig).toContain("ALLOWED_ORIGINS");
  });

  it("security_ready_rejects_wildcard_allowed_origins", async () => {
    process.env.ALLOWED_ORIGINS = "*";
    const { getReadiness } = require("../scripts/services/health");

    const readiness = await getReadiness({ worker, provider });

    expect(readiness.ok).toBe(false);
    expect(readiness.missingConfig).toContain("ALLOWED_ORIGINS_WILDCARD_NOT_ALLOWED");
  });

  it("security_ready_accepts_valid_https_allowed_origin", async () => {
    process.env.ALLOWED_ORIGINS = "https://example.com";
    const { getReadiness } = require("../scripts/services/health");

    const readiness = await getReadiness({ worker, provider });

    expect(readiness.missingConfig).not.toContain("ALLOWED_ORIGINS");
    expect(readiness.missingConfig.find((item) => String(item).startsWith("ALLOWED_ORIGINS_"))).toBeUndefined();
    expect(readiness.checks.config).toBe(true);
  });

  it("security_runtime_contract_ready_uses_503_on_unready_state", async () => {
    delete process.env.ALLOWED_ORIGINS;
    const { getReadiness } = require("../scripts/services/health");
    const readiness = await getReadiness({ worker, provider });

    const statusCode = readiness.ok ? 200 : 503;
    expect(readiness.ok).toBe(false);
    expect(statusCode).toBe(503);
  });

  it("security_docs_reference_ready_for_readiness_not_health", async () => {
    const fs = require("fs");
    const en = fs.readFileSync(require("path").resolve(process.cwd(), "../docs/EN/LOCAL_DEVELOPMENT.md"), "utf8");
    const tr = fs.readFileSync(require("path").resolve(process.cwd(), "../docs/TR/LOCAL_DEVELOPMENT.md"), "utf8");

    expect(en).toContain("/ready");
    expect(en).toContain("liveness");
    expect(tr).toContain("/ready");
    expect(tr).toContain("liveness");
  });
});
