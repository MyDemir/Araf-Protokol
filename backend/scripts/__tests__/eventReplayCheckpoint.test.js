"use strict";

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock("../config/redis", () => ({
  getRedisClient: () => mockRedis,
}));

const worker = require("../services/eventListener");

describe("event replay/checkpoint stabilization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    worker.contract = {
      queryFilter: jest.fn().mockResolvedValue([]),
      on: jest.fn(),
    };
    worker.provider = {
      getBlockNumber: jest.fn().mockResolvedValue(1500),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
    };
  });

  test("uses WORKER_START_BLOCK when checkpoint is missing", async () => {
    process.env.WORKER_START_BLOCK = "1200";
    process.env.NODE_ENV = "production";
    mockRedis.get.mockResolvedValueOnce(null).mockResolvedValueOnce("0");

    await worker._replayMissedEvents();

    expect(worker.contract.queryFilter).toHaveBeenCalled();
  });

  test("block listener never writes unsafe full-head checkpoint", async () => {
    const updateSpy = jest.spyOn(worker, "_updateSafeCheckpointIfHigher").mockResolvedValue();

    worker._attachLiveListeners();
    const blockHandler = worker.provider.on.mock.calls.find(([event]) => event === "block")[1];
    await blockHandler(2000);

    expect(updateSpy).toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalledWith(2000);
    updateSpy.mockRestore();
  });
});
