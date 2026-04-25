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
jest.mock("../scripts/models/Trade", () => ({
  findOneAndUpdate: (...args) => mockTradeFindOneAndUpdate(...args),
  updateOne: jest.fn().mockResolvedValue({}),
  findOne: jest.fn(),
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
    expect(update.$set["settlement_proposal.tx_hash"]).toBe("0xproposal");
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
    expect(update.$set["settlement_proposal.state"]).toBe("FINALIZED");
    expect(update.$set["settlement_proposal.maker_payout"]).toBe("700");
    expect(update.$set["settlement_proposal.taker_payout"]).toBe("300");
    expect(update.$set["settlement_proposal.tx_hash"]).toBe("0xfinalized");
    expect(mockOrderFindOneAndUpdate).toHaveBeenCalled();
    expect(mockSession.commitTransaction).toHaveBeenCalled();
  });
});
