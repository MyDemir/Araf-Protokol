"use strict";

// B27 (/ready cache + redaction), B6 (liveness), B19 (HTTP before worker start) static/behaviour guards.

jest.mock("mongoose", () => ({ connection: { readyState: 1 } }));
jest.mock("../../backend/scripts/config/redis", () => ({
  isReady: jest.fn(() => true),
  getRedisClient: jest.fn(() => ({ get: jest.fn().mockResolvedValue("1") })),
}));
jest.mock("../../backend/scripts/services/expectedChain", () => ({
  EXPECTED_CHAIN_ENV: "EXPECTED_CHAIN_ID",
  resolveExpectedChainIdOrThrow: jest.fn(() => 84532),
}));

const fs = require("fs");
const path = require("path");

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

describe("/ready cache, redaction and liveness", () => {
  const ORIGINAL_ENV = { ...process.env };
  let health;
  let provider;
  const worker = {
    isRunning: true, _state: "live", _lastSafeCheckpointBlock: 99, _runtimeConfig: { WORKER_FINALITY_DEPTH: 6 },
    getDiagnostics: () => ({ reconciliation: { lastReport: { dlqPending: 0, missingTerminalTimestampSample: [{ onchain_escrow_id: "1" }] } } }),
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "production", MONGODB_URI: "m", REDIS_URL: "r", JWT_SECRET: "s", SIWE_DOMAIN: "example.com" };
    delete process.env.ALLOWED_ORIGINS; // forces missingConfig entries
    delete process.env.READY_INTERNAL_TOKEN;
    provider = { getBlockNumber: jest.fn().mockResolvedValue(100), getNetwork: jest.fn().mockResolvedValue({ chainId: 84532 }) };
    health = require("../../backend/scripts/services/health");
    health._resetReadinessCacheForTests();
  });
  afterAll(() => { process.env = { ...ORIGINAL_ENV }; });

  it("B27: concurrent and repeated /ready calls within the TTL cost one RPC pair", async () => {
    const handler = health.createReadyHandler({ worker, getProvider: () => provider });
    await Promise.all([handler({ headers: {} }, fakeRes()), handler({ headers: {} }, fakeRes()), handler({ headers: {} }, fakeRes())]);
    await handler({ headers: {} }, fakeRes());
    expect(provider.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(provider.getNetwork).toHaveBeenCalledTimes(1);
  });

  it("B27: anonymous callers get no internal diagnostics; 503 status still reflects readiness", async () => {
    const handler = health.createReadyHandler({ worker, getProvider: () => provider });
    const res = fakeRes();
    await handler({ headers: {} }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.missingConfig).toBeUndefined();
    expect(res.body.worker.diagnostics).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/ALLOWED_ORIGINS|MONGODB_URI|missingTerminalTimestampSample|onchain_escrow_id/);
    expect(res.body.configIssueCount).toBeGreaterThan(0);
  });

  it("B27: a valid internal token gets the full detail; a wrong token does not", async () => {
    process.env.READY_INTERNAL_TOKEN = "s3cret-token";
    const handler = health.createReadyHandler({ worker, getProvider: () => provider });

    const good = fakeRes();
    await handler({ headers: { "x-internal-token": "s3cret-token" } }, good);
    expect(good.body.missingConfig).toContain("ALLOWED_ORIGINS");

    health._resetReadinessCacheForTests();
    const bad = fakeRes();
    await handler({ headers: { "x-internal-token": "nope" } }, bad);
    expect(bad.body.missingConfig).toBeUndefined();
  });

  it("B19: /ready reports replaying while the worker replays", async () => {
    const handler = health.createReadyHandler({ worker: { ...worker, _state: "replaying" }, getProvider: () => provider });
    const res = fakeRes();
    await handler({ headers: {} }, res);
    expect(res.body.worker.replaying).toBe(true);
    expect(res.statusCode).toBe(503);
  });

  it("B6: /health returns 503 when the worker liveness is stale and 200 otherwise", () => {
    const stale = fakeRes();
    health.createHealthHandler({ worker: { getLivenessSnapshot: () => ({ stale: true, state: "live", lastBlockAgeMs: 999999 }) } })({}, stale);
    expect(stale.statusCode).toBe(503);
    expect(stale.body.status).toBe("stale");

    const ok = fakeRes();
    health.createHealthHandler({ worker: { getLivenessSnapshot: () => ({ stale: false, state: "live", lastBlockAgeMs: 10 }) } })({}, ok);
    expect(ok.statusCode).toBe(200);
    expect(health.getLiveness().status).toBe("ok");
  });
});

describe("startup order and deploy wiring (static)", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../../backend/scripts/app.js"), "utf8");

  it("B19: app.js no longer awaits worker.start() and starts the worker only after app.listen", () => {
    expect(app).not.toMatch(/await worker\.start\(\)/);
    expect(app.indexOf("app.listen(")).toBeGreaterThan(-1);
    expect(app.indexOf("worker.startInBackground(")).toBeGreaterThan(app.indexOf("app.listen("));
  });

  it("B6/B27: /health and /ready use the worker-aware handlers", () => {
    expect(app).toContain("createHealthHandler({ worker })");
    expect(app).toContain("createReadyHandler(");
  });

  it("B6: fly.toml health check still targets /health", () => {
    const fly = fs.readFileSync(path.resolve(__dirname, "../../backend/fly.toml"), "utf8");
    expect(fly).toMatch(/path\s*=\s*"\/health"/);
  });
});
