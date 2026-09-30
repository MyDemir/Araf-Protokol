"use strict";

const express = require("express");
const request = require("supertest");

const WALLET = "0x1111111111111111111111111111111111111111";
const MAKER = "0x2222222222222222222222222222222222222222";
const TRADE_ID = "a".repeat(24);

describe("onchainTradeState service", () => {
  let svc;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    svc = require("../../backend/scripts/services/onchainTradeState");
    svc._resetForTests();
  });

  it("maps LOCKED/PAID/CHALLENGED to active and terminal states to closed", async () => {
    for (const [state, active] of [[1, true], [2, true], [3, true], [4, false], [5, false], [6, false]]) {
      svc._resetForTests();
      const reader = { getTrade: jest.fn().mockResolvedValue({ state }) };
      expect(await svc.isTradeActiveOnChain("7", { reader })).toBe(active);
    }
  });

  it("caches results so repeated PII reads do not hit the RPC", async () => {
    const reader = { getTrade: jest.fn().mockResolvedValue({ state: 2 }) };
    await svc.isTradeActiveOnChain("9", { reader, now: 1_000 });
    await svc.isTradeActiveOnChain("9", { reader, now: 5_000 });
    expect(reader.getTrade).toHaveBeenCalledTimes(1);
    await svc.isTradeActiveOnChain("9", { reader, now: 20_000 });
    expect(reader.getTrade).toHaveBeenCalledTimes(2);
  });

  it("returns null (mirror decides) when the RPC fails or no reader/id", async () => {
    const reader = { getTrade: jest.fn().mockRejectedValue(new Error("down")) };
    expect(await svc.isTradeActiveOnChain("3", { reader })).toBeNull();
    expect(await svc.isTradeActiveOnChain("3", { reader: null })).toBeNull();
    expect(await svc.isTradeActiveOnChain(null, { reader })).toBeNull();
  });
});

describe("PII routes honour on-chain closure", () => {
  afterEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  function buildApp(activeOnChain) {
    const decryptField = jest.fn().mockResolvedValue(JSON.stringify({ iban: "TR00", account_holder_name: "X" }));
    const trade = {
      maker_address: MAKER,
      taker_address: WALLET,
      status: "PAID",
      onchain_escrow_id: "42",
      payout_snapshot: {
        is_complete: true,
        maker: { payout_details_enc: "enc", rail: "TR_IBAN" },
        taker: { payout_details_enc: "enc" },
      },
    };
    let router;
    jest.isolateModules(() => {
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (req, _res, next) => { req.wallet = req.headers["x-test-wallet"] || WALLET; next(); },
        requireSessionWalletMatch: (_req, _res, next) => next(),
        requirePIIToken: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({ piiProfileLimiter: (_req, _res, next) => next(), piiTakerNameLimiter: (_req, _res, next) => next(), piiTokenRequestLimiter: (_req, _res, next) => next(), piiFetchLimiter: (_req, _res, next) => next() }));
      jest.doMock("../../backend/scripts/services/identityNormalizationGuard", () => ({
        verifyIdentityNormalization: jest.fn().mockResolvedValue(),
      }));
      const lean = () => ({ lean: jest.fn().mockResolvedValue(trade) });
      jest.doMock("../../backend/scripts/models/Trade", () => ({
        findById: jest.fn(() => ({ select: jest.fn(lean) })),
        findOne: jest.fn(() => ({ select: jest.fn(lean) })),
      }));
      jest.doMock("../../backend/scripts/models/User", () => ({ findOne: jest.fn() }));
      jest.doMock("../../backend/scripts/services/encryption", () => ({ decryptField, decryptPayoutProfile: jest.fn() }));
      jest.doMock("../../backend/scripts/services/siwe", () => ({ issuePIIToken: jest.fn() }));
      jest.doMock("../../backend/scripts/services/onchainTradeState", () => ({
        isTradeActiveOnChain: jest.fn().mockResolvedValue(activeOnChain),
      }));
      jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../../backend/scripts/routes/pii");
    });
    const app = express();
    app.use("/api/pii", router);
    return { app, decryptField };
  }

  it("denies taker PII when the chain already closed the trade, without decrypting", async () => {
    const { app, decryptField } = buildApp(false);
    const res = await request(app).get(`/api/pii/${TRADE_ID}`);
    expect(res.status).toBe(403);
    expect(decryptField).not.toHaveBeenCalled();
  });

  it("denies maker taker-name lookup when the chain already closed the trade", async () => {
    const { app, decryptField } = buildApp(false);
    const res = await request(app).get("/api/pii/taker-name/42").set("x-test-wallet", MAKER);
    expect(res.status).toBe(400);
    expect(decryptField).not.toHaveBeenCalled();
  });

  it("serves PII when the chain agrees, and falls back to the mirror when the RPC is unknown", async () => {
    for (const state of [true, null]) {
      const { app, decryptField } = buildApp(state);
      const res = await request(app).get(`/api/pii/${TRADE_ID}`);
      expect(res.status).toBe(200);
      expect(decryptField).toHaveBeenCalled();
      jest.resetModules();
    }
  });
});
