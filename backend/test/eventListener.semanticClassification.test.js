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
jest.mock("../scripts/models/User", () => ({}));

const worker = require("../scripts/services/eventListener");

describe("eventListener semantic terminal outcome classification", () => {
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
});
