"use strict";

// B8: a failed refresh must keep the previous config (no null window, cache not deleted).

describe("protocolConfig refresh keeps the old config on failure (B8)", () => {
  const escrow = "0x1111111111111111111111111111111111111111";
  const token = "0x2222222222222222222222222222222222222222";

  function setup() {
    jest.resetModules();
    process.env.BASE_RPC_URL = "http://localhost:8545";
    process.env.EXPECTED_CHAIN_ID = "8453";
    process.env.ARAF_ESCROW_ADDRESS = escrow;
    process.env.ARAF_TRACKED_TOKENS = token;

    const redis = { get: jest.fn().mockResolvedValue(null), setEx: jest.fn().mockResolvedValue("OK"), del: jest.fn().mockResolvedValue(1) };
    const state = { fee: 25n, failFee: false, failToken: false };
    const methods = {
      getFeeConfig: jest.fn(async () => {
        if (state.failFee) throw new Error("rpc down");
        return { currentTakerFeeBps: state.fee, currentMakerFeeBps: 10n };
      }),
      getCooldownConfig: jest.fn().mockResolvedValue({ currentTier0TradeCooldown: 1n, currentTier1TradeCooldown: 2n }),
      getTokenConfig: jest.fn(async () => {
        if (state.failToken) throw new Error("token rpc down");
        return { supported: true, allowSellOrders: true, allowBuyOrders: true, decimals: 6, tierMaxAmountsBaseUnit: [1n, 2n, 3n, 4n] };
      }),
    };
    for (let t = 0; t < 5; t += 1) {
      methods[`MAKER_BOND_TIER${t}_BPS`] = jest.fn().mockResolvedValue(1000n);
      methods[`TAKER_BOND_TIER${t}_BPS`] = jest.fn().mockResolvedValue(1000n);
    }
    jest.doMock("../../backend/scripts/config/redis", () => ({ getRedisClient: () => redis }));
    jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
    jest.doMock("ethers", () => ({
      ethers: {
        JsonRpcProvider: jest.fn(() => ({ getNetwork: jest.fn().mockResolvedValue({ chainId: 8453n }) })),
        Contract: jest.fn(() => methods),
      },
    }));
    return { service: require("../../backend/scripts/services/protocolConfig"), redis, state };
  }

  it("keeps serving the previous config and the cache when the chain read fails", async () => {
    const { service, redis, state } = setup();
    await service.loadProtocolConfig();
    expect(service.getConfig().feeConfig.takerFeeBps).toBe(25);

    state.failFee = true;
    await expect(service.refreshProtocolConfig()).rejects.toThrow("rpc down");

    expect(service.getConfig().feeConfig.takerFeeBps).toBe(25); // no CONFIG_UNAVAILABLE window
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("keeps the old config when a single token read fails during refresh (no zeroed token entry)", async () => {
    const { service, state } = setup();
    await service.loadProtocolConfig();
    state.failToken = true;

    await expect(service.refreshProtocolConfig()).rejects.toThrow("token rpc down");

    expect(service.getConfig().tokenMap[token].supported).toBe(true);
  });

  it("swaps in the new config on success", async () => {
    const { service, state } = setup();
    await service.loadProtocolConfig();
    state.fee = 40n;

    await service.refreshProtocolConfig();

    expect(service.getConfig().feeConfig.takerFeeBps).toBe(40);
  });
});
