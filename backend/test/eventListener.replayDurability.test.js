"use strict";

const mockRedis = { get: jest.fn(), set: jest.fn(), rPush: jest.fn(), lLen: jest.fn().mockResolvedValue(0) };

jest.mock("../scripts/config/redis", () => ({ getRedisClient: jest.fn(() => mockRedis) }));
jest.mock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../scripts/models/Trade", () => ({ find: jest.fn(() => ({ select: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) })) }));
jest.mock("../scripts/models/Order", () => ({ findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));
jest.mock("../scripts/models/User", () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn() }));
jest.mock("../scripts/models/RevenueEvent", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../scripts/models/RewardFunding", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../scripts/models/RewardEpoch", () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })) }));
jest.mock("../scripts/models/RewardClaim", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../scripts/models/RewardEpochAllocationEvent", () => ({ findOneAndUpdate: jest.fn().mockResolvedValue({ lastErrorObject: { updatedExisting: true } }) }));
jest.mock("../scripts/services/protocolConfig", () => ({ updateCachedFeeConfig: jest.fn(), updateCachedCooldownConfig: jest.fn(), updateCachedTokenConfig: jest.fn(), refreshProtocolConfig: jest.fn() }));
jest.mock("../scripts/services/expectedChain", () => ({ assertProviderExpectedChainOrThrow: jest.fn() }));

describe("eventListener replay durability", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("does not advance checkpoint past poison event and writes DLQ with stable key", async () => {
    const worker = require("../scripts/services/eventListener");
    mockRedis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce("0");
    worker.provider = { getBlockNumber: jest.fn().mockResolvedValue(10) };
    const good = { eventName: "WalletRegistered", transactionHash: "0xgood", logIndex: 1, blockNumber: 4, args: { wallet: "0xabc", timestamp: 1 } };
    const bad = { eventName: "EscrowReleased", transactionHash: "0xbad", logIndex: 2, blockNumber: 4, args: { tradeId: "1" } };
    worker.contract = { queryFilter: jest.fn().mockResolvedValueOnce([good, bad]).mockResolvedValue([]) };
    worker._processEvent = jest.fn(async (evt) => { if (evt.transactionHash === "0xbad") throw new Error("poison"); });

    await worker._replayMissedEvents();

    expect(worker._processEvent).toHaveBeenCalledWith(good);
    expect(mockRedis.rPush).toHaveBeenCalledTimes(1);
    const dlq = JSON.parse(mockRedis.rPush.mock.calls[0][1]);
    expect(dlq.idempotencyKey).toBe("0xbad:2");
    expect(mockRedis.set).not.toHaveBeenCalledWith("worker:last_safe_block", "4");
  });

  it("re-drive success does not duplicate prior successful projections and keeps unsafe block on fail", async () => {
    const worker = require("../scripts/services/eventListener");
    const entry = { eventName: "WalletRegistered", txHash: "0x1", logIndex: 3, blockNumber: 7, namedArgs: { wallet: "0xabc", timestamp: "1" } };
    worker._processEventWithRetryNoDLQ = jest.fn().mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: "x" });

    const ok = await worker.reDriveEvent(entry);
    expect(ok.success).toBe(true);
    const fail = await worker.reDriveEvent(entry);
    expect(fail.success).toBe(false);
    expect(worker._blockAcks.get(7).unsafe).toBe(true);
  });



  it("reconciliation report includes drift categories and ignored histogram", async () => {
    const Trade = require("../scripts/models/Trade");
    Trade.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { onchain_escrow_id: "1", status: "RESOLVED", timers: {} },
        { onchain_escrow_id: "1", status: "RESOLVED", timers: {} },
      ]),
    });
    const worker = require("../scripts/services/eventListener");
    worker._ignoredEventsByReason = { malformed_event_args: 2 };
    worker._blockAcks.set(9, { unsafe: true });
    mockRedis.lLen.mockResolvedValueOnce(3);

    const report = await worker.runReconciliationReport({ limit: 10 });
    expect(report.success).toBe(true);
    expect(report.categories.terminal_trade_drift).toBe(2);
    expect(report.categories.duplicate_projection).toBe(1);
    expect(report.categories.dlq_pending).toBe(3);
    expect(report.ignoredEventReasonHistogram.malformed_event_args).toBe(2);
    expect(report.unsafeAckBlocks).toContain(9);
  });

  it("tracks malformed and unknown events in ignore metrics", async () => {
    const worker = require("../scripts/services/eventListener");
    await worker._processEvent(null);
    await worker._processEvent({ eventName: "UnknownX", args: {} });
    await worker._processEvent({ eventName: "WalletRegistered" });
    const d = worker.getDiagnostics();
    expect(d.ignoredEventsByReason.malformed_event_object).toBe(1);
    expect(d.ignoredEventsByReason["unknown_event:UnknownX"]).toBe(1);
    expect(d.ignoredEventsByReason.malformed_event_args).toBe(1);
    expect(d.reconciliationNeeded).toBe(true);
  });
});
