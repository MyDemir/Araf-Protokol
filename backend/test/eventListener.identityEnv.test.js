"use strict";

jest.mock("../scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), rPush: jest.fn() })),
}));
jest.mock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: jest.fn(),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: jest.fn(),
}));

const mockTradeFindOneAndUpdate = jest.fn().mockResolvedValue({ value: {}, lastErrorObject: { updatedExisting: true } });
const mockOrderFindOneAndUpdate = jest.fn().mockResolvedValue({});

jest.mock("../scripts/models/Trade", () => ({ findOneAndUpdate: (...args) => mockTradeFindOneAndUpdate(...args) }));
jest.mock("../scripts/models/Order", () => ({ findOneAndUpdate: (...args) => mockOrderFindOneAndUpdate(...args) }));
jest.mock("../scripts/models/User", () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn() }));

const worker = require("../scripts/services/eventListener");

describe("eventListener identity + env wiring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stores identity fields as strings and keeps parent order zero as null", async () => {
    await worker._upsertTradeMirror({
      id: 900719925474099312345n,
      parentOrderId: 0n,
      maker: "0x1111111111111111111111111111111111111111",
      taker: "0x0000000000000000000000000000000000000000",
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      cryptoAmount: 10n,
      makerBond: 1n,
      takerBond: 1n,
      takerFeeBpsSnapshot: 10,
      makerFeeBpsSnapshot: 10,
      tier: 1,
      state: 0,
      lockedAt: 0n,
      paidAt: 0n,
      challengedAt: 0n,
      ipfsReceiptHash: "",
      pingedByTaker: false,
      challengePingedByMaker: false,
      pingedAt: 0n,
      challengePingedAt: 0n,
    });

    const update = mockTradeFindOneAndUpdate.mock.calls[0][1].$set;
    expect(update.onchain_escrow_id).toBe("900719925474099312345");
    expect(update.parent_order_id).toBeNull();
  });

  it("exposes BLOCK_BATCH_SIZE and CHECKPOINT_INTERVAL env override keys", () => {
    const source = require("fs").readFileSync(require("path").join(__dirname, "../scripts/services/eventListener.js"), "utf8");
    expect(source).toContain("WORKER_BLOCK_BATCH_SIZE");
    expect(source).toContain("WORKER_CHECKPOINT_INTERVAL_BLOCKS");
  });
});
