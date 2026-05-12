"use strict";

const mockRefreshProtocolConfig = jest.fn();
const mockUpdateCachedTokenConfig = jest.fn();

jest.mock("../../backend/scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => ({ get: jest.fn(), setEx: jest.fn(), del: jest.fn(), rPush: jest.fn() })),
}));
jest.mock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../backend/scripts/services/protocolConfig", () => ({
  refreshProtocolConfig: (...args) => mockRefreshProtocolConfig(...args),
  updateCachedFeeConfig: jest.fn(),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: (...args) => mockUpdateCachedTokenConfig(...args),
}));
jest.mock("../../backend/scripts/models/Trade", () => ({}));
jest.mock("../../backend/scripts/models/Order", () => ({}));
jest.mock("../../backend/scripts/models/User", () => ({}));

const worker = require("../../backend/scripts/services/eventListener");
const logger = require("../../backend/scripts/utils/logger");

describe("eventListener token config refresh path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("refreshes protocol config on TokenConfigUpdated instead of deriving missing fields from event", async () => {
    mockRefreshProtocolConfig.mockResolvedValue(undefined);

    await worker._onTokenConfigUpdated({
      args: {
        token: "0x1111111111111111111111111111111111111111",
        supported: true,
        allowSellOrders: true,
        allowBuyOrders: true,
      },
    });

    expect(mockRefreshProtocolConfig).toHaveBeenCalledTimes(1);
    expect(mockUpdateCachedTokenConfig).not.toHaveBeenCalled();
  });

  it("falls back to partial cache patch when refresh fails", async () => {
    mockRefreshProtocolConfig.mockRejectedValue(new Error("rpc timeout"));
    mockUpdateCachedTokenConfig.mockResolvedValue(undefined);

    await worker._onTokenConfigUpdated({
      args: {
        token: "0x1111111111111111111111111111111111111111",
        supported: false,
        allowSellOrders: false,
        allowBuyOrders: false,
      },
    });

    expect(mockRefreshProtocolConfig).toHaveBeenCalledTimes(1);
    expect(mockUpdateCachedTokenConfig).toHaveBeenCalledWith(
      "0x1111111111111111111111111111111111111111",
      { supported: false, allowSellOrders: false, allowBuyOrders: false }
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

