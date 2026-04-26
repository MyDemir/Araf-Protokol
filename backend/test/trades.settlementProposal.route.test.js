"use strict";

const express = require("express");
const request = require("supertest");

describe("trades settlement proposal read-model routes", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("GET /api/trades/:id/settlement-proposal is party-restricted and read-only", async () => {
    const tradeDoc = {
      _id: "507f1f77bcf86cd799439011",
      maker_address: "0x1111111111111111111111111111111111111111",
      taker_address: "0x2222222222222222222222222222222222222222",
      settlement_proposal: {
        proposal_id: "8",
        state: "PROPOSED",
        maker_share_bps: 7000,
        taker_share_bps: 3000,
      },
    };

    const Trade = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(tradeDoc),
        }),
      }),
      find: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      })),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
    };

    const User = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
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

    const ok = await request(app).get("/api/trades/507f1f77bcf86cd799439011/settlement-proposal");
    expect(ok.status).toBe(200);
    expect(ok.body.settlement_proposal).toMatchObject({
      proposal_id: "8",
      state: "PROPOSED",
      informational_only: true,
      non_authoritative_semantics: true,
    });
  });

  it("POST /api/trades/:id/settlement-proposal/preview returns BigInt-safe informational preview", async () => {
    const tradeDoc = {
      _id: "507f1f77bcf86cd799439012",
      maker_address: "0x1111111111111111111111111111111111111111",
      taker_address: "0x2222222222222222222222222222222222222222",
      status: "LOCKED",
      onchain_escrow_id: "77",
      financials: {
        crypto_amount: "1000000",
        maker_bond: "200000",
        taker_bond: "300000",
      },
    };

    const Trade = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(tradeDoc),
        }),
      }),
      find: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      })),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
    };

    const User = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      }),
    };

    let router;
    jest.isolateModules(() => {
      process.env.BASE_RPC_URL = "";
      process.env.ARAF_ESCROW_ADDRESS = "";
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

    const res = await request(app)
      .post("/api/trades/507f1f77bcf86cd799439012/settlement-proposal/preview")
      .send({ makerShareBps: 7000 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      informationalOnly: true,
      nonAuthoritative: true,
      makerShareBps: 7000,
      takerShareBps: 3000,
      poolSource: "db-raw-financials",
      pool: "1500000",
      makerPayout: "1050000",
      takerPayout: "450000",
      decayedAmount: "0",
    });
  });

  it("POST preview uses on-chain current amounts for challenged trades", async () => {
    const tradeDoc = {
      _id: "507f1f77bcf86cd799439014",
      maker_address: "0x1111111111111111111111111111111111111111",
      taker_address: "0x2222222222222222222222222222222222222222",
      status: "CHALLENGED",
      onchain_escrow_id: "88",
      financials: {
        crypto_amount: "1000000",
        maker_bond: "200000",
        taker_bond: "300000",
      },
    };
    const Trade = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(tradeDoc),
        }),
      }),
      find: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      })),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
    };
    const User = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      }),
    };

    let router;
    jest.isolateModules(() => {
      jest.doMock("ethers", () => {
        const contract = {
          getCurrentAmounts: jest.fn().mockResolvedValue({
            currentCrypto: 900000n,
            currentMakerBond: 200000n,
            currentTakerBond: 300000n,
            totalDecayed: 100000n,
          }),
        };
        const provider = {
          getNetwork: jest.fn().mockResolvedValue({ chainId: 8453n }),
        };
        return {
          ethers: {
            JsonRpcProvider: jest.fn(() => provider),
            Contract: jest.fn(() => contract),
          },
        };
      });
      process.env.BASE_RPC_URL = "https://example-rpc";
      process.env.ARAF_ESCROW_ADDRESS = "0x3333333333333333333333333333333333333333";
      process.env.EXPECTED_CHAIN_ID = "8453";
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

    const res = await request(app)
      .post("/api/trades/507f1f77bcf86cd799439014/settlement-proposal/preview")
      .send({ makerShareBps: 7000 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      poolSource: "onchain-current-amounts",
      pool: "1400000",
      makerPayout: "980000",
      takerPayout: "420000",
      decayedAmount: "100000",
    });
  });

  it("POST preview fails closed for challenged trades when on-chain read is unavailable", async () => {
    const tradeDoc = {
      _id: "507f1f77bcf86cd799439015",
      maker_address: "0x1111111111111111111111111111111111111111",
      taker_address: "0x2222222222222222222222222222222222222222",
      status: "CHALLENGED",
      onchain_escrow_id: "99",
      financials: {
        crypto_amount: "1000000",
        maker_bond: "200000",
        taker_bond: "300000",
      },
    };
    const Trade = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(tradeDoc),
        }),
      }),
      find: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      })),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
    };
    const User = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      }),
    };

    let router;
    jest.isolateModules(() => {
      process.env.BASE_RPC_URL = "";
      process.env.ARAF_ESCROW_ADDRESS = "";
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

    const res = await request(app)
      .post("/api/trades/507f1f77bcf86cd799439015/settlement-proposal/preview")
      .send({ makerShareBps: 7000 });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      code: "PREVIEW_UNAVAILABLE",
      informationalOnly: true,
      nonAuthoritative: true,
    });
    expect(res.body.error).toMatch(/Settlement preview unavailable/);
  });

  it("blocks settlement proposal read for non-party wallet", async () => {
    const tradeDoc = {
      _id: "507f1f77bcf86cd799439013",
      maker_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      taker_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      settlement_proposal: {},
    };

    const Trade = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(tradeDoc),
        }),
      }),
      find: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      })),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
    };
    const User = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
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
    const res = await request(app).get("/api/trades/507f1f77bcf86cd799439013/settlement-proposal");
    expect(res.status).toBe(403);
  });
});
