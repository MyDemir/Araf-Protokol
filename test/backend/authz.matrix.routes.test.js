"use strict";

const express = require("express");
const request = require("supertest");
const cookieParser = require("cookie-parser");

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const ADMIN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function buildApp() {
  jest.resetModules();
  process.env.ADMIN_WALLETS = ADMIN;

  jest.doMock("../../backend/scripts/services/siwe", () => ({
    verifyJWT: jest.fn((token) => {
      if (token === "good") return { type: "auth", sub: WALLET, jti: "j1" };
      if (token === "admin") return { type: "auth", sub: ADMIN, jti: "j2" };
      if (token === "no-jti") return { type: "auth", sub: WALLET };
      if (token === "pii-good") return { type: "pii", sub: WALLET, tradeId: "507f1f77bcf86cd799439011" };
      if (token === "pii-bad") return { type: "pii", sub: WALLET, tradeId: "507f1f77bcf86cd799439012" };
      throw new Error("invalid");
    }),
    isJWTBlacklisted: jest.fn().mockResolvedValue(false),
    revokeRefreshToken: jest.fn().mockResolvedValue(),
    blacklistJWT: jest.fn().mockResolvedValue(),
    issuePIIToken: jest.fn(() => "pii-good"),
  }));

  jest.doMock("../../backend/scripts/middleware/rateLimiter", () => new Proxy({}, { get: () => (_req, _res, next) => next() }));
  const emptyFind = () => ({ select: () => ({ lean: async () => null }) });
  jest.doMock("../../backend/scripts/models/User", () => ({ findOne: jest.fn(emptyFind), find: jest.fn(() => ({ select: () => ({ lean: async () => [] }) })) }));
  jest.doMock("../../backend/scripts/models/Order", () => ({ find: jest.fn(() => ({ select: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) }) })), countDocuments: jest.fn(async () => 0) }));
  jest.doMock("../../backend/scripts/models/Trade", () => ({
    findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ _id: "507f1f77bcf86cd799439011", maker_address: WALLET, taker_address: WALLET, status: "LOCKED", payout_snapshot: { maker: { payout_details_enc: "x" }, taker: { payout_details_enc: "x" }, is_complete: true } }) }) })),
    findOne: jest.fn(() => ({ select: () => ({ lean: async () => ({ maker_address: WALLET, taker_address: WALLET, status: "LOCKED", payout_snapshot: { maker: { payout_details_enc: "x" }, taker: { payout_details_enc: "x" }, is_complete: true } }) }) })),
    findOneAndUpdate: jest.fn(async () => null),
    find: jest.fn(() => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }), limit: () => ({ lean: async () => [] }), lean: async () => [] }) })),
  }));
  jest.doMock("../../backend/scripts/models/Feedback", () => ({}));
  jest.doMock("../../backend/scripts/models/HistoricalStat", () => ({ findOne: jest.fn(() => ({ sort: () => ({ lean: async () => null }) })) }));
  jest.doMock("../../backend/scripts/models/RevenueEvent", () => ({ find: jest.fn(() => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) })) }));
  jest.doMock("../../backend/scripts/models/RewardEpoch", () => ({ countDocuments: jest.fn(async () => 0) }));
  jest.doMock("../../backend/scripts/models/RewardFunding", () => ({ countDocuments: jest.fn(async () => 0) }));
  jest.doMock("../../backend/scripts/models/RewardClaim", () => ({ countDocuments: jest.fn(async () => 0) }));
  jest.doMock("../../backend/scripts/services/protocolConfig", () => ({ getConfig: jest.fn(() => ({ tokenMap: {}, bondMap: {}, feeConfig: {}, cooldownConfig: {} })) }));
  jest.doMock("../../backend/scripts/services/health", () => ({ getReadiness: jest.fn(async () => ({ ok: true })) }));
  jest.doMock("../../backend/scripts/services/dlqProcessor", () => ({ getDlqMetrics: jest.fn(async () => ({ depth: 0 })) }));
  jest.doMock("../../backend/scripts/services/encryption", () => ({ decryptField: jest.fn(async () => JSON.stringify({ account_holder_name: "A" })), decryptPayoutProfile: jest.fn(async () => ({})), encryptField: jest.fn(async () => "enc") }));
  jest.doMock("../../backend/scripts/services/identityNormalizationGuard", () => ({ verifyIdentityNormalization: jest.fn(async () => true) }));

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", require("../../backend/scripts/routes/auth"));
  app.use("/api/orders", require("../../backend/scripts/routes/orders"));
  app.use("/api/trades", require("../../backend/scripts/routes/trades"));
  app.use("/api/pii", require("../../backend/scripts/routes/pii"));
  app.use("/api/receipts", require("../../backend/scripts/routes/receipts"));
  app.use("/api/admin", require("../../backend/scripts/routes/admin"));
  app.use("/api/logs", require("../../backend/scripts/routes/logs"));
  return app;
}

const withAuth = (req, token = "good", wallet = WALLET) => req.set("Cookie", [`araf_jwt=${token}`]).set("x-wallet-address", wallet);

describe("route authorization matrix", () => {
  it("table driven auth matrix across route groups", async () => {
    const app = buildApp();
    const cases = [
      ["unauth /api/auth/me", request(app).get("/api/auth/me"), 401],
      ["auth me", withAuth(request(app).get("/api/auth/me")), 200],
      ["jti-less", withAuth(request(app).get("/api/auth/me"), "no-jti"), 401],
      ["wallet mismatch", withAuth(request(app).put("/api/auth/profile").send({}), "good", OTHER), 409],
      ["orders write route is intentionally unavailable", request(app).post("/api/orders").send({}), 404],
      ["trades coordination mismatch", withAuth(request(app).post("/api/trades/propose-cancel").send({ tradeId: "507f1f77bcf86cd799439011" }), "good", OTHER), 409],
      ["pii token missing", withAuth(request(app).get("/api/pii/507f1f77bcf86cd799439011")), 401],
      ["pii token mismatch", withAuth(request(app).get("/api/pii/507f1f77bcf86cd799439011").set("Authorization", "Bearer pii-bad")), 403],
      ["admin non-admin forbidden", withAuth(request(app).get("/api/admin/summary")), 403],
      ["admin allowed", withAuth(request(app).get("/api/admin/summary"), "admin", ADMIN), 200],
      ["logs intentionally public", request(app).post("/api/logs/client-error").send({ message: "boom" }), 204],
      ["logs invalid body", request(app).post("/api/logs/client-error").send({}), 400],
      ["receipts write unauth", request(app).post("/api/receipts/upload"), 401],
      ["method not allowed", withAuth(request(app).delete("/api/auth/me")), 404],
    ];

    for (const [name, req, status] of cases) {
      const res = await req;
      expect(res.status).toBe(status);
    }
  });
});
