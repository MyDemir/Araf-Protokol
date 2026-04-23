"use strict";

const express = require("express");
const request = require("supertest");

describe("orders route market trust visibility summary", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("GET /api/orders returns compact trust_visibility_summary without raw reasons", async () => {
    const ordersRows = [
      {
        _id: "507f1f77bcf86cd799439011",
        onchain_order_id: "11",
        owner_address: "0x1111111111111111111111111111111111111111",
        side: "SELL_CRYPTO",
        status: "OPEN",
        tier: 1,
        token_address: "0x9999999999999999999999999999999999999999",
        market: { crypto_asset: "USDT", fiat_currency: "TRY", exchange_rate: 34 },
        amounts: { min_fill_amount_num: 10, remaining_amount_num: 50 },
      },
    ];

    const findChain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(ordersRows),
    };
    const Order = {
      find: jest.fn(() => findChain),
      countDocuments: jest.fn().mockResolvedValue(1),
      findOne: jest.fn(),
    };
    const Trade = {
      aggregate: jest.fn().mockResolvedValue([
        {
          _id: "0x1111111111111111111111111111111111111111",
          trade: {
            maker_address: "0x1111111111111111111111111111111111111111",
            payout_snapshot: {
              is_complete: true,
              maker: {
                profile_version_at_lock: 0,
                bank_change_count_7d_at_lock: 0,
                bank_change_count_30d_at_lock: 0,
              },
            },
          },
        },
      ]),
    };
    const User = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { wallet_address: "0x1111111111111111111111111111111111111111", profileVersion: 0 },
          ]),
        }),
      }),
    };

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        marketReadLimiter: (_req, _res, next) => next(),
        ordersReadLimiter: (_req, _res, next) => next(),
        ordersWriteLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/models/Order", () => Order);
      jest.doMock("../scripts/models/Trade", () => Trade);
      jest.doMock("../scripts/models/User", () => User);
      jest.doMock("../scripts/services/protocolConfig", () => ({ getConfig: jest.fn(() => ({ bondMap: {}, feeConfig: {}, cooldownConfig: {}, tokenMap: {} })) }));
      router = require("../scripts/routes/orders");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/orders", router);

    const res = await request(app).get("/api/orders");
    expect(res.status).toBe(200);
    expect(Trade.aggregate).toHaveBeenCalledWith([
      {
        $match: {
          maker_address: { $in: ["0x1111111111111111111111111111111111111111"] },
          $or: [
            { "timers.locked_at": { $ne: null } },
            { "payout_snapshot.captured_at": { $ne: null } },
          ],
        },
      },
      { $sort: { created_at: -1, _id: -1 } },
      { $group: { _id: "$maker_address", trade: { $first: "$$ROOT" } } },
    ]);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].trust_visibility_summary).toMatchObject({
      available: true,
      band: "GREEN",
      readOnly: true,
      nonBlocking: true,
      canBlockProtocolActions: false,
    });
    expect(res.body.orders[0].trust_visibility_summary.explainableReasons).toBeUndefined();
  });
});
