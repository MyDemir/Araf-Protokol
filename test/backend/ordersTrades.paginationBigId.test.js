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

    const ordersReadLimiter = jest.fn((_req, _res, next) => next());
    const ordersWriteLimiter = jest.fn((_req, _res, next) => next());

    let router;
    jest.isolateModules(() => {
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
        marketReadLimiter: (_req, _res, next) => next(),
        ordersReadLimiter,
        ordersWriteLimiter,
      }));
      jest.doMock("../../backend/scripts/models/Order", () => Order);
      jest.doMock("../../backend/scripts/models/Trade", () => ({ find: jest.fn() }));
      jest.doMock("../../backend/scripts/services/protocolConfig", () => ({ getConfig: jest.fn(() => ({ bondMap: {}, feeConfig: {}, cooldownConfig: {}, tokenMap: {} })) }));
      router = require("../../backend/scripts/routes/orders");
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

    // [TR] /my read endpoint'i write limiter değil read limiter kullanmalı.
    // [EN] /my should use read limiter, not write limiter.
    expect(ordersReadLimiter).toHaveBeenCalled();
    expect(ordersWriteLimiter).not.toHaveBeenCalled();
  });

  it("uses read limiter (not write limiter) on GET /api/orders/:id/trades", async () => {
    const Order = {
      find: jest.fn(),
      countDocuments: jest.fn(),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            owner_address: "0x1111111111111111111111111111111111111111",
          }),
        }),
      }),
    };
    const Trade = {
      find: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      })),
    };

    const ordersReadLimiter = jest.fn((_req, _res, next) => next());
    const ordersWriteLimiter = jest.fn((_req, _res, next) => next());

    let router;
    jest.isolateModules(() => {
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
        marketReadLimiter: (_req, _res, next) => next(),
        ordersReadLimiter,
        ordersWriteLimiter,
      }));
      jest.doMock("../../backend/scripts/models/Order", () => Order);
      jest.doMock("../../backend/scripts/models/Trade", () => Trade);
      jest.doMock("../../backend/scripts/services/protocolConfig", () => ({ getConfig: jest.fn(() => ({ bondMap: {}, feeConfig: {}, cooldownConfig: {}, tokenMap: {} })) }));
      router = require("../../backend/scripts/routes/orders");
    });

    const app = buildApp(router);
    app.use("/api/orders", router);

    const res = await request(app).get("/api/orders/1/trades");
    expect(res.status).toBe(200);
    expect(ordersReadLimiter).toHaveBeenCalled();
    expect(ordersWriteLimiter).not.toHaveBeenCalled();
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
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
        roomReadLimiter: (_req, _res, next) => next(),
        coordinationWriteLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/models/Trade", () => Trade);
      jest.doMock("../../backend/scripts/models/User", () => ({
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        }),
      }));
      jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../../backend/scripts/routes/trades");
    });

    const app = buildApp(router);
    app.use("/api/trades", router);

    const huge = "900719925474099312345";
    const res = await request(app).get(`/api/trades/by-escrow/${huge}`);
    expect(res.status).toBe(200);

    const filter = Trade.findOne.mock.calls[0][0];
    expect(filter.onchain_escrow_id).toBe(huge);
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

    const roomReadLimiter = jest.fn((_req, _res, next) => next());
    const coordinationWriteLimiter = jest.fn((_req, _res, next) => next());

    let router;
    jest.isolateModules(() => {
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
        roomReadLimiter,
        coordinationWriteLimiter,
      }));
      jest.doMock("../../backend/scripts/models/Trade", () => Trade);
      jest.doMock("../../backend/scripts/models/User", () => ({
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        }),
      }));
      jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../../backend/scripts/routes/trades");
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
    expect(roomReadLimiter).toHaveBeenCalled();
    expect(coordinationWriteLimiter).not.toHaveBeenCalled();
  });

  it("receipt upload rejects non-numeric onchainEscrowId and supports huge numeric string", async () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tempPdfPathBad = path.join(os.tmpdir(), `receipt-test-bad-${Date.now()}.pdf`);
    const tempPdfPathOk = path.join(os.tmpdir(), `receipt-test-ok-${Date.now()}.pdf`);
    fs.writeFileSync(tempPdfPathBad, Buffer.from("%PDF-1.4 bad"));
    fs.writeFileSync(tempPdfPathOk, Buffer.from("%PDF-1.4 ok"));

    const Trade = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: "ok" }),
      findOne: jest.fn(),
    };

    const roomReadLimiter = jest.fn((_req, _res, next) => next());
    const receiptUploadLimiter = jest.fn((_req, _res, next) => next());

    let uploadCallCount = 0;
    let router;
    jest.isolateModules(() => {
      jest.doMock("multer", () => {
        const mw = (_req, _res, next) => {
          uploadCallCount += 1;
          _req.file = {
            path: uploadCallCount === 1 ? tempPdfPathBad : tempPdfPathOk,
            mimetype: "application/pdf",
          };
          next();
        };
        const multerFn = () => ({ single: () => mw });
        multerFn.diskStorage = () => ({});
        return multerFn;
      });
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (req, _res, next) => { req.wallet = "0x1111111111111111111111111111111111111111"; next(); },
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
        roomReadLimiter,
        coordinationWriteLimiter: (_req, _res, next) => next(),
        receiptUploadLimiter,
      }));
      jest.doMock("../../backend/scripts/services/encryption", () => ({ encryptField: jest.fn().mockResolvedValue("enc") }));
      jest.doMock("../../backend/scripts/models/Trade", () => Trade);
      jest.doMock("../../backend/scripts/models/User", () => ({
        findOne: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue(null),
          }),
        }),
      }));
      jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../../backend/scripts/routes/receipts");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/receipts", router);

    const badRes = await request(app).post("/api/receipts/upload").send({ onchainEscrowId: "abc" });
    expect(badRes.status).toBe(400);

    const huge = "900719925474099312345";
    const okRes = await request(app).post("/api/receipts/upload").send({ onchainEscrowId: huge });
    expect(okRes.status).toBe(201);
    expect(Trade.findOneAndUpdate.mock.calls[0][0].onchain_escrow_id).toBe(huge);
    expect(receiptUploadLimiter).toHaveBeenCalled();
    expect(roomReadLimiter).not.toHaveBeenCalled();

    for (const filePath of [tempPdfPathBad, tempPdfPathOk]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });
});
