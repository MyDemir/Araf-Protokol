"use strict";

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  rPush: jest.fn(),
};

const mockTradeModel = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
};

const mockListingModel = {
  findOne: jest.fn(),
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
describe("event listener listing link safety and financial consistency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("links authoritative listing_ref on EscrowCreated", async () => {
    const listing = {
      _id: "listing1",
      maker_address: "0x1111111111111111111111111111111111111111",
      tier_rules: { required_tier: 1 },
      token_address: "0x2222222222222222222222222222222222222222",
      onchain_escrow_id: null,
      exchange_rate: 34.2,
      crypto_asset: "USDT",
      fiat_currency: "TRY",
    };
    mockListingModel.findOne.mockReturnValueOnce(mockLeanResult(listing));
    mockListingModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockTradeModel.findOneAndUpdate.mockResolvedValue({});

    await worker._onEscrowCreated({
      args: {
        tradeId: 12,
        maker: "0x1111111111111111111111111111111111111111",
        amount: 1000000n,
        tier: 1,
        token: "0x2222222222222222222222222222222222222222",
        listingRef: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });

    expect(mockListingModel.findOne).toHaveBeenCalledWith({
      listing_ref: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(mockListingModel.updateOne).toHaveBeenCalledWith(
      {
        _id: "listing1",
        listing_ref: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        onchain_escrow_id: null,
      },
      { $set: { onchain_escrow_id: 12, status: "OPEN" } }
    );
    expect(mockTradeModel.findOneAndUpdate).toHaveBeenCalled();
  });

  test("fails closed when listingRef is missing/zero", async () => {
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
        listingRef: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    });

    expect(dlqSpy).toHaveBeenCalled();
    expect(mockListingModel.findOne).not.toHaveBeenCalled();
    expect(mockTradeModel.findOneAndUpdate).not.toHaveBeenCalled();
    dlqSpy.mockRestore();
  });

  test("keeps decay mirror fields consistent and idempotent keys aligned", async () => {
    mockTradeModel.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await worker._onBleedingDecayed({
      transactionHash: "0xdecay",
      logIndex: 7,
      args: {
        tradeId: 15,
        decayedAmount: 7n,
      },
    });

    expect(mockTradeModel.updateOne).toHaveBeenCalledWith(
      {
        onchain_escrow_id: 15,
        "financials.decay_tx_hashes": { $ne: "0xdecay:7" },
      },
      expect.arrayContaining([
        expect.objectContaining({
          $set: expect.objectContaining({
            "timers.last_decay_at": expect.any(Date),
            "financials.total_decayed": expect.any(Object),
            "financials.total_decayed_num": expect.any(Object),
            "financials.decay_tx_hashes": expect.any(Object),
            "financials.decayed_amounts": expect.any(Object),
          }),
        }),
      ])
    );
  });
});
