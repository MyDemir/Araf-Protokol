"use strict";

jest.mock("../scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => ({
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    rPush: jest.fn(),
  })),
}));

jest.mock("../scripts/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: jest.fn(),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: jest.fn(),
}));

const mockFindOneAndUpdateOrder = jest.fn().mockResolvedValue({});
const mockUpdateOneOrder = jest.fn().mockResolvedValue({});
jest.mock("../scripts/models/Order", () => ({
  findOneAndUpdate: (...args) => mockFindOneAndUpdateOrder(...args),
  updateOne: (...args) => mockUpdateOneOrder(...args),
}));

const mockFindOneAndUpdateTrade = jest.fn().mockResolvedValue({
  lastErrorObject: { updatedExisting: false },
  value: { maker_address: "0x3333333333333333333333333333333333333333", taker_address: "0x1111111111111111111111111111111111111111" },
});
jest.mock("../scripts/models/Trade", () => ({
  findOneAndUpdate: (...args) => mockFindOneAndUpdateTrade(...args),
  updateOne: jest.fn().mockResolvedValue({}),
  findOne: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ status: "LOCKED", maker_address: "0x3333333333333333333333333333333333333333", taker_address: "0x1111111111111111111111111111111111111111" }),
    }),
  }),
}));

jest.mock("../scripts/models/User", () => ({
  findOne: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  }),
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
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

describe("eventListener OrderFilled mirror hardening", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    worker._fetchOrderFromChain = jest.fn().mockResolvedValue({
      id: 7n,
      owner: "0x1111111111111111111111111111111111111111",
      side: 0,
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      totalAmount: 1000n,
      remainingAmount: 700n,
      minFillAmount: 100n,
      remainingMakerBondReserve: 10n,
      remainingTakerBondReserve: 0n,
      takerFeeBpsSnapshot: 15,
      makerFeeBpsSnapshot: 15,
      tier: 2,
      state: 1,
      orderRef: "0x" + "11".repeat(32),
    });
    worker._fetchTradeFromChain = jest.fn().mockResolvedValue({
      id: 99n,
      parentOrderId: 7n,
      maker: "0x3333333333333333333333333333333333333333",
      taker: "0x1111111111111111111111111111111111111111",
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      cryptoAmount: 300n,
      makerBond: 10n,
      takerBond: 5n,
      takerFeeBpsSnapshot: 15,
      makerFeeBpsSnapshot: 15,
      tier: 2,
      state: 1,
      lockedAt: 1710000000n,
      paidAt: 0n,
      challengedAt: 0n,
      ipfsReceiptHash: "",
      pingedByTaker: false,
      challengePingedByMaker: false,
      pingedAt: 0n,
      challengePingedAt: 0n,
    });
    worker._captureLockedTradeSnapshot = jest.fn().mockResolvedValue();
    worker._getEventDate = jest.fn().mockResolvedValue(new Date("2026-01-01T00:00:00.000Z"));
    worker._getEventId = jest.fn().mockReturnValue("tx:1");
  });

  it("writes childListingRef into canonical_refs.listing_ref during OrderFilled processing", async () => {
    await worker._onOrderFilled({
      eventName: "OrderFilled",
      blockNumber: 123,
      transactionHash: "0xabc",
      logIndex: 0,
      args: {
        orderId: 7n,
        tradeId: 99n,
        filler: "0x3333333333333333333333333333333333333333",
        fillAmount: 300n,
        remainingAmount: 700n,
        childListingRef: "0x" + "ab".repeat(32),
      },
    });

    const tradeSetPayload = mockFindOneAndUpdateTrade.mock.calls[0][1].$set;
    expect(tradeSetPayload.canonical_refs.listing_ref).toBe("0x" + "ab".repeat(32));
  });

  it("does not write unsafe precision number cache for uint256 > MAX_SAFE_INTEGER", async () => {
    const hugeId = 9007199254740993n;
    await worker._upsertOrderMirror({
      id: hugeId,
      owner: "0x1111111111111111111111111111111111111111",
      side: 0,
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      totalAmount: 9007199254740993n,
      remainingAmount: 9007199254740993n,
      minFillAmount: 1n,
      remainingMakerBondReserve: 9007199254740993n,
      remainingTakerBondReserve: 0n,
      takerFeeBpsSnapshot: 15,
      makerFeeBpsSnapshot: 15,
      tier: 1,
      state: 0,
      orderRef: "0x" + "12".repeat(32),
    });

    const [orderFilter, orderUpdate] = mockFindOneAndUpdateOrder.mock.calls[0];
    const orderPayload = orderUpdate.$set;
    expect(orderFilter.onchain_order_id).toBe("9007199254740993");
    expect(orderPayload.onchain_order_id).toBe("9007199254740993");
    expect(orderPayload.amounts.total_amount_num).toBeNull();
    expect(orderPayload.amounts.remaining_amount_num).toBeNull();
    expect(orderPayload.reserves.remaining_maker_bond_reserve_num).toBeNull();
  });

  it("skips delayed EscrowLocked when trade is already PAID (monotonic guard)", async () => {
    const Trade = require("../scripts/models/Trade");
    Trade.findOne = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          status: "PAID",
          maker_address: "0x3333333333333333333333333333333333333333",
          taker_address: "0x1111111111111111111111111111111111111111",
        }),
      }),
    });
    worker._captureLockedTradeSnapshot = jest.fn().mockResolvedValue();

    await worker._onEscrowLocked({
      eventName: "EscrowLocked",
      blockNumber: 200,
      transactionHash: "0xpaid",
      logIndex: 3,
      args: {
        tradeId: 99n,
        taker: "0x1111111111111111111111111111111111111111",
      },
    });

    expect(worker._captureLockedTradeSnapshot).not.toHaveBeenCalled();
  });

  it("skips delayed EscrowLocked when trade is already CHALLENGED (monotonic guard)", async () => {
    const Trade = require("../scripts/models/Trade");
    Trade.findOne = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          status: "CHALLENGED",
          maker_address: "0x3333333333333333333333333333333333333333",
          taker_address: "0x1111111111111111111111111111111111111111",
        }),
      }),
    });
    worker._captureLockedTradeSnapshot = jest.fn().mockResolvedValue();

    await worker._onEscrowLocked({
      eventName: "EscrowLocked",
      blockNumber: 201,
      transactionHash: "0xchallenged",
      logIndex: 4,
      args: {
        tradeId: 100n,
        taker: "0x1111111111111111111111111111111111111111",
      },
    });

    expect(worker._captureLockedTradeSnapshot).not.toHaveBeenCalled();
  });
});
