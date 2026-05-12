"use strict";

const WALLET = "0x1111111111111111111111111111111111111111";
const PLAINTEXT = "iban:TR120006200011001000000001";

function loadEncryptionModuleWithAwsMock({ plaintextBytes, sendImpl } = {}) {
  const send = sendImpl || jest.fn().mockResolvedValue({
    Plaintext: plaintextBytes || Buffer.alloc(32, 0x42),
  });

  const DecryptCommand = jest.fn().mockImplementation((input) => ({ input }));
  const KMSClient = jest.fn().mockImplementation(() => ({ send }));

  jest.doMock("@aws-sdk/client-kms", () => ({ KMSClient, DecryptCommand }));
  const encryption = require("../../backend/scripts/services/encryption");

  return { encryption, send, KMSClient, DecryptCommand };
}

describe("encryption AWS KMS provider security paths", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.MASTER_ENCRYPTION_KEY;
    delete process.env.AWS_ENCRYPTED_DATA_KEY;
    delete process.env.AWS_REGION;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("rejects env provider in production (fail-closed)", async () => {
    process.env.NODE_ENV = "production";
    process.env.KMS_PROVIDER = "env";
    process.env.MASTER_ENCRYPTION_KEY = "a".repeat(64);

    const encryption = require("../../backend/scripts/services/encryption");

    await expect(encryption.encryptField(PLAINTEXT, WALLET)).rejects.toThrow(
      "Production'da KMS_PROVIDER='env' kullanılamaz",
    );
  });

  test("rejects aws provider when AWS_ENCRYPTED_DATA_KEY is missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.KMS_PROVIDER = "aws";

    const { encryption, send } = loadEncryptionModuleWithAwsMock();

    await expect(encryption.encryptField(PLAINTEXT, WALLET)).rejects.toThrow(
      "AWS_ENCRYPTED_DATA_KEY .env'de tanımlı değil",
    );
    expect(send).not.toHaveBeenCalled();
  });

  test("rejects unknown KMS_PROVIDER values", async () => {
    process.env.NODE_ENV = "production";
    process.env.KMS_PROVIDER = "unknown-provider";

    const encryption = require("../../backend/scripts/services/encryption");

    await expect(encryption.encryptField(PLAINTEXT, WALLET)).rejects.toThrow(
      'Bilinmeyen KMS_PROVIDER: "unknown-provider"',
    );
  });


  test("startup self-test rejects aws provider when encrypted key missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.KMS_PROVIDER = "aws";
    const { encryption } = loadEncryptionModuleWithAwsMock();
    await expect(encryption.runProductionKmsStartupSelfTest()).rejects.toThrow(
      "AWS_ENCRYPTED_DATA_KEY production'da zorunlu",
    );
  });

  test("startup self-test rejects aws provider when plaintext length invalid", async () => {
    process.env.NODE_ENV = "production";
    process.env.KMS_PROVIDER = "aws";
    process.env.AWS_ENCRYPTED_DATA_KEY = Buffer.from("ciphertextblob").toString("base64");
    const { encryption } = loadEncryptionModuleWithAwsMock({ plaintextBytes: Buffer.alloc(31, 0x01) });
    await expect(encryption.runProductionKmsStartupSelfTest()).rejects.toThrow(
      "AWS master key length invalid (expected 32 bytes)",
    );
  });

  test("startup self-test accepts mocked aws happy path", async () => {
    process.env.NODE_ENV = "production";
    process.env.KMS_PROVIDER = "aws";
    process.env.AWS_ENCRYPTED_DATA_KEY = Buffer.from("ciphertextblob").toString("base64");
    const { encryption } = loadEncryptionModuleWithAwsMock({ plaintextBytes: Buffer.alloc(32, 0x02) });
    await expect(encryption.runProductionKmsStartupSelfTest()).resolves.toEqual({ ok: true, provider: "aws" });
  });

  test("aws provider uses mocked decrypt and returns 32-byte master key", async () => {
    process.env.NODE_ENV = "production";
    process.env.KMS_PROVIDER = "aws";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ENCRYPTED_DATA_KEY = Buffer.from("ciphertextblob").toString("base64");

    const { encryption, send, KMSClient, DecryptCommand } = loadEncryptionModuleWithAwsMock({
      plaintextBytes: Buffer.alloc(32, 0x37),
    });

    const cipherHex = await encryption.encryptField(PLAINTEXT, WALLET);
    const decrypted = await encryption.decryptField(cipherHex, WALLET);

    expect(decrypted).toBe(PLAINTEXT);
    expect(KMSClient).toHaveBeenCalledWith({ region: "us-east-1" });
    expect(DecryptCommand).toHaveBeenCalledTimes(1);

    const decryptInput = DecryptCommand.mock.calls[0][0];
    expect(Buffer.isBuffer(decryptInput.CiphertextBlob)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);

    const sentCommand = send.mock.calls[0][0];
    expect(sentCommand.input.CiphertextBlob.equals(Buffer.from("ciphertextblob"))).toBe(true);

    encryption.clearMasterKeyCache();
  });
});
