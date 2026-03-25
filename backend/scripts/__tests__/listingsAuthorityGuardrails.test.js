"use strict";

const express = require("express");
const request = require("supertest");

const mockListingSave = jest.fn();

jest.mock("../middleware/auth", () => ({
  requireAuth: (req, _res, next) => {
    req.wallet = "0x1111111111111111111111111111111111111111";
    next();
  },
}));

jest.mock("../middleware/rateLimiter", () => ({
  listingsReadLimiter: (_req, _res, next) => next(),
  listingsWriteLimiter: (_req, _res, next) => next(),
}));

jest.mock("../services/protocolConfig", () => ({
  getConfig: jest.fn(() => ({
    bondMap: {
      0: { maker: 5, taker: 5 },
      1: { maker: 5, taker: 5 },
      2: { maker: 5, taker: 5 },
      3: { maker: 5, taker: 5 },
      4: { maker: 5, taker: 5 },
    },
  })),
}));

jest.mock("../models/Trade", () => {
  function Listing(data) {
    Object.assign(this, data);
    this._id = "507f191e810c19729de860ea";
    this.save = mockListingSave.mockResolvedValue(this);
  }

  Listing.find = jest.fn(() => ({
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  }));
  Listing.countDocuments = jest.fn().mockResolvedValue(0);
  Listing.findById = jest.fn();

  return {
    Listing,
    Trade: { findOne: jest.fn().mockResolvedValue(null) },
  };
});

jest.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: jest.fn(() => ({})),
    Contract: jest.fn(() => ({
      getReputation: jest.fn().mockResolvedValue({ effectiveTier: 4 }),
    })),
    keccak256: jest.fn(() => "0x" + "a".repeat(64)),
    toUtf8Bytes: jest.fn((v) => Buffer.from(String(v), "utf8")),
  },
}));

jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe("listings route authority guardrails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BASE_RPC_URL = "https://mainnet.base.org";
    process.env.ARAF_ESCROW_ADDRESS = "0x2222222222222222222222222222222222222222";
    mockListingSave.mockResolvedValue(true);
  });

  function buildApp() {
    const routes = require("../routes/listings");
    const app = express();
    app.use(express.json());
    app.use("/api/listings", routes);
    return app;
  }

  test("does not reject high fiat max with low exchange rate when on-chain tier is valid", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/api/listings")
      .send({
        crypto_asset: "USDT",
        fiat_currency: "TRY",
        exchange_rate: 10,
        limits: { min: 1000, max: 10000000 },
        tier: 0,
        token_address: "0x1111111111111111111111111111111111111111",
      });

    expect(res.status).toBe(201);
    expect(res.body.listing).toBeDefined();
  });
});
