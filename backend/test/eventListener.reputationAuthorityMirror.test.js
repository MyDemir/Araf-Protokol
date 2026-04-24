"use strict";

const mockFindOneAndUpdate = jest.fn();

jest.mock("../scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => ({ get: jest.fn(), setEx: jest.fn(), del: jest.fn(), rPush: jest.fn() })),
}));
jest.mock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: jest.fn(),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: jest.fn(),
}));
jest.mock("../scripts/models/Trade", () => ({}));
jest.mock("../scripts/models/Order", () => ({}));
jest.mock("../scripts/models/User", () => ({
  findOneAndUpdate: (...args) => mockFindOneAndUpdate(...args),
}));

const worker = require("../scripts/services/eventListener");

describe("eventListener V3 authority reputation mirror", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not export off-chain semantic classification helper anymore", () => {
    expect(worker._classifyTerminalSemanticOutcome).toBeUndefined();
  });

  it("mirrors full V3 reputation authority fields from ReputationUpdated", async () => {
    worker._fetchReputationFromChain = jest.fn().mockResolvedValue({ consecutiveBans: 3 });
    worker._getEventDate = jest.fn().mockResolvedValue(new Date("2024-04-24T00:00:00.000Z"));

    await worker._onReputationUpdated({
      args: {
        wallet: "0x1111111111111111111111111111111111111111",
        successful: 12,
        failed: 4,
        bannedUntil: 0,
        effectiveTier: 2,
        manualReleaseCount: 7,
        autoReleaseCount: 3,
        mutualCancelCount: 2,
        disputedResolvedCount: 5,
        burnCount: 1,
        disputeWinCount: 4,
        disputeLossCount: 2,
        riskPoints: 66,
        lastPositiveEventAt: 1713916800,
        lastNegativeEventAt: 1714003200,
      },
    });

    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({
      "reputation_cache.successful_trades": 12,
      "reputation_cache.failed_disputes": 4,
      "reputation_cache.effective_tier": 2,
      "reputation_cache.failure_score": 66,
      "consecutive_bans": 3,
      "reputation_breakdown.manual_release_count": 7,
      "reputation_breakdown.auto_release_count": 3,
      "reputation_breakdown.mutual_cancel_count": 2,
      "reputation_breakdown.disputed_resolved_count": 5,
      "reputation_breakdown.burn_count": 1,
      "reputation_breakdown.dispute_win_count": 4,
      "reputation_breakdown.dispute_loss_count": 2,
      "reputation_breakdown.risk_points": 66,
    });
  });
});
