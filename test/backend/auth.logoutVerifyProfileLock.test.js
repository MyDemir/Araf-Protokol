"use strict";

// B30 logout with expired JWT / refresh cookie only, B31 /verify error classes,
// B18 first profile creation exempt from active-trade lock, refresh grace does not overwrite cookie.

const express = require("express");
const request = require("supertest");

const WALLET = "0x1111111111111111111111111111111111111111";
const SIG = "0x" + "ab".repeat(65);

function loadApp({ cookies = {}, siwe = {}, user = null, tradeExists = false } = {}) {
  const siweMock = {
    generateNonce: jest.fn(),
    verifySiweSignature: jest.fn(),
    getSiweConfig: jest.fn(() => ({ domain: "localhost", uri: "https://localhost" })),
    issueJWT: jest.fn(() => "jwt"),
    issueRefreshToken: jest.fn(async () => "refresh"),
    rotateRefreshToken: jest.fn(),
    revokeRefreshToken: jest.fn().mockResolvedValue(),
    peekRefreshTokenOwner: jest.fn().mockResolvedValue(null),
    blacklistJWT: jest.fn().mockResolvedValue(),
    verifyJWT: jest.fn(),
    ...siwe,
  };
  const Trade = { exists: jest.fn().mockResolvedValue(tradeExists) };
  const enc = {
    encryptPayoutProfile: jest.fn().mockResolvedValue({
      rail: "TR_IBAN", country: "TR", contact: { channel: null, value_enc: null },
      payout_details_enc: "enc", fingerprint: { version: 0, hash: "h" },
    }),
    decryptPayoutProfile: jest.fn().mockResolvedValue({
      rail: "TR_IBAN", country: "TR", contact: { channel: null, value: null },
      fields: { account_holder_name: "Old Name", iban: "TR330006100519786457841326" },
    }),
    buildPayoutFingerprintHmac: jest.fn(async (d) => JSON.stringify(d)),
  };
  let router;
  jest.isolateModules(() => {
    jest.doMock("../../backend/scripts/middleware/rateLimiter", () => ({
      authLimiter: (_req, _res, next) => next(),
      nonceLimiter: (_req, _res, next) => next(),
    }));
    // requireAuth always rejects: logout must NOT depend on it (B30)
    jest.doMock("../../backend/scripts/middleware/auth", () => ({
      requireAuth: (req, res, next) => {
        if (req.headers["x-test-auth"]) { req.wallet = WALLET; return next(); }
        return res.status(401).json({ error: "expired" });
      },
      requireSessionWalletMatch: (_req, _res, next) => next(),
    }));
    jest.doMock("../../backend/scripts/services/siwe", () => siweMock);
    jest.doMock("../../backend/scripts/services/encryption", () => enc);
    jest.doMock("../../backend/scripts/models/TermsAcceptance", () => ({
      updateOne: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(() => ({ lean: async () => ({ _id: 1 }) })),
    }));
    jest.doMock("../../backend/scripts/models/User", () => ({
      findOne: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(user) }),
      findOneAndUpdate: jest.fn(async () => ({
        checkBanExpiry: async () => {},
        toPublicProfile: () => ({ wallet_address: WALLET }),
      })),
    }));
    jest.doMock("../../backend/scripts/models/Trade", () => Trade);
    jest.doMock("../../backend/scripts/utils/logger", () => ({
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    }));
    router = require("../../backend/scripts/routes/auth");
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.cookies = cookies; next(); });
  app.use("/api/auth", router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: "internal" }));
  return { app, siweMock, Trade, enc };
}

function clearedCookies(res) {
  const set = res.headers["set-cookie"] || [];
  return {
    jwt: set.some((c) => c.startsWith("araf_jwt=;")),
    refresh: set.some((c) => c.startsWith("araf_refresh=;")),
  };
}

describe("POST /api/auth/logout (B30)", () => {
  afterEach(() => jest.resetModules());

  test("works with an expired (but validly signed) JWT: revokes wallet families and clears cookies", async () => {
    const verifyJWT = jest.fn(() => ({ sub: WALLET, type: "auth", jti: "j" }));
    const { app, siweMock } = loadApp({ cookies: { araf_jwt: "expired.jwt" }, siwe: { verifyJWT } });

    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(verifyJWT).toHaveBeenCalledWith("expired.jwt", { ignoreExpiration: true });
    expect(siweMock.revokeRefreshToken).toHaveBeenCalledWith(WALLET);
    expect(siweMock.blacklistJWT).toHaveBeenCalledWith("expired.jwt");
    expect(clearedCookies(res)).toEqual({ jwt: true, refresh: true });
  });

  test("works with the refresh cookie alone (no JWT)", async () => {
    const peekRefreshTokenOwner = jest.fn().mockResolvedValue({ wallet: WALLET, familyId: "f1" });
    const { app, siweMock } = loadApp({ cookies: { araf_refresh: "r".repeat(64) }, siwe: { peekRefreshTokenOwner } });

    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(peekRefreshTokenOwner).toHaveBeenCalledWith("r".repeat(64));
    expect(siweMock.revokeRefreshToken).toHaveBeenCalledWith(WALLET);
    expect(siweMock.blacklistJWT).not.toHaveBeenCalled();
    expect(clearedCookies(res)).toEqual({ jwt: true, refresh: true });
  });

  test("a JWT with a forged signature grants no identity; falls back to refresh cookie", async () => {
    const verifyJWT = jest.fn(() => { throw new Error("invalid signature"); });
    const peekRefreshTokenOwner = jest.fn().mockResolvedValue(null);
    const { app, siweMock } = loadApp({
      cookies: { araf_jwt: "forged", araf_refresh: "x" },
      siwe: { verifyJWT, peekRefreshTokenOwner },
    });

    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(siweMock.revokeRefreshToken).not.toHaveBeenCalled();
    expect(siweMock.blacklistJWT).not.toHaveBeenCalled();
    expect(clearedCookies(res)).toEqual({ jwt: true, refresh: true });
  });

  test("a non-auth token type (e.g. PII token) is not accepted as identity", async () => {
    const verifyJWT = jest.fn(() => ({ sub: WALLET, type: "pii", tradeId: "t" }));
    const { app, siweMock } = loadApp({ cookies: { araf_jwt: "pii.token" }, siwe: { verifyJWT } });
    await request(app).post("/api/auth/logout").expect(200);
    expect(siweMock.revokeRefreshToken).not.toHaveBeenCalled();
  });

  test("no cookies at all: idempotent success", async () => {
    const { app, siweMock } = loadApp();
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(200);
    expect(siweMock.revokeRefreshToken).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/verify error classes (B31)", () => {
  afterEach(() => jest.resetModules());

  const { SiweMessage } = require("siwe");
  const { CURRENT_TERMS_VERSION } = require("../../backend/scripts/config/terms");
  const message = new SiweMessage({
    domain: "localhost", address: WALLET, uri: "https://localhost", version: "1", chainId: 8453,
    statement: `I accept the Araf Terms of Use v${CURRENT_TERMS_VERSION} and sign in.`,
    nonce: "abcdefgh12345678", issuedAt: new Date().toISOString(),
  }).prepareMessage();

  test("expected auth failures stay 401 and keep their message", async () => {
    const err = Object.assign(new Error("Nonce uyuşmazlığı."), { isAuthError: true });
    const { app } = loadApp({ siwe: { verifySiweSignature: jest.fn().mockRejectedValue(err) } });
    const res = await request(app).post("/api/auth/verify").send({ message, signature: SIG });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Nonce uyuşmazlığı.");
  });

  test("unexpected errors (Redis/DB/config) return 500 with a generic message and no raw text", async () => {
    const boom = new Error("connect ECONNREFUSED 10.0.0.5:6379 secret-host");
    const { app } = loadApp({ siwe: { verifySiweSignature: jest.fn().mockRejectedValue(boom) } });
    const res = await request(app).post("/api/auth/verify").send({ message, signature: SIG });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(res.body)).not.toContain("secret-host");
  });

  test("non-Error rejections (siwe library response objects) are also 500, not a crash", async () => {
    const { app } = loadApp({ siwe: { verifySiweSignature: jest.fn().mockRejectedValue({ success: false }) } });
    const res = await request(app).post("/api/auth/verify").send({ message, signature: SIG });
    expect(res.status).toBe(500);
  });
});

describe("POST /api/auth/refresh grace reuse", () => {
  afterEach(() => jest.resetModules());

  test("does not overwrite the refresh cookie when only a JWT is returned", async () => {
    const rotateRefreshToken = jest.fn().mockResolvedValue({ token: "newjwt", refreshToken: null, wallet: WALLET, graceReuse: true });
    const { app } = loadApp({ cookies: { araf_refresh: "old" }, siwe: { rotateRefreshToken } });
    const res = await request(app).post("/api/auth/refresh").send({});
    expect(res.status).toBe(200);
    const set = res.headers["set-cookie"] || [];
    expect(set.some((c) => c.startsWith("araf_jwt=newjwt"))).toBe(true);
    expect(set.some((c) => c.startsWith("araf_refresh="))).toBe(false);
  });
});

describe("PUT /api/auth/profile active-trade lock (B18)", () => {
  afterEach(() => jest.resetModules());

  const body = {
    payoutProfile: {
      rail: "TR_IBAN", country: "TR",
      contact: { channel: null, value: null },
      fields: {
        account_holder_name: "Test User", iban: "TR330006100519786457841326",
        routing_number: null, account_number: null, account_type: null, bic: null, bank_name: null,
      },
    },
  };

  function makeUser(payout_profile) {
    return {
      wallet_address: WALLET, profileVersion: 0, payout_profile,
      markBankProfileChanged: jest.fn(), recomputeBankChangeCounters: jest.fn(),
      save: jest.fn().mockResolvedValue(),
    };
  }

  test("first-ever profile creation is allowed while a trade is active (lock check skipped)", async () => {
    const { app, Trade } = loadApp({ user: makeUser(undefined), tradeExists: true });
    const res = await request(app).put("/api/auth/profile").set("x-test-auth", "1").send(body);
    expect(res.status).toBe(200);
    expect(Trade.exists).not.toHaveBeenCalled();
  });

  test("changing an existing profile is still locked during an active trade", async () => {
    const existing = makeUser({ payout_details_enc: "enc", fingerprint: { version: 1 } });
    const { app, Trade } = loadApp({ user: existing, tradeExists: true });
    const res = await request(app).put("/api/auth/profile").set("x-test-auth", "1").send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("BANK_PROFILE_LOCKED_DURING_ACTIVE_TRADE");
    expect(Trade.exists).toHaveBeenCalled();
    expect(existing.save).not.toHaveBeenCalled();
  });
});
