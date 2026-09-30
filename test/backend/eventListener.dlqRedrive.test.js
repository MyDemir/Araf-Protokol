"use strict";

/*
 * B1 + B9: DLQ namedArgs must be built from the ethers fragment (real EventLog), re-drive must run the
 * synthetic-event path, DLQ writes must be unique per idempotencyKey, and a successful re-drive must clear
 * the unsafe/ack record.
 *
 * NOTE: these tests deliberately use REAL ethers EventLog/Interface objects. Hand-written `namedArgs` objects
 * hid B1 for a long time: in ethers v6 the named fields of a Result are not own properties.
 */

const store = { list: [], lists: {}, sets: {} };
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue("OK"),
  rPush: jest.fn(async (_key, value) => { store.list.push(value); return store.list.length; }),
  lRange: jest.fn(async (_key, start, end) => (end === -1 ? [...store.list] : store.list.slice(start, end + 1))),
  lLen: jest.fn(async () => store.list.length),
  lPush: jest.fn(async (key, value) => { (store.lists[key] = store.lists[key] || []).push(value); }),
  sIsMember: jest.fn(async (set, member) => (store.sets[set] && store.sets[set].has(member) ? 1 : 0)),
  sAdd: jest.fn(async (set, member) => { (store.sets[set] = store.sets[set] || new Set()).add(member); }),
  sRem: jest.fn(async (set, member) => { if (store.sets[set]) store.sets[set].delete(member); }),
  lRem: jest.fn(async (_key, _count, value) => {
    const i = store.list.indexOf(value);
    if (i >= 0) store.list.splice(i, 1);
    return i >= 0 ? 1 : 0;
  }),
  multi: jest.fn(() => {
    const ops = { lPush: () => ops, lTrim: () => ops, expire: () => ops, exec: async () => [] };
    return ops;
  }),
};

jest.mock("../../backend/scripts/config/redis", () => ({ getRedisClient: jest.fn(() => mockRedis) }));
jest.mock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const mockUpdateFee = jest.fn().mockResolvedValue({});
const mockUpdateCooldown = jest.fn().mockResolvedValue({});
const mockUpdatePolicy = jest.fn().mockResolvedValue({});
jest.mock("../../backend/scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: (...a) => mockUpdateFee(...a),
  updateCachedCooldownConfig: (...a) => mockUpdateCooldown(...a),
  updateCachedReputationPolicy: (...a) => mockUpdatePolicy(...a),
  updateCachedTokenConfig: jest.fn(),
  refreshProtocolConfig: jest.fn(),
}));
jest.mock("../../backend/scripts/models/Trade", () => ({}));
jest.mock("../../backend/scripts/models/Order", () => ({}));
jest.mock("../../backend/scripts/models/RevenueEvent", () => ({}));
const mockUserFindOneAndUpdate = jest.fn().mockResolvedValue({});
jest.mock("../../backend/scripts/models/User", () => ({ findOneAndUpdate: (...a) => mockUserFindOneAndUpdate(...a) }));

const { ethers } = require("ethers");
const worker = require("../../backend/scripts/services/eventListener");
const { processDLQ } = require("../../backend/scripts/services/dlqProcessor");

const ESCROW = "0x1111111111111111111111111111111111111111";
const WALLET = "0x2222222222222222222222222222222222222222";
const iface = new ethers.Interface(worker._ARAF_ABI_FOR_TESTS);

function makeEventLog(name, values, { block = 100, index = 3, txHash = `0x${"ab".repeat(32)}` } = {}) {
  const fragment = iface.getEvent(name);
  const { data, topics } = iface.encodeEventLog(fragment, values);
  return new ethers.EventLog(
    {
      address: ESCROW,
      blockNumber: block,
      blockHash: `0x${"cd".repeat(32)}`,
      transactionHash: txHash,
      transactionIndex: 0,
      index,
      removed: false,
      data,
      topics,
    },
    iface,
    fragment
  );
}

describe("DLQ namedArgs from real ethers events (B1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.list = [];
    store.lists = {};
    store.sets = {};
    worker._blockAcks.clear();
    worker._getEventDate = jest.fn().mockResolvedValue(new Date("2026-01-01T00:00:00Z"));
  });

  it("documents the root cause: a real EventLog exposes named args only through the Result proxy", () => {
    const event = makeEventLog("FeeConfigUpdated", [15n, 10n]);
    expect(event.args.takerFeeBps).toBe(15n);
    // The old Object.entries(...).filter(non-numeric) approach yields nothing for a Result.
    const legacy = Object.entries(event.args).filter(([k]) => Number.isNaN(Number(k)));
    expect(legacy).toEqual([]);
  });

  it("writes namedArgs to the DLQ from event.fragment.inputs", async () => {
    const event = makeEventLog("FeeConfigUpdated", [15n, 10n]);
    await worker._addToDLQ(event, "boom");

    const entry = JSON.parse(store.list[0]);
    expect(entry.namedArgs).toEqual({ takerFeeBps: "15", makerFeeBps: "10" });
    expect(entry.args).toEqual(["15", "10"]);
    expect(entry.idempotencyKey).toBe(`${event.transactionHash}:3`);
    expect(entry.logIndex).toBe(3);
  });

  it("re-drives a DLQ entry produced from a real EventLog successfully (FeeConfigUpdated)", async () => {
    await worker._addToDLQ(makeEventLog("FeeConfigUpdated", [15n, 10n]), "boom");
    const entry = JSON.parse(store.list[0]);

    const result = await worker.reDriveEvent(entry);

    expect(result.success).toBe(true);
    expect(mockUpdateFee).toHaveBeenCalledWith(15, 10);
  });

  it("re-drives WalletRegistered and tier-threshold arrays serialized from real events", async () => {
    await worker._addToDLQ(makeEventLog("WalletRegistered", [WALLET, 1_700_000_000n], { index: 1 }), "boom");
    await worker._addToDLQ(
      makeEventLog("ReputationTierThresholdsUpdated", [[0, 15, 50, 100, 200], [100, 80, 50, 30, 15]], { index: 2 }),
      "boom"
    );

    const [walletEntry, tierEntry] = store.list.map((raw) => JSON.parse(raw));
    expect((await worker.reDriveEvent(walletEntry)).success).toBe(true);
    expect((await worker.reDriveEvent(tierEntry)).success).toBe(true);

    expect(mockUserFindOneAndUpdate).toHaveBeenCalledWith(
      { wallet_address: WALLET },
      expect.objectContaining({ $set: { last_onchain_sync_at: new Date("2026-01-01T00:00:00Z") } }),
      { upsert: true }
    );
    expect(mockUpdatePolicy).toHaveBeenCalledWith({
      tierMinSuccessfulTrades: [0, 15, 50, 100, 200],
      tierMaxRiskPoints: [100, 80, 50, 30, 15],
    });
  });

  it("still re-drives legacy DLQ entries whose namedArgs is the old always-empty {} (positional args fallback)", async () => {
    const legacy = {
      eventName: "FeeConfigUpdated",
      txHash: "0xlegacy",
      logIndex: 1,
      blockNumber: 50,
      namedArgs: {},
      args: ["25", "5"],
    };

    const result = await worker.reDriveEvent(legacy);

    expect(result.success).toBe(true);
    expect(mockUpdateFee).toHaveBeenCalledWith(25, 5);
  });

  it("processDLQ drains a real-EventLog entry end to end", async () => {
    worker.isRunning = true;
    worker.contract = {};
    await worker._addToDLQ(makeEventLog("FeeConfigUpdated", [30n, 20n]), "boom");
    expect(store.list).toHaveLength(1);

    await processDLQ();

    expect(mockUpdateFee).toHaveBeenCalledWith(30, 20);
    expect(store.list).toHaveLength(0);
    worker.isRunning = false;
    worker.contract = null;
  });

  it("processDLQ leaves the queue untouched while the worker is not ready (no attempts burned)", async () => {
    worker.isRunning = false;
    worker.contract = null;
    await worker._addToDLQ(makeEventLog("FeeConfigUpdated", [30n, 20n]), "boom");
    const before = store.list[0];

    await processDLQ();

    expect(mockUpdateFee).not.toHaveBeenCalled();
    expect(store.list).toEqual([before]);
  });
});

describe("config events reject missing/NaN payloads instead of writing NaN (B1)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("FeeConfigUpdated throws on empty args and never reaches the cache", async () => {
    await expect(worker._onFeeConfigUpdated({ eventName: "FeeConfigUpdated", args: {} })).rejects.toThrow("takerFeeBps");
    expect(mockUpdateFee).not.toHaveBeenCalled();
  });

  it("FeeConfigUpdated throws on a non-numeric value", async () => {
    await expect(
      worker._onFeeConfigUpdated({ eventName: "FeeConfigUpdated", args: { takerFeeBps: "abc", makerFeeBps: "1" } })
    ).rejects.toThrow("geçerli bir sayı değil");
    expect(mockUpdateFee).not.toHaveBeenCalled();
  });

  it("CooldownConfigUpdated throws when a field is missing", async () => {
    await expect(
      worker._onCooldownConfigUpdated({ eventName: "CooldownConfigUpdated", args: { tier0TradeCooldown: 60n } })
    ).rejects.toThrow("tier1TradeCooldown");
    expect(mockUpdateCooldown).not.toHaveBeenCalled();
  });

  it("ReputationPolicyUpdated and TierThresholds throw on incomplete payloads", async () => {
    await expect(worker._onReputationPolicyUpdated({ eventName: "ReputationPolicyUpdated", args: { cleanPeriod: 1n } })).rejects.toThrow();
    await expect(worker._onReputationTierThresholdsUpdated({ eventName: "ReputationTierThresholdsUpdated", args: {} })).rejects.toThrow();
    expect(mockUpdatePolicy).not.toHaveBeenCalled();
  });
});

describe("DLQ uniqueness and unsafe-flag cleanup (B9)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.list = [];
    store.lists = {};
    store.sets = {};
    worker._blockAcks.clear();
  });

  it("does not append the same poison event to the DLQ twice", async () => {
    const event = makeEventLog("FeeConfigUpdated", [15n, 10n]);

    expect(await worker._addToDLQ(event, "first")).toBe(true);
    expect(await worker._addToDLQ(event, "second replay")).toBe(false);
    expect(await worker._addToDLQ(event, "third replay")).toBe(false);

    expect(store.list).toHaveLength(1);
    expect(mockRedis.rPush).toHaveBeenCalledTimes(1);
  });

  it("keeps distinct events (different logIndex) as separate DLQ entries", async () => {
    await worker._addToDLQ(makeEventLog("FeeConfigUpdated", [15n, 10n], { index: 1 }), "x");
    await worker._addToDLQ(makeEventLog("FeeConfigUpdated", [15n, 10n], { index: 2 }), "x");
    expect(store.list).toHaveLength(2);
  });

  it("a successful re-drive acks the event and clears the block's unsafe flag; a failure keeps it", async () => {
    const event = makeEventLog("FeeConfigUpdated", [15n, 10n], { block: 200, index: 4 });
    const eventId = worker._getEventId(event);
    worker._seedAckStateForRange(200, 200);
    worker._trackLiveEventSeen(event);
    worker._markBlockUnsafe(200, eventId);
    expect(worker._blockAcks.get(200).unsafe).toBe(true);

    await worker._addToDLQ(event, "boom");
    const entry = JSON.parse(store.list[0]);

    mockUpdateFee.mockRejectedValueOnce(new Error("still broken"));
    // MAX_RETRIES would sleep; make the no-DLQ retry fail fast for this negative case.
    worker._processEventWithRetryNoDLQ = jest.fn().mockResolvedValueOnce({ success: false, error: "still broken" });
    const failed = await worker.reDriveEvent(entry);
    expect(failed.success).toBe(false);
    expect(worker._blockAcks.get(200).unsafe).toBe(true);

    worker._processEventWithRetryNoDLQ = jest.fn().mockResolvedValueOnce({ success: true });
    const ok = await worker.reDriveEvent(entry);
    expect(ok.success).toBe(true);
    const state = worker._blockAcks.get(200);
    expect(state.unsafe).toBe(false);
    expect(state.acked.has(eventId)).toBe(true);
    expect(state.failed.size).toBe(0);
  });

  it("keeps the block unsafe when another event in it is still failing", async () => {
    worker._seedAckStateForRange(300, 300);
    worker._markBlockUnsafe(300, "0xa:1");
    worker._markBlockUnsafe(300, "0xa:2");

    worker._processEventWithRetryNoDLQ = jest.fn().mockResolvedValue({ success: true });
    await worker.reDriveEvent({ eventName: "FeeConfigUpdated", txHash: "0xa", logIndex: 1, blockNumber: 300, namedArgs: { takerFeeBps: "1", makerFeeBps: "1" } });

    expect(worker._blockAcks.get(300).unsafe).toBe(true);
  });
});
