"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");

describe("stats + logs rate limiter wiring", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("applies statsReadLimiter on GET /api/stats", async () => {
    const statsReadLimiter = jest.fn((_req, _res, next) => next());

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        statsReadLimiter,
      }));
      jest.doMock("../scripts/config/redis", () => ({
        getRedisClient: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(JSON.stringify({ ok: true })),
          setEx: jest.fn().mockResolvedValue("OK"),
        })),
      }));
      jest.doMock("../scripts/models/HistoricalStat", () => ({
        findOne: jest.fn(),
      }));
      router = require("../scripts/routes/stats");
    });

    const app = express();
    app.use("/api/stats", router);

    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(statsReadLimiter).toHaveBeenCalled();
  });

  it("logs route imports shared clientLogLimiter from middleware", () => {
    const source = fs.readFileSync(path.join(__dirname, "../scripts/routes/logs.js"), "utf8");

    expect(source).toContain('const { clientLogLimiter } = require("../middleware/rateLimiter");');
    expect(source).toContain("router.post(\"/client-error\", clientLogLimiter");
    expect(source).not.toContain('require("express-rate-limit")');
    expect(source).not.toContain("logRateLimiter");
  });
});
