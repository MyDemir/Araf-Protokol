"use strict";

const request = require("supertest");
const express = require("express");

jest.mock("../scripts/services/protocolConfig", () => ({
  getConfig: jest.fn(() => ({
    bondMap: { 1: { maker: 800, taker: 1000 } },
    feeConfig: { currentTakerFeeBps: 10, currentMakerFeeBps: 5 },
    cooldownConfig: { currentTier0TradeCooldown: 3600, currentTier1TradeCooldown: 600 },
    tokenMap: {
      usdt: {
        supported: true,
        allowSellOrders: true,
        allowBuyOrders: true,
        decimals: 6,
        tierMaxAmountsBaseUnit: ["150000000", "1500000000", "7500000000", "30000000000"],
      },
    },
  })),
}));

jest.mock("../scripts/middleware/auth", () => ({
  requireAuth: (_req, _res, next) => next(),
  requireSessionWalletMatch: (_req, _res, next) => next(),
}));

jest.mock("../scripts/middleware/rateLimiter", () => ({
  marketReadLimiter: (_req, _res, next) => next(),
  ordersReadLimiter: (_req, _res, next) => next(),
  ordersWriteLimiter: (_req, _res, next) => next(),
}));

describe("GET /api/orders/config", () => {
  it("orders_config_exposes_token_decimals_and_tier_limits", async () => {
    const router = require("../scripts/routes/orders");
    const app = express();
    app.use("/api/orders", router);

    const res = await request(app).get("/api/orders/config").expect(200);
    expect(res.body).toHaveProperty("bondMap");
    expect(res.body).toHaveProperty("feeConfig");
    expect(res.body).toHaveProperty("cooldownConfig");
    expect(res.body).toHaveProperty("tokenMap");
    expect(res.body.feeConfig.currentTakerFeeBps).toBe(10);
    expect(res.body.tokenMap.usdt.decimals).toBe(6);
    expect(res.body.tokenMap.usdt.tierMaxAmountsBaseUnit).toEqual([
      "150000000",
      "1500000000",
      "7500000000",
      "30000000000",
    ]);
  });
});
