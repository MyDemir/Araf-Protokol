"use strict";

// B12 (nonce is consumed only after the signature verifies), B32 (chainId), B21 (refresh reuse
// detection + grace + absolute lifetime), B26 (sessions index instead of SCAN), B29 (blacklist timeout).
// Uses a small in-memory Redis fake and REAL SIWE signatures (ethers wallet).

const { ethers } = require("ethers");
const { SiweMessage } = require("siwe");

const JWT_SECRET = "k7Q2vX9pL4mZ8rT1wB6nY3cF5hJ0dS2gA7eU9iO4qW1xR8tV6yN3bM5zK2jH0lP9sD4fG7aC1";

class FakeRedis {
  constructor() {
    this.kv = new Map();
    this.sets = new Map();
    this.scanCalls = 0;
    this.ttls = new Map();
  }
  async get(k) { return this.kv.has(k) ? this.kv.get(k) : null; }
  async set(k, v, opts = {}) {
    if (opts.NX && this.kv.has(k)) return null;
    this.kv.set(k, v);
    if (opts.EX) this.ttls.set(k, opts.EX);
    return "OK";
  }
  async setEx(k, ttl, v) { this.kv.set(k, v); this.ttls.set(k, ttl); return "OK"; }
  async getDel(k) { const v = this.kv.has(k) ? this.kv.get(k) : null; this.kv.delete(k); return v; }
  async del(k) { const had = this.kv.delete(k) || this.sets.delete(k); return had ? 1 : 0; }
  async exists(k) { return this.kv.has(k) || (this.sets.get(k)?.size > 0) ? 1 : 0; }
  async sMembers(k) { return [...(this.sets.get(k) || [])]; }
  async scan(_cursor, { MATCH }) {
    this.scanCalls += 1;
    const re = new RegExp(`^${MATCH.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? ".*" : `\\${c}`))}$`);
    const keys = [...this.kv.keys(), ...this.sets.keys()].filter((k) => re.test(k));
    return { cursor: 0, keys };
  }
  multi() {
    const ops = [];
    const m = {
      setEx: (k, t, v) => { ops.push(() => this.setEx(k, t, v)); return m; },
      sAdd: (k, v) => { ops.push(() => { this.sets.set(k, (this.sets.get(k) || new Set()).add(v)); }); return m; },
      sRem: (k, v) => { ops.push(() => { const s = this.sets.get(k); if (s) { s.delete(v); if (!s.size) this.sets.delete(k); } }); return m; },
      expire: () => m,
      del: (k) => { ops.push(() => this.del(k)); return m; },
      exec: async () => { for (const f of ops) await f(); return []; },
    };
    return m;
  }
}

function loadSiwe(redis, { isReady = () => true } = {}) {
  let svc;
  jest.isolateModules(() => {
    jest.doMock("../../backend/scripts/config/redis", () => ({ getRedisClient: () => redis, isReady }));
    jest.doMock("../../backend/scripts/utils/logger", () => ({
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    }));
    svc = jest.requireActual("../../backend/scripts/services/siwe");
  });
  return svc;
}

async function signedLogin({ signer, claimedAddress, nonce, chainId = 8453 }) {
  const message = new SiweMessage({
    domain: "localhost",
    address: claimedAddress || signer.address,
    statement: "sign in",
    uri: "https://localhost",
    version: "1",
    chainId,
    nonce,
    issuedAt: new Date().toISOString(),
  }).prepareMessage();
  const signature = await signer.signMessage(message);
  return { message, signature };
}

describe("siwe service (real signatures, fake Redis)", () => {
  const originalEnv = process.env;
  let victim;
  let attacker;
  let redis;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, JWT_SECRET };
    delete process.env.BASE_RPC_URL;
    delete process.env.SIWE_DOMAIN;
    delete process.env.SIWE_URI;
    process.env.EXPECTED_CHAIN_ID = "8453";
    victim = ethers.Wallet.createRandom();
    attacker = ethers.Wallet.createRandom();
    redis = new FakeRedis();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("nonce consumption order (B12)", () => {
    test("an invalid signature does not burn the victim's nonce; the real owner can still log in once", async () => {
      const svc = loadSiwe(redis);
      const nonce = await svc.generateNonce(victim.address);

      // attacker claims the victim's address but signs with their own key
      const forged = await signedLogin({ signer: attacker, claimedAddress: victim.address, nonce });
      await expect(svc.verifySiweSignature(forged.message, forged.signature)).rejects.toMatchObject({
        isAuthError: true,
      });
      expect(await redis.get(`nonce:${victim.address.toLowerCase()}`)).toBe(nonce);

      const real = await signedLogin({ signer: victim, nonce });
      await expect(svc.verifySiweSignature(real.message, real.signature)).resolves.toBe(victim.address.toLowerCase());
      expect(await redis.get(`nonce:${victim.address.toLowerCase()}`)).toBeNull();

      // single use: replay of the same signed message fails
      await expect(svc.verifySiweSignature(real.message, real.signature)).rejects.toMatchObject({ isAuthError: true });
    });

    test("a wrong nonce in the message does not burn the stored nonce", async () => {
      const svc = loadSiwe(redis);
      const nonce = await svc.generateNonce(victim.address);
      const bad = await signedLogin({ signer: victim, nonce: "deadbeef12345678" });
      await expect(svc.verifySiweSignature(bad.message, bad.signature)).rejects.toThrow("Nonce uyuşmazlığı");
      expect(await redis.get(`nonce:${victim.address.toLowerCase()}`)).toBe(nonce);
    });

    test("two concurrent valid verifications: exactly one succeeds", async () => {
      const svc = loadSiwe(redis);
      const nonce = await svc.generateNonce(victim.address);
      const login = await signedLogin({ signer: victim, nonce });
      const results = await Promise.allSettled([
        svc.verifySiweSignature(login.message, login.signature),
        svc.verifySiweSignature(login.message, login.signature),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
  });

  describe("chainId enforcement (B32)", () => {
    test("rejects a message signed for another chain and keeps the nonce", async () => {
      const svc = loadSiwe(redis);
      const nonce = await svc.generateNonce(victim.address);
      const wrongChain = await signedLogin({ signer: victim, nonce, chainId: 1 });
      await expect(svc.verifySiweSignature(wrongChain.message, wrongChain.signature)).rejects.toMatchObject({
        code: "SIWE_CHAIN_MISMATCH",
      });
      expect(await redis.get(`nonce:${victim.address.toLowerCase()}`)).toBe(nonce);

      const ok = await signedLogin({ signer: victim, nonce, chainId: 8453 });
      await expect(svc.verifySiweSignature(ok.message, ok.signature)).resolves.toBe(victim.address.toLowerCase());
    });

    test("production without EXPECTED_CHAIN_ID fails closed (config error, not AuthError)", async () => {
      process.env.NODE_ENV = "production";
      process.env.SIWE_DOMAIN = "araf.example";
      process.env.SIWE_URI = "https://araf.example";
      delete process.env.EXPECTED_CHAIN_ID;
      const svc = loadSiwe(redis);
      const nonce = await svc.generateNonce(victim.address);
      const message = new SiweMessage({
        domain: "araf.example", address: victim.address, uri: "https://araf.example", version: "1",
        chainId: 8453, nonce, issuedAt: new Date().toISOString(),
      }).prepareMessage();
      const signature = await victim.signMessage(message);
      await expect(svc.verifySiweSignature(message, signature)).rejects.toThrow("EXPECTED_CHAIN_ID");
    });
  });

  describe("refresh token reuse detection (B21)", () => {
    const CURRENT = () => require("../../backend/scripts/config/terms").CURRENT_TERMS_VERSION;

    test("normal rotation issues a new token, tombstones the old one and carries startedAt", async () => {
      const svc = loadSiwe(redis);
      const t1 = await svc.issueRefreshToken(victim.address, null, CURRENT());
      const first = JSON.parse(await redis.get(`refresh:${t1}`));

      const out = await svc.rotateRefreshToken(t1, victim.address);
      expect(out.refreshToken).toBeTruthy();
      expect(out.refreshToken).not.toBe(t1);
      expect(await redis.get(`refresh:${t1}`)).toBeNull();
      expect(await redis.get(`refresh-used:${t1}`)).toEqual(expect.stringContaining("|"));
      const next = JSON.parse(await redis.get(`refresh:${out.refreshToken}`));
      expect(next.familyId).toBe(first.familyId);
      expect(next.startedAt).toBe(first.startedAt);
    });

    test("reuse after the grace window revokes the whole family", async () => {
      const svc = loadSiwe(redis);
      const t1 = await svc.issueRefreshToken(victim.address, null, CURRENT());
      const { refreshToken: t2 } = await svc.rotateRefreshToken(t1);

      const realNow = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(realNow + 60_000); // well beyond the 10s grace

      await expect(svc.rotateRefreshToken(t1)).rejects.toMatchObject({ code: "REFRESH_REUSE_DETECTED" });
      // the legitimate newest token is gone too (family revoked)
      expect(await redis.get(`refresh:${t2}`)).toBeNull();
      await expect(svc.rotateRefreshToken(t2)).rejects.toMatchObject({ isAuthError: true });
      // and later reuse of t1 no longer resolves to a live family
      await expect(svc.rotateRefreshToken(t1)).rejects.toMatchObject({ code: "REFRESH_INVALID" });
    });

    test("reuse inside the grace window (two tabs) does not revoke the family and gives a JWT only", async () => {
      const svc = loadSiwe(redis);
      const t1 = await svc.issueRefreshToken(victim.address, null, CURRENT());
      const { refreshToken: t2 } = await svc.rotateRefreshToken(t1);

      const tabB = await svc.rotateRefreshToken(t1);
      expect(tabB.graceReuse).toBe(true);
      expect(tabB.refreshToken).toBeNull();
      expect(tabB.token).toEqual(expect.any(String));
      // winner's refresh token is still valid
      expect(await redis.get(`refresh:${t2}`)).not.toBeNull();
      await expect(svc.rotateRefreshToken(t2)).resolves.toMatchObject({ wallet: victim.address.toLowerCase() });
    });

    test("concurrent rotation of the same token: one rotates, the other is a grace reuse (never two new tokens)", async () => {
      const svc = loadSiwe(redis);
      const t1 = await svc.issueRefreshToken(victim.address, null, CURRENT());
      const [a, b] = await Promise.all([svc.rotateRefreshToken(t1), svc.rotateRefreshToken(t1)]);
      const withNewToken = [a, b].filter((r) => r.refreshToken);
      expect(withNewToken).toHaveLength(1);
      expect([a, b].filter((r) => r.graceReuse)).toHaveLength(1);
    });

    test("expected-wallet mismatch on a consumed token is still rejected", async () => {
      const svc = loadSiwe(redis);
      const t1 = await svc.issueRefreshToken(victim.address, null, CURRENT());
      await svc.rotateRefreshToken(t1);
      await expect(svc.rotateRefreshToken(t1, attacker.address)).rejects.toMatchObject({ code: "TOKEN_WALLET_MISMATCH" });
    });

    test("absolute session lifetime: rotation stops after REFRESH_ABSOLUTE_TTL_SECS and revokes the family", async () => {
      process.env.REFRESH_ABSOLUTE_TTL_SECS = "3600";
      const svc = loadSiwe(redis);
      const t1 = await svc.issueRefreshToken(victim.address, null, CURRENT());
      const t2 = (await svc.rotateRefreshToken(t1)).refreshToken;

      // remaining lifetime bounds the new token ttl (never longer than the absolute cap)
      expect(redis.ttls.get(`refresh:${t2}`)).toBeLessThanOrEqual(3600);

      const realNow = Date.now();
      jest.spyOn(Date, "now").mockReturnValue(realNow + 3601 * 1000);
      await expect(svc.rotateRefreshToken(t2)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      expect(await redis.get(`refresh:${t2}`)).toBeNull();
    });
  });

  describe("sessions index instead of keyspace SCAN (B26)", () => {
    const CURRENT = () => require("../../backend/scripts/config/terms").CURRENT_TERMS_VERSION;

    test("revokeRefreshToken revokes every family of the wallet without SCAN", async () => {
      const svc = loadSiwe(redis);
      const a = await svc.issueRefreshToken(victim.address, null, CURRENT());
      const b = await svc.issueRefreshToken(victim.address, null, CURRENT());
      const other = await svc.issueRefreshToken(attacker.address, null, CURRENT());

      await svc.revokeRefreshToken(victim.address);

      expect(await redis.get(`refresh:${a}`)).toBeNull();
      expect(await redis.get(`refresh:${b}`)).toBeNull();
      expect(await redis.get(`refresh:${other}`)).not.toBeNull(); // other wallet untouched
      expect(redis.scanCalls).toBe(0);
    });

    test("legacy sessions without an index are still revoked through one-time SCAN fallback; can be disabled", async () => {
      const svc = loadSiwe(redis);
      const w = victim.address.toLowerCase();
      redis.kv.set("refresh:legacytok", JSON.stringify({ familyId: "legacyfam", wallet: w }));
      redis.sets.set(`family:${w}:legacyfam`, new Set(["legacytok"]));

      await svc.revokeRefreshToken(w);
      expect(redis.scanCalls).toBe(1);
      expect(await redis.get("refresh:legacytok")).toBeNull();

      // kill switch
      process.env.REFRESH_LEGACY_SCAN = "false";
      redis.scanCalls = 0;
      const svc2 = loadSiwe(redis);
      await svc2.revokeRefreshToken(w);
      expect(redis.scanCalls).toBe(0);
    });

    test("peekRefreshTokenOwner resolves live and consumed tokens, rejects garbage", async () => {
      const svc = loadSiwe(redis);
      const t1 = await svc.issueRefreshToken(victim.address, null, CURRENT());
      expect((await svc.peekRefreshTokenOwner(t1)).wallet).toBe(victim.address.toLowerCase());
      await svc.rotateRefreshToken(t1);
      expect((await svc.peekRefreshTokenOwner(t1)).wallet).toBe(victim.address.toLowerCase());
      expect(await svc.peekRefreshTokenOwner("not-a-token")).toBeNull();
      expect(await svc.peekRefreshTokenOwner("a".repeat(64))).toBeNull();
    });
  });

  describe("JWT blacklist check does not hang when Redis is stuck (B29)", () => {
    test("times out and fails closed in production mode", async () => {
      process.env.JWT_BLACKLIST_TIMEOUT_MS = "40";
      process.env.JWT_BLACKLIST_FAIL_MODE = "closed";
      const stuck = { get: () => new Promise(() => {}) }; // offline queue: never resolves
      const svc = loadSiwe(stuck);
      const started = Date.now();
      await expect(svc.isJWTBlacklisted("jti-1")).resolves.toBe(true);
      expect(Date.now() - started).toBeLessThan(1000);
    });

    test("times out and fails open when configured open", async () => {
      process.env.JWT_BLACKLIST_TIMEOUT_MS = "40";
      process.env.JWT_BLACKLIST_FAIL_MODE = "open";
      const svc = loadSiwe({ get: () => new Promise(() => {}) });
      await expect(svc.isJWTBlacklisted("jti-1")).resolves.toBe(false);
    });

    test("Redis not ready fails immediately without touching the client (closed)", async () => {
      process.env.JWT_BLACKLIST_FAIL_MODE = "closed";
      const get = jest.fn();
      const svc = loadSiwe({ get }, { isReady: () => false });
      await expect(svc.isJWTBlacklisted("jti-1")).resolves.toBe(true);
      expect(get).not.toHaveBeenCalled();
    });

    test("healthy Redis: blacklisted jti true, unknown jti false", async () => {
      const svc = loadSiwe(redis);
      await redis.setEx("blacklist:jti:bad", 60, "1");
      await expect(svc.isJWTBlacklisted("bad")).resolves.toBe(true);
      await expect(svc.isJWTBlacklisted("good")).resolves.toBe(false);
    });
  });
});
