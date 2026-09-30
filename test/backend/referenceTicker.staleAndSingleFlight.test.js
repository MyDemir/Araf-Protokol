"use strict";

// B28: per-row last-good + stale flag with original updatedAt, true updatedAt from caches, single-flight refresh.

function loadService() {
  let service;
  jest.isolateModules(() => {
    jest.doMock("../../backend/scripts/config/redis", () => ({ isReady: () => false, getRedisClient: jest.fn() }));
    jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    service = require("../../backend/scripts/services/referenceTicker");
  });
  return service;
}

function mockFetch({ coinbaseOk = true, fiatOk = true, delayMs = 0 } = {}) {
  global.fetch = jest.fn(async (url) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const text = String(url);
    if (text.includes("frankfurter")) {
      if (!fiatOk) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ rates: { TRY: 35, EUR: 0.9, GBP: 0.8 } }) };
    }
    if (!coinbaseOk) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ trades: [{ price: "2" }] }) };
  });
}

describe("referenceTicker stale + single-flight (B28)", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetModules();
    jest.useRealTimers();
  });

  test("a failing source only makes ITS rows stale, keeping their original updatedAt", async () => {
    const svc = loadService();
    mockFetch();
    const first = await svc.refreshReferenceTicker();
    const fresh = first.items.find((i) => i.symbol === "BTC/USDC");
    expect(fresh.stale).toBe(false);
    expect(first.items).toHaveLength(9);

    // let time pass, then coinbase dies (fiat is still cached and fresh)
    await new Promise((r) => setTimeout(r, 15));
    mockFetch({ coinbaseOk: false });
    const second = await svc.refreshReferenceTicker();

    const crypto = second.items.find((i) => i.symbol === "BTC/USDC");
    expect(crypto.stale).toBe(true);
    expect(crypto.updatedAt).toBe(fresh.updatedAt); // real, old timestamp
    expect(second.generatedAt).not.toBe(fresh.updatedAt);
    // stable/TRY rows derived from coinbase also stale; fiat rows stay fresh
    expect(second.items.find((i) => i.symbol === "USDT/TRY").stale).toBe(true);
    const usdTry = second.items.find((i) => i.symbol === "USD/TRY");
    expect(usdTry.stale).toBe(false);
  });

  test("with every source down and no last-good the payload is empty (no fabricated data)", async () => {
    const svc = loadService();
    mockFetch({ coinbaseOk: false, fiatOk: false });
    const payload = await svc.refreshReferenceTicker();
    expect(payload.items).toEqual([]);
  });

  test("fiat rows carry the fiat cache's real generatedAt, not 'now'", async () => {
    const svc = loadService();
    mockFetch();
    const first = await svc.refreshReferenceTicker();
    const fiatTime = first.items.find((i) => i.symbol === "USD/TRY").updatedAt;

    await new Promise((r) => setTimeout(r, 15));
    // crypto refresh happens later, fiat stays cached from the first run
    const second = await svc.refreshReferenceTicker();
    expect(second.items.find((i) => i.symbol === "USD/TRY").updatedAt).toBe(fiatTime);
    expect(second.items.find((i) => i.symbol === "BTC/USDC").updatedAt).toBe(second.generatedAt);
  });

  test("concurrent refreshes share one in-flight run (single upstream fetch set)", async () => {
    const svc = loadService();
    mockFetch({ delayMs: 20 });
    const [a, b, c] = await Promise.all([
      svc.refreshReferenceTicker(), svc.refreshReferenceTicker(), svc.getReferenceTickerPayload(),
    ]);
    expect(a).toBe(b);
    expect(c.items.length).toBeGreaterThan(0);
    // 8 coinbase products + 1 frankfurter call; a second run would double this
    expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(9);
  });
});
