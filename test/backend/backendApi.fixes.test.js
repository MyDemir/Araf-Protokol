"use strict";

// B35 min_amount integer conversion, B39 trust summary role, B25 projections, B37 pagination,
// B34 log control chars, B38 preview provider cache, B33 chargeback ip hash, B36 dead hooks,
// B17/B24/B37 schema indexes.

const express = require("express");
const request = require("supertest");

const OWNER = "0x1111111111111111111111111111111111111111";
const passMw = (_req, _res, next) => next();

function loadOrders({ Order, Trade, User, tokenMap }) {
  let router;
  jest.isolateModules(() => {
    jest.doMock("../../backend/scripts/middleware/auth", () => ({
      requireAuth: (req, _res, next) => { req.wallet = OWNER; next(); },
      requireSessionWalletMatch: passMw,
    }));
    jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
      marketReadLimiter: passMw, ordersReadLimiter: passMw, ordersWriteLimiter: passMw,
    }));
    jest.doMock("../../backend/scripts/models/Order", () => Order);
    jest.doMock("../../backend/scripts/models/Trade", () => Trade);
    jest.doMock("../../backend/scripts/models/User", () => User);
    jest.doMock("../../backend/scripts/services/protocolConfig", () => ({
      getConfig: jest.fn(() => ({ bondMap: {}, feeConfig: {}, cooldownConfig: {}, tokenMap: tokenMap || {} })),
    }));
    jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    router = require("../../backend/scripts/routes/orders");
  });
  const app = express();
  app.use(express.json());
  app.use("/api/orders", router);
  return app;
}

const chain = (result) => {
  const c = {};
  for (const m of ["select", "sort", "skip", "limit"]) c[m] = jest.fn(() => c);
  c.lean = jest.fn().mockResolvedValue(result);
  return c;
};

describe("orders route fixes", () => {
  afterEach(() => jest.resetModules());

  test("B35: min_amount is converted with integer math, not float multiplication", async () => {
    const TOKEN = "0x" + "a".repeat(40);
    const orderChain = chain([]);
    const Order = { find: jest.fn(() => orderChain), countDocuments: jest.fn().mockResolvedValue(0) };
    const app = loadOrders({ Order, Trade: { aggregate: jest.fn() }, User: { find: jest.fn() }, tokenMap: { [TOKEN]: { decimals: 6 } } });

    // 1.005 * 10**6 === 1004999.9999999999 with floats
    expect(1.005 * 10 ** 6).not.toBe(1005000);
    await request(app).get(`/api/orders?min_amount=1.005&token_address=${TOKEN}`).expect(200);
    const clause = Order.find.mock.calls[0][0].$or[0];
    expect(clause["amounts.remaining_amount_num"]).toEqual({ $gte: 1005000 });
    expect(clause.$or[0]).toEqual({ "amounts.min_fill_amount_num": { $lte: 1005000 } });

    // extra digits beyond decimals round up
    await request(app).get(`/api/orders?min_amount=1.0000001&token_address=${TOKEN}`).expect(200);
    expect(Order.find.mock.calls[1][0].$or[0]["amounts.remaining_amount_num"]).toEqual({ $gte: 1000001 });
  });

  test("B39 + B25: BUY_CRYPTO owner is summarised from the TAKER side; user payout blob is not selected", async () => {
    const BUYER = "0x" + "b".repeat(40);
    const SELLER = "0x" + "c".repeat(40);
    const orders = [
      { _id: 1, owner_address: BUYER, side: "BUY_CRYPTO" },
      { _id: 2, owner_address: SELLER, side: "SELL_CRYPTO" },
    ];
    const Order = { find: jest.fn(() => chain(orders)), countDocuments: jest.fn().mockResolvedValue(2) };
    const userChain = chain([]);
    const User = { find: jest.fn(() => userChain) };
    const Trade = { aggregate: jest.fn().mockResolvedValue([]) };
    const app = loadOrders({ Order, Trade, User });

    await request(app).get("/api/orders").expect(200);

    const pipelines = Trade.aggregate.mock.calls.map((c) => c[0]);
    expect(pipelines).toHaveLength(2);
    const buy = pipelines.find((p) => p[0].$match.taker_address);
    const sell = pipelines.find((p) => p[0].$match.maker_address);
    expect(buy[0].$match.taker_address.$in).toEqual([BUYER]);
    expect(sell[0].$match.maker_address.$in).toEqual([SELLER]);
    expect(buy[1].$sort).toMatchObject({ taker_address: 1, created_at: -1 });
    expect(JSON.stringify(buy)).toContain("payout_snapshot.taker");
    expect(JSON.stringify(buy)).toContain("payout_snapshot.taker.payout_details_enc");

    const selected = userChain.select.mock.calls[0][0];
    expect(selected).toContain("payout_profile.fingerprint.version");
    expect(selected).not.toMatch(/payout_profile(?!\.fingerprint\.version)/);
  });

  test("B39: taker snapshot of the latest trade drives the signal for a BUY_CRYPTO owner", async () => {
    const BUYER = "0x" + "b".repeat(40);
    const Order = {
      find: jest.fn(() => chain([{ _id: 1, owner_address: BUYER, side: "BUY_CRYPTO" }])),
      countDocuments: jest.fn().mockResolvedValue(1),
    };
    // taker snapshot says: profile changed after lock (version at lock 1, current 3)
    const Trade = {
      aggregate: jest.fn().mockResolvedValue([{
        _id: BUYER,
        trade: { payout_snapshot: { is_complete: true, taker: { profile_version_at_lock: 1, bank_change_count_7d_at_lock: 0 } } },
      }]),
    };
    const User = { find: jest.fn(() => chain([{ wallet_address: BUYER, payout_profile: { fingerprint: { version: 3 } } }])) };
    const app = loadOrders({ Order, Trade, User });

    const res = await request(app).get("/api/orders").expect(200);
    expect(res.body.orders[0].trust_visibility_summary).toMatchObject({ available: true, band: "YELLOW" });
  });

  test("B37: GET /orders/:id/trades is paginated (skip/limit/total) and validates query", async () => {
    const tradeChain = chain([{ _id: "t1" }]);
    const Trade = { find: jest.fn(() => tradeChain), countDocuments: jest.fn().mockResolvedValue(130) };
    const Order = { findOne: jest.fn(() => chain({ owner_address: OWNER })) };
    const app = loadOrders({ Order, Trade, User: {} });

    const res = await request(app).get("/api/orders/5/trades?page=2&limit=10").expect(200);
    expect(res.body).toMatchObject({ total: 130, page: 2, limit: 10 });
    expect(tradeChain.skip).toHaveBeenCalledWith(10);
    expect(tradeChain.limit).toHaveBeenCalledWith(10);

    await request(app).get("/api/orders/5/trades").expect(200);
    expect(tradeChain.limit).toHaveBeenLastCalledWith(50);
    await request(app).get("/api/orders/5/trades?limit=1000").expect(400);
  });
});

describe("logs route (B34)", () => {
  test("CR/LF and control characters cannot forge log lines", async () => {
    let router;
    const error = jest.fn();
    jest.isolateModules(() => {
      jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error }));
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({ clientLogLimiter: passMw }));
      router = require("../../backend/scripts/routes/logs");
    });
    const app = express();
    app.use(express.json());
    app.use("/api/logs", router);

    await request(app).post("/api/logs/client-error")
      .send({ message: "boom\r\n[INFO] admin logged in\u2028x", stack: "a\nb\rc", componentStack: "c\nd", url: "/x\r\ny" })
      .expect(204);

    const meta = error.mock.calls[0][1];
    for (const v of [meta.message, meta.stack, meta.componentStack, meta.url]) {
      expect(v).not.toMatch(/[\r\n\u2028]/);
    }
    expect(meta.message).toContain("boom [INFO] admin logged in");
  });
});

describe("trades route (B38, B33, B36)", () => {
  afterEach(() => jest.resetModules());

  function loadTrades({ Trade, assertChain, hmacDigest }) {
    const ctorCalls = [];
    let router;
    jest.isolateModules(() => {
      jest.doMock("ethers", () => {
        const real = jest.requireActual("ethers");
        return {
          ...real,
          ethers: {
            ...real.ethers,
            JsonRpcProvider: jest.fn().mockImplementation(() => { const p = { destroy: jest.fn() }; ctorCalls.push(p); return p; }),
            Contract: jest.fn().mockImplementation(() => ({
              getCurrentAmounts: jest.fn().mockResolvedValue([1n, 1n, 1n, 0n]),
            })),
          },
        };
      });
      jest.doMock("../../backend/scripts/services/expectedChain", () => ({ assertProviderExpectedChainOrThrow: assertChain }));
      jest.doMock("../../backend/scripts/services/encryption", () => ({ hmacDigest }));
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (req, _res, next) => { req.wallet = OWNER; next(); },
        requireSessionWalletMatch: passMw,
      }));
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({ roomReadLimiter: passMw, coordinationWriteLimiter: passMw }));
      jest.doMock("../../backend/scripts/models/Trade", () => Trade);
      jest.doMock("../../backend/scripts/models/User", () => ({ find: jest.fn() }));
      jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../../backend/scripts/routes/trades");
    });
    const app = express();
    app.use(express.json());
    app.use("/api/trades", router);
    return { app, router, ctorCalls };
  }

  test("B36: dead cancel-verifier hooks no longer exist", () => {
    const { router } = loadTrades({ Trade: {}, assertChain: jest.fn(), hmacDigest: jest.fn() });
    expect(router.__resetCancelVerifier).toBeUndefined();
    expect(router.__getCancelVerifierCacheKey).toBeUndefined();
  });

  test("B33: chargeback ip_hash uses the keyed HMAC, not plain sha256", async () => {
    const hmacDigest = jest.fn().mockResolvedValue("hmac-result");
    const Trade = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ chargeback_ack: { acknowledged_at: new Date() } }),
    };
    const { app } = loadTrades({ Trade, assertChain: jest.fn(), hmacDigest });
    const id = "a".repeat(24);
    await request(app).post(`/api/trades/${id}/chargeback-ack`).expect(201);
    expect(hmacDigest).toHaveBeenCalledWith("chargeback-ip", expect.any(String));
    expect(Trade.findOneAndUpdate.mock.calls[0][1].$set["chargeback_ack.ip_hash"]).toBe("hmac-result");
  });

  test("B38: failed chain validation does not cache the provider, but destroys it; success is cached", async () => {
    process.env.BASE_RPC_URL = "http://rpc.local";
    process.env.ARAF_ESCROW_ADDRESS = "0x" + "d".repeat(40);
    const TradeDoc = { maker_address: OWNER, taker_address: "0x" + "e".repeat(40), onchain_escrow_id: "9", status: "PAID",
      settlement_proposal: { state: "PROPOSED", maker_share_bps: 5000, taker_share_bps: 5000 }, financials: {} };
    const Trade = { findById: jest.fn(() => chain(TradeDoc)), findOne: jest.fn(() => chain(TradeDoc)) };
    const assertChain = jest.fn()
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValue({});
    const { router, ctorCalls } = loadTrades({ Trade, assertChain, hmacDigest: jest.fn() });

    await expect(router.__getPreviewReadContract()).rejects.toThrow("rpc down");
    await expect(router.__getPreviewReadContract()).rejects.toThrow("rpc down");
    expect(ctorCalls).toHaveLength(2);
    ctorCalls.forEach((p) => expect(p.destroy).toHaveBeenCalled());

    const ok1 = await router.__getPreviewReadContract();
    const ok2 = await router.__getPreviewReadContract();
    expect(ok1.contract).toBe(ok2.contract); // cached after success
    expect(ctorCalls).toHaveLength(3);
  });
});

describe("model indexes (B17, B24, B25, B37)", () => {
  const mongoose = require("mongoose");
  function indexes(modelPath) {
    let Model;
    jest.isolateModules(() => { Model = jest.requireActual(modelPath); });
    return Model.schema.indexes().map(([fields, opts]) => ({ fields, opts }));
  }

  test("Order: refs.order_ref is declared once (unique) and market sort indexes exist", () => {
    const idx = indexes("../../backend/scripts/models/Order");
    const orderRef = idx.filter((i) => i.fields["refs.order_ref"] === 1);
    expect(orderRef).toHaveLength(1);
    expect(orderRef[0].opts.unique).toBe(true);
    expect(idx.some((i) => JSON.stringify(i.fields) === JSON.stringify({ side: 1, status: 1, "amounts.remaining_amount_num": -1, _id: -1 }))).toBe(true);
  });

  test("User: wallet_address has a single unique index", () => {
    const idx = indexes("../../backend/scripts/models/User").filter((i) => i.fields.wallet_address === 1);
    expect(idx).toHaveLength(1);
    expect(idx[0].opts.unique).toBe(true);
  });

  test("Trade: sparse snapshot_delete_at index; no single-field index duplicating a compound prefix", () => {
    const idx = indexes("../../backend/scripts/models/Trade");
    const snap = idx.find((i) => i.fields["payout_snapshot.snapshot_delete_at"] === 1);
    expect(snap.opts.sparse).toBe(true);
    const single = idx.filter((i) => Object.keys(i.fields).length === 1).map((i) => Object.keys(i.fields)[0]);
    for (const redundant of ["parent_order_id", "maker_address", "taker_address", "trade_origin", "parent_order_side", "token_address", "tier", "settlement_proposal.state"]) {
      expect(single).not.toContain(redundant);
    }
    // compound indexes that cover them remain
    expect(idx.some((i) => Object.keys(i.fields)[0] === "maker_address" && Object.keys(i.fields).length > 1)).toBe(true);
    expect(idx.some((i) => JSON.stringify(i.fields) === JSON.stringify({ taker_address: 1, created_at: -1 }))).toBe(true);
    expect(mongoose).toBeDefined();
  });
});
