"use strict";

const express = require("express");
const request = require("supertest");

describe("auth refresh + nonce hardening", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("does not derive wallet authority from unsigned jwt cookie during refresh", async () => {
    const rotateRefreshToken = jest.fn().mockResolvedValue({
      token: "new.jwt.token",
      refreshToken: "new-refresh",
      wallet: "0x1111111111111111111111111111111111111111",
    });

    let authRouter;
    jest.isolateModules(() => {
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
        authLimiter: (_req, _res, next) => next(),
        nonceLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/services/siwe", () => ({
        generateNonce: jest.fn(),
        verifySiweSignature: jest.fn(),
        getSiweConfig: jest.fn(() => ({ domain: "localhost", uri: "https://localhost" })),
        issueJWT: jest.fn(),
        issueRefreshToken: jest.fn(),
        rotateRefreshToken,
        revokeRefreshToken: jest.fn(),
        blacklistJWT: jest.fn(),
      }));
      jest.doMock("../../backend/scripts/services/encryption", () => ({
        encryptPayoutProfile: jest.fn(),
        decryptPayoutProfile: jest.fn(),
        buildPayoutFingerprint: jest.fn(() => "fp"),
      }));
      jest.doMock("../../backend/scripts/models/User", () => ({
        findOneAndUpdate: jest.fn(),
        findOne: jest.fn(),
      }));
      jest.doMock("../../backend/scripts/models/Trade", () => ({ exists: jest.fn() }));
      authRouter = require("../../backend/scripts/routes/auth");
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.cookies = {
        araf_refresh: "valid-refresh-token",
        // forged payload sub points to another wallet; server must ignore this fallback source
        araf_jwt: "x.eyJzdWIiOiIweDk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5OTk5In0.y",
      };
      next();
    });
    app.use("/api/auth", authRouter);

    const res = await request(app)
      .post("/api/auth/refresh")
      .send({});

    expect(res.status).toBe(200);
    expect(rotateRefreshToken).toHaveBeenCalledWith("valid-refresh-token", null);
    expect(res.body.wallet).toBe("0x1111111111111111111111111111111111111111");
  });

  it("applies nonce limiter in nonce route chain", () => {
    const source = require("fs").readFileSync(require("path").join(__dirname, "../../backend/scripts/routes/auth.js"), "utf8");
    expect(source).toContain('router.get("/nonce", authLimiter, nonceLimiter');
    expect(source).not.toContain("_tryDecodeWalletFromJwtCookie");
  });

  it("allows nonce limiter to short-circuit nonce endpoint", async () => {
    const generateNonce = jest.fn();
    let authRouter;
    jest.isolateModules(() => {
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
        authLimiter: (_req, _res, next) => next(),
        nonceLimiter: (_req, res, _next) => res.status(429).json({ error: "nonce limited" }),
      }));
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/services/siwe", () => ({
        generateNonce,
        verifySiweSignature: jest.fn(),
        getSiweConfig: jest.fn(() => ({ domain: "localhost", uri: "https://localhost" })),
        issueJWT: jest.fn(),
        issueRefreshToken: jest.fn(),
        rotateRefreshToken: jest.fn(),
        revokeRefreshToken: jest.fn(),
        blacklistJWT: jest.fn(),
      }));
      jest.doMock("../../backend/scripts/services/encryption", () => ({
        encryptPayoutProfile: jest.fn(),
        decryptPayoutProfile: jest.fn(),
        buildPayoutFingerprint: jest.fn(() => "fp"),
      }));
      jest.doMock("../../backend/scripts/models/User", () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn() }));
      jest.doMock("../../backend/scripts/models/Trade", () => ({ exists: jest.fn() }));
      authRouter = require("../../backend/scripts/routes/auth");
    });

    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter);
    const res = await request(app).get("/api/auth/nonce?wallet=0x1111111111111111111111111111111111111111");
    expect(res.status).toBe(429);
    expect(generateNonce).not.toHaveBeenCalled();
  });

  it("refresh route fails closed and clears cookies on expectedWallet mismatch", async () => {
    const rotateRefreshToken = jest.fn().mockRejectedValue(new Error("Token/wallet uyuşmazlığı. Güvenlik ihlali tespit edildi."));
    let authRouter;
    jest.isolateModules(() => {
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
        authLimiter: (_req, _res, next) => next(),
        nonceLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/services/siwe", () => ({
        generateNonce: jest.fn(),
        verifySiweSignature: jest.fn(),
        getSiweConfig: jest.fn(() => ({ domain: "localhost", uri: "https://localhost" })),
        issueJWT: jest.fn(),
        issueRefreshToken: jest.fn(),
        rotateRefreshToken,
        revokeRefreshToken: jest.fn(),
        blacklistJWT: jest.fn(),
      }));
      jest.doMock("../../backend/scripts/services/encryption", () => ({
        encryptPayoutProfile: jest.fn(),
        decryptPayoutProfile: jest.fn(),
        buildPayoutFingerprint: jest.fn(() => "fp"),
      }));
      jest.doMock("../../backend/scripts/models/User", () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn() }));
      jest.doMock("../../backend/scripts/models/Trade", () => ({ exists: jest.fn() }));
      authRouter = require("../../backend/scripts/routes/auth");
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.cookies = { araf_refresh: "race-token" };
      next();
    });
    app.use("/api/auth", authRouter);

    const res = await request(app).post("/api/auth/refresh").send({ wallet: "0x2222222222222222222222222222222222222222" });
    expect(res.status).toBe(401);
    expect(rotateRefreshToken).toHaveBeenCalledTimes(1);
    expect(Array.isArray(res.headers["set-cookie"])).toBe(true);
  });

  it("concurrent refresh calls for same token cannot both succeed", async () => {
    let consumed = false;
    const rotateRefreshToken = jest.fn(async () => {
      if (consumed) throw new Error("Refresh token geçersiz veya süresi dolmuş. Lütfen yeniden giriş yapın.");
      consumed = true;
      return {
        token: "new.jwt.token",
        refreshToken: "new-refresh",
        wallet: "0x1111111111111111111111111111111111111111",
      };
    });
    let authRouter;
    jest.isolateModules(() => {
      jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
        authLimiter: (_req, _res, next) => next(),
        nonceLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../../backend/scripts/services/siwe", () => ({
        generateNonce: jest.fn(),
        verifySiweSignature: jest.fn(),
        getSiweConfig: jest.fn(() => ({ domain: "localhost", uri: "https://localhost" })),
        issueJWT: jest.fn(),
        issueRefreshToken: jest.fn(),
        rotateRefreshToken,
        revokeRefreshToken: jest.fn(),
        blacklistJWT: jest.fn(),
      }));
      jest.doMock("../../backend/scripts/services/encryption", () => ({
        encryptPayoutProfile: jest.fn(),
        decryptPayoutProfile: jest.fn(),
        buildPayoutFingerprint: jest.fn(() => "fp"),
      }));
      jest.doMock("../../backend/scripts/models/User", () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn() }));
      jest.doMock("../../backend/scripts/models/Trade", () => ({ exists: jest.fn() }));
      authRouter = require("../../backend/scripts/routes/auth");
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.cookies = { araf_refresh: "same-refresh-token" };
      next();
    });
    app.use("/api/auth", authRouter);

    const [res1, res2] = await Promise.all([
      request(app).post("/api/auth/refresh").send({}),
      request(app).post("/api/auth/refresh").send({}),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 401]);
  });
});
