"use strict";

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  rPush: jest.fn(),
};

const mockTrade = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
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

  test("BleedingDecayed is idempotent and aligns to financials.decay_tx_hashes", async () => {
    const event = {
      eventName: "BleedingDecayed",
      transactionHash: "0xdecaytx",
      logIndex: 2,
      args: { tradeId: 42, decayedAmount: 25n },
    };

    mockTrade.findOne
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ financials: { total_decayed: "100" } }),
        }),
      })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ _id: "already-processed" }) });

    mockTrade.findOneAndUpdate.mockResolvedValue({});

    await worker._onBleedingDecayed(event);
    await worker._onBleedingDecayed(event);

    expect(mockTrade.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(mockTrade.findOneAndUpdate).toHaveBeenCalledWith(
      { onchain_escrow_id: 42 },
      expect.objectContaining({
        $set: expect.objectContaining({ "financials.total_decayed": "125" }),
        $addToSet: expect.objectContaining({ "financials.decay_tx_hashes": "0xdecaytx" }),
      })
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
