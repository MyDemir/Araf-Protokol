"use strict";

const express = require("express");
const request = require("supertest");

describe("reference-rates route", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("returns informational semantics and fixed ticker set without arbitrary pair input", async () => {
    const marketReadLimiter = jest.fn((_req, _res, next) => next());
    const getReferenceTickerPayload = jest.fn(async () => ({
      items: [{
        symbol: "BTC/USDC",
        base: "BTC",
        quote: "USDC",
        rate: 64000,
        source: "coinbase",
        sourceKind: "CRYPTO_EXCHANGE_REFERENCE",
        derived: false,
        updatedAt: new Date().toISOString(),
        stale: false,
      }],
      generatedAt: new Date().toISOString(),
      informationalOnly: true,
      nonAuthoritative: true,
      canAffectSettlement: false,
    }));

    let router;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/rateLimiter", () => ({ marketReadLimiter }));
      jest.doMock("../scripts/services/referenceTicker", () => ({ getReferenceTickerPayload }));
      router = require("../scripts/routes/referenceRates");
    });

    const app = express();
    app.use("/api/reference-rates", router);

    const res = await request(app).get("/api/reference-rates/ticker?pair=FAKE/TRY");

    expect(res.status).toBe(200);
    expect(marketReadLimiter).toHaveBeenCalled();
    expect(getReferenceTickerPayload).toHaveBeenCalled();
    expect(res.body.informationalOnly).toBe(true);
    expect(res.body.nonAuthoritative).toBe(true);
    expect(res.body.canAffectSettlement).toBe(false);
    expect(res.body.items.map((v) => v.symbol)).toEqual(["BTC/USDC"]);
    expect(res.body.items.some((v) => v.symbol === "FAKE/TRY")).toBe(false);
  });
});
