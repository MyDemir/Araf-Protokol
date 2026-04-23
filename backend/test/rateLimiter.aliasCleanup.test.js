"use strict";

const fs = require("fs");
const path = require("path");

describe("rate limiter alias cleanup", () => {
  it("uses canonical roomRead/coordinator names in trades route", () => {
    const tradesSource = fs.readFileSync(path.join(__dirname, "../scripts/routes/trades.js"), "utf8");

    expect(tradesSource).toContain("roomReadLimiter");
    expect(tradesSource).toContain("coordinationWriteLimiter");
    expect(tradesSource).not.toContain("tradesLimiter");
  });

  it("does not export deprecated tradesLimiter alias", () => {
    const limiterSource = fs.readFileSync(path.join(__dirname, "../scripts/middleware/rateLimiter.js"), "utf8");

    expect(limiterSource).not.toContain("const tradesLimiter =");
    expect(limiterSource).not.toMatch(/\btradesLimiter\b/);
    expect(limiterSource).toContain("coordinationWriteLimiter");
  });
});
