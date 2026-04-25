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
  refreshProtocolConfig: jest.fn(),
}));

const mockOrderFindOneAndUpdate = jest.fn().mockResolvedValue({});
jest.mock("../scripts/models/Order", () => ({
  findOneAndUpdate: (...args) => mockOrderFindOneAndUpdate(...args),
}));

const mockTradeFindOneAndUpdate = jest.fn();
const mockTradeFindOne = jest.fn();
jest.mock("../scripts/models/Trade", () => ({
  findOneAndUpdate: (...args) => mockTradeFindOneAndUpdate(...args),
  updateOne: jest.fn().mockResolvedValue({}),
  findOne: (...args) => mockTradeFindOne(...args),
}));

jest.mock("../scripts/models/User", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

const mockSession = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn().mockResolvedValue(),
  abortTransaction: jest.fn().mockResolvedValue(),
  endSession: jest.fn().mockResolvedValue(),
};

jest.mock("mongoose", () => ({
  startSession: jest.fn().mockResolvedValue(mockSession),
}));

const worker = require("../scripts/services/eventListener");

describe("eventListener settlement proposal mirror", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTradeFindOneAndUpdate.mockResolvedValue({ parent_order_id: "7" });
    mockTradeFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ status: "RESOLVED", settlement_proposal: { state: "FINALIZED" } }),
      }),
      lean: jest.fn().mockResolvedValue({ status: "RESOLVED", settlement_proposal: { state: "FINALIZED" } }),
    });
    worker._getEventDate = jest.fn().mockResolvedValue(new Date("2026-04-25T00:00:00.000Z"));
  });

  it("maps SettlementFinalized dlq args with canonical key names", () => {
    const synthetic = worker.buildSyntheticEventFromDLQEntry({
      eventName: "SettlementFinalized",
      txHash: "0xabc",
      blockNumber: 100,
      args: [11n, 2n, 700n, 300n, 0n, 0n],
    });

    expect(synthetic.args.tradeId).toBe(11n);
    expect(synthetic.args.proposalId).toBe(2n);
    expect(synthetic.args.makerPayout).toBe(700n);
    expect(synthetic.args.takerPayout).toBe(300n);
  });

  it("mirrors SettlementProposed into trade.settlement_proposal read model", async () => {
    await worker._onSettlementProposed({
      eventName: "SettlementProposed",
      transactionHash: "0xproposal",
      args: {
        tradeId: 15n,
        proposalId: 3n,
        proposer: "0x1111111111111111111111111111111111111111",
        makerShareBps: 7000,
        takerShareBps: 3000,
        expiresAt: 1760000000n,
      },
    });

    const [, update] = mockTradeFindOneAndUpdate.mock.calls[0];
    expect(update.$set["settlement_proposal.state"]).toBe("PROPOSED");
    expect(update.$set["settlement_proposal.proposal_id"]).toBe("3");
    expect(update.$set["settlement_proposal.maker_share_bps"]).toBe(7000);
    expect(update.$set["settlement_proposal.taker_share_bps"]).toBe(3000);
    expect(update.$set["settlement_proposal.expires_at"]).toEqual(new Date("2025-10-09T08:53:20.000Z"));
    expect(update.$set["settlement_proposal.expired_at"]).toBeNull();
    expect(update.$set["settlement_proposal.tx_hash"]).toBe("0xproposal");
  });

  it("keeps proposal deadline in expires_at and writes event time to expired_at on SettlementExpired", async () => {
    await worker._onSettlementExpired({
      eventName: "SettlementExpired",
      transactionHash: "0xexpired",
      args: {
        tradeId: 15n,
        proposalId: 3n,
      },
    });

    const [, update] = mockTradeFindOneAndUpdate.mock.calls[0];
    expect(update.$set["settlement_proposal.state"]).toBe("EXPIRED");
    expect(update.$set["settlement_proposal.expired_at"]).toEqual(new Date("2026-04-25T00:00:00.000Z"));
    expect(update.$set["settlement_proposal.expires_at"]).toBeUndefined();
  });

  it("does not overwrite FINALIZED proposal mirror with rejected/withdrawn/expired transitions", async () => {
    await worker._onSettlementRejected({
      eventName: "SettlementRejected",
      transactionHash: "0xrej",
      args: { tradeId: 9n, proposalId: 2n, rejecter: "0x1111111111111111111111111111111111111111" },
    });
    await worker._onSettlementWithdrawn({
      eventName: "SettlementWithdrawn",
      transactionHash: "0xwd",
      args: { tradeId: 9n, proposalId: 2n, proposer: "0x1111111111111111111111111111111111111111" },
    });
    await worker._onSettlementExpired({
      eventName: "SettlementExpired",
      transactionHash: "0xexp",
      args: { tradeId: 9n, proposalId: 2n },
    });

    const filters = mockTradeFindOneAndUpdate.mock.calls.map(([filter]) => filter);
    expect(filters[0]["settlement_proposal.state"]).toStrictEqual({ $ne: "FINALIZED" });
    expect(filters[1]["settlement_proposal.state"]).toStrictEqual({ $ne: "FINALIZED" });
    expect(filters[2]["settlement_proposal.state"]).toStrictEqual({ $ne: "FINALIZED" });
  });

  it("keeps trade status RESOLVED and marks settlement FINALIZED on SettlementFinalized", async () => {
    await worker._onSettlementFinalized({
      eventName: "SettlementFinalized",
      transactionHash: "0xfinalized",
      args: {
        tradeId: 16n,
        proposalId: 4n,
        makerPayout: 700n,
        takerPayout: 300n,
        takerFee: 0n,
        makerFee: 0n,
      },
    });

    const [, update] = mockTradeFindOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe("RESOLVED");
    expect(update.$set.resolution_type).toBe("PARTIAL_SETTLEMENT");
    expect(update.$set["settlement_proposal.state"]).toBe("FINALIZED");
    expect(update.$set["settlement_proposal.maker_payout"]).toBe("700");
    expect(update.$set["settlement_proposal.taker_payout"]).toBe("300");
    expect(update.$set["settlement_proposal.tx_hash"]).toBe("0xfinalized");
    expect(mockOrderFindOneAndUpdate).toHaveBeenCalled();
    expect(mockSession.commitTransaction).toHaveBeenCalled();
  });

  it("security_settlement_finalized_replay_does_not_double_decrement_parent_order_stats", async () => {
    mockTradeFindOneAndUpdate
      .mockResolvedValueOnce({ parent_order_id: "7", status: "RESOLVED" })
      .mockResolvedValueOnce(null);
    mockTradeFindOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ status: "RESOLVED" }),
      }),
      lean: jest.fn().mockResolvedValue({ status: "RESOLVED" }),
    });

    const event = {
      eventName: "SettlementFinalized",
      transactionHash: "0xfinalized",
      args: {
        tradeId: 16n,
        proposalId: 4n,
        makerPayout: 700n,
        takerPayout: 300n,
        takerFee: 0n,
        makerFee: 0n,
      },
    };

    await worker._onSettlementFinalized(event);
    await worker._onSettlementFinalized(event);

    expect(mockOrderFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it("security_escrow_canceled_event_sets_resolution_type_mutual_cancel_from_onchain_semantics", async () => {
    await worker._onEscrowCanceled({
      eventName: "EscrowCanceled",
      args: { tradeId: 20n, makerRefund: 0n, takerRefund: 0n },
    });

    const [, update] = mockTradeFindOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe("CANCELED");
    expect(update.$set.resolution_type).toBe("MUTUAL_CANCEL");
  });

  it("security_escrow_burned_event_sets_resolution_type_burned_without_backend_authority_guessing", async () => {
    await worker._onEscrowBurned({
      eventName: "EscrowBurned",
      args: { tradeId: 21n, burnedAmount: 10n },
    });

    const [, update] = mockTradeFindOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe("BURNED");
    expect(update.$set.resolution_type).toBe("BURNED");
  });
});
