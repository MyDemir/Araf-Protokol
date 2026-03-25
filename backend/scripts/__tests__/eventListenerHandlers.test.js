"use strict";

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  rPush: jest.fn(),
};

const mockTrade = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
};

const mockListing = {
  findOne: jest.fn(),
  updateOne: jest.fn(),
};

const mockUser = {
  findOneAndUpdate: jest.fn(),
};

jest.mock("../config/redis", () => ({
  getRedisClient: () => mockRedis,
}));

jest.mock("../models/Trade", () => ({
  Trade: mockTrade,
  Listing: mockListing,
}));

jest.mock("../models/User", () => mockUser);

jest.mock("mongoose", () => ({
  startSession: jest.fn(),
}));

const mongoose = require("mongoose");
const worker = require("../services/eventListener");

describe("event listener handler consistency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("processEvent maps EscrowCreated to the correct handler", async () => {
    const handlerSpy = jest.spyOn(worker, "_onEscrowCreated").mockResolvedValue();

    await worker._processEvent({ eventName: "EscrowCreated", args: {} });

    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  test("BleedingDecayed uses canonical txHash:logIndex id and is race-safe", async () => {
    const event = {
      eventName: "BleedingDecayed",
      transactionHash: "0xdecaytx",
      logIndex: 2,
      args: { tradeId: 42, decayedAmount: 25n },
    };

    mockTrade.updateOne
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 0 });

    await worker._onBleedingDecayed(event);
    await worker._onBleedingDecayed(event);

    expect(mockTrade.updateOne).toHaveBeenCalledTimes(2);
    expect(mockTrade.updateOne).toHaveBeenNthCalledWith(
      1,
      {
        onchain_escrow_id: 42,
        "financials.decay_tx_hashes": { $ne: "0xdecaytx:2" },
      },
      expect.any(Array)
    );
  });

  test("CHALLENGED->RESOLVED mirrors unjust challenge penalty to taker only", async () => {
    const session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };
    mongoose.startSession.mockResolvedValue(session);

    mockTrade.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ status: "CHALLENGED" }),
    });

    mockTrade.findOneAndUpdate
      .mockResolvedValueOnce({
        maker_address: "0xmaker",
        taker_address: "0xtaker",
      })
      .mockResolvedValueOnce({});

    await worker._onEscrowReleased({ args: { tradeId: 7 } });

    expect(mockUser.findOneAndUpdate).toHaveBeenCalledWith(
      { wallet_address: "0xtaker" },
      expect.any(Object),
      expect.objectContaining({ session })
    );
    expect(mockUser.findOneAndUpdate).not.toHaveBeenCalledWith(
      { wallet_address: "0xmaker" },
      expect.anything(),
      expect.anything()
    );
  });
});
