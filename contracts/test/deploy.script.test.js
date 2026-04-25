const { expect } = require("chai");
const {
  resolveProductionTokenConfig,
  resolveFinalOwnerAddress,
  getTokenConfigSnapshot,
  setAndVerifyTokenConfig,
} = require("../scripts/deploy");

describe("deploy script config guards", function () {
  const OLD_NODE_ENV = process.env.NODE_ENV;
  const OLD_MAINNET_USDT = process.env.MAINNET_USDT_ADDRESS;
  const OLD_MAINNET_USDC = process.env.MAINNET_USDC_ADDRESS;
  const OLD_BASE_MAINNET_USDT = process.env.BASE_MAINNET_USDT_ADDRESS;
  const OLD_BASE_MAINNET_USDC = process.env.BASE_MAINNET_USDC_ADDRESS;
  const OLD_BASE_SEPOLIA_USDT = process.env.BASE_SEPOLIA_USDT_ADDRESS;
  const OLD_BASE_SEPOLIA_USDC = process.env.BASE_SEPOLIA_USDC_ADDRESS;
  const OLD_FINAL_OWNER = process.env.FINAL_OWNER_ADDRESS;

  after(function () {
    process.env.NODE_ENV = OLD_NODE_ENV;
    process.env.MAINNET_USDT_ADDRESS = OLD_MAINNET_USDT;
    process.env.MAINNET_USDC_ADDRESS = OLD_MAINNET_USDC;
    process.env.BASE_MAINNET_USDT_ADDRESS = OLD_BASE_MAINNET_USDT;
    process.env.BASE_MAINNET_USDC_ADDRESS = OLD_BASE_MAINNET_USDC;
    process.env.BASE_SEPOLIA_USDT_ADDRESS = OLD_BASE_SEPOLIA_USDT;
    process.env.BASE_SEPOLIA_USDC_ADDRESS = OLD_BASE_SEPOLIA_USDC;
    process.env.FINAL_OWNER_ADDRESS = OLD_FINAL_OWNER;
  });

  beforeEach(function () {
    delete process.env.MAINNET_USDT_ADDRESS;
    delete process.env.MAINNET_USDC_ADDRESS;
    delete process.env.BASE_MAINNET_USDT_ADDRESS;
    delete process.env.BASE_MAINNET_USDC_ADDRESS;
    delete process.env.BASE_SEPOLIA_USDT_ADDRESS;
    delete process.env.BASE_SEPOLIA_USDC_ADDRESS;
    delete process.env.FINAL_OWNER_ADDRESS;
    process.env.NODE_ENV = "production";
  });

  it("fails fast when base-mainnet token env vars are missing", function () {
    expect(() => resolveProductionTokenConfig({ chainId: 8453 })).to.throw(/BASE_MAINNET_USDT_ADDRESS/);
  });

  it("accepts BASE_MAINNET_* env vars on chain 8453", function () {
    process.env.BASE_MAINNET_USDT_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.BASE_MAINNET_USDC_ADDRESS = "0x2222222222222222222222222222222222222222";

    const cfg = resolveProductionTokenConfig({ chainId: 8453 });
    expect(cfg.isProduction).to.equal(true);
    expect(cfg.usdtAddress).to.equal("0x1111111111111111111111111111111111111111");
    expect(cfg.usdcAddress).to.equal("0x2222222222222222222222222222222222222222");
  });

  it("accepts MAINNET_* alias only for base-mainnet", function () {
    process.env.MAINNET_USDT_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.MAINNET_USDC_ADDRESS = "0x2222222222222222222222222222222222222222";
    const cfg = resolveProductionTokenConfig({ chainId: 8453 });
    expect(cfg.usdtAddress).to.equal("0x1111111111111111111111111111111111111111");
    expect(cfg.usdcAddress).to.equal("0x2222222222222222222222222222222222222222");
  });

  it("fails fast when base-sepolia uses MAINNET_* alias env vars", function () {
    process.env.MAINNET_USDT_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.MAINNET_USDC_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.BASE_SEPOLIA_USDT_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.BASE_SEPOLIA_USDC_ADDRESS = "0x4444444444444444444444444444444444444444";
    expect(() => resolveProductionTokenConfig({ chainId: 84532 })).to.throw(/MAINNET_\*/);
  });

  it("accepts BASE_SEPOLIA_* env vars on chain 84532", function () {
    process.env.BASE_SEPOLIA_USDT_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.BASE_SEPOLIA_USDC_ADDRESS = "0x4444444444444444444444444444444444444444";
    const cfg = resolveProductionTokenConfig({ chainId: 84532 });
    expect(cfg.usdtAddress).to.equal("0x3333333333333333333333333333333333333333");
    expect(cfg.usdcAddress).to.equal("0x4444444444444444444444444444444444444444");
  });

  it("fails fast when token env vars are zero addresses", function () {
    process.env.BASE_MAINNET_USDT_ADDRESS = "0x0000000000000000000000000000000000000000";
    process.env.BASE_MAINNET_USDC_ADDRESS = "0x2222222222222222222222222222222222222222";
    expect(() => resolveProductionTokenConfig({ chainId: 8453 })).to.throw(/BASE_MAINNET_USDT_ADDRESS/);
  });

  it("fails fast when token env vars are invalid addresses", function () {
    process.env.BASE_MAINNET_USDT_ADDRESS = "not-an-address";
    process.env.BASE_MAINNET_USDC_ADDRESS = "0x2222222222222222222222222222222222222222";
    expect(() => resolveProductionTokenConfig({ chainId: 8453 })).to.throw();
  });

  it("is mock-friendly in non-production mode", function () {
    process.env.NODE_ENV = "test";

    const cfg = resolveProductionTokenConfig({ chainId: 8453 });
    expect(cfg.isProduction).to.equal(false);
    expect(cfg.usdtAddress).to.equal(null);
    expect(cfg.usdcAddress).to.equal(null);
  });

  it("security_public_mode_reverts_when_final_owner_missing", function () {
    expect(() =>
      resolveFinalOwnerAddress({
        deployMode: "public",
        treasuryAddress: "0x1111111111111111111111111111111111111111",
      })
    ).to.throw(/FINAL_OWNER_ADDRESS/);
  });

  it("security_public_mode_accepts_valid_final_owner", function () {
    process.env.FINAL_OWNER_ADDRESS = "0x2222222222222222222222222222222222222222";
    const owner = resolveFinalOwnerAddress({
      deployMode: "public",
      treasuryAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(owner).to.equal("0x2222222222222222222222222222222222222222");
  });

  it("security_public_mode_reverts_when_final_owner_equals_treasury", function () {
    process.env.FINAL_OWNER_ADDRESS = "0x1111111111111111111111111111111111111111";
    expect(() =>
      resolveFinalOwnerAddress({
        deployMode: "public",
        treasuryAddress: "0x1111111111111111111111111111111111111111",
      })
    ).to.throw(/aynı olamaz/);
  });

  it("local_mode_can_fallback_final_owner_to_treasury", function () {
    const owner = resolveFinalOwnerAddress({
      deployMode: "local",
      treasuryAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(owner).to.equal("0x1111111111111111111111111111111111111111");
  });

  it("getTokenConfigSnapshot_reads_explicit_getTokenConfig_tier_limits", async function () {
    const fakeEscrow = {
      getTokenConfig: async () => ({
        supported: true,
        allowSellOrders: true,
        allowBuyOrders: false,
        decimals: 6,
        tierMaxAmountsBaseUnit: [150n, 1500n, 7500n, 30000n],
      }),
    };

    const snapshot = await getTokenConfigSnapshot(fakeEscrow, "0x1111111111111111111111111111111111111111");
    expect(snapshot).to.deep.equal({
      supported: true,
      allowSellOrders: true,
      allowBuyOrders: false,
      decimals: 6,
      tierMaxAmountsBaseUnit: ["150", "1500", "7500", "30000"],
    });
  });

  it("getTokenConfigSnapshot_rejects_missing_tier_limits", async function () {
    const fakeEscrow = {
      getTokenConfig: async () => ({
        supported: true,
        allowSellOrders: true,
        allowBuyOrders: true,
        decimals: 6,
        tierMaxAmountsBaseUnit: [150n, 1500n],
      }),
    };

    await expect(
      getTokenConfigSnapshot(fakeEscrow, "0x1111111111111111111111111111111111111111")
    ).to.be.rejectedWith(/tier limit snapshot invalid/);
  });

  it("setAndVerifyTokenConfig_fails_on_mismatched_tier_limits", async function () {
    const config = {
      supported: true,
      allowSellOrders: true,
      allowBuyOrders: true,
      decimals: 6,
      tierMaxAmountsBaseUnit: [150n, 1500n, 7500n, 30000n],
    };
    const fakeEscrow = {
      setTokenConfig: async () => ({ wait: async () => ({ hash: "0xabc" }) }),
      getTokenConfig: async () => ({
        supported: true,
        allowSellOrders: true,
        allowBuyOrders: true,
        decimals: 6,
        tierMaxAmountsBaseUnit: [150n, 1500n, 7500n, 99999n],
      }),
    };

    await expect(
      setAndVerifyTokenConfig(fakeEscrow, "0x1111111111111111111111111111111111111111", "USDT", config)
    ).to.be.rejectedWith(/doğrulaması başarısız/);
  });
});
