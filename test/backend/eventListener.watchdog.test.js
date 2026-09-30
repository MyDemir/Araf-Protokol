"use strict";

// B6 (block watchdog, websocket close, liveness snapshot) + B19 (startInBackground does not block)

jest.mock("../../backend/scripts/config/redis", () => ({ getRedisClient: jest.fn(() => ({ get: jest.fn(), set: jest.fn() })) }));
jest.mock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../../backend/scripts/services/protocolConfig", () => ({ updateCachedFeeConfig: jest.fn(), updateCachedCooldownConfig: jest.fn(), updateCachedTokenConfig: jest.fn(), refreshProtocolConfig: jest.fn() }));
jest.mock("../../backend/scripts/models/Trade", () => ({}));
jest.mock("../../backend/scripts/models/Order", () => ({}));
jest.mock("../../backend/scripts/models/User", () => ({}));

const worker = require("../../backend/scripts/services/eventListener");

describe("eventListener block watchdog (B6)", () => {
  let now;
  beforeEach(() => {
    now = jest.spyOn(Date, "now").mockReturnValue(10_000_000);
    worker.isRunning = true;
    worker._state = "live";
    worker._reconnectPromise = null;
    worker._staleReconnects = 0;
    worker._lastBlockSeenAt = 10_000_000;
    worker._exitProcess = jest.fn();
    worker._reconnect = jest.fn().mockResolvedValue(undefined);
  });
  afterEach(() => { now.mockRestore(); worker._stopWatchdog(); worker.isRunning = false; });

  it("does nothing while blocks keep arriving", async () => {
    now.mockReturnValue(10_000_000 + 30_000);
    await worker._watchdogTick();
    expect(worker._reconnect).not.toHaveBeenCalled();
  });

  it("reconnects once when no block was seen for the stale window", async () => {
    now.mockReturnValue(10_000_000 + 80_000);
    await worker._watchdogTick();
    expect(worker._reconnect).toHaveBeenCalledTimes(1);
    expect(worker._exitProcess).not.toHaveBeenCalled();
  });

  it("exits with code 1 when the reconnect did not bring blocks back", async () => {
    now.mockReturnValue(10_000_000 + 80_000);
    await worker._watchdogTick();
    now.mockReturnValue(10_000_000 + 80_000 + 80_000);
    await worker._watchdogTick();
    expect(worker._exitProcess).toHaveBeenCalledWith(1);
  });

  it("exits when the reconnect itself fails", async () => {
    worker._reconnect = jest.fn().mockRejectedValue(new Error("ws refused"));
    now.mockReturnValue(10_000_000 + 80_000);
    await worker._watchdogTick();
    expect(worker._exitProcess).toHaveBeenCalledWith(1);
  });

  it("a received block resets the stale counter (block handler wiring)", () => {
    let blockHandler;
    worker.contract = {};
    worker._listenersAttached = false;
    worker.provider = { on: jest.fn((evt, cb) => { if (evt === "block") blockHandler = cb; }) };
    worker._attachLiveListeners();
    worker._staleReconnects = 1;
    now.mockReturnValue(10_000_000 + 5_000);
    blockHandler(123);
    expect(worker._staleReconnects).toBe(0);
    expect(worker._lastBlockSeenAt).toBe(10_000_000 + 5_000);
    worker._listenersAttached = false;
  });

  it("websocket close on the current provider triggers reconnect; a superseded provider is ignored", () => {
    const listeners = {};
    const socket = { addEventListener: (evt, cb) => { listeners[evt] = cb; } };
    const provider = { websocket: socket };
    worker.provider = provider;
    worker._recoverOrExit = jest.fn();
    worker._watchWebSocketClose(provider);

    listeners.close({ code: 1006 });
    expect(worker._recoverOrExit).toHaveBeenCalledWith("websocket close");

    worker._recoverOrExit.mockClear();
    worker.provider = { websocket: {} };
    listeners.close({ code: 1006 });
    expect(worker._recoverOrExit).not.toHaveBeenCalled();
  });

  it("liveness snapshot turns stale past the liveness window but never while replaying", () => {
    now.mockReturnValue(10_000_000 + 10 * 60_000);
    expect(worker.getLivenessSnapshot().stale).toBe(true);
    worker._state = "replaying";
    expect(worker.getLivenessSnapshot().stale).toBe(false);
  });
});

describe("startInBackground (B19)", () => {
  it("returns without waiting for start() and forwards failures to onFatal", async () => {
    let release;
    worker.start = jest.fn(() => new Promise((_, reject) => { release = reject; }));
    const onFatal = jest.fn();

    const p = worker.startInBackground({ onFatal });
    expect(worker.start).toHaveBeenCalled();
    expect(onFatal).not.toHaveBeenCalled(); // still "replaying"; caller was not blocked

    release(new Error("boom"));
    await p;
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });
});
