"use strict";

jest.mock("../scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => ({ get: jest.fn(), setEx: jest.fn(), del: jest.fn(), rPush: jest.fn() })),
}));
jest.mock("../scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: jest.fn(),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: jest.fn(),
}));
jest.mock("../scripts/models/Trade", () => ({}));
jest.mock("../scripts/models/Order", () => ({}));
jest.mock("../scripts/models/User", () => ({
  findOneAndUpdate: jest.fn(),
}));

const worker = require("../scripts/services/eventListener");
const User = require("../scripts/models/User");

describe("eventListener semantic terminal outcome classification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("burned -> burn_count", () => {
    const outcome = worker._classifyTerminalSemanticOutcome({
      terminalStatus: "BURNED",
      trade: {},
      tradeData: {},
    });
    expect(outcome).toEqual({ historyType: "burned", counterField: "burn_count" });
  });

  it("canceled + both signatures -> mutual_cancel_count", () => {
    const outcome = worker._classifyTerminalSemanticOutcome({
      terminalStatus: "CANCELED",
      trade: { cancel_proposal: { maker_signed: true, taker_signed: true } },
      tradeData: {},
    });
    expect(outcome).toEqual({ historyType: "mutual_canceled", counterField: "mutual_cancel_count" });
  });

  it("canceled mirror lag olsa da on-chain iki imza varsa mutual_cancel_count üretir", () => {
    const outcome = worker._classifyTerminalSemanticOutcome({
      terminalStatus: "CANCELED",
      trade: { cancel_proposal: { maker_signed: false, taker_signed: false } },
      tradeData: { cancelProposedByMaker: true, cancelProposedByTaker: true },
    });
    expect(outcome).toEqual({ historyType: "mutual_canceled", counterField: "mutual_cancel_count" });
  });

  it("resolved + dispute evidence -> disputed_but_resolved_count", () => {
    const outcome = worker._classifyTerminalSemanticOutcome({
      terminalStatus: "RESOLVED",
      trade: { timers: { challenged_at: new Date("2026-04-01T00:00:00Z") } },
      tradeData: {},
    });
    expect(outcome).toEqual({ historyType: "disputed_resolved", counterField: "disputed_but_resolved_count" });
  });

  it("resolved + ambiguous non-dispute -> no auto_release_count increment", () => {
    const outcome = worker._classifyTerminalSemanticOutcome({
      terminalStatus: "RESOLVED",
      trade: { timers: {} },
      tradeData: { challengedAt: 0, pingedByTaker: false },
    });
    expect(outcome).toEqual({ historyType: "resolved_unclassified", counterField: null });
  });

  it("terminal helper should not increment counters by default", async () => {
    await worker._applySemanticOutcomeToParticipants({
      session: {},
      addresses: ["0xabc"],
      semantic: { historyType: "mutual_canceled", counterField: "mutual_cancel_count" },
      eventAt: new Date("2026-04-01T00:00:00Z"),
      tradeId: "1",
    });

    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const update = User.findOneAndUpdate.mock.calls[0][1];
    expect(update.$inc).toBeUndefined();
  });
});
