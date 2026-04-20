"use strict";

const express = require("express");
const request = require("supertest");

function buildApp(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.wallet = "0x1111111111111111111111111111111111111111";
    next();
  });
  return app;
}

describe("orders/trades pagination + big on-chain id", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("paginates /api/orders/my with default, custom and max-cap validation", async () => {
    const findLean = jest.fn().mockResolvedValue([]);
    const findChain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: findLean,
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

    const app = buildApp(router);
    app.use("/api/orders", router);

    const defRes = await request(app).get("/api/orders/my");
    expect(defRes.status).toBe(200);
    expect(defRes.body.limit).toBe(20);

    const customRes = await request(app).get("/api/orders/my?page=2&limit=5");
    expect(customRes.status).toBe(200);
    expect(customRes.body.page).toBe(2);
    expect(customRes.body.limit).toBe(5);

    const capRes = await request(app).get("/api/orders/my?limit=999");
    expect(capRes.status).toBe(400);
  });

  it("supports huge string onchain escrow id in /api/trades/by-escrow/:onchainId lookup", async () => {
    const Trade = {
      find: jest.fn(),
      countDocuments: jest.fn(),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            maker_address: "0x1111111111111111111111111111111111111111",
            taker_address: "0x2222222222222222222222222222222222222222",
          }),
        }),
      }),
    };

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        tradesLimiter: (_req, _res, next) => next(),
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

    const app = buildApp(router);
    app.use("/api/trades", router);

    const huge = "900719925474099312345";
    const res = await request(app).get(`/api/trades/by-escrow/${huge}`);
    expect(res.status).toBe(200);

    const filter = Trade.findOne.mock.calls[0][0];
    expect(filter.$expr.$eq[0].$toString).toBe("$onchain_escrow_id");
    expect(filter.$expr.$eq[1]).toBe(huge);
  });

  it("paginates /api/trades/my with defaults, custom values and cap validation", async () => {
    const findLean = jest.fn().mockResolvedValue([]);
    const findChain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: findLean,
    };
    const Trade = {
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
        tradesLimiter: (_req, _res, next) => next(),
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

    const app = buildApp(router);
    app.use("/api/trades", router);

    const defRes = await request(app).get("/api/trades/my");
    expect(defRes.status).toBe(200);
    expect(defRes.body.limit).toBe(20);

    const customRes = await request(app).get("/api/trades/my?page=2&limit=8");
    expect(customRes.status).toBe(200);
    expect(customRes.body.page).toBe(2);
    expect(customRes.body.limit).toBe(8);

    const capRes = await request(app).get("/api/trades/my?limit=999");
    expect(capRes.status).toBe(400);
  });

  it("receipt upload rejects non-numeric onchainEscrowId and supports huge numeric string", async () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tempPdfPath = path.join(os.tmpdir(), `receipt-test-${Date.now()}.pdf`);
    fs.writeFileSync(tempPdfPath, Buffer.from("%PDF-1.4 test"));

    const Trade = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: "ok" }),
      findOne: jest.fn(),
    };

    let router;
    jest.isolateModules(() => {
      jest.doMock("multer", () => {
        const mw = (_req, _res, next) => {
          _req.file = { path: tempPdfPath, mimetype: "application/pdf" };
          next();
        };
        const multerFn = () => ({ single: () => mw });
        multerFn.diskStorage = () => ({});
        return multerFn;
      });
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (req, _res, next) => { req.wallet = "0x1111111111111111111111111111111111111111"; next(); },
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        tradesLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/services/encryption", () => ({ encryptField: jest.fn().mockResolvedValue("enc") }));
      jest.doMock("../scripts/models/Trade", () => Trade);
      jest.doMock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../scripts/routes/receipts");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/receipts", router);

    const badRes = await request(app).post("/api/receipts/upload").send({ onchainEscrowId: "abc" });
    expect(badRes.status).toBe(400);
    fs.writeFileSync(tempPdfPath, Buffer.from("%PDF-1.4 test"));

    const huge = "900719925474099312345";
    const okRes = await request(app).post("/api/receipts/upload").send({ onchainEscrowId: huge });
    expect(okRes.status).toBe(201);
    expect(Trade.findOneAndUpdate.mock.calls[0][0].$expr.$eq[0].$toString).toBe("$onchain_escrow_id");
    expect(Trade.findOneAndUpdate.mock.calls[0][0].$expr.$eq[1]).toBe(huge);

    if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
  });
});
