"use strict";

const mockRedis = { get: jest.fn(), set: jest.fn(), rPush: jest.fn() };

jest.mock("../scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => mockRedis),
}));
jest.mock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: jest.fn(),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: jest.fn(),
  refreshProtocolConfig: jest.fn(),
}));
jest.mock("../scripts/models/Trade", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../scripts/models/Order", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../scripts/models/User", () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn() }));
jest.mock("../scripts/services/expectedChain", () => ({ assertProviderExpectedChainOrThrow: jest.fn() }));

describe("eventListener finality depth safe-checkpoint behavior", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("security_replay_only_advances_safe_checkpoint_up_to_finalized_head", async () => {
    process.env.WORKER_FINALITY_DEPTH = "6";
    const worker = require("../scripts/services/eventListener");

    mockRedis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("0");
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(100) };
    worker.contract = {
      queryFilter: jest.fn().mockResolvedValue([]),
    };
    worker._processEvent = jest.fn().mockResolvedValue();

    await worker._replayMissedEvents();

    expect(mockRedis.set).toHaveBeenCalledWith("worker:last_safe_block", "94");
    expect(mockRedis.set).toHaveBeenCalledWith("worker:last_block", "94");
    expect(worker._lastSafeCheckpointBlock).toBe(94);
  });

  it("security_replay_seeds_memory_checkpoint_from_redis_when_from_exceeds_finalized_range", async () => {
    process.env.WORKER_FINALITY_DEPTH = "6";
    const worker = require("../scripts/services/eventListener");

    mockRedis.get.mockResolvedValueOnce("500");
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(500) };
    worker.contract = { queryFilter: jest.fn().mockResolvedValue([]) };

    await worker._replayMissedEvents();

    expect(worker._lastSafeCheckpointBlock).toBe(500);
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("security_replay_throws_on_invalid_checkpoint_value", async () => {
    process.env.WORKER_FINALITY_DEPTH = "6";
    const worker = require("../scripts/services/eventListener");

    mockRedis.get.mockResolvedValueOnce("invalid");
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(100) };
    worker.contract = { queryFilter: jest.fn().mockResolvedValue([]) };

    await expect(worker._replayMissedEvents()).rejects.toThrow("Geçersiz checkpoint değeri");
  });

  it("security_replay_allows_configured_start_above_finalized_head_and_defers_replay", async () => {
    process.env.WORKER_FINALITY_DEPTH = "6";
    process.env.WORKER_START_BLOCK = "98";
    const worker = require("../scripts/services/eventListener");

    mockRedis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(100) };
    worker.contract = { queryFilter: jest.fn().mockResolvedValue([]) };

    await expect(worker._replayMissedEvents()).resolves.toBeUndefined();
    expect(worker.contract.queryFilter).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("security_startup_live_poll_starts_from_last_safe_checkpoint_not_head", async () => {
    const worker = require("../scripts/services/eventListener");

    worker._connect = jest.fn().mockResolvedValue(undefined);
    worker._replayMissedEvents = jest.fn().mockImplementation(async () => {
      worker._lastSafeCheckpointBlock = 94;
    });
    worker._attachLiveListeners = jest.fn();
    worker.contract = {};

    await worker.start();

    expect(worker._lastLivePolledBlock).toBe(94);
    expect(worker._attachLiveListeners).toHaveBeenCalled();
  });
});
