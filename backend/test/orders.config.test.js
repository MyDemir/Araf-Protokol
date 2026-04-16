"use strict";

const request = require("supertest");
const express = require("express");

jest.mock("../scripts/services/protocolConfig", () => ({
  getConfig: jest.fn(() => ({
    bondMap: { 1: { maker: 800, taker: 1000 } },
    feeConfig: { currentTakerFeeBps: 10, currentMakerFeeBps: 5 },
    cooldownConfig: { currentTier0TradeCooldown: 3600, currentTier1TradeCooldown: 600 },
    tokenMap: { usdt: { symbol: "USDT" } },
  })),
}));

jest.mock("../scripts/middleware/auth", () => ({
  requireAuth: (_req, _res, next) => next(),
}));

jest.mock("../scripts/middleware/rateLimiter", () => ({
  marketReadLimiter: (_req, _res, next) => next(),
  ordersWriteLimiter: (_req, _res, next) => next(),
}));

describe("GET /api/orders/config", () => {
  it("returns canonical response shape from protocolConfig mirror", async () => {
    const router = require("../scripts/routes/orders");
    const app = express();
    app.use("/api/orders", router);

    const res = await request(app).get("/api/orders/config").expect(200);
    expect(res.body).toHaveProperty("bondMap");
    expect(res.body).toHaveProperty("feeConfig");
    expect(res.body).toHaveProperty("cooldownConfig");
    expect(res.body).toHaveProperty("tokenMap");
    expect(res.body.feeConfig.currentTakerFeeBps).toBe(10);
  });
});
