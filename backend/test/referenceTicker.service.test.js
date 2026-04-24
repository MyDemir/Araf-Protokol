"use strict";

describe("referenceTicker service", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("parses direct Coinbase pair price from trades[0].price", async () => {
    let service;
    jest.isolateModules(() => {
      jest.doMock("../scripts/config/redis", () => ({
        isReady: () => false,
        getRedisClient: jest.fn(),
      }));
      service = require("../scripts/services/referenceTicker");
    });

    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes("frankfurter")) {
        return { ok: true, json: async () => ({ rates: { TRY: 35, EUR: 0.9, GBP: 0.8 } }) };
      }
      return { ok: true, json: async () => ({ trades: [{ price: "65000.12" }] }) };
    });

    const payload = await service.refreshReferenceTicker();
    const directItem = payload.items.find((item) => item.symbol === "BTC/USDC");

    expect(directItem).toBeTruthy();
    expect(directItem.derived).toBe(false);
    expect(directItem.source).toBe("coinbase");
    expect(directItem.rate).toBeCloseTo(65000.12, 2);
  });

  it("derives BTC/USDC from BTC-USD and USDC-USD when direct pair is missing", async () => {
    let service;
    jest.isolateModules(() => {
      jest.doMock("../scripts/config/redis", () => ({
        isReady: () => false,
        getRedisClient: jest.fn(),
      }));
      service = require("../scripts/services/referenceTicker");
    });

    global.fetch.mockImplementation(async (url) => {
      const text = String(url);
      if (text.includes("frankfurter")) {
        return { ok: true, json: async () => ({ rates: { TRY: 35, EUR: 0.9, GBP: 0.8 } }) };
      }
      if (text.includes("BTC-USDC")) return { ok: false, status: 404, json: async () => ({}) };
      if (text.includes("BTC-USD")) return { ok: true, json: async () => ({ trades: [{ price: "60000" }] }) };
      if (text.includes("USDC-USD")) return { ok: true, json: async () => ({ trades: [{ price: "1.0" }] }) };
      return { ok: true, json: async () => ({ trades: [{ price: "2000" }] }) };
    });

    const payload = await service.refreshReferenceTicker();
    const item = payload.items.find((v) => v.symbol === "BTC/USDC");

    expect(item).toBeTruthy();
    expect(item.derived).toBe(true);
    expect(item.source).toBe("derived:coinbase");
    expect(item.rate).toBeCloseTo(60000, 4);
  });

  it("computes USD/TRY, EUR/TRY, GBP/TRY from Frankfurter object response", async () => {
    let service;
    jest.isolateModules(() => {
      jest.doMock("../scripts/config/redis", () => ({
        isReady: () => false,
        getRedisClient: jest.fn(),
      }));
      service = require("../scripts/services/referenceTicker");
    });

    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes("frankfurter")) {
        return { ok: true, json: async () => ({ rates: { TRY: 35, EUR: 0.875, GBP: 0.75 } }) };
      }
      return { ok: true, json: async () => ({ trades: [{ price: "1" }] }) };
    });

    const payload = await service.refreshReferenceTicker();
    const usdTry = payload.items.find((v) => v.symbol === "USD/TRY");
    const eurTry = payload.items.find((v) => v.symbol === "EUR/TRY");
    const gbpTry = payload.items.find((v) => v.symbol === "GBP/TRY");

    expect(usdTry.rate).toBeCloseTo(35, 6);
    expect(eurTry.rate).toBeCloseTo(40, 6);
    expect(gbpTry.rate).toBeCloseTo(46.666666, 5);
  });


  it("computes fiat rates from Frankfurter v2 row-array response", async () => {
    let service;
    jest.isolateModules(() => {
      jest.doMock("../scripts/config/redis", () => ({
        isReady: () => false,
        getRedisClient: jest.fn(),
      }));
      service = require("../scripts/services/referenceTicker");
    });

    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes("frankfurter")) {
        return {
          ok: true,
          json: async () => ([
            { base: "USD", quote: "TRY", rate: 39.2 },
            { base: "USD", quote: "EUR", rate: 0.92 },
            { base: "USD", quote: "GBP", rate: 0.79 },
          ]),
        };
      }
      return { ok: true, json: async () => ({ trades: [{ price: "1" }] }) };
    });

    const payload = await service.refreshReferenceTicker();
    const usdTry = payload.items.find((v) => v.symbol === "USD/TRY");
    const eurTry = payload.items.find((v) => v.symbol === "EUR/TRY");
    const gbpTry = payload.items.find((v) => v.symbol === "GBP/TRY");

    expect(usdTry.rate).toBeCloseTo(39.2, 6);
    expect(eurTry.rate).toBeCloseTo(42.608695, 5);
    expect(gbpTry.rate).toBeCloseTo(49.620253, 5);
  });

  it("returns stale last-good payload when providers fail", async () => {
    const mockRedis = {
      get: jest.fn(async (key) => {
        if (key === "reference:ticker:last-good:v1") {
          return JSON.stringify({
            items: [{
              symbol: "USD/TRY",
              base: "USD",
              quote: "TRY",
              rate: 34,
              source: "frankfurter",
              sourceKind: "FIAT_OFFICIAL_REFERENCE",
              derived: false,
              updatedAt: new Date().toISOString(),
              stale: false,
            }],
            generatedAt: new Date().toISOString(),
            informationalOnly: true,
            nonAuthoritative: true,
            canAffectSettlement: false,
          });
        }
        return null;
      }),
      setEx: jest.fn(async () => "OK"),
    };

    let service;
    jest.isolateModules(() => {
      jest.doMock("../scripts/config/redis", () => ({
        isReady: () => true,
        getRedisClient: () => mockRedis,
      }));
      service = require("../scripts/services/referenceTicker");
    });

    global.fetch.mockRejectedValue(new Error("provider down"));

    const payload = await service.refreshReferenceTicker();

    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.items.every((item) => item.stale === true)).toBe(true);
  });
});
