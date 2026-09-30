"use strict";

const WALLET = "0x1111111111111111111111111111111111111111";
const PLAINTEXT = "iban:TR120006200011001000000001";
const KEY32 = Buffer.alloc(32, 0x5a);

function vaultOk(plaintextBuf = KEY32) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: { plaintext: plaintextBuf.toString("base64") } }),
    text: async () => "",
  });
}

describe("encryption Vault provider (B7) + HMAC fingerprint (B33)", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.MASTER_ENCRYPTION_KEY;
    process.env.NODE_ENV = "production";
    process.env.KMS_PROVIDER = "vault";
    process.env.VAULT_ADDR = "https://vault.example:8200/";
    process.env.VAULT_TOKEN = "s.token";
    process.env.VAULT_KEY_NAME = "araf-master-key";
    process.env.VAULT_ENCRYPTED_DATA_KEY = "vault:v1:abcdef";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("uses transit/decrypt with the stored wrapped key, never datakey/plaintext", async () => {
    const fetchMock = vaultOk();
    global.fetch = fetchMock;
    const enc = require("../../backend/scripts/services/encryption");

    const cipher = await enc.encryptField(PLAINTEXT, WALLET);
    expect(await enc.decryptField(cipher, WALLET)).toBe(PLAINTEXT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://vault.example:8200/v1/transit/decrypt/araf-master-key");
    expect(url).not.toContain("datakey");
    expect(JSON.parse(init.body)).toEqual({ ciphertext: "vault:v1:abcdef" });
    expect(init.headers["X-Vault-Token"]).toBe("s.token");
  });

  test("PII stays decryptable after a restart (same wrapped key => same master key)", async () => {
    global.fetch = vaultOk();
    let enc = require("../../backend/scripts/services/encryption");
    const cipher = await enc.encryptField(PLAINTEXT, WALLET);

    jest.resetModules(); // simulate process restart: cache lost
    global.fetch = vaultOk(); // Vault decrypts the same wrapped key to the same plaintext
    enc = require("../../backend/scripts/services/encryption");
    expect(await enc.decryptField(cipher, WALLET)).toBe(PLAINTEXT);
  });

  test("fails closed when VAULT_ENCRYPTED_DATA_KEY is missing and does not call Vault", async () => {
    delete process.env.VAULT_ENCRYPTED_DATA_KEY;
    const fetchMock = vaultOk();
    global.fetch = fetchMock;
    const enc = require("../../backend/scripts/services/encryption");

    await expect(enc.encryptField(PLAINTEXT, WALLET)).rejects.toThrow("VAULT_ENCRYPTED_DATA_KEY .env'de tanımlı değil");
    await expect(enc.runProductionKmsStartupSelfTest()).rejects.toThrow("VAULT_ENCRYPTED_DATA_KEY production'da zorunlu");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects wrong-length plaintext and Vault HTTP errors", async () => {
    global.fetch = vaultOk(Buffer.alloc(16, 1));
    let enc = require("../../backend/scripts/services/encryption");
    await expect(enc.encryptField(PLAINTEXT, WALLET)).rejects.toThrow("VAULT master key length invalid");

    jest.resetModules();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "denied" });
    enc = require("../../backend/scripts/services/encryption");
    await expect(enc.encryptField(PLAINTEXT, WALLET)).rejects.toThrow("Vault HTTP 403");
  });

  test("payout fingerprint is master-key HMAC, differs from legacy unsalted SHA-256, and keeps legacy compare path", async () => {
    global.fetch = vaultOk();
    const enc = require("../../backend/scripts/services/encryption");
    const details = { iban: "TR120006200011001000000001", account_holder_name: "A B" };

    const legacy = enc.buildPayoutFingerprint(details);
    const hmac = await enc.buildPayoutFingerprintHmac(details);
    expect(hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(hmac).not.toBe(legacy);
    expect(await enc.buildPayoutFingerprintHmac({ ...details })).toBe(hmac);

    // key-dependent: another master key gives another fingerprint
    jest.resetModules();
    global.fetch = vaultOk(Buffer.alloc(32, 0x11));
    const enc2 = require("../../backend/scripts/services/encryption");
    expect(await enc2.buildPayoutFingerprintHmac(details)).not.toBe(hmac);

    // legacy record (no hash_scheme) still matches through the sha256 path
    expect(await enc.payoutFingerprintMatches(details, { hash: legacy })).toBe(true);
    expect(await enc.payoutFingerprintMatches(details, { hash: legacy, hash_scheme: "sha256" })).toBe(true);
    expect(await enc.payoutFingerprintMatches(details, { hash: hmac, hash_scheme: "hmac-v1" })).toBe(true);
    expect(await enc.payoutFingerprintMatches({ ...details, iban: "TR000" }, { hash: hmac, hash_scheme: "hmac-v1" })).toBe(false);
    expect(await enc.payoutFingerprintMatches(details, { hash: hmac })).toBe(false);
  });

  test("encryptPayoutProfile writes an hmac-v1 fingerprint", async () => {
    global.fetch = vaultOk();
    const enc = require("../../backend/scripts/services/encryption");
    const profile = await enc.encryptPayoutProfile({ rail: "TR_IBAN", country: "TR", details: { iban: "TR1" } }, WALLET);
    expect(profile.fingerprint.hash_scheme).toBe("hmac-v1");
    expect(profile.fingerprint.hash).toBe(await enc.buildPayoutFingerprintHmac({ iban: "TR1" }));
  });
});
