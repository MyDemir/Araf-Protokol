"use strict";

describe("tokenEnv chain-aware resolver", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.ARAF_TRACKED_TOKENS;
    delete process.env.EXPECTED_CHAIN_ID;
    delete process.env.BASE_MAINNET_USDT_ADDRESS;
    delete process.env.BASE_MAINNET_USDC_ADDRESS;
    delete process.env.BASE_SEPOLIA_USDT_ADDRESS;
    delete process.env.BASE_SEPOLIA_USDC_ADDRESS;
    delete process.env.MAINNET_USDT_ADDRESS;
    delete process.env.MAINNET_USDC_ADDRESS;
    delete process.env.USDT_ADDRESS;
    delete process.env.USDC_ADDRESS;
    process.env.NODE_ENV = "production";
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  function loadService() {
    jest.doMock("../scripts/utils/logger", () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    return require("../scripts/services/tokenEnv");
  }

  it("derives tracked tokens from BASE_MAINNET_* on expected chain 8453", () => {
    process.env.EXPECTED_CHAIN_ID = "8453";
    process.env.BASE_MAINNET_USDT_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.BASE_MAINNET_USDC_ADDRESS = "0x2222222222222222222222222222222222222222";
    const { resolveTrackedTokensOrThrow } = loadService();

    const tokens = resolveTrackedTokensOrThrow({ isProduction: true });
    expect(tokens).toEqual([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ]);
  });

  it("fails fast when BASE_MAINNET_USDT_ADDRESS is zero address in production", () => {
    process.env.EXPECTED_CHAIN_ID = "8453";
    process.env.BASE_MAINNET_USDT_ADDRESS = "0x0000000000000000000000000000000000000000";
    process.env.BASE_MAINNET_USDC_ADDRESS = "0x2222222222222222222222222222222222222222";
    const { resolveTrackedTokensOrThrow } = loadService();

    expect(() => resolveTrackedTokensOrThrow({ isProduction: true })).toThrow(/BASE_MAINNET_USDT_ADDRESS/);
  });

  it("derives tracked tokens from BASE_SEPOLIA_* on expected chain 84532", () => {
    process.env.EXPECTED_CHAIN_ID = "84532";
    process.env.BASE_SEPOLIA_USDT_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.BASE_SEPOLIA_USDC_ADDRESS = "0x4444444444444444444444444444444444444444";
    const { resolveTrackedTokensOrThrow } = loadService();

    const tokens = resolveTrackedTokensOrThrow({ isProduction: true });
    expect(tokens).toEqual([
      "0x3333333333333333333333333333333333333333",
      "0x4444444444444444444444444444444444444444",
    ]);
  });

  it("fails fast in production when chain is 84532 and MAINNET_* alias is set", () => {
    process.env.EXPECTED_CHAIN_ID = "84532";
    process.env.MAINNET_USDT_ADDRESS = "0x5555555555555555555555555555555555555555";
    process.env.BASE_SEPOLIA_USDC_ADDRESS = "0x4444444444444444444444444444444444444444";
    const { resolveTrackedTokensOrThrow } = loadService();

    expect(() => resolveTrackedTokensOrThrow({ isProduction: true })).toThrow(/Base Sepolia/);
  });

  it("infers USDT/USDC symbols using BASE_SEPOLIA_* token addresses", () => {
    process.env.EXPECTED_CHAIN_ID = "84532";
    process.env.BASE_SEPOLIA_USDT_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.BASE_SEPOLIA_USDC_ADDRESS = "0x4444444444444444444444444444444444444444";
    const { inferCryptoAssetFromTokenAddress } = loadService();

    expect(inferCryptoAssetFromTokenAddress("0x3333333333333333333333333333333333333333")).toBe("USDT");
    expect(inferCryptoAssetFromTokenAddress("0x4444444444444444444444444444444444444444")).toBe("USDC");
  });

  it("fails closed in production when infer path sees Base Sepolia + MAINNET_* alias", () => {
    process.env.EXPECTED_CHAIN_ID = "84532";
    process.env.MAINNET_USDT_ADDRESS = "0x5555555555555555555555555555555555555555";
    const { inferCryptoAssetFromTokenAddress } = loadService();

    expect(() => inferCryptoAssetFromTokenAddress("0x5555555555555555555555555555555555555555")).toThrow(/Base Sepolia/);
  });

  it("fails closed in production infer path when EXPECTED_CHAIN_ID is missing", () => {
    delete process.env.EXPECTED_CHAIN_ID;
    process.env.BASE_MAINNET_USDT_ADDRESS = "0x1111111111111111111111111111111111111111";
    const { inferCryptoAssetFromTokenAddress } = loadService();

    expect(() => inferCryptoAssetFromTokenAddress("0x1111111111111111111111111111111111111111")).toThrow(/EXPECTED_CHAIN_ID/);
  });

  it("fails fast in production when ARAF_TRACKED_TOKENS contains zero address only", () => {
    process.env.EXPECTED_CHAIN_ID = "8453";
    process.env.ARAF_TRACKED_TOKENS = "0x0000000000000000000000000000000000000000";
    const { resolveTrackedTokensOrThrow } = loadService();

    expect(() => resolveTrackedTokensOrThrow({ isProduction: true })).toThrow(/ARAF_TRACKED_TOKENS/);
  });

  it("fails fast in production when ARAF_TRACKED_TOKENS mixes valid and zero addresses", () => {
    process.env.EXPECTED_CHAIN_ID = "8453";
    process.env.ARAF_TRACKED_TOKENS = [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0x0000000000000000000000000000000000000000",
    ].join(",");
    const { resolveTrackedTokensOrThrow } = loadService();

    expect(() => resolveTrackedTokensOrThrow({ isProduction: true })).toThrow(/zero address/);
  });

  it("prefers explicit ARAF_TRACKED_TOKENS over env-derived chain token set", () => {
    process.env.EXPECTED_CHAIN_ID = "8453";
    process.env.ARAF_TRACKED_TOKENS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.BASE_MAINNET_USDT_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.BASE_MAINNET_USDC_ADDRESS = "0x2222222222222222222222222222222222222222";
    const { resolveTrackedTokensOrThrow } = loadService();

    const tokens = resolveTrackedTokensOrThrow({ isProduction: true });
    expect(tokens).toEqual(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
  });
});
