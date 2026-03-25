"use strict";

const mockRedis = {
  lLen: jest.fn(),
  lRange: jest.fn(),
  lRem: jest.fn(),
  rPush: jest.fn(),
  lPush: jest.fn(),
  lTrim: jest.fn(),
  expire: jest.fn(),
  multi: jest.fn(),
};

const mockEventWorker = {
  reDriveEvent: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock("../config/redis", () => ({
  getRedisClient: () => mockRedis,
}));

jest.mock("../services/eventListener", () => mockEventWorker);
jest.mock("../utils/logger", () => mockLogger);

const { processDLQ } = require("../services/dlqProcessor");

describe("DLQ processor runtime path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.lLen.mockResolvedValue(1);
    mockRedis.lRange.mockResolvedValue([]);
    mockRedis.lRem.mockResolvedValue(1);
    mockRedis.rPush.mockResolvedValue(1);
  });

  test("successful redrive removes item from DLQ", async () => {
    const raw = JSON.stringify({
      eventName: "EscrowReleased",
      txHash: "0xabc",
      logIndex: 0,
      blockNumber: 10,
      attempt: 1,
      next_retry_at: new Date(0).toISOString(),
    });
    mockRedis.lRange.mockResolvedValue([raw]);
    mockEventWorker.reDriveEvent.mockResolvedValue({ success: true });

    await processDLQ();

    expect(mockEventWorker.reDriveEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "EscrowReleased",
      txHash: "0xabc",
    }));
    expect(mockRedis.lRem).toHaveBeenCalledWith("worker:dlq", 1, raw);
    expect(mockRedis.rPush).not.toHaveBeenCalled();
  });

  test("failed redrive requeues entry with backoff and incremented attempt", async () => {
    const raw = JSON.stringify({
      eventName: "EscrowReleased",
      txHash: "0xdef",
      logIndex: 1,
      blockNumber: 11,
      attempt: 1,
      next_retry_at: new Date(0).toISOString(),
    });
    mockRedis.lRange.mockResolvedValue([raw]);
    mockEventWorker.reDriveEvent.mockResolvedValue({ success: false, error: "boom" });

    await processDLQ();

    expect(mockRedis.lRem).toHaveBeenCalledWith("worker:dlq", 1, raw);
    expect(mockRedis.rPush).toHaveBeenCalledTimes(1);
    expect(mockRedis.rPush).toHaveBeenCalledWith(
      "worker:dlq",
      expect.stringContaining("\"attempt\":2")
    );
    expect(mockRedis.rPush).toHaveBeenCalledWith(
      "worker:dlq",
      expect.stringContaining("\"next_retry_at\"")
    );
  });

  test("poison behavior remains observable via metrics logging", async () => {
    const raw = JSON.stringify({
      eventName: "EscrowReleased",
      txHash: "0xpoison",
      logIndex: 2,
      blockNumber: 12,
      attempt: 9,
      next_retry_at: new Date(0).toISOString(),
    });
    mockRedis.lRange.mockResolvedValue([raw]);
    mockEventWorker.reDriveEvent.mockResolvedValue({ success: false, error: "still failing" });

    await processDLQ();

    expect(mockRedis.rPush).toHaveBeenCalledWith(
      "worker:dlq",
      expect.stringContaining("\"attempt\":10")
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("poison_event_count=1")
    );
  });
});
