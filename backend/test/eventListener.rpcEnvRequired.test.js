"use strict";

const mockAssertProviderExpectedChainOrThrow = jest.fn().mockResolvedValue();
const mockJsonRpcProvider = jest.fn(() => ({ getBlockNumber: jest.fn().mockResolvedValue(0) }));
const mockWebSocketProvider = jest.fn(() => ({ getBlockNumber: jest.fn().mockResolvedValue(0) }));
const mockContractCtor = jest.fn(() => ({}));

jest.mock("../scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), rPush: jest.fn() })),
}));
jest.mock("../scripts/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock("../scripts/models/Trade", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../scripts/models/Order", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../scripts/models/User", () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn() }));
jest.mock("../scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: jest.fn(),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: jest.fn(),
  refreshProtocolConfig: jest.fn(),
}));
jest.mock("../scripts/services/expectedChain", () => ({
  assertProviderExpectedChainOrThrow: (...args) => mockAssertProviderExpectedChainOrThrow(...args),
}));
jest.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: (...args) => mockJsonRpcProvider(...args),
    WebSocketProvider: (...args) => mockWebSocketProvider(...args),
    Contract: (...args) => mockContractCtor(...args),
  },
}));

describe("eventListener RPC env fail-closed behavior", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NODE_ENV;
    delete process.env.BASE_RPC_URL;
    delete process.env.BASE_WS_RPC_URL;
    delete process.env.WORKER_DISABLED;
    process.env.ARAF_ESCROW_ADDRESS = "0x1111111111111111111111111111111111111111";
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("fails in non-production when BASE_RPC_URL is missing and contract address is set", async () => {
    const worker = require("../scripts/services/eventListener");

    await expect(worker._connect()).rejects.toThrow(
      "[Worker] KRİTİK: BASE_RPC_URL zorunludur (public mainnet fallback kapalı)."
    );
    expect(mockJsonRpcProvider).not.toHaveBeenCalled();
    expect(mockContractCtor).not.toHaveBeenCalled();
  });

  it("does not fail when worker is explicitly disabled in non-production", async () => {
    process.env.WORKER_DISABLED = "true";
    const worker = require("../scripts/services/eventListener");

    await expect(worker._connect()).resolves.toBeUndefined();
    expect(mockJsonRpcProvider).not.toHaveBeenCalled();
    expect(mockContractCtor).not.toHaveBeenCalled();
  });

  it("does not fail when contract address is absent (dry-run mode)", async () => {
    delete process.env.ARAF_ESCROW_ADDRESS;
    const worker = require("../scripts/services/eventListener");

    await expect(worker._connect()).resolves.toBeUndefined();
    expect(mockJsonRpcProvider).not.toHaveBeenCalled();
    expect(mockContractCtor).not.toHaveBeenCalled();
  });
});

