"use strict";

const fs = require("fs");
const path = require("path");

jest.mock("../services/siwe", () => ({
  verifyJWT: jest.fn(),
  isJWTBlacklisted: jest.fn(),
}));
jest.mock("../utils/logger", () => ({
  warn: jest.fn(),
}));

const { requireSessionWalletMatch } = require("../middleware/auth");

describe("session-wallet strict match guard", () => {
  test("rejects when header wallet is missing", () => {
    const req = { headers: {}, wallet: "0x1111111111111111111111111111111111111111" };
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    const next = jest.fn();

    requireSessionWalletMatch(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("SESSION_WALLET_HEADER_MISSING");
  });

  test("rejects mismatched cookie wallet vs header wallet", () => {
    const req = {
      headers: { "x-wallet-address": "0x2222222222222222222222222222222222222222" },
      wallet: "0x1111111111111111111111111111111111111111",
    };
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    const next = jest.fn();

    requireSessionWalletMatch(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("SESSION_WALLET_MISMATCH");
  });

  test("route write-paths include session-wallet guard", () => {
    const authRoute = fs.readFileSync(path.join(__dirname, "../routes/auth.js"), "utf8");
    const listingsRoute = fs.readFileSync(path.join(__dirname, "../routes/listings.js"), "utf8");
    const tradesRoute = fs.readFileSync(path.join(__dirname, "../routes/trades.js"), "utf8");
    const receiptsRoute = fs.readFileSync(path.join(__dirname, "../routes/receipts.js"), "utf8");

    expect(authRoute).toContain("requireSessionWalletMatch");
    expect(listingsRoute).toContain("router.post(\"/\", requireAuth, requireSessionWalletMatch, listingsWriteLimiter");
    expect(listingsRoute).toContain("router.delete(\"/:id\", requireAuth, requireSessionWalletMatch");
    expect(tradesRoute).toContain("router.post(\"/propose-cancel\", requireAuth, requireSessionWalletMatch, tradesLimiter");
    expect(tradesRoute).toContain("router.post(\"/:id/chargeback-ack\", requireAuth, requireSessionWalletMatch, tradesLimiter");
    expect(receiptsRoute).toContain("requireSessionWalletMatch");
  });
});
