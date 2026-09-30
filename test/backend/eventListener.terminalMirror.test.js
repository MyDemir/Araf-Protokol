"use strict";

// B5, B13, B15, B16, B20, B22

const mockRedis = { get: jest.fn(), set: jest.fn(), rPush: jest.fn(), lLen: jest.fn().mockResolvedValue(0) };
jest.mock("../../backend/scripts/config/redis", () => ({ getRedisClient: jest.fn(() => mockRedis) }));
jest.mock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
const mockUpdateFee = jest.fn().mockResolvedValue({});
jest.mock("../../backend/scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: (...a) => mockUpdateFee(...a),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: jest.fn(),
  refreshProtocolConfig: jest.fn(),
}));

const mockTrade = {
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
};
jest.mock("../../backend/scripts/models/Trade", () => ({
  findOneAndUpdate: (...a) => mockTrade.findOneAndUpdate(...a),
  findOne: (...a) => mockTrade.findOne(...a),
  updateOne: (...a) => mockTrade.updateOne(...a),
  find: (...a) => mockTrade.find(...a),
  countDocuments: (...a) => mockTrade.countDocuments(...a),
}));
const mockOrder = { findOneAndUpdate: jest.fn().mockResolvedValue({}) };
jest.mock("../../backend/scripts/models/Order", () => ({ findOneAndUpdate: (...a) => mockOrder.findOneAndUpdate(...a) }));
const mockUser = { findOne: jest.fn(), findOneAndUpdate: jest.fn().mockResolvedValue({}) };
jest.mock("../../backend/scripts/models/User", () => ({
  findOne: (...a) => mockUser.findOne(...a),
  findOneAndUpdate: (...a) => mockUser.findOneAndUpdate(...a),
}));
const mockRevenue = { findOneAndUpdate: jest.fn().mockResolvedValue({}) };
jest.mock("../../backend/scripts/models/RevenueEvent", () => ({ findOneAndUpdate: (...a) => mockRevenue.findOneAndUpdate(...a) }));
const mockSession = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn().mockResolvedValue(),
  abortTransaction: jest.fn().mockResolvedValue(),
  endSession: jest.fn().mockResolvedValue(),
};
jest.mock("mongoose", () => ({ startSession: jest.fn().mockResolvedValue(mockSession) }));

const worker = require("../../backend/scripts/services/eventListener");

const leanOf = (doc) => ({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) }) });
const TRADE = {
  id: 5n, parentOrderId: 7n,
  maker: "0x3333333333333333333333333333333333333333", taker: "0x1111111111111111111111111111111111111111",
  tokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".padEnd(42, "a"),
  cryptoAmount: 100n, makerBond: 8n, takerBond: 10n, takerFeeBpsSnapshot: 15, makerFeeBpsSnapshot: 15,
  tier: 1, paymentRiskLevelSnapshot: 1, state: 4, lockedAt: 1000n, paidAt: 0n, challengedAt: 0n,
  pingedAt: 0n, pingedByTaker: false, challengePingedAt: 0n, challengePingedByMaker: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTrade.findOneAndUpdate.mockResolvedValue({ parent_order_id: "7" });
  mockTrade.updateOne.mockResolvedValue({});
  mockTrade.findOne.mockReturnValue(leanOf({ status: "PAID" }));
  mockRedis.get.mockResolvedValue(null);
  worker.contract = null;
  worker._getEventDate = jest.fn().mockResolvedValue(new Date("2026-01-01T00:00:00Z"));
});

describe("B5: trade mirror status + terminal idempotency", () => {
  it("never $sets status from getTrade; inserts via $setOnInsert", async () => {
    mockTrade.findOneAndUpdate.mockResolvedValue({ lastErrorObject: { upserted: "x" }, value: {} });
    await worker._upsertTradeMirror(TRADE, { parentOrder: { side: 0, orderRef: "0x" + "cd".repeat(32) } });
    const [, update] = mockTrade.findOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBeUndefined();
    expect(update.$setOnInsert.status).toBe("RESOLVED");
    expect(mockTrade.updateOne).not.toHaveBeenCalled();
  });

  it("on an existing mirror only advances forward from non-terminal states (regression + terminal blocked)", async () => {
    mockTrade.findOneAndUpdate.mockResolvedValue({ lastErrorObject: { updatedExisting: true }, value: {} });
    await worker._upsertTradeMirror({ ...TRADE, state: 2 }, { parentOrder: { side: 0, orderRef: "0x" + "cd".repeat(32) } });
    const [filter, update] = mockTrade.updateOne.mock.calls[0];
    expect(update).toEqual({ $set: { status: "PAID" } });
    expect(filter.status.$in.sort()).toEqual(["LOCKED", "OPEN"]); // never PAID->LOCKED, never from terminal/CHALLENGED
  });

  it("terminal handler still writes resolved_at/resolution_type/receipt_delete_at when status was already terminal", async () => {
    mockTrade.findOne.mockReturnValue(leanOf({ status: "RESOLVED", timers: { resolved_at: null } }));
    worker.contract = { getRewardableTrade: jest.fn().mockResolvedValue({ outcome: 1n }) };

    await worker._onEscrowReleased({ eventName: "EscrowReleased", args: { tradeId: 5n } });

    const [filter, update] = mockTrade.findOneAndUpdate.mock.calls[0];
    expect(filter.status.$in).toContain("RESOLVED");
    expect(filter["timers.resolved_at"]).toBeNull();
    expect(update.$set.resolution_type).toBe("MANUAL_RELEASE");
    expect(update.$set["timers.resolved_at"]).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(update.$set["evidence.receipt_delete_at"]).toBeInstanceOf(Date);
    expect(mockOrder.findOneAndUpdate.mock.calls[0][1].$inc).toEqual({
      "stats.active_child_trade_count": -1,
      "stats.resolved_child_trade_count": 1,
    });
  });

  it("an already-applied terminal transition is an idempotent no-op (no RPC, no counter change, no error)", async () => {
    mockTrade.findOne.mockReturnValue(leanOf({ status: "RESOLVED", timers: { resolved_at: new Date() } }));
    worker.contract = { getRewardableTrade: jest.fn() };

    await expect(worker._onEscrowReleased({ eventName: "EscrowReleased", args: { tradeId: 5n } })).resolves.toBeUndefined();

    expect(worker.contract.getRewardableTrade).not.toHaveBeenCalled();
    expect(mockTrade.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mockOrder.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("cancel/burn/settlement-finalized apply on an already-terminal, unapplied mirror", async () => {
    await worker._onEscrowCanceled({ eventName: "EscrowCanceled", args: { tradeId: 5n } });
    await worker._onEscrowBurned({ eventName: "EscrowBurned", args: { tradeId: 5n, burnedAmount: 3n } });
    await worker._onSettlementFinalized({
      eventName: "SettlementFinalized",
      args: { tradeId: 5n, proposalId: 1n, makerPayout: 1n, takerPayout: 1n, takerFee: 0n, makerFee: 0n },
    });
    for (const [filter] of mockTrade.findOneAndUpdate.mock.calls) {
      expect(filter["timers.resolved_at"]).toBeNull();
    }
    expect(mockTrade.findOneAndUpdate.mock.calls[0][0].status.$in).toContain("CANCELED");
    expect(mockTrade.findOneAndUpdate.mock.calls[1][0].status.$in).toContain("BURNED");
    expect(mockTrade.findOneAndUpdate.mock.calls[2][0].status.$in).toContain("RESOLVED");
  });
});

describe("B13: terminal outcome read failure is not swallowed", () => {
  it("EscrowReleased throws (retry/DLQ) instead of persisting UNKNOWN", async () => {
    worker.contract = { getRewardableTrade: jest.fn().mockRejectedValue(new Error("rpc down")) };
    await expect(worker._onEscrowReleased({ eventName: "EscrowReleased", args: { tradeId: 5n } })).rejects.toThrow("rpc down");
    expect(mockTrade.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mockSession.abortTransaction).toHaveBeenCalled();
  });
});

describe("B15: missing trade mirror throws, filtered-out (already processed) does not", () => {
  const cases = [
    ["PaymentReported", (w) => w._onPaymentReported({ eventName: "PaymentReported", args: { tradeId: 5n, ipfsHash: "Qm", timestamp: 1n } })],
    ["DisputeOpened", (w) => w._onDisputeOpened({ eventName: "DisputeOpened", args: { tradeId: 5n, timestamp: 1n } })],
    ["EscrowCanceled", (w) => w._onEscrowCanceled({ eventName: "EscrowCanceled", args: { tradeId: 5n } })],
    ["PaymentWindowExpired", (w) => w._onPaymentWindowExpired({ eventName: "PaymentWindowExpired", args: { tradeId: 5n } })],
    ["EscrowBurned", (w) => w._onEscrowBurned({ eventName: "EscrowBurned", args: { tradeId: 5n, burnedAmount: 1n } })],
    ["SettlementRejected", (w) => w._onSettlementRejected({ eventName: "SettlementRejected", args: { tradeId: 5n, proposalId: 1n } })],
    ["SettlementWithdrawn", (w) => w._onSettlementWithdrawn({ eventName: "SettlementWithdrawn", args: { tradeId: 5n, proposalId: 1n } })],
    ["SettlementExpired", (w) => w._onSettlementExpired({ eventName: "SettlementExpired", args: { tradeId: 5n, proposalId: 1n } })],
    ["SettlementFinalized", (w) => w._onSettlementFinalized({ eventName: "SettlementFinalized", args: { tradeId: 5n, proposalId: 1n, makerPayout: 1n, takerPayout: 1n, takerFee: 0n, makerFee: 0n } })],
  ];

  it.each(cases)("%s throws when the trade mirror does not exist", async (name, run) => {
    mockTrade.findOneAndUpdate.mockResolvedValue(null);
    mockTrade.findOne.mockReturnValue(leanOf(null));
    await expect(run(worker)).rejects.toThrow(`${name} geldi ama trade mirror bulunamadı`);
  });

  it.each(cases)("%s is a silent idempotent skip when the mirror exists but the filter did not match", async (_name, run) => {
    mockTrade.findOneAndUpdate.mockResolvedValue(null);
    mockTrade.findOne.mockReturnValue(leanOf({ status: "RESOLVED" }));
    await expect(run(worker)).resolves.toBeUndefined();
  });

  it("EscrowReleased and CancelProposed and BleedingDecayed throw on a missing mirror", async () => {
    mockTrade.findOne.mockReturnValue(leanOf(null));
    await expect(worker._onEscrowReleased({ eventName: "EscrowReleased", args: { tradeId: 5n } })).rejects.toThrow("trade mirror bulunamadı");

    worker._fetchTradeFromChain = jest.fn().mockResolvedValue({ maker: TRADE.maker, taker: TRADE.taker });
    mockTrade.findOneAndUpdate.mockResolvedValue(null);
    await expect(
      worker._onCancelProposed({ eventName: "CancelProposed", args: { tradeId: 5n, proposer: TRADE.maker } })
    ).rejects.toThrow("trade mirror bulunamadı");

    mockTrade.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
      worker._onBleedingDecayed({ eventName: "BleedingDecayed", transactionHash: "0x1", index: 1, args: { tradeId: 5n, decayedAmount: 1n, timestamp: 1n } })
    ).rejects.toThrow("trade mirror bulunamadı");
  });
});

describe("B16: single revenue row per transfer", () => {
  const VAULT = "0x9999999999999999999999999999999999999999";
  const sent = (treasury) => ({
    eventName: "ProtocolRevenueSent", transactionHash: "0xr", index: 1, blockNumber: 9,
    args: { token: "0xaaa", amount: 10n, kind: 0, tradeId: 5n, treasury },
  });

  it("skips the escrow row when the treasury is the watched vault (vault event is primary)", async () => {
    worker.vaultContract = { target: VAULT };
    await worker._onProtocolRevenueSent(sent(VAULT));
    expect(mockRevenue.findOneAndUpdate).not.toHaveBeenCalled();

    await worker._onEscrowRevenueReceived({
      eventName: "EscrowRevenueReceived", transactionHash: "0xr", index: 2, blockNumber: 9,
      args: { token: "0xaaa", amount: 10n, rewardShare: 4n, treasuryShare: 6n, kind: 0, tradeId: 5n },
    });
    expect(mockRevenue.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it("writes the escrow row when no vault is watched or the treasury is another address", async () => {
    worker.vaultContract = null;
    await worker._onProtocolRevenueSent(sent(VAULT));
    worker.vaultContract = { target: VAULT };
    await worker._onProtocolRevenueSent(sent("0x8888888888888888888888888888888888888888"));
    expect(mockRevenue.findOneAndUpdate).toHaveBeenCalledTimes(2);
    worker.vaultContract = null;
  });
});

describe("B20: ordering guard for mutable mirrors", () => {
  const rep = (block, index, successful) => ({
    eventName: "ReputationUpdated", blockNumber: block, index,
    args: {
      wallet: "0x1111111111111111111111111111111111111111", successful, failed: 0, bannedUntil: 0, effectiveTier: 1,
      manualReleaseCount: 0, autoReleaseCount: 0, mutualCancelCount: 0, disputedResolvedCount: 0, burnCount: 0,
      disputeWinCount: 0, disputeLossCount: 0, partialSettlementCount: 0, riskPoints: 0, lastPositiveEventAt: 0, lastNegativeEventAt: 0,
    },
  });

  beforeEach(() => {
    mockUser.findOne.mockReturnValue(leanOf(null));
    worker._fetchReputationFromChain = jest.fn().mockResolvedValue({ consecutiveBans: 0 });
  });

  it("ignores an older ReputationUpdated and records the applied position for a newer one", async () => {
    mockRedis.get.mockResolvedValue("200:5");
    await worker._onReputationUpdated(rep(199, 9, 1));
    await worker._onReputationUpdated(rep(200, 4, 1));
    expect(mockUser.findOneAndUpdate).not.toHaveBeenCalled();

    await worker._onReputationUpdated(rep(200, 6, 2));
    expect(mockUser.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith(
      "worker:applied_order:ReputationUpdated:0x1111111111111111111111111111111111111111",
      "200:6"
    );
  });

  it("re-applies the very same event idempotently (equal position)", async () => {
    mockRedis.get.mockResolvedValue("200:6");
    await worker._onReputationUpdated(rep(200, 6, 2));
    expect(mockUser.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it("ignores stale FeeConfigUpdated but applies a newer one", async () => {
    mockRedis.get.mockResolvedValue("300:0");
    const fee = (block, index) => ({ eventName: "FeeConfigUpdated", blockNumber: block, index, args: { takerFeeBps: 10n, makerFeeBps: 10n } });
    await worker._onFeeConfigUpdated(fee(299, 50));
    expect(mockUpdateFee).not.toHaveBeenCalled();
    await worker._onFeeConfigUpdated(fee(301, 0));
    expect(mockUpdateFee).toHaveBeenCalledWith(10, 10);
    expect(mockRedis.set).toHaveBeenCalledWith("worker:applied_order:FeeConfigUpdated", "301:0");
  });
});

describe("B22: reconciliation queries missing resolved_at directly", () => {
  it("queries terminal trades with null resolved_at and reports the true count", async () => {
    const chain = (rows) => ({
      select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(rows),
    });
    mockTrade.find
      .mockReturnValueOnce(chain([{ onchain_escrow_id: "77", status: "RESOLVED" }]))
      .mockReturnValueOnce(chain([{ onchain_escrow_id: "1", status: "RESOLVED", timers: { resolved_at: new Date() } }]));
    mockTrade.countDocuments.mockResolvedValue(250);

    const report = await worker.runReconciliationReport({ limit: 100 });

    const missingFilter = mockTrade.find.mock.calls[0][0];
    expect(missingFilter["timers.resolved_at"]).toBeNull();
    expect(missingFilter.status.$in.sort()).toEqual(["BURNED", "CANCELED", "RESOLVED"]);
    expect(report.categories.missing_terminal_timestamp).toBe(250);
    expect(report.missingTerminalTimestampSample).toEqual([{ onchain_escrow_id: "77", status: "RESOLVED" }]);
  });
});
