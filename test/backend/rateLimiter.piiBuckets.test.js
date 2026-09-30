"use strict";

// B11: the four PII endpoints must not share one rate-limit bucket.
// Redis is reported as not ready so the process-local fallback (same key scheme) is exercised.

function loadLimiters() {
  let mod;
  jest.isolateModules(() => {
    jest.doMock("../../backend/scripts/config/redis", () => ({
      isReady: () => false,
      // rate-limit-redis preloads its Lua scripts at construction time.
      getRedisClient: () => ({ sendCommand: async () => "sha" }),
    }));
    jest.doMock("../../backend/scripts/models/User", () => ({ findOne: jest.fn() }));
    jest.doMock("../../backend/scripts/utils/logger", () => ({
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    }));
    mod = require("../../backend/scripts/middleware/rateLimiter");
  });
  return mod;
}

function call(limiter, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    limiter({ ip: "1.2.3.4", wallet: "0xabc", params: {}, query: {}, ...req }, res, () => resolve({ status: 200 }));
  });
}

describe("PII rate limiter buckets are per endpoint (B11)", () => {
  afterEach(() => jest.resetModules());

  test("exhausting /my does not block request-token, taker-name or GET /:tradeId", async () => {
    const l = loadLimiters();
    for (let i = 0; i < 10; i += 1) {
      expect((await call(l.piiProfileLimiter, {})).status).toBe(200);
    }
    expect((await call(l.piiProfileLimiter, {})).status).toBe(429);

    expect((await call(l.piiTokenRequestLimiter, { params: { tradeId: "a".repeat(24) } })).status).toBe(200);
    expect((await call(l.piiTakerNameLimiter, { params: { onchainId: "7" } })).status).toBe(200);
    expect((await call(l.piiFetchLimiter, { params: { tradeId: "a".repeat(24) } })).status).toBe(200);
  });

  test("request-token and fetch are keyed per trade and independent of each other", async () => {
    const l = loadLimiters();
    const tradeA = "a".repeat(24);
    const tradeB = "b".repeat(24);

    for (let i = 0; i < 5; i += 1) {
      expect((await call(l.piiTokenRequestLimiter, { params: { tradeId: tradeA } })).status).toBe(200);
    }
    expect((await call(l.piiTokenRequestLimiter, { params: { tradeId: tradeA } })).status).toBe(429);

    // another trade has its own bucket
    expect((await call(l.piiTokenRequestLimiter, { params: { tradeId: tradeB } })).status).toBe(200);
    // the fetch endpoint for the exhausted trade is a separate bucket
    expect((await call(l.piiFetchLimiter, { params: { tradeId: tradeA } })).status).toBe(200);
  });

  test("taker-name is keyed per on-chain id with its own bucket", async () => {
    const l = loadLimiters();
    for (let i = 0; i < 10; i += 1) {
      expect((await call(l.piiTakerNameLimiter, { params: { onchainId: "1" } })).status).toBe(200);
    }
    expect((await call(l.piiTakerNameLimiter, { params: { onchainId: "1" } })).status).toBe(429);
    expect((await call(l.piiTakerNameLimiter, { params: { onchainId: "2" } })).status).toBe(200);
    expect((await call(l.piiProfileLimiter, {})).status).toBe(200);
  });

  test("routes wire the dedicated limiters", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../../backend/scripts/routes/pii.js"),
      "utf8"
    );
    expect(src).toMatch(/"\/my",[^)]*piiProfileLimiter/);
    expect(src).toMatch(/"\/taker-name\/:onchainId",[^)]*piiTakerNameLimiter/);
    expect(src).toMatch(/"\/request-token\/:tradeId",[^)]*piiTokenRequestLimiter/);
    expect(src).toContain("piiFetchLimiter");
    expect(src).not.toMatch(/\bpiiLimiter\b/);
  });
});
