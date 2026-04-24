"use strict";

const mockFindOneAndUpdate = jest.fn();
const mockFindOne = jest.fn();

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
  findOne: (...args) => mockFindOne(...args),
  findOneAndUpdate: (...args) => mockFindOneAndUpdate(...args),
}));

const worker = require("../scripts/services/eventListener");
const logger = require("../scripts/utils/logger");

describe("eventListener V3 authority reputation mirror", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
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

  it("continues mirroring when chain backfill fails and preserves stored consecutive_bans", async () => {
    worker._fetchReputationFromChain = jest.fn().mockRejectedValue(new Error("rpc timeout"));
    worker._getEventDate = jest.fn().mockResolvedValue(new Date("2024-04-24T00:00:00.000Z"));
    mockFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ consecutive_bans: 7 }),
      }),
    });

    await expect(
      worker._onReputationUpdated({
        args: {
          wallet: "0x2222222222222222222222222222222222222222",
          successful: 5,
          failed: 1,
          bannedUntil: 0,
          effectiveTier: 1,
          manualReleaseCount: 1,
          autoReleaseCount: 1,
          mutualCancelCount: 0,
          disputedResolvedCount: 1,
          burnCount: 0,
          disputeWinCount: 1,
          disputeLossCount: 0,
          riskPoints: 11,
          lastPositiveEventAt: 1713916800,
          lastNegativeEventAt: 1714003200,
        },
      })
    ).resolves.toBeUndefined();

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set["consecutive_bans"]).toBe(7);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("falls back consecutive_bans to 0 when no stored user and chain backfill fails", async () => {
    worker._fetchReputationFromChain = jest.fn().mockRejectedValue(new Error("rpc timeout"));
    worker._getEventDate = jest.fn().mockResolvedValue(new Date("2024-04-24T00:00:00.000Z"));
    mockFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    await worker._onReputationUpdated({
      args: {
        wallet: "0x3333333333333333333333333333333333333333",
        successful: 1,
        failed: 0,
        bannedUntil: 0,
        effectiveTier: 0,
        manualReleaseCount: 1,
        autoReleaseCount: 0,
        mutualCancelCount: 0,
        disputedResolvedCount: 0,
        burnCount: 0,
        disputeWinCount: 0,
        disputeLossCount: 0,
        riskPoints: 0,
        lastPositiveEventAt: 1713916800,
        lastNegativeEventAt: 0,
      },
    });

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set["consecutive_bans"]).toBe(0);
  });
});
