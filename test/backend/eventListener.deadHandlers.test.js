"use strict";

// [TR] B36: kontrat EscrowCreated / EscrowLocked yayınlamaz; ölü handler ve iç retry/DLQ zinciri kaldırıldı.
// [EN] B36: the contract never emits EscrowCreated / EscrowLocked; dead handlers and their inner retry/DLQ chain are gone.

jest.mock("../../backend/scripts/config/redis", () => ({ getRedisClient: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), rPush: jest.fn() })) }));
jest.mock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../backend/scripts/services/protocolConfig", () => ({ updateCachedFeeConfig: jest.fn(), updateCachedCooldownConfig: jest.fn(), updateCachedTokenConfig: jest.fn(), refreshProtocolConfig: jest.fn() }));
jest.mock("../../backend/scripts/models/Trade", () => ({}));
jest.mock("../../backend/scripts/models/Order", () => ({}));
jest.mock("../../backend/scripts/models/User", () => ({}));

const fs = require("fs");
const path = require("path");
const worker = require("../../backend/scripts/services/eventListener");

describe("eventListener dead contract handlers (B36)", () => {
  it("ABI and handlers no longer contain EscrowCreated/EscrowLocked", () => {
    const abiText = worker._ARAF_ABI_FOR_TESTS.join("\n");
    expect(abiText).not.toMatch(/EscrowCreated|EscrowLocked/);
    expect(worker._onEscrowCreated).toBeUndefined();
    expect(worker._onEscrowLocked).toBeUndefined();
  });

  it("the contract source really has no such events (guards against removing a live handler)", () => {
    const sol = fs.readFileSync(path.resolve(__dirname, "../../contracts/src/ArafEscrow.sol"), "utf8");
    expect(sol).not.toMatch(/event\s+EscrowCreated/);
    expect(sol).not.toMatch(/event\s+EscrowLocked/);
  });

  it("a stale DLQ entry for a removed event is ignored, not processed", async () => {
    await worker._processEvent({ eventName: "EscrowLocked", args: { tradeId: 1n } });
    expect(worker.getDiagnostics().ignoredEventsByReason["unknown_event:EscrowLocked"]).toBe(1);
  });
});
