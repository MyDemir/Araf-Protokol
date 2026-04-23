"use strict";

const express = require("express");
const request = require("supertest");

describe("auth profile payout rail validation", () => {
  let app;
  let UserMock;
  let TradeMock;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const existingUser = {
        wallet_address: "0x1111111111111111111111111111111111111111",
        profileVersion: 1,
        lastBankChangeAt: null,
        bankChangeCount7d: 0,
        bankChangeCount30d: 0,
        payout_profile: { fingerprint: { version: 0 } },
        markBankProfileChanged: jest.fn(),
        recomputeBankChangeCounters: jest.fn(),
        save: jest.fn().mockResolvedValue(),
      };
      UserMock = {
        findOne: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue(existingUser),
        }),
      };

      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (req, _res, next) => {
          req.wallet = "0x1111111111111111111111111111111111111111";
          next();
        },
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        authLimiter: (_req, _res, next) => next(),
        nonceLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/services/siwe", () => ({
        generateNonce: jest.fn(),
        verifySiweSignature: jest.fn(),
        getSiweConfig: jest.fn(),
        issueJWT: jest.fn(),
        issueRefreshToken: jest.fn(),
        rotateRefreshToken: jest.fn(),
        revokeRefreshToken: jest.fn(),
        blacklistJWT: jest.fn(),
      }));
      jest.doMock("../scripts/services/encryption", () => ({
        encryptPayoutProfile: jest.fn().mockResolvedValue({
          rail: "TR_IBAN",
          country: "TR",
          contact: { channel: "telegram", value_enc: "enc" },
          payout_details_enc: "enc",
          fingerprint: { version: 1, hash: "hash" },
        }),
        decryptPayoutProfile: jest.fn(),
        buildPayoutFingerprint: jest.fn().mockReturnValue("fp"),
      }));
      jest.doMock("../scripts/models/User", () => UserMock);
      TradeMock = { exists: jest.fn().mockResolvedValue(false) };
      jest.doMock("../scripts/models/Trade", () => TradeMock);
      jest.doMock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

      const router = require("../scripts/routes/auth");
      app = express();
      app.use(express.json());
      app.use("/api/auth", router);
    });
  });

  it("accepts only supported rails and validates rail-specific fields", async () => {
    const okTr = await request(app).put("/api/auth/profile").send({
      payoutProfile: {
        rail: "TR_IBAN",
        country: "TR",
        contact: { channel: "telegram", value: "tester1" },
        fields: {
          account_holder_name: "Test User",
          iban: "TR123456789012345678901234",
          routing_number: null, account_number: null, account_type: null, bic: null, bank_name: "Bank",
        },
      },
    });
    expect(okTr.status).toBe(200);

    const badRail = await request(app).put("/api/auth/profile").send({
      payoutProfile: {
        rail: "SWIFT", country: "TR", contact: { channel: "telegram", value: "tester1" },
        fields: { account_holder_name: "Test User", iban: "TR123456789012345678901234", routing_number: null, account_number: null, account_type: null, bic: null, bank_name: "Bank" },
      },
    });
    expect(badRail.status).toBe(400);

    const badAch = await request(app).put("/api/auth/profile").send({
      payoutProfile: {
        rail: "US_ACH", country: "US", contact: { channel: "telegram", value: "tester1" },
        fields: { account_holder_name: "Test User", iban: null, routing_number: "123", account_number: "12", account_type: "checking", bic: null, bank_name: "Bank" },
      },
    });
    expect(badAch.status).toBe(400);

    const badSepa = await request(app).put("/api/auth/profile").send({
      payoutProfile: {
        rail: "SEPA_IBAN", country: "DE", contact: { channel: "telegram", value: "tester1" },
        fields: { account_holder_name: "Test User", iban: "INVALIDIBAN", routing_number: null, account_number: null, account_type: null, bic: "DEUTDEFF", bank_name: "Bank" },
      },
    });
    expect(badSepa.status).toBe(400);
  });

  it("returns 409 when active trade exists and payout profile changed", async () => {
    TradeMock.exists.mockResolvedValue(true);
    const res = await request(app).put("/api/auth/profile").send({
      payoutProfile: {
        rail: "TR_IBAN",
        country: "TR",
        contact: { channel: "email", value: "a@b.com" },
        fields: {
          account_holder_name: "Test User",
          iban: "TR123456789012345678901234",
          routing_number: null, account_number: null, account_type: null, bic: null, bank_name: null,
        },
      },
    });
    expect(res.status).toBe(409);
  });
});
