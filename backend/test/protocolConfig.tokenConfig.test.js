"use strict";

describe("protocolConfig token config compatibility", () => {
  const escrowAddress = "0x1111111111111111111111111111111111111111";
  const tokenA = "0x2222222222222222222222222222222222222222";

  const baseContractMethods = () => ({
    MAKER_BOND_TIER0_BPS: jest.fn().mockResolvedValue(1000n),
    MAKER_BOND_TIER1_BPS: jest.fn().mockResolvedValue(900n),
    MAKER_BOND_TIER2_BPS: jest.fn().mockResolvedValue(800n),
    MAKER_BOND_TIER3_BPS: jest.fn().mockResolvedValue(700n),
    MAKER_BOND_TIER4_BPS: jest.fn().mockResolvedValue(600n),
    TAKER_BOND_TIER0_BPS: jest.fn().mockResolvedValue(1200n),
    TAKER_BOND_TIER1_BPS: jest.fn().mockResolvedValue(1100n),
    TAKER_BOND_TIER2_BPS: jest.fn().mockResolvedValue(1000n),
    TAKER_BOND_TIER3_BPS: jest.fn().mockResolvedValue(900n),
    TAKER_BOND_TIER4_BPS: jest.fn().mockResolvedValue(800n),
    getFeeConfig: jest.fn().mockResolvedValue({ currentTakerFeeBps: 25n, currentMakerFeeBps: 10n }),
    getCooldownConfig: jest.fn().mockResolvedValue({
      currentTier0TradeCooldown: 3600n,
      currentTier1TradeCooldown: 600n,
    }),
  });

  function loadServiceWith({ getTokenConfigImpl }) {
    jest.resetModules();
    process.env.BASE_RPC_URL = "http://localhost:8545";
    process.env.EXPECTED_CHAIN_ID = "8453";
    process.env.ARAF_ESCROW_ADDRESS = escrowAddress;
    process.env.ARAF_TRACKED_TOKENS = tokenA;

    const redis = {
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
    };

    const methods = baseContractMethods();
    methods.getTokenConfig = jest.fn(getTokenConfigImpl);
    methods.tokenConfigs = jest.fn().mockResolvedValue({ supported: true }); // legacy path should remain unused

    const contractCtor = jest.fn(() => methods);

    jest.doMock("../scripts/config/redis", () => ({
      getRedisClient: () => redis,
    }));
    jest.doMock("../scripts/utils/logger", () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    jest.doMock("ethers", () => ({
      ethers: {
        JsonRpcProvider: jest.fn(() => ({
          getNetwork: jest.fn().mockResolvedValue({ chainId: 8453n }),
        })),
        Contract: contractCtor,
      },
    }));

    const service = require("../scripts/services/protocolConfig");
    return { service, methods, redis };
  }

  it("loadProtocolConfig_reads_token_decimals_and_tier_limits", async () => {
    const { service, methods } = loadServiceWith({
      getTokenConfigImpl: async () => ({
        supported: true,
        allowSellOrders: true,
        allowBuyOrders: false,
        decimals: 6,
        tierMaxAmountsBaseUnit: [150n, 1500n, 7500n, 30000n],
      }),
    });

    const cfg = await service.loadProtocolConfig();
    expect(methods.getTokenConfig).toHaveBeenCalledWith(tokenA);
    expect(methods.tokenConfigs).not.toHaveBeenCalled();
    expect(cfg.tokenMap[tokenA]).toEqual({
      supported: true,
      allowSellOrders: true,
      allowBuyOrders: false,
      decimals: 6,
      tierMaxAmountsBaseUnit: ["150", "1500", "7500", "30000"],
    });
  });

  it("loadProtocolConfig_does_not_fallback_to_six_decimals", async () => {
    const { service } = loadServiceWith({
      getTokenConfigImpl: async () => {
        throw new Error("rpc failure");
      },
    });

    const cfg = await service.loadProtocolConfig();
    expect(cfg.tokenMap[tokenA]).toEqual({
      supported: false,
      allowSellOrders: false,
      allowBuyOrders: false,
      decimals: null,
      tierMaxAmountsBaseUnit: [],
    });
  });

  it("updateCachedTokenConfig_preserves_existing_precision_limits_on_partial_event_patch_after_refresh_failure", async () => {
    const { service } = loadServiceWith({
      getTokenConfigImpl: async () => ({
        supported: true,
        allowSellOrders: true,
        allowBuyOrders: false,
        decimals: 6,
        tierMaxAmountsBaseUnit: [150n, 1500n, 7500n, 30000n],
      }),
    });

    await service.loadProtocolConfig();
    await service.updateCachedTokenConfig(tokenA, {
      supported: false,
      allowSellOrders: false,
      allowBuyOrders: false,
    });

    expect(service.getConfig().tokenMap[tokenA]).toEqual({
      supported: false,
      allowSellOrders: false,
      allowBuyOrders: false,
      decimals: 6,
      tierMaxAmountsBaseUnit: ["150", "1500", "7500", "30000"],
    });
  });

  it("security_loadProtocolConfig_fails_closed_on_expected_chain_mismatch", async () => {
    jest.resetModules();
    process.env.BASE_RPC_URL = "http://localhost:8545";
    process.env.EXPECTED_CHAIN_ID = "8453";
    process.env.ARAF_ESCROW_ADDRESS = escrowAddress;

    const redis = {
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
    };

    jest.doMock("../scripts/config/redis", () => ({
      getRedisClient: () => redis,
    }));
    jest.doMock("../scripts/utils/logger", () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    jest.doMock("ethers", () => ({
      ethers: {
        JsonRpcProvider: jest.fn(() => ({
          getNetwork: jest.fn().mockResolvedValue({ chainId: 84532n }),
        })),
        Contract: jest.fn(),
      },
    }));

    const service = require("../scripts/services/protocolConfig");
    await expect(service.loadProtocolConfig()).rejects.toThrow(/Chain ID uyuşmazlığı/);
  });
});
