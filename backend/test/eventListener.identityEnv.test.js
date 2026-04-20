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

describe("eventListener identity + env wiring", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function loadWorkerWithEnv(batchRaw, checkpointRaw) {
    process.env.WORKER_BLOCK_BATCH_SIZE = batchRaw;
    process.env.WORKER_CHECKPOINT_INTERVAL_BLOCKS = checkpointRaw;
    return require("../scripts/services/eventListener");
  }

  it("falls back to safe defaults for invalid env values and keeps loop progress integers", () => {
    const invalidSamples = ["0", "-1", "NaN", "Infinity", "1.5", "abc"];

    for (const sample of invalidSamples) {
      const worker = loadWorkerWithEnv(sample, sample);
      expect(worker._runtimeConfig.BLOCK_BATCH_SIZE).toBe(1000);
      expect(worker._runtimeConfig.CHECKPOINT_INTERVAL_BLOCKS).toBe(50);
      expect(Number.isInteger(worker._runtimeConfig.BLOCK_BATCH_SIZE)).toBe(true);
      expect(worker._runtimeConfig.BLOCK_BATCH_SIZE).toBeGreaterThan(0);
      expect(Number.isInteger(worker._runtimeConfig.CHECKPOINT_INTERVAL_BLOCKS)).toBe(true);
      expect(worker._runtimeConfig.CHECKPOINT_INTERVAL_BLOCKS).toBeGreaterThan(0);
      jest.resetModules();
    }
  });

  it("accepts only positive integers from env", () => {
    const worker = loadWorkerWithEnv("2048", "75");
    expect(worker._runtimeConfig.BLOCK_BATCH_SIZE).toBe(2048);
    expect(worker._runtimeConfig.CHECKPOINT_INTERVAL_BLOCKS).toBe(75);
  });

  it("stores identity fields as strings and keeps parent order zero as null", async () => {
    const worker = loadWorkerWithEnv("", "");

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

    const [filter, updateObj] = mockTradeFindOneAndUpdate.mock.calls[0];
    expect(filter.$expr.$eq[0].$toString).toBe("$onchain_escrow_id");
    expect(filter.$expr.$eq[1]).toBe("900719925474099312345");

    const update = updateObj.$set;
    expect(update.onchain_escrow_id).toBe("900719925474099312345");
    expect(update.parent_order_id).toBeNull();
  });

  it("builds uncast identity matcher for order upsert to avoid legacy numeric misses", async () => {
    const worker = loadWorkerWithEnv("", "");

    await worker._upsertOrderMirror({
      id: 42n,
      owner: "0x1111111111111111111111111111111111111111",
      side: 0,
      tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      totalAmount: 10n,
      remainingAmount: 10n,
      minFillAmount: 1n,
      remainingMakerBondReserve: 0n,
      remainingTakerBondReserve: 0n,
      takerFeeBpsSnapshot: 1,
      makerFeeBpsSnapshot: 1,
      tier: 1,
      state: 0,
      orderRef: "0x" + "11".repeat(32),
    });

    const [filter] = mockOrderFindOneAndUpdate.mock.calls[0];
    expect(filter.$expr.$eq[0].$toString).toBe("$onchain_order_id");
    expect(filter.$expr.$eq[1]).toBe("42");
  });
});
