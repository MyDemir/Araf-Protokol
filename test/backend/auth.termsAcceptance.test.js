"use strict";

const express = require("express");
const request = require("supertest");
const fs = require("fs");
const path = require("path");
const { SiweMessage } = require("siwe");

const WALLET = "0x1111111111111111111111111111111111111111";
const SIG = "0x" + "ab".repeat(65);

function buildMessage(statement) {
  return new SiweMessage({
    domain: "localhost",
    address: "0x1111111111111111111111111111111111111111",
    statement,
    uri: "https://localhost",
    version: "1",
    chainId: 8453,
    nonce: "abcdefgh12345678",
    issuedAt: new Date().toISOString(),
  }).prepareMessage();
}

function loadApp() {
  process.env.JWT_SECRET = "a".repeat(80);
  const verifySiweSignature = jest.fn(async () => WALLET);
  const issueRefreshToken = jest.fn(async () => "refresh");
  const findOneAndUpdate = jest.fn(async () => ({
    checkBanExpiry: jest.fn(async () => {}),
    toPublicProfile: () => ({ wallet_address: WALLET }),
  }));
  const termsUpdateOne = jest.fn(async () => ({ acknowledged: true }));
  const termsFindOne = jest.fn(() => ({ lean: async () => null }));
  let router;
  jest.isolateModules(() => {
    jest.doMock("../../backend/scripts/models/TermsAcceptance", () => ({ updateOne: termsUpdateOne, findOne: termsFindOne }));
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
      verifySiweSignature,
      getSiweConfig: jest.fn(() => ({ domain: "localhost", uri: "https://localhost" })),
      issueJWT: jest.fn(() => "jwt"),
      issueRefreshToken,
      rotateRefreshToken: jest.fn(),
      revokeRefreshToken: jest.fn(),
      blacklistJWT: jest.fn(),
    }));
    jest.doMock("../../backend/scripts/services/encryption", () => ({
      encryptPayoutProfile: jest.fn(),
      decryptPayoutProfile: jest.fn(),
      buildPayoutFingerprint: jest.fn(() => "fingerprint"),
    }));
    jest.doMock("../../backend/scripts/models/User", () => ({ findOneAndUpdate, findOne: jest.fn() }));
    jest.doMock("../../backend/scripts/models/Trade", () => ({ exists: jest.fn() }));
    router = require("../../backend/scripts/routes/auth");
  });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", router);
  return { app, verifySiweSignature, findOneAndUpdate, termsUpdateOne, termsFindOne, issueRefreshToken };
}

describe("SIWE login requires signed acceptance of the terms", () => {
  afterEach(() => jest.resetModules());

  it("without the clause and without stored acceptance: no session, and the status is only revealed after the signature is verified", async () => {
    const { app, verifySiweSignature, findOneAndUpdate, termsUpdateOne } = loadApp();
    const res = await request(app).post("/api/auth/verify").send({ message: buildMessage("Sign in to Araf Protocol."), signature: SIG });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "TERMS_NOT_ACCEPTED", reason: "ACCEPTANCE_REQUIRED" });
    expect(verifySiweSignature).toHaveBeenCalled();
    expect(termsUpdateOne).not.toHaveBeenCalled();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("without the clause but with stored acceptance (new device): session opens, evidence untouched", async () => {
    const { CURRENT_TERMS_VERSION } = require("../../backend/scripts/config/terms");
    const { app, termsFindOne, termsUpdateOne, findOneAndUpdate, issueRefreshToken } = loadApp();
    termsFindOne.mockReturnValueOnce({ lean: async () => ({ _id: "x" }) });
    const res = await request(app).post("/api/auth/verify").send({ message: buildMessage("Sign in to Araf Protocol."), signature: SIG });
    expect(res.status).toBe(200);
    expect(res.body.terms.version).toBe(CURRENT_TERMS_VERSION);
    expect(termsFindOne.mock.calls[0][0]).toEqual({ wallet_address: WALLET, terms_version: CURRENT_TERMS_VERSION });
    expect(termsUpdateOne).not.toHaveBeenCalled();
    expect(findOneAndUpdate.mock.calls[0][1].$set).toEqual({ last_login: expect.any(Date) });
    expect(issueRefreshToken).toHaveBeenCalledWith(WALLET, null, CURRENT_TERMS_VERSION);
  });

  it("rejects an unknown terms version before checking the signature", async () => {
    const { app, verifySiweSignature } = loadApp();
    const res = await request(app).post("/api/auth/verify").send({ message: buildMessage("I accept the Araf Terms of Use v1999-01-01 and sign in."), signature: SIG });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "TERMS_NOT_ACCEPTED", reason: "UNSUPPORTED_VERSION" });
    expect(verifySiweSignature).not.toHaveBeenCalled();
  });

  it("records version, time and message digest when the current terms are accepted", async () => {
    const { CURRENT_TERMS_VERSION } = require("../../backend/scripts/config/terms");
    const { app, findOneAndUpdate, issueRefreshToken } = loadApp();
    const message = buildMessage(`Sign in to Araf Protocol. I accept the Araf Terms of Use v${CURRENT_TERMS_VERSION} and acknowledge that Araf is non-custodial software, not a party to my trades.`);
    const res = await request(app).post("/api/auth/verify").send({ message, signature: SIG });
    expect(res.status).toBe(200);
    expect(res.body.terms.version).toBe(CURRENT_TERMS_VERSION);
    expect(issueRefreshToken).toHaveBeenCalledWith(WALLET, null, CURRENT_TERMS_VERSION);
    const update = findOneAndUpdate.mock.calls[0][1].$set;
    expect(update.terms_accepted_version).toBe(CURRENT_TERMS_VERSION);
    expect(update.terms_accepted_at).toBeInstanceOf(Date);
    expect(update.terms_acceptance_message_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the first signed acceptance per wallet and version as permanent evidence", async () => {
    const { CURRENT_TERMS_VERSION } = require("../../backend/scripts/config/terms");
    const { app, termsUpdateOne } = loadApp();
    const message = buildMessage(`Sign in to Araf Protocol. I accept the Araf Terms of Use v${CURRENT_TERMS_VERSION} and acknowledge that Araf is non-custodial software, not a party to my trades.`);
    await request(app).post("/api/auth/verify").send({ message, signature: SIG }).expect(200);
    const [filter, update, opts] = termsUpdateOne.mock.calls[0];
    expect(filter).toEqual({ wallet_address: WALLET, terms_version: CURRENT_TERMS_VERSION });
    // $setOnInsert only: later logins never overwrite the first acceptance.
    expect(Object.keys(update)).toEqual(["$setOnInsert"]);
    expect(update.$setOnInsert.signed_message).toBe(message);
    expect(update.$setOnInsert.signature).toBe(SIG);
    expect(update.$setOnInsert.chain_id).toBe(8453);
    expect(opts).toEqual({ upsert: true });
  });

  it("does not open a session when the evidence cannot be stored", async () => {
    const { CURRENT_TERMS_VERSION } = require("../../backend/scripts/config/terms");
    const { app, termsUpdateOne, findOneAndUpdate } = loadApp();
    termsUpdateOne.mockRejectedValueOnce(new Error("db down"));
    const message = buildMessage(`I accept the Araf Terms of Use v${CURRENT_TERMS_VERSION} and sign in.`);
    const res = await request(app).post("/api/auth/verify").send({ message, signature: SIG });
    // [TR] Beklenmeyen (DB) hata artık 401 değil 500 + genel mesajdır (B31); oturum yine açılmaz.
    expect(res.status).toBe(500);
    expect(res.body.error).not.toContain("db down");
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("tolerates a concurrent first acceptance (duplicate key)", async () => {
    const { CURRENT_TERMS_VERSION } = require("../../backend/scripts/config/terms");
    const { app, termsUpdateOne } = loadApp();
    termsUpdateOne.mockRejectedValueOnce(Object.assign(new Error("E11000"), { code: 11000 }));
    const message = buildMessage(`I accept the Araf Terms of Use v${CURRENT_TERMS_VERSION} and sign in.`);
    await request(app).post("/api/auth/verify").send({ message, signature: SIG }).expect(200);
  });

  it("frontend and backend use the same terms version", () => {
    const { CURRENT_TERMS_VERSION } = require("../../backend/scripts/config/terms");
    const src = fs.readFileSync(path.join(__dirname, "../../frontend/src/app/legal/terms.js"), "utf8");
    expect(src).toContain(`export const TERMS_VERSION = '${CURRENT_TERMS_VERSION}';`);
  });
});

describe("refresh rotation requires the current terms version (Redis only, no DB)", () => {
  afterEach(() => jest.resetModules());

  function loadSiwe(stored) {
    process.env.JWT_SECRET = "k7Q2vX9pL4mZ8rT1wB6nY3cF5hJ0dS2gA7eU9iO4qW1xR8tV6yN3bM5zK2jH0lP9sD4fG7aC1";
    const store = new Map([["refresh:tok", JSON.stringify(stored)]]);
    const sets = new Map();
    const multi = () => {
      const ops = [];
      const m = {
        setEx: (k, _t, v) => { ops.push(() => store.set(k, v)); return m; },
        sAdd: (k, v) => { ops.push(() => { sets.set(k, (sets.get(k) || new Set()).add(v)); }); return m; },
        sRem: (k, v) => { ops.push(() => sets.get(k)?.delete(v)); return m; },
        expire: () => m,
        del: (k) => { ops.push(() => { store.delete(k); sets.delete(k); }); return m; },
        exec: async () => ops.forEach((f) => f()),
      };
      return m;
    };
    const redis = {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v, opts) => {
        if (opts?.NX && store.has(k)) return null;
        store.set(k, v);
        return "OK";
      },
      exists: async (k) => (store.has(k) || (sets.get(k)?.size > 0) ? 1 : 0),
      sMembers: async (k) => [...(sets.get(k) || [])],
      scan: async () => ({ cursor: 0, keys: [] }),
      multi,
    };
    let svc;
    jest.isolateModules(() => {
      jest.dontMock("../../backend/scripts/services/siwe");
      jest.doMock("../../backend/scripts/config/redis", () => ({ getRedisClient: () => redis, isReady: () => true }));
      svc = jest.requireActual("../../backend/scripts/services/siwe");
    });
    return { svc, store };
  }

  it("refuses sessions opened without (or before) the current terms", async () => {
    const { svc } = loadSiwe({ familyId: "f1", wallet: WALLET });
    await expect(svc.rotateRefreshToken("tok")).rejects.toMatchObject({ code: "TERMS_NOT_ACCEPTED" });
  });

  it("rotates and carries the terms version forward", async () => {
    const { CURRENT_TERMS_VERSION } = require("../../backend/scripts/config/terms");
    const { svc, store } = loadSiwe({ familyId: "f1", wallet: WALLET, termsVersion: CURRENT_TERMS_VERSION });
    const out = await svc.rotateRefreshToken("tok");
    expect(out.wallet).toBe(WALLET);
    const next = JSON.parse([...store.entries()].find(([k, v]) => k.startsWith("refresh:") && v.includes("termsVersion"))[1]);
    expect(next.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });
});
