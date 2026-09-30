"use strict";

// B2 (stop at first failed batch), B3 (early-return checkpoint), B9 (replay backoff), state restore.

const kv = new Map();
const mockRedis = {
  get: jest.fn(async (k) => (kv.has(k) ? kv.get(k) : null)),
  set: jest.fn(async (k, v) => { kv.set(k, v); return "OK"; }),
  rPush: jest.fn(),
  lRange: jest.fn().mockResolvedValue([]),
  sIsMember: jest.fn().mockResolvedValue(0),
  sAdd: jest.fn(),
};
jest.mock("../../backend/scripts/config/redis", () => ({ getRedisClient: jest.fn(() => mockRedis) }));
jest.mock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../backend/scripts/services/protocolConfig", () => ({ updateCachedFeeConfig: jest.fn(), updateCachedCooldownConfig: jest.fn(), updateCachedTokenConfig: jest.fn(), refreshProtocolConfig: jest.fn() }));
jest.mock("../../backend/scripts/models/Trade", () => ({}));
jest.mock("../../backend/scripts/models/Order", () => ({}));
jest.mock("../../backend/scripts/models/User", () => ({}));

describe("eventListener replay checkpoint semantics", () => {
  const ORIGINAL_ENV = { ...process.env };
  let worker;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    kv.clear();
    process.env = { ...ORIGINAL_ENV, WORKER_BLOCK_BATCH_SIZE: "10", WORKER_FINALITY_DEPTH: "1" };
    worker = require("../../backend/scripts/services/eventListener");
    worker.contract = {};
  });
  afterAll(() => { process.env = { ...ORIGINAL_ENV }; });

  it("B2: stops at the first failed batch and leaves the checkpoint before it", async () => {
    kv.set("worker:last_safe_block", "0");
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(31) }; // finalized 30 -> batches 1-10, 11-20, 21-30
    const bad = { eventName: "X", transactionHash: "0xbad", index: 1, blockNumber: 15, args: {} };
    worker._fetchRangeEvents = jest.fn(async (from) => (from === 11 ? [bad] : []));
    worker._processEvent = jest.fn(async () => { throw new Error("poison"); });

    await worker._replayMissedEvents();

    expect(worker._fetchRangeEvents.mock.calls.map((c) => c[0])).toEqual([1, 11]); // batch 21-30 never attempted
    expect(kv.get("worker:last_safe_block")).toBe("10");
    expect(worker._lastSafeCheckpointBlock).toBe(10);
  });

  it("B2: state returns from replaying to its previous value even on failure", async () => {
    kv.set("worker:last_safe_block", "0");
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(31) };
    worker._state = "live";
    worker._fetchRangeEvents = jest.fn().mockRejectedValue(new Error("rpc"));

    await worker._replayMissedEvents();

    expect(worker._state).toBe("live");
  });

  it("B3: start block above finalized head seeds the checkpoint so the live poll does not start at block 1", async () => {
    process.env.WORKER_FINALITY_DEPTH = "6";
    process.env.WORKER_START_BLOCK = "98";
    jest.resetModules();
    worker = require("../../backend/scripts/services/eventListener");
    worker.contract = {};
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(100) };
    worker._fetchRangeEvents = jest.fn().mockResolvedValue([]);
    worker._connect = jest.fn().mockResolvedValue(undefined);
    worker._attachLiveListeners = jest.fn();

    await worker.start();

    expect(worker._fetchRangeEvents).not.toHaveBeenCalled();
    expect(worker._lastSafeCheckpointBlock).toBe(97);
    expect(worker._lastLivePolledBlock).toBe(97);
  });

  it("B9: a failing replay backs off exponentially before the live listener may trigger it again", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    worker._lastSafeCheckpointBlock = 0;

    expect(worker._shouldTriggerLiveReplay(100)).toBe(true);
    worker._noteReplayFailure();
    expect(worker._shouldTriggerLiveReplay(101)).toBe(false);
    expect(worker._replayNextAttemptAt - 1_000_000).toBe(5_000);

    now.mockReturnValue(1_005_001);
    expect(worker._shouldTriggerLiveReplay(102)).toBe(true);
    worker._noteReplayFailure();
    expect(worker._replayNextAttemptAt - 1_005_001).toBe(10_000);

    worker._noteReplaySuccess();
    expect(worker._shouldTriggerLiveReplay(103)).toBe(true);
    now.mockRestore();
  });

  it("B9: a real failing replay arms the backoff", async () => {
    kv.set("worker:last_safe_block", "0");
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(31) };
    worker._fetchRangeEvents = jest.fn().mockRejectedValue(new Error("rpc"));

    await worker._replayMissedEvents();

    expect(worker._replayFailureCount).toBe(1);
    expect(worker._replayNextAttemptAt).toBeGreaterThan(Date.now());
  });
});
