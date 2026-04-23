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
        payout_profile: { payout_details_enc: "enc", fingerprint: { version: 0 } },
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
        decryptPayoutProfile: jest.fn().mockResolvedValue({
          rail: "TR_IBAN",
          country: "TR",
          contact: { channel: "telegram", value: "tester1" },
          fields: { account_holder_name: "Test User", iban: "TR123456789012345678901234", bank_name: "Bank" },
        }),
        buildPayoutFingerprint: jest.fn().mockImplementation((details) => JSON.stringify(details)),
      }));
      jest.doMock("../scripts/models/User", () => UserMock);
      TradeMock = { exists: jest.fn().mockResolvedValue(false) };
      jest.doMock("../scripts/models/Trade", () => TradeMock);
      jest.doMock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

      const router = require("../scripts/routes/auth");
      app = express();
      app.use(express.json());
      app.use("/api/auth", router);
      app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    });
  });

  const makePayload = (overrides = {}) => ({
    payoutProfile: {
      rail: "TR_IBAN",
      country: "TR",
      contact: { channel: "telegram", value: "tester1" },
      fields: {
        account_holder_name: "Test User",
        iban: "TR123456789012345678901234",
        routing_number: null,
        account_number: null,
        account_type: null,
        bic: null,
        bank_name: "Bank",
      },
      ...overrides,
    },
  });

  it("accepts supported rail-country combinations", async () => {
    const okTr = await request(app).put("/api/auth/profile").send(makePayload());
    expect(okTr.status).toBe(200);

    const okAch = await request(app).put("/api/auth/profile").send(makePayload({
      rail: "US_ACH",
      country: "US",
      fields: {
        account_holder_name: "Jean-Luc Picard",
        iban: null,
        routing_number: "021000021",
        account_number: "1234567890",
        account_type: "checking",
        bic: null,
        bank_name: "Chase",
      },
    }));
    expect(okAch.status).toBe(200);

    const okSepa = await request(app).put("/api/auth/profile").send(makePayload({
      rail: "SEPA_IBAN",
      country: "DE",
      fields: {
        account_holder_name: "José María",
        iban: "DE89370400440532013000",
        routing_number: null,
        account_number: null,
        account_type: null,
        bic: "COBADEFFXXX",
        bank_name: "Commerzbank",
      },
    }));
    expect(okSepa.status).toBe(200);
  });

  it("rejects invalid rail-country combinations", async () => {
    const trUs = await request(app).put("/api/auth/profile").send(makePayload({ country: "US" }));
    expect(trUs.status).toBe(400);

    const achTr = await request(app).put("/api/auth/profile").send(makePayload({
      rail: "US_ACH",
      country: "TR",
      fields: { account_holder_name: "Test User", iban: null, routing_number: "021000021", account_number: "1234567890", account_type: "checking", bic: null, bank_name: null },
    }));
    expect(achTr.status).toBe(400);

    const sepaTr = await request(app).put("/api/auth/profile").send(makePayload({
      rail: "SEPA_IBAN",
      country: "TR",
      fields: { account_holder_name: "Test User", iban: "DE89370400440532013000", routing_number: null, account_number: null, account_type: null, bic: "DEUTDEFF", bank_name: null },
    }));
    expect(sepaTr.status).toBe(400);
  });

  it("validates widened account holder names and rejects noisy ones", async () => {
    const goodNames = ["Jean-Luc Picard", "O'Connor", "José María", "M. Dupont"];
    for (const n of goodNames) {
      const res = await request(app).put("/api/auth/profile").send(makePayload({
        fields: { account_holder_name: n, iban: "TR123456789012345678901234", routing_number: null, account_number: null, account_type: null, bic: null, bank_name: null },
      }));
      expect(res.status).toBe(200);
    }

    const badName = await request(app).put("/api/auth/profile").send(makePayload({
      fields: { account_holder_name: "1234@@", iban: "TR123456789012345678901234", routing_number: null, account_number: null, account_type: null, bic: null, bank_name: null },
    }));
    expect(badName.status).toBe(400);
  });

  it("normalizes and validates contact values", async () => {
    const telegram = await request(app).put("/api/auth/profile").send(makePayload({
      contact: { channel: "telegram", value: "@tester_11" },
    }));
    expect(telegram.status).toBe(200);

    const email = await request(app).put("/api/auth/profile").send(makePayload({
      contact: { channel: "email", value: "name@example.com" },
    }));
    expect(email.status).toBe(200);

    const phone = await request(app).put("/api/auth/profile").send(makePayload({
      contact: { channel: "phone", value: "+90 555 111 22 33" },
    }));
    expect(phone.status).toBe(200);

    const badPhone = await request(app).put("/api/auth/profile").send(makePayload({
      contact: { channel: "phone", value: "abc-123" },
    }));
    expect(badPhone.status).toBe(400);
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

  it("allows contact-only updates for legacy profiles during active trades", async () => {
    TradeMock.exists.mockResolvedValue(true);

    const res = await request(app).put("/api/auth/profile").send({
      payoutProfile: {
        rail: "TR_IBAN",
        country: "TR",
        contact: { channel: "telegram", value: "tester2" },
        fields: {
          account_holder_name: "Test User",
          iban: "TR123456789012345678901234",
          routing_number: null, account_number: null, account_type: null, bic: null, bank_name: "Bank",
        },
      },
    });

    expect(res.status).toBe(200);
    expect(TradeMock.exists).not.toHaveBeenCalled();
  });
});
