"use strict";

jest.mock("../scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => ({ get: jest.fn(), setEx: jest.fn(), del: jest.fn(), rPush: jest.fn() })),
}));
jest.mock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: jest.fn(),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: jest.fn(),
}));

const mockTradeFindOneAndUpdate = jest.fn().mockResolvedValue({
  parent_order_id: "7",
  maker_address: "0x1111111111111111111111111111111111111111",
  taker_address: "0x2222222222222222222222222222222222222222",
});
jest.mock("../scripts/models/Trade", () => ({
  findOneAndUpdate: (...args) => mockTradeFindOneAndUpdate(...args),
  findOne: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  }),
  updateOne: jest.fn().mockResolvedValue({}),
}));

const mockOrderFindOneAndUpdate = jest.fn().mockResolvedValue({});
jest.mock("../scripts/models/Order", () => ({
  findOneAndUpdate: (...args) => mockOrderFindOneAndUpdate(...args),
  updateOne: jest.fn().mockResolvedValue({}),
}));

const mockUserFindOneAndUpdate = jest.fn().mockResolvedValue({});
jest.mock("../scripts/models/User", () => ({
  findOneAndUpdate: (...args) => mockUserFindOneAndUpdate(...args),
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

describe("eventListener semantic inference removal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    worker._getEventDate = jest.fn().mockResolvedValue(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("does not expose legacy semantic classifier helper", () => {
    expect(worker._classifyTerminalSemanticOutcome).toBeUndefined();
  });

  it("does not mutate reputation_breakdown during EscrowCanceled handling", async () => {
    await worker._onEscrowCanceled({
      eventName: "EscrowCanceled",
      blockNumber: 100,
      transactionHash: "0xabc",
      logIndex: 1,
      args: { tradeId: 99n },
    });

    const wroteSemanticBreakdown = mockUserFindOneAndUpdate.mock.calls.some(([, update]) =>
      JSON.stringify(update || {}).includes("reputation_breakdown")
    );
    expect(wroteSemanticBreakdown).toBe(false);
  });
});
