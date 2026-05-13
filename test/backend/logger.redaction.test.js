"use strict";

const fs = require("fs");
const path = require("path");
const { redactLogMeta, redactLogString } = require("../../backend/scripts/utils/logRedaction");

describe("logger redaction utility", () => {
  test("redacts nested meta keys while preserving safe correlation IDs", () => {
    const input = {
      tradeId: 12,
      orderId: 98,
      txHash: "0xabc",
      blockNumber: 123,
      logIndex: 5,
      headers: {
        authorization: "Bearer token",
        cookie: "sid=123",
        "x-api-key": "topsecret",
      },
      body: {
        payout_details: { iban: "TR120006200011001000000001", account_holder_name: "Alice" },
      },
    };

    const redacted = redactLogMeta(input);
    expect(redacted.tradeId).toBe(12);
    expect(redacted.orderId).toBe(98);
    expect(redacted.txHash).toBe("0xabc");
    expect(redacted.headers.authorization).toBe("[REDACTED]");
    expect(redacted.headers.cookie).toBe("[REDACTED]");
    expect(redacted.body.payout_details).toBe("[REDACTED]");
  });

  test("redacts token-like and secret-like values in arbitrary strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ3YWxsZXQiOiIweDExMSJ9.signaturepart";
    const privateKey = "0x" + "11".repeat(32);
    const msg = `jwt=${jwt} pk=${privateKey} wallet=0x1111111111111111111111111111111111111111`;

    const redacted = redactLogString(msg);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).toContain("[WALLET]");
    expect(redacted).not.toContain(privateKey);
  });



  test("redacts KMS/Vault assignment-like secrets in log strings", () => {
    const msg = "MASTER_ENCRYPTION_KEY=abcd AWS_ENCRYPTED_DATA_KEY=xyz VAULT_TOKEN=tok123 KMS_PLAINTEXT_KEY=plain";
    const redacted = redactLogString(msg);
    expect(redacted).toContain("MASTER_ENCRYPTION_KEY=[REDACTED]");
    expect(redacted).toContain("AWS_ENCRYPTED_DATA_KEY=[REDACTED]");
    expect(redacted).toContain("VAULT_TOKEN=[REDACTED]");
    expect(redacted).toContain("KMS_PLAINTEXT_KEY=[REDACTED]");
  });

  test("strips URL query strings from log strings", () => {
    const msg = "request failed https://api.example.com/path?token=abc&wallet=0x1111111111111111111111111111111111111111";
    const redacted = redactLogString(msg);
    expect(redacted).toContain("https://api.example.com/path?[REDACTED_QUERY]");
    expect(redacted).not.toContain("token=abc");
  });
});

describe("dockerignore env policy", () => {
  test("includes broad .env* ignore for build context hygiene", () => {
    const dockerignore = fs.readFileSync(path.resolve(__dirname, "../../backend/.dockerignore"), "utf8");
    expect(dockerignore).toContain(".env*");
  });
});
