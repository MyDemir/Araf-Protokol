"use strict";

const express = require("express");
const request = require("supertest");

describe("orders/listings sort semantics on string onchain ids", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("orders market route does not use lexicographic onchain_order_id tie-break", async () => {
    const findChain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    const Order = {
      find: jest.fn(() => findChain),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
    };

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        marketReadLimiter: (_req, _res, next) => next(),
        ordersReadLimiter: (_req, _res, next) => next(),
        ordersWriteLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/models/Order", () => Order);
      jest.doMock("../scripts/models/Trade", () => ({ find: jest.fn(), aggregate: jest.fn().mockResolvedValue([]) }));
      jest.doMock("../scripts/models/User", () => ({
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        }),
      }));
      jest.doMock("../scripts/services/protocolConfig", () => ({ getConfig: jest.fn(() => ({ bondMap: {}, feeConfig: {}, cooldownConfig: {}, tokenMap: {} })) }));
      router = require("../scripts/routes/orders");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/orders", router);

    const res = await request(app).get("/api/orders");
    expect(res.status).toBe(200);

    const sortArg = findChain.sort.mock.calls[0][0];
    expect(sortArg._id).toBe(-1);
    expect(sortArg.onchain_order_id).toBeUndefined();
  });

  it("listings route uses deterministic _id tie-break instead of onchain_order_id string sort", async () => {
    const findChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    const Order = {
      find: jest.fn(() => findChain),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        marketReadLimiter: (_req, _res, next) => next(),
        ordersReadLimiter: (_req, _res, next) => next(),
        ordersWriteLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/models/Order", () => Order);
      jest.doMock("../scripts/services/protocolConfig", () => ({ getConfig: jest.fn(() => ({ bondMap: {}, feeConfig: {}, cooldownConfig: {}, tokenMap: {} })) }));
      jest.doMock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../scripts/routes/listings");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/listings", router);

    const res = await request(app).get("/api/listings");
    expect(res.status).toBe(200);

    const sortArg = findChain.sort.mock.calls[0][0];
    expect(sortArg._id).toBe(1);
    expect(sortArg.onchain_order_id).toBeUndefined();
  });

  it("trades history route uses _id tie-break instead of onchain_escrow_id lexicographic sort", async () => {
    const findChain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    const Trade = {
      find: jest.fn(() => findChain),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (req, _res, next) => { req.wallet = "0x1111111111111111111111111111111111111111"; next(); },
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        roomReadLimiter: (_req, _res, next) => next(),
        coordinationWriteLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/models/Trade", () => Trade);
      jest.doMock("../scripts/models/User", () => ({
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        }),
      }));
      jest.doMock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../scripts/routes/trades");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/trades", router);

    const res = await request(app).get("/api/trades/history");
    expect(res.status).toBe(200);

    const sortArg = findChain.sort.mock.calls[0][0];
    expect(sortArg["timers.resolved_at"]).toBe(-1);
    expect(sortArg._id).toBe(-1);
    expect(sortArg.onchain_escrow_id).toBeUndefined();
  });
});
