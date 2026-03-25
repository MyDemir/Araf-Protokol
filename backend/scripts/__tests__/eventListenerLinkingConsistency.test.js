"use strict";

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  rPush: jest.fn(),
};

const mockTradeModel = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
};

const mockListingModel = {
  findOne: jest.fn(),
  find: jest.fn(),
  updateOne: jest.fn(),
};

jest.mock("../config/redis", () => ({
  getRedisClient: () => mockRedis,
}));

jest.mock("../models/Trade", () => ({
  Trade: mockTradeModel,
  Listing: mockListingModel,
}));

jest.mock("../models/User", () => ({
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
}));

const worker = require("../services/eventListener");

function mockLeanResult(value) {
  return { lean: jest.fn().mockResolvedValue(value) };
}
function mockQueryResult(value) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}
function mockSelectLeanResult(value) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

describe("event listener listing link safety and financial consistency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListingModel.find.mockReturnValue(mockQueryResult([]));
  });

  test("links exactly one precreated pending listing on EscrowCreated", async () => {
    const listing = {
      _id: "listing1",
      maker_address: "0x1111111111111111111111111111111111111111",
      exchange_rate: 34.2,
      crypto_asset: "USDT",
      fiat_currency: "TRY",
    };
    mockListingModel.findOne.mockReturnValueOnce(mockLeanResult(null));
    mockListingModel.find.mockReturnValueOnce(mockQueryResult([listing]));
    mockListingModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockTradeModel.findOneAndUpdate.mockResolvedValue({});

    await worker._onEscrowCreated({
      args: {
        tradeId: 12,
        maker: "0x1111111111111111111111111111111111111111",
        amount: 1000000n,
        tier: 1,
        token: "0x2222222222222222222222222222222222222222",
      },
    });

    expect(mockListingModel.updateOne).toHaveBeenCalledWith(
      { _id: "listing1", onchain_escrow_id: null },
      { $set: { onchain_escrow_id: 12, status: "OPEN" } }
    );
    expect(mockTradeModel.findOneAndUpdate).toHaveBeenCalled();
  });

  test("marks ambiguity explicitly and avoids silent wrong listing link", async () => {
    mockListingModel.findOne.mockReturnValueOnce(mockLeanResult(null));
    mockListingModel.find.mockReturnValueOnce(mockQueryResult([{ _id: "a1" }, { _id: "a2" }]));
    const dlqSpy = jest.spyOn(worker, "_addToDLQ").mockResolvedValue();

    await worker._onEscrowCreated({
      eventName: "EscrowCreated",
      transactionHash: "0xabc",
      logIndex: 0,
      blockNumber: 1,
      args: {
        tradeId: 99,
        maker: "0x1111111111111111111111111111111111111111",
        amount: 1000000n,
        tier: 0,
        token: "0x2222222222222222222222222222222222222222",
      },
    });

    expect(dlqSpy).toHaveBeenCalled();
    expect(mockTradeModel.findOneAndUpdate).not.toHaveBeenCalled();
    dlqSpy.mockRestore();
  });

  test("keeps decay mirror fields consistent and idempotent keys aligned", async () => {
    mockTradeModel.findOne
      .mockReturnValueOnce(mockLeanResult(null))
      .mockReturnValueOnce(mockSelectLeanResult({ financials: { total_decayed: "5", total_decayed_num: 5 } }));
    mockTradeModel.findOneAndUpdate.mockResolvedValue({});

    await worker._onBleedingDecayed({
      transactionHash: "0xdecay",
      logIndex: 7,
      args: {
        tradeId: 15,
        decayedAmount: 7n,
      },
    });

    expect(mockTradeModel.findOne).toHaveBeenNthCalledWith(1, {
      onchain_escrow_id: 15,
      "financials.decay_tx_hashes": "0xdecay:7",
    });
    expect(mockTradeModel.findOneAndUpdate).toHaveBeenCalledWith(
      { onchain_escrow_id: 15 },
      expect.objectContaining({
        $set: expect.objectContaining({
          "financials.total_decayed": "12",
          "financials.total_decayed_num": 12,
        }),
        $addToSet: { "financials.decay_tx_hashes": "0xdecay:7" },
        $push: { "financials.decayed_amounts": "7" },
      })
    );
  });
});
