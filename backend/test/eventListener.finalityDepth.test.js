"use strict";

jest.mock("../scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), rPush: jest.fn() })),
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

  it("computes finalized block with WORKER_FINALITY_DEPTH=6 (block 100 => 94)", async () => {
    process.env.WORKER_FINALITY_DEPTH = "6";
    const worker = require("../scripts/services/eventListener");

    const blockHandlers = {};
    worker.provider = {
      on: jest.fn((event, cb) => { blockHandlers[event] = cb; }),
    };
    worker.contract = {};
    worker._listenersAttached = false;
    worker._livePollInProgress = false;
    worker._lastLivePolledBlock = 99;
    worker._lastSafeCheckpointBlock = 80;
    worker._replayInProgress = true; // replay tetiklemesini kapat
    worker._updateSeenBlockIfHigher = jest.fn().mockResolvedValue();
    worker._pollLiveRange = jest.fn().mockResolvedValue();
    worker._advanceSafeCheckpointFromAcks = jest.fn().mockResolvedValue();

    worker._attachLiveListeners();
    await blockHandlers.block(100);

    expect(worker._advanceSafeCheckpointFromAcks).toHaveBeenCalledWith(94);
  });

  it("does not advance when finalizedUpTo is <= current safe checkpoint", async () => {
    process.env.WORKER_FINALITY_DEPTH = "6";
    const worker = require("../scripts/services/eventListener");

    worker._lastSafeCheckpointBlock = 95;
    worker._updateSafeCheckpointIfHigher = jest.fn().mockResolvedValue();
    await worker._advanceSafeCheckpointFromAcks(95);
    await worker._advanceSafeCheckpointFromAcks(94);

    expect(worker._updateSafeCheckpointIfHigher).not.toHaveBeenCalled();
  });
});

