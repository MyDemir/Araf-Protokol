const { expect } = require("chai");
const path = require("path");

describe("hardhat config RPC env requirements", function () {
  const CONFIG_PATH = path.join(__dirname, "..", "hardhat.config.js");
  const ORIGINAL_ENV = { ...process.env };

  function loadConfigWithEnv(overrides = {}) {
    process.env = { ...ORIGINAL_ENV, ...overrides };
    delete require.cache[require.resolve(CONFIG_PATH)];
    return require(CONFIG_PATH);
  }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete require.cache[require.resolve(CONFIG_PATH)];
  });

  it("throws when base network url is accessed without BASE_RPC_URL", function () {
    const config = loadConfigWithEnv({ BASE_RPC_URL: "" });
    expect(() => config.__private.assertRequiredRpcEnvForNetwork("base")).to.throw(
      "[Hardhat] base ağı için BASE_RPC_URL zorunludur. Public RPC fallback kaldırıldı."
    );
  });

  it("uses BASE_RPC_URL when provided", function () {
    const config = loadConfigWithEnv({ BASE_RPC_URL: "https://example.base-rpc.local" });
    expect(config.networks.base.url).to.equal("https://example.base-rpc.local");
    expect(() => config.__private.assertRequiredRpcEnvForNetwork("base")).to.not.throw();
  });

  it("throws when base-sepolia url is accessed without BASE_SEPOLIA_RPC_URL", function () {
    const config = loadConfigWithEnv({ BASE_SEPOLIA_RPC_URL: "" });
    expect(() => config.__private.assertRequiredRpcEnvForNetwork("base-sepolia")).to.throw(
      "[Hardhat] base-sepolia ağı için BASE_SEPOLIA_RPC_URL zorunludur. Public RPC fallback kaldırıldı."
    );
  });
});
