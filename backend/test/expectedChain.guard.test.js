"use strict";

describe("expected chain ID fail-closed guard", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.EXPECTED_CHAIN_ID;
    delete process.env.ALLOW_UNSAFE_CHAIN_ID_BYPASS;
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function loadGuard() {
    return require("../scripts/services/expectedChain");
  }

  it("security_production_fails_when_expected_chain_missing", () => {
    process.env.NODE_ENV = "production";
    process.env.BASE_RPC_URL = "https://mainnet.base.org";
    const { resolveExpectedChainIdOrThrow } = loadGuard();

    expect(() => resolveExpectedChainIdOrThrow({
      isProduction: true,
      rpcUrl: process.env.BASE_RPC_URL,
      surface: "UnitTest",
    })).toThrow(/EXPECTED_CHAIN_ID production ortamında zorunludur/);
  });

  it("security_fails_when_provider_chain_mismatches_expected", async () => {
    process.env.NODE_ENV = "development";
    process.env.BASE_RPC_URL = "http://localhost:8545";
    process.env.EXPECTED_CHAIN_ID = "8453";
    const { assertProviderExpectedChainOrThrow } = loadGuard();
    const provider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 84532n }),
    };

    await expect(assertProviderExpectedChainOrThrow(provider, {
      rpcUrl: process.env.BASE_RPC_URL,
      surface: "UnitTest",
    })).rejects.toThrow(/expected=8453 actual=84532/);
  });

  it("security_passes_when_provider_chain_matches_expected", async () => {
    process.env.NODE_ENV = "development";
    process.env.BASE_RPC_URL = "http://localhost:8545";
    process.env.EXPECTED_CHAIN_ID = "8453";
    const { assertProviderExpectedChainOrThrow } = loadGuard();
    const provider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 8453n }),
    };

    await expect(assertProviderExpectedChainOrThrow(provider, {
      rpcUrl: process.env.BASE_RPC_URL,
      surface: "UnitTest",
    })).resolves.toMatchObject({ expectedChainId: 8453, actualChainId: 8453 });
  });
});

