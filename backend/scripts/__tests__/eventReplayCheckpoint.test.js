"use strict";

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  rPush: jest.fn(),
};

jest.mock("../config/redis", () => ({
  getRedisClient: () => mockRedis,
}));

const worker = require("../services/eventListener");

describe("event replay/checkpoint stabilization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ARAF_DEPLOYMENT_BLOCK;
    delete process.env.WORKER_START_BLOCK;
    process.env.NODE_ENV = "test";
    worker._blockAcks = new Map();
    worker._lastSafeCheckpointBlock = 0;
    worker._lastSeenBlock = 0;
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

  test("fails closed in production when checkpoint and start-block config are missing", async () => {
    process.env.NODE_ENV = "production";
    mockRedis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(worker._replayMissedEvents()).rejects.toThrow(
      /ARAF_DEPLOYMENT_BLOCK\/WORKER_START_BLOCK/
    );
    expect(worker.contract.queryFilter).not.toHaveBeenCalled();
  });

  test("block listener does not advance checkpoint automatically", async () => {
    worker._lastSafeCheckpointBlock = 1990;
    worker._blockAcks.set(1991, {
      seen: new Set(["0xtx:0"]),
      acked: new Set(["0xtx:0"]),
      unsafe: false,
    });
    const updateSpy = jest.spyOn(worker, "_updateSafeCheckpointIfHigher").mockResolvedValue();

    worker._attachLiveListeners();
    const blockHandler = worker.provider.on.mock.calls.find(([event]) => event === "block")[1];
    await blockHandler(2000);

    expect(updateSpy).toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalledWith(2000);
    updateSpy.mockRestore();
  });

  test("does not advance safe checkpoint on partially failed replay batch", async () => {
    mockRedis.get.mockResolvedValueOnce("1490");
    worker.provider.getBlockNumber.mockResolvedValue(1491);
    worker.contract.queryFilter.mockResolvedValueOnce([{
      eventName: "EscrowCreated",
      transactionHash: "0xtx",
      logIndex: 0,
      blockNumber: 1491,
      args: ["1", "0xabc", "0xtoken", "1", "0"],
    }]);
    jest.spyOn(worker, "_processEvent").mockRejectedValue(new Error("boom"));

    await worker._replayMissedEvents();

    expect(mockRedis.set).not.toHaveBeenCalledWith("worker:last_safe_block", expect.any(String));
  });
});
