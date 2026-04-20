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
        ordersWriteLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/models/Order", () => Order);
      jest.doMock("../scripts/models/Trade", () => ({ find: jest.fn() }));
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
});
