"use strict";

const express = require("express");
const request = require("supertest");

describe("PII taker-name identity guard + big id parsing", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.PII_IDENTITY_NORMALIZATION_GUARD;
  });

  it("returns 503 when identity normalization guard fails (no silent false-negative)", async () => {
    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (req, _res, next) => { req.wallet = "0x1111111111111111111111111111111111111111"; next(); },
        requireSessionWalletMatch: (_req, _res, next) => next(),
        requirePIIToken: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({ piiLimiter: (_req, _res, next) => next() }));
      jest.doMock("../scripts/services/identityNormalizationGuard", () => ({
        verifyIdentityNormalization: jest.fn().mockRejectedValue(new Error("mixed ids")),
      }));
      jest.doMock("../scripts/models/Trade", () => ({ findOne: jest.fn() }));
      jest.doMock("../scripts/models/User", () => ({ findOne: jest.fn() }));
      jest.doMock("../scripts/services/encryption", () => ({ decryptField: jest.fn(), decryptPayoutProfile: jest.fn() }));
      jest.doMock("../scripts/services/siwe", () => ({ issuePIIToken: jest.fn() }));
      jest.doMock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../scripts/routes/pii");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/pii", router);

    const res = await request(app).get("/api/pii/taker-name/900719925474099312345");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("IDENTITY_NORMALIZATION_REQUIRED");
  });

  it("does not sticky-cache transient guard failures across requests", async () => {
    const verifyMock = jest
      .fn()
      .mockRejectedValueOnce(new Error("temporary db timeout"))
      .mockResolvedValue({ ok: true });

    const Trade = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            maker_address: "0x1111111111111111111111111111111111111111",
            taker_address: "0x2222222222222222222222222222222222222222",
            status: "LOCKED",
            payout_snapshot: {
              is_complete: true,
              taker: { payout_details_enc: "enc" },
            },
          }),
        }),
      }),
    };

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (req, _res, next) => { req.wallet = "0x1111111111111111111111111111111111111111"; next(); },
        requireSessionWalletMatch: (_req, _res, next) => next(),
        requirePIIToken: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({ piiLimiter: (_req, _res, next) => next() }));
      jest.doMock("../scripts/services/identityNormalizationGuard", () => ({
        verifyIdentityNormalization: verifyMock,
      }));
      jest.doMock("../scripts/models/Trade", () => Trade);
      jest.doMock("../scripts/models/User", () => ({ findOne: jest.fn() }));
      jest.doMock("../scripts/services/encryption", () => ({
        decryptField: jest.fn().mockResolvedValue(JSON.stringify({ account_holder_name: "Alice" })),
        decryptPayoutProfile: jest.fn(),
      }));
      jest.doMock("../scripts/services/siwe", () => ({ issuePIIToken: jest.fn() }));
      jest.doMock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../scripts/routes/pii");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/pii", router);

    const huge = "900719925474099312345";
    const first = await request(app).get(`/api/pii/taker-name/${huge}`);
    expect(first.status).toBe(503);

    const second = await request(app).get(`/api/pii/taker-name/${huge}`);
    expect(second.status).toBe(200);
    expect(verifyMock).toHaveBeenCalledTimes(2);
  });

  it("keeps huge onchainId as string for lookup when guard passes", async () => {
    const Trade = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            maker_address: "0x1111111111111111111111111111111111111111",
            taker_address: "0x2222222222222222222222222222222222222222",
            status: "LOCKED",
            payout_snapshot: {
              is_complete: true,
              taker: { payout_details_enc: "enc" },
            },
          }),
        }),
      }),
    };

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (req, _res, next) => { req.wallet = "0x1111111111111111111111111111111111111111"; next(); },
        requireSessionWalletMatch: (_req, _res, next) => next(),
        requirePIIToken: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({ piiLimiter: (_req, _res, next) => next() }));
      jest.doMock("../scripts/services/identityNormalizationGuard", () => ({
        verifyIdentityNormalization: jest.fn().mockResolvedValue({ ok: true }),
      }));
      jest.doMock("../scripts/models/Trade", () => Trade);
      jest.doMock("../scripts/models/User", () => ({ findOne: jest.fn() }));
      jest.doMock("../scripts/services/encryption", () => ({
        decryptField: jest.fn().mockResolvedValue(JSON.stringify({ account_holder_name: "Alice" })),
        decryptPayoutProfile: jest.fn(),
      }));
      jest.doMock("../scripts/services/siwe", () => ({ issuePIIToken: jest.fn() }));
      jest.doMock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../scripts/routes/pii");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/pii", router);

    const huge = "900719925474099312345";
    const res = await request(app).get(`/api/pii/taker-name/${huge}`);
    expect(res.status).toBe(200);
    expect(Trade.findOne.mock.calls[0][0].onchain_escrow_id).toBe(huge);
  });
});
