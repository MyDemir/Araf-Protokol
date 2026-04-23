"use strict";

const path = require("path");

describe("rate limiter tier-aware overlay", () => {
  let rateLimiter;
  let redisState;
  let redisClient;
  let userFindOne;

  function loadWithMocks() {
    jest.resetModules();

    userFindOne = jest.fn();
    redisState = { ready: true, cache: new Map() };
    redisClient = {
      sendCommand: jest.fn().mockResolvedValue("OK"),
      get: jest.fn(async (key) => (redisState.cache.has(key) ? redisState.cache.get(key) : null)),
      setEx: jest.fn(async (key, _ttl, val) => {
        redisState.cache.set(key, String(val));
        return "OK";
      }),
    };

    jest.doMock("../scripts/config/redis", () => ({
      getRedisClient: () => redisClient,
      isReady: () => redisState.ready,
    }));

    jest.doMock("../scripts/models/User", () => ({
      findOne: (...args) => userFindOne(...args),
    }));

    jest.doMock("../scripts/utils/logger", () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));

    jest.doMock("rate-limit-redis", () => ({
      RedisStore: class RedisStoreMock {
        constructor(opts) {
          this.opts = opts;
        }
      },
    }));

    jest.doMock("express-rate-limit", () => (opts) => {
      const mw = (req, _res, next) => {
        req.__rateLimitMaxUsed = opts.max;
        req.__rateLimitStorePrefix = opts.store?.opts?.prefix || null;
        next();
      };
      mw.__opts = opts;
      return mw;
    });

    // eslint-disable-next-line global-require
    rateLimiter = require("../scripts/middleware/rateLimiter");
  }

  beforeEach(() => {
    loadWithMocks();
  });

  it("resolves tier from Redis cache hit", async () => {
    redisState.cache.set("ratelimit:tier:0xabc", "3");

    const req = { wallet: "0xAbC" };
    const tier = await rateLimiter.__private.resolveRequestTier(req);

    expect(tier).toBe(3);
    expect(req.rateLimitTier).toBe(3);
    expect(userFindOne).not.toHaveBeenCalled();
  });

  it("resolves tier from Mongo on cache miss and clamps effective tier by max_allowed_tier", async () => {
    userFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          reputation_cache: { effective_tier: 4 },
          max_allowed_tier: 2,
        }),
      }),
    });

    const req = { wallet: "0xdef" };
    const tier = await rateLimiter.__private.resolveRequestTier(req);

    expect(tier).toBe(2);
    expect(redisClient.setEx).toHaveBeenCalled();
  });

  it("does not perform duplicate mirror reads on repeated resolve calls in same request", async () => {
    const lean = jest.fn().mockResolvedValue({
      reputation_cache: { effective_tier: 3 },
      max_allowed_tier: 4,
    });
    const select = jest.fn().mockReturnValue({ lean });
    userFindOne.mockReturnValue({ select });

    const req = { wallet: "0xaaa" };
    const tierA = await rateLimiter.__private.resolveRequestTier(req);
    const tierB = await rateLimiter.__private.resolveRequestTier(req);

    expect(tierA).toBe(3);
    expect(tierB).toBe(3);
    expect(userFindOne).toHaveBeenCalledTimes(1);
  });

  it("falls back to tier0 when Redis read fails and mirror lookup also fails", async () => {
    redisClient.get.mockRejectedValueOnce(new Error("redis read failure"));
    userFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error("mongo down")),
      }),
    });

    const req = { wallet: "0xbeef" };
    const tier = await rateLimiter.__private.resolveRequestTier(req);

    expect(tier).toBe(0);
  });

  it("defaults to anonymous tier when wallet is missing", async () => {
    const req = { ip: "127.0.0.1" };
    const tier = await rateLimiter.__private.resolveRequestTier(req);

    expect(tier).toBe(0);
    expect(userFindOne).not.toHaveBeenCalled();
  });

  it("clamps edge tier values to [0..4]", () => {
    expect(rateLimiter.__private.clampTier(-99)).toBe(0);
    expect(rateLimiter.__private.clampTier(999)).toBe(4);
    expect(rateLimiter.__private.clampTier("not-a-number")).toBe(0);
  });

  it("selects tier-specific max for ordersReadLimiter while fixed stats limiter remains fixed", async () => {
    redisState.cache.set("ratelimit:tier:0x111", "4");

    const reqTiered = { wallet: "0x111", ip: "1.1.1.1" };
    await new Promise((resolve) => rateLimiter.ordersReadLimiter(reqTiered, {}, resolve));
    expect(reqTiered.__rateLimitMaxUsed).toBe(230);
    expect(String(reqTiered.__rateLimitStorePrefix)).toContain("orders-read:t4");

    const reqFixed = { ip: "2.2.2.2" };
    await new Promise((resolve) => rateLimiter.statsReadLimiter(reqFixed, {}, resolve));
    expect(reqFixed.__rateLimitMaxUsed).toBe(60);
    expect(String(reqFixed.__rateLimitStorePrefix)).toContain("stats-read");
  });
});
