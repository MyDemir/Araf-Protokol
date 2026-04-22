"use strict";

const express = require("express");
const request = require("supertest");

function buildApp(router) {
  const app = express();
  app.use(express.json());
  app.locals.schedulerState = {};
  app.use((req, _res, next) => {
    req.wallet = "0x1111111111111111111111111111111111111111";
    next();
  });
  app.use("/api/admin", router);
  return app;
}

describe("admin routes resilience + pagination semantics", () => {
  const previousAdminWallets = process.env.ADMIN_WALLETS;

  beforeEach(() => {
    process.env.ADMIN_WALLETS = "0x1111111111111111111111111111111111111111";
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.ADMIN_WALLETS = previousAdminWallets;
  });

  it("returns degraded summary payload instead of 500 when secondary deps fail", async () => {
    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/services/health", () => ({
        getReadiness: jest.fn().mockResolvedValue({ ok: true, checks: { db: true } }),
      }));
      jest.doMock("../scripts/services/dlqProcessor", () => ({
        getDlqMetrics: jest.fn(() => ({ retries: 0 })),
      }));
      jest.doMock("../scripts/config/redis", () => ({
        getRedisClient: jest.fn(() => ({
          lLen: jest.fn().mockRejectedValue(new Error("redis down")),
        })),
      }));
      jest.doMock("../scripts/services/eventListener", () => ({ provider: null }));
      jest.doMock("../scripts/models/HistoricalStat", () => ({
        findOne: jest.fn(() => ({
          sort: jest.fn(() => ({
            lean: jest.fn().mockRejectedValue(new Error("mongo down")),
          })),
        })),
      }));
      jest.doMock("../scripts/models/Trade", () => ({
        countDocuments: jest.fn().mockRejectedValue(new Error("count failed")),
        find: jest.fn(),
      }));
      jest.doMock("../scripts/models/User", () => ({ find: jest.fn() }));
      jest.doMock("../scripts/models/Feedback", () => ({ find: jest.fn(), countDocuments: jest.fn() }));
      router = require("../scripts/routes/admin");
    });

    const app = buildApp(router);
    const res = await request(app).get("/api/admin/summary");
    expect(res.status).toBe(200);
    expect(res.body.readiness.ok).toBe(true);
    expect(res.body.degraded.isDegraded).toBe(true);
    expect(res.body.degraded.sources.latestStatFallbackUsed).toBe(true);
    expect(res.body.degraded.sources.tradeCountsFallbackUsed).toBe(true);
    expect(res.body.degraded.sources.dlqDepthFallbackUsed).toBe(true);
    expect(Array.isArray(res.body.degraded.errors)).toBe(true);
  });

  it("uses stable global totals for normal mode and explicit windowed scope for riskOnly", async () => {
    const tradeRows = [
      {
        _id: "1",
        onchain_escrow_id: "1",
        maker_address: "0xaaa",
        taker_address: "0xbbb",
        status: "CHALLENGED",
        payout_snapshot: { is_complete: false },
        created_at: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/services/health", () => ({
        getReadiness: jest.fn().mockResolvedValue({ ok: true }),
      }));
      jest.doMock("../scripts/services/dlqProcessor", () => ({
        getDlqMetrics: jest.fn(() => ({})),
      }));
      jest.doMock("../scripts/config/redis", () => ({
        getRedisClient: jest.fn(() => ({ lLen: jest.fn().mockResolvedValue(0) })),
      }));
      jest.doMock("../scripts/services/eventListener", () => ({ provider: null }));
      jest.doMock("../scripts/models/HistoricalStat", () => ({
        findOne: jest.fn(() => ({ sort: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })) })),
      }));

      const findMock = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(tradeRows),
      }));

      jest.doMock("../scripts/models/Trade", () => ({
        find: findMock,
        countDocuments: jest.fn().mockResolvedValue(321),
      }));
      jest.doMock("../scripts/models/User", () => ({
        find: jest.fn(() => ({
          select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
        })),
      }));
      jest.doMock("../scripts/models/Feedback", () => ({ find: jest.fn(), countDocuments: jest.fn() }));
      router = require("../scripts/routes/admin");
    });

    const app = buildApp(router);
    const normalRes = await request(app).get("/api/admin/trades?status=ALL&page=1&limit=20");
    expect(normalRes.status).toBe(200);
    expect(normalRes.body.total).toBe(321);
    expect(normalRes.body.paginationScope.isWindowed).toBe(false);

    const riskRes = await request(app).get("/api/admin/trades?status=ALL&page=1&limit=20&riskOnly=true");
    expect(riskRes.status).toBe(200);
    expect(riskRes.body.paginationScope.mode).toBe("risk_only_bounded_window");
    expect(riskRes.body.paginationScope.isWindowed).toBe(true);
  });
});
