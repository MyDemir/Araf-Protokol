"use strict";

jest.mock("../scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => ({
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    rPush: jest.fn(),
  })),
}));

jest.mock("../scripts/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: jest.fn(),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: jest.fn(),
}));

const mockFindOneAndUpdateUser = jest.fn().mockResolvedValue({});
jest.mock("../scripts/models/User", () => ({
  findOneAndUpdate: (...args) => mockFindOneAndUpdateUser(...args),
}));

jest.mock("../scripts/models/Order", () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
  updateOne: jest.fn().mockResolvedValue({}),
}));

jest.mock("../scripts/models/Trade", () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
  updateOne: jest.fn().mockResolvedValue({}),
  findOne: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  }),
}));

jest.mock("mongoose", () => ({
  startSession: jest.fn().mockResolvedValue({
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(),
    abortTransaction: jest.fn().mockResolvedValue(),
    endSession: jest.fn().mockResolvedValue(),
  }),
}));

const worker = require("../scripts/services/eventListener");

describe("eventListener ReputationUpdated V3 handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    worker._getEventDate = jest.fn().mockResolvedValue(new Date("2026-01-01T00:00:00.000Z"));
    worker._fetchReputationFromChain = jest.fn();
  });

  it("uses consecutiveBans directly from ReputationUpdated event payload", async () => {
    await worker._onReputationUpdated({
      eventName: "ReputationUpdated",
      blockNumber: 123,
      transactionHash: "0xabc",
      logIndex: 0,
      args: {
        wallet: "0x1111111111111111111111111111111111111111",
        successfulTrades: 9n,
        manualReleaseCount: 5n,
        autoReleaseCount: 2n,
        mutualCancelCount: 1n,
        disputedResolvedCount: 3n,
        burnCount: 1n,
        disputeWinCount: 2n,
        disputeLossCount: 1n,
        failedDisputes: 1n,
        riskPoints: 8n,
        bannedUntil: 0n,
        consecutiveBans: 3n,
        effectiveTier: 2n,
      },
    });

    expect(worker._fetchReputationFromChain).not.toHaveBeenCalled();
    const [, update] = mockFindOneAndUpdateUser.mock.calls[0];
    expect(update.$set.consecutive_bans).toBe(3);
    expect(update.$set["reputation_cache.effective_tier"]).toBe(2);
    expect(update.$set["reputation_breakdown.auto_release_count"]).toBe(2);
    expect(update.$set["reputation_breakdown.burn_count"]).toBe(1);
  });
});
