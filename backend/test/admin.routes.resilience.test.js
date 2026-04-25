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
    const adminReadLimiter = jest.fn((_req, _res, next) => next());
    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        adminReadLimiter,
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
        countDocuments: jest.fn(() => Promise.reject(new Error("count failed"))),
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
    expect(res.body.settlementAnalytics).toMatchObject({
      activeSettlementProposals: 0,
      expiredSettlementProposals: 0,
      finalizedSettlementProposals24h: 0,
    });
    expect(Array.isArray(res.body.degraded.errors)).toBe(true);
    expect(adminReadLimiter).toHaveBeenCalled();
  });

  it("summary_resolution_analytics_counts_are_computed_from_resolution_type_not_status_only", async () => {
    const adminReadLimiter = jest.fn((_req, _res, next) => next());
    let router;

    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({ adminReadLimiter }));
      jest.doMock("../scripts/services/health", () => ({
        getReadiness: jest.fn().mockResolvedValue({ ok: true }),
      }));
      jest.doMock("../scripts/services/dlqProcessor", () => ({
        getDlqMetrics: jest.fn(() => ({ retries: 0 })),
      }));
      jest.doMock("../scripts/config/redis", () => ({
        getRedisClient: jest.fn(() => ({ lLen: jest.fn().mockResolvedValue(0) })),
      }));
      jest.doMock("../scripts/services/eventListener", () => ({ provider: null }));
      jest.doMock("../scripts/models/HistoricalStat", () => ({
        findOne: jest.fn(() => ({
          sort: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
        })),
      }));

      const resolutionCounts = {
        MANUAL_RELEASE: 4,
        AUTO_RELEASE: 3,
        PARTIAL_SETTLEMENT: 2,
        MUTUAL_CANCEL: 5,
        BURNED: 1,
        DISPUTED_RESOLUTION: 6,
        UNKNOWN: 7,
      };
      jest.doMock("../scripts/models/Trade", () => ({
        find: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([]),
        })),
        countDocuments: jest.fn((filter = {}) => {
          const resolutionType = filter?.resolution_type;
          if (resolutionType && resolutionCounts[resolutionType] !== undefined) {
            return Promise.resolve(resolutionCounts[resolutionType]);
          }
          return Promise.resolve(0);
        }),
      }));
      jest.doMock("../scripts/models/User", () => ({ find: jest.fn() }));
      jest.doMock("../scripts/models/Feedback", () => ({ find: jest.fn(), countDocuments: jest.fn() }));
      router = require("../scripts/routes/admin");
    });

    const app = buildApp(router);
    const res = await request(app).get("/api/admin/summary");
    expect(res.status).toBe(200);
    expect(res.body.resolutionAnalytics).toMatchObject({
      manualReleaseCount: 4,
      autoReleaseCount: 3,
      partialSettlementCount: 2,
      mutualCancelCount: 5,
      burnedCount: 1,
      disputedResolutionCount: 6,
      unknownResolvedCount: 7,
    });
  });

  it("uses stable global totals for normal mode and explicit windowed scope for riskOnly", async () => {
    const adminReadLimiter = jest.fn((_req, _res, next) => next());
    const tradeRows = [
      {
        _id: "1",
        onchain_escrow_id: "1",
        maker_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        taker_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "CHALLENGED",
        payout_snapshot: {
          is_complete: false,
          maker: {
            reputation_context_at_lock: {
              burn_count: 4,
              auto_release_count: 3,
              mutual_cancel_count: 2,
              disputed_but_resolved_count: 1,
            },
          },
        },
        created_at: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        adminReadLimiter,
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
          select: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue([
              {
                wallet_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                profileVersion: 0,
                reputation_breakdown: {
                  burn_count: 4,
                  auto_release_count: 3,
                  mutual_cancel_count: 2,
                  disputed_but_resolved_count: 1,
                },
              },
            ]),
          })),
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
    expect(normalRes.body.trades[0].offchain_health_score_input.informational_only).toBe(true);
    expect(normalRes.body.trades[0].offchain_health_score_input.non_authoritative_semantics).toBe(true);
    expect(normalRes.body.trades[0].offchain_health_score_input.readOnly).toBe(true);
    expect(normalRes.body.trades[0].offchain_health_score_input.nonBlocking).toBe(true);
    expect(normalRes.body.trades[0].offchain_health_score_input.canBlockProtocolActions).toBe(false);
    expect(
      normalRes.body.trades[0].offchain_health_score_input?.maker?.reputationBanMirrorContext?.reputation_semantics
    ).toMatchObject({
      burn_count: 4,
      auto_release_count: 3,
      mutual_cancel_count: 2,
      disputed_but_resolved_count: 1,
    });
    // [TR] Yeni semantic alanlar additive explainability katmanında kalır; legacy risk nesnesi korunur.
    // [EN] New semantic fields stay additive in explainability layer; legacy risk object remains intact.
    expect(normalRes.body.trades[0].bank_profile_risk).toBeDefined();
    expect(normalRes.body.trades[0].bank_profile_risk).toMatchObject({
      highRiskBankProfile: false,
      changedAfterLock: false,
      frequentRecentChanges: false,
    });

    const riskRes = await request(app).get("/api/admin/trades?status=ALL&page=1&limit=20&riskOnly=true");
    expect(riskRes.status).toBe(200);
    expect(riskRes.body.paginationScope.mode).toBe("risk_only_bounded_window");
    expect(riskRes.body.paginationScope.isWindowed).toBe(true);
  });

  it("returns settlement proposal analytics payload with derived fields and riskOnly filter", async () => {
    const adminReadLimiter = jest.fn((_req, _res, next) => next());
    const now = Date.now();
    const rows = [
      {
        _id: "trade-a",
        onchain_escrow_id: "101",
        status: "LOCKED",
        maker_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        taker_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        settlement_proposal: {
          proposal_id: "5",
          state: "PROPOSED",
          proposed_by: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          maker_share_bps: 6200,
          taker_share_bps: 3800,
          proposed_at: new Date(now - 3600 * 1000),
          expires_at: new Date(now + 3600 * 1000),
          finalized_at: null,
          tx_hash: "0xabc",
        },
      },
      {
        _id: "trade-b",
        onchain_escrow_id: "102",
        status: "BURNED",
        maker_address: "0xcccccccccccccccccccccccccccccccccccccccc",
        taker_address: "0xdddddddddddddddddddddddddddddddddddddddd",
        settlement_proposal: {
          proposal_id: "6",
          state: "PROPOSED",
          proposed_by: "0xcccccccccccccccccccccccccccccccccccccccc",
          maker_share_bps: 5000,
          taker_share_bps: 5000,
          proposed_at: new Date(now - 7200 * 1000),
          expires_at: new Date(now - 1000),
          finalized_at: null,
          tx_hash: "0xdef",
        },
      },
    ];

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({ adminReadLimiter }));
      jest.doMock("../scripts/services/health", () => ({ getReadiness: jest.fn().mockResolvedValue({ ok: true }) }));
      jest.doMock("../scripts/services/dlqProcessor", () => ({ getDlqMetrics: jest.fn(() => ({})) }));
      jest.doMock("../scripts/config/redis", () => ({ getRedisClient: jest.fn(() => ({ lLen: jest.fn().mockResolvedValue(0) })) }));
      jest.doMock("../scripts/services/eventListener", () => ({ provider: null }));
      jest.doMock("../scripts/models/HistoricalStat", () => ({
        findOne: jest.fn(() => ({ sort: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })) })),
      }));
      jest.doMock("../scripts/models/Trade", () => ({
        find: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue(rows),
        })),
        countDocuments: jest.fn().mockResolvedValue(2),
      }));
      jest.doMock("../scripts/models/User", () => ({ find: jest.fn() }));
      jest.doMock("../scripts/models/Feedback", () => ({ find: jest.fn(), countDocuments: jest.fn() }));
      router = require("../scripts/routes/admin");
    });

    const app = buildApp(router);
    const resAll = await request(app).get("/api/admin/settlement-proposals?state=ALL&page=1&limit=20");
    expect(resAll.status).toBe(200);
    expect(resAll.body.proposals.length).toBe(2);
    expect(resAll.body.proposals[0]).toMatchObject({
      proposal_id: "5",
      state: "PROPOSED",
      is_trade_terminal: false,
      is_expired: false,
      requires_counterparty_action: true,
      informational_only: true,
      non_authoritative_semantics: true,
    });
    expect(typeof resAll.body.proposals[0].proposal_age_seconds).toBe("number");
    expect(resAll.body.proposals[1].is_expired).toBe(true);
    expect(resAll.body.proposals[1].is_trade_terminal).toBe(true);
    expect(resAll.body.proposals[1].requires_counterparty_action).toBe(false);

    const resRiskOnly = await request(app).get("/api/admin/settlement-proposals?state=ALL&page=1&limit=20&riskOnly=true");
    expect(resRiskOnly.status).toBe(200);
    expect(resRiskOnly.body.proposals.length).toBe(2);
  });

  it("summary_active_settlement_count_excludes_terminal_trades_even_when_proposed_exists", async () => {
    const adminReadLimiter = jest.fn((_req, _res, next) => next());
    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/rateLimiter", () => ({ adminReadLimiter }));
      jest.doMock("../scripts/services/health", () => ({ getReadiness: jest.fn().mockResolvedValue({ ok: true }) }));
      jest.doMock("../scripts/services/dlqProcessor", () => ({ getDlqMetrics: jest.fn(() => ({})) }));
      jest.doMock("../scripts/config/redis", () => ({ getRedisClient: jest.fn(() => ({ lLen: jest.fn().mockResolvedValue(0) })) }));
      jest.doMock("../scripts/services/eventListener", () => ({ provider: null }));
      jest.doMock("../scripts/models/HistoricalStat", () => ({
        findOne: jest.fn(() => ({ sort: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })) })),
      }));
      const countDocuments = jest.fn((filter) => {
        if (filter?.["settlement_proposal.state"] === "PROPOSED" && filter?.status?.$nin) return Promise.resolve(1);
        if (filter?.["settlement_proposal.state"] === "PROPOSED") return Promise.resolve(4);
        if (filter?.["settlement_proposal.state"] === "EXPIRED") return Promise.resolve(0);
        if (filter?.["settlement_proposal.state"] === "FINALIZED" && filter?.["settlement_proposal.finalized_at"]) return Promise.resolve(0);
        if (filter?.["settlement_proposal.state"] === "FINALIZED") return Promise.resolve(0);
        if (filter?.["settlement_proposal.state"]?.$in) return Promise.resolve(4);
        return Promise.resolve(0);
      });
      jest.doMock("../scripts/models/Trade", () => ({
        countDocuments,
        find: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([]),
        })),
      }));
      jest.doMock("../scripts/models/User", () => ({ find: jest.fn() }));
      jest.doMock("../scripts/models/Feedback", () => ({ find: jest.fn(), countDocuments: jest.fn() }));
      router = require("../scripts/routes/admin");
    });

    const app = buildApp(router);
    const res = await request(app).get("/api/admin/summary");
    expect(res.status).toBe(200);
    expect(res.body.settlementAnalytics.activeSettlementProposals).toBe(1);
  });
});
