"use strict";

const express = require("express");
const request = require("supertest");

describe("trades route offchain_health_score_input regression", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("GET /api/trades/my response içinde expected offchain_health_score_input shape döner", async () => {
    const tradeRows = [
      {
        _id: "507f1f77bcf86cd799439011",
        onchain_escrow_id: "123",
        maker_address: "0x1111111111111111111111111111111111111111",
        taker_address: "0x2222222222222222222222222222222222222222",
        status: "LOCKED",
        payout_snapshot: {
          is_complete: true,
          captured_at: new Date("2026-04-01T00:00:00Z"),
          maker: {
            rail: "TR_IBAN",
            country: "TR",
            profile_version_at_lock: 0,
            bank_change_count_7d_at_lock: 3,
            bank_change_count_30d_at_lock: 4,
            reputation_context_at_lock: {
              effective_tier: 2,
              failed_disputes: 1,
              is_banned: false,
              burn_count: 9,
              auto_release_count: 8,
              mutual_cancel_count: 7,
              disputed_but_resolved_count: 6,
            },
          },
          taker: {
            rail: "US_ACH",
            country: "US",
          },
        },
      },
    ];

    const findTradeChain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(tradeRows),
    };

    const Trade = {
      find: jest.fn(() => findTradeChain),
      countDocuments: jest.fn().mockResolvedValue(1),
      findOne: jest.fn(),
      findById: jest.fn(),
    };

    const users = [
      {
        wallet_address: "0x1111111111111111111111111111111111111111",
        profileVersion: 0,
        payout_profile: { fingerprint: { version: 0 } },
      },
      {
        wallet_address: "0x2222222222222222222222222222222222222222",
        profileVersion: 5,
      },
    ];

    const User = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(users),
        }),
      }),
    };

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (req, _res, next) => {
          req.wallet = "0x1111111111111111111111111111111111111111";
          next();
        },
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        roomReadLimiter: (_req, _res, next) => next(),
        coordinationWriteLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/models/Trade", () => Trade);
      jest.doMock("../scripts/models/User", () => User);
      jest.doMock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
      router = require("../scripts/routes/trades");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/trades", router);

    const res = await request(app).get("/api/trades/my");

    expect(res.status).toBe(200);
    expect(res.body.trades).toHaveLength(1);
    expect(res.body.trades[0].offchain_health_score_input).toMatchObject({
      readOnly: true,
      nonBlocking: true,
      canBlockProtocolActions: false,
      taker: {
        counterparty: "maker",
        frequentRecentChanges: true,
      },
    });
    expect(res.body.trades[0].offchain_health_score_input.explainableReasons).not.toContain("partial_or_incomplete_snapshot");
    expect(
      res.body.trades[0].offchain_health_score_input?.maker?.reputationBanMirrorContext?.reputation_semantics
    ).toMatchObject({
      burn_count: 9,
      auto_release_count: 8,
      mutual_cancel_count: 7,
      disputed_but_resolved_count: 6,
    });
    expect(res.body.trades[0].bank_profile_risk).toBeDefined();
  });
});
