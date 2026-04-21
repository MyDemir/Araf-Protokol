"use strict";

const express = require("express");
const request = require("supertest");

const mockMismatchResponse = {
  error: "Oturum cüzdanı aktif bağlı cüzdanla eşleşmiyor. Lütfen yeniden giriş yapın.",
  code: "SESSION_WALLET_MISMATCH",
};

jest.mock("../scripts/middleware/auth", () => ({
  requireAuth: (req, _res, next) => {
    req.wallet = "0x1111111111111111111111111111111111111111";
    next();
  },
  requireSessionWalletMatch: (req, res, next) => {
    const headerWallet = String(req.headers["x-wallet-address"] || "").toLowerCase();
    if (headerWallet !== req.wallet) {
      return res.status(409).json(mockMismatchResponse);
    }
    return next();
  },
}));

jest.mock("../scripts/middleware/rateLimiter", () => ({
  ordersWriteLimiter: (_req, _res, next) => next(),
  ordersReadLimiter: (_req, _res, next) => next(),
  marketReadLimiter: (_req, _res, next) => next(),
  feedbackLimiter: (_req, _res, next) => next(),
}));

jest.mock("../scripts/models/Order", () => ({
  find: jest.fn(() => ({
    select: jest.fn(() => ({ sort: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })) })),
  })),
  findOne: jest.fn(() => ({
    select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ owner_address: "0x1111111111111111111111111111111111111111" }) })),
  })),
}));

jest.mock("../scripts/models/Trade", () => ({
  find: jest.fn(() => ({
    select: jest.fn(() => ({ sort: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })) })),
  })),
}));

jest.mock("../scripts/models/Feedback", () => ({
  create: jest.fn().mockResolvedValue({}),
}));

describe("session-wallet guard on user-scoped routes", () => {
  it("returns 409 on GET /api/orders/my wallet mismatch", async () => {
    const router = require("../scripts/routes/orders");
    const app = express();
    app.use(express.json());
    app.use("/api/orders", router);

    const res = await request(app)
      .get("/api/orders/my")
      .set("x-wallet-address", "0x2222222222222222222222222222222222222222");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SESSION_WALLET_MISMATCH");
  });

  it("returns 409 on GET /api/orders/:id/trades wallet mismatch", async () => {
    const router = require("../scripts/routes/orders");
    const app = express();
    app.use(express.json());
    app.use("/api/orders", router);

    const res = await request(app)
      .get("/api/orders/1/trades")
      .set("x-wallet-address", "0x2222222222222222222222222222222222222222");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SESSION_WALLET_MISMATCH");
  });

  it("returns 409 on POST /api/feedback wallet mismatch", async () => {
    const router = require("../scripts/routes/feedback");
    const app = express();
    app.use(express.json());
    app.use("/api/feedback", router);

    const res = await request(app)
      .post("/api/feedback")
      .set("x-wallet-address", "0x2222222222222222222222222222222222222222")
      .send({
        rating: 5,
        category: "bug",
        comment: "mismatch check",
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SESSION_WALLET_MISMATCH");
  });
});
