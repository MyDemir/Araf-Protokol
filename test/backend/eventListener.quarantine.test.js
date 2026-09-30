"use strict";

// Poison quarantine (acked-poison), set-based DLQ dedupe incl. archive/quarantine, stop() during replay.

const kv = new Map();
const lists = {};
const sets = {};
const L = (k) => (lists[k] = lists[k] || []);
const mockRedis = {
  get: jest.fn(async (k) => (kv.has(k) ? kv.get(k) : null)),
  set: jest.fn(async (k, v) => { kv.set(k, v); return "OK"; }),
  rPush: jest.fn(async (k, v) => L(k).push(v)),
  lPush: jest.fn(async (k, v) => L(k).unshift(v)),
  lRange: jest.fn(async (k, s, e) => (e === -1 ? [...L(k)] : L(k).slice(s, e + 1))),
  lLen: jest.fn(async (k) => L(k).length),
  lRem: jest.fn(async (k, _c, v) => { const i = L(k).indexOf(v); if (i >= 0) L(k).splice(i, 1); return i >= 0 ? 1 : 0; }),
  sIsMember: jest.fn(async (s, m) => (sets[s] && sets[s].has(m) ? 1 : 0)),
  sAdd: jest.fn(async (s, m) => { (sets[s] = sets[s] || new Set()).add(m); }),
  sRem: jest.fn(async (s, m) => { if (sets[s]) sets[s].delete(m); }),
};
jest.mock("../../backend/scripts/config/redis", () => ({ getRedisClient: jest.fn(() => mockRedis) }));
jest.mock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../backend/scripts/services/protocolConfig", () => ({ updateCachedFeeConfig: jest.fn(), updateCachedCooldownConfig: jest.fn(), updateCachedTokenConfig: jest.fn(), refreshProtocolConfig: jest.fn() }));
jest.mock("../../backend/scripts/models/Trade", () => ({}));
jest.mock("../../backend/scripts/models/Order", () => ({}));
jest.mock("../../backend/scripts/models/User", () => ({}));

const worker = require("../../backend/scripts/services/eventListener");
const { processDLQ } = require("../../backend/scripts/services/dlqProcessor");

const poison = { eventName: "FeeConfigUpdated", transactionHash: "0xpoison", index: 2, blockNumber: 5, args: { takerFeeBps: "x", makerFeeBps: "1" } };

beforeEach(() => {
  jest.clearAllMocks();
  kv.clear();
  for (const k of Object.keys(lists)) delete lists[k];
  for (const k of Object.keys(sets)) delete sets[k];
  worker._blockAcks.clear();
  worker._quarantinedCount = 0;
  worker._stopRequested = false;
  worker.isRunning = true;
  worker.contract = {};
});
afterEach(() => { worker.isRunning = false; worker.contract = null; });

describe("poison quarantine", () => {
  it("quarantines an entry after MAX attempts, alarms via diagnostics, and the checkpoint advances past it", async () => {
    await worker._addToDLQ(poison, "boom");
    const entry = JSON.parse(L("worker:dlq")[0]);
    entry.attempt = 9; // next failure = attempt 10 = MAX_REDRIVE_ATTEMPTS
    L("worker:dlq")[0] = JSON.stringify(entry);
    worker._seedAckStateForRange(5, 5);
    worker._trackLiveEventSeen(poison);
    worker._markBlockUnsafe(5, worker._getEventId(poison));
    worker._processEventWithRetryNoDLQ = jest.fn().mockResolvedValue({ success: false, error: "still broken" });

    await processDLQ();

    expect(L("worker:dlq")).toHaveLength(0);
    expect(L("worker:dlq:quarantine")).toHaveLength(1);
    expect(sets["worker:dlq:quarantine:keys"].has("0xpoison:2")).toBe(true);
    expect(sets["worker:dlq:keys"].has("0xpoison:2")).toBe(false);
    expect(worker.getDiagnostics().quarantinedEvents).toBe(1);
    expect(worker._blockAcks.get(5).unsafe).toBe(false);

    // replay skips the quarantined event and moves the checkpoint forward
    kv.set("worker:last_safe_block", "0");
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(11) };
    worker._fetchRangeEvents = jest.fn().mockResolvedValue([poison]);
    worker._processEvent = jest.fn().mockRejectedValue(new Error("poison"));
    await worker._replayMissedEvents();

    expect(worker._processEvent).not.toHaveBeenCalled();
    expect(kv.get("worker:last_safe_block")).toBe("10");

    // and it is never re-added to the DLQ
    expect(await worker._addToDLQ(poison, "again")).toBe(false);
    expect(L("worker:dlq")).toHaveLength(0);
  });

  it("the live poll treats a quarantined event as acked", async () => {
    sets["worker:dlq:quarantine:keys"] = new Set(["0xpoison:2"]);
    worker._fetchRangeEvents = jest.fn().mockResolvedValue([poison]);
    worker._processEventWithRetry = jest.fn();
    await worker._pollLiveRange(5, 5);
    expect(worker._processEventWithRetry).not.toHaveBeenCalled();
    expect(worker._blockAcks.get(5).unsafe).toBe(false);
    expect(worker._blockAcks.get(5).acked.has("0xpoison:2")).toBe(true);
  });
});

describe("set-based DLQ dedupe", () => {
  it("does not re-add an event whose key is in the archive index", async () => {
    sets["worker:dlq:archive:keys"] = new Set(["0xpoison:2"]);
    expect(await worker._addToDLQ(poison, "x")).toBe(false);
    expect(L("worker:dlq")).toHaveLength(0);
    expect(mockRedis.lRange).not.toHaveBeenCalled(); // no list scan
  });

  it("indexes new entries in the live set", async () => {
    expect(await worker._addToDLQ(poison, "x")).toBe(true);
    expect(sets["worker:dlq:keys"].has("0xpoison:2")).toBe(true);
    expect(await worker._addToDLQ(poison, "x")).toBe(false);
  });
});

describe("stop() during replay", () => {
  it("halts the replay loop before the next event/batch", async () => {
    kv.set("worker:last_safe_block", "0");
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(31) };
    const ev = { eventName: "X", transactionHash: "0x1", index: 0, blockNumber: 3, args: {} };
    worker._fetchRangeEvents = jest.fn().mockResolvedValue([ev, { ...ev, index: 1 }]);
    worker._processEvent = jest.fn(async () => { await worker.stop(); });

    await worker._replayMissedEvents();

    expect(worker._processEvent).toHaveBeenCalledTimes(1); // second event never processed
    expect(kv.get("worker:last_safe_block")).toBe("0");
  });
});
