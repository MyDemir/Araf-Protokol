"use strict";

// B23: cumulative string volumes come from $group aggregates; no full-collection find().

const { Types } = require("mongoose");

function load() {
  const Trade = {
    find: jest.fn(() => { throw new Error("Trade.find must not be used (loads every trade into memory)"); }),
    countDocuments: jest.fn().mockResolvedValue(3),
    aggregate: jest.fn(async (pipeline) => {
      const group = pipeline.find((st) => st.$group)?.$group || {};
      const match = pipeline[0].$match || {};
      if (group._id === null && group.total) {
        if (match.status === "RESOLVED") return [{ _id: null, total: Types.Decimal128.fromString("123456789012345678901234567890") }];
        if (match.status === "BURNED") return [{ _id: null, total: Types.Decimal128.fromString("42") }];
        return [{ _id: null, total: Types.Decimal128.fromString("999999999999999999999999") }];
      }
      return [];
    }),
  };
  const Order = { countDocuments: jest.fn().mockResolvedValue(0) };
  let mod;
  jest.isolateModules(() => {
    jest.doMock("../../backend/scripts/models/Trade", () => Trade);
    jest.doMock("../../backend/scripts/models/Order", () => Order);
    jest.doMock("../../backend/scripts/models/HistoricalStat", () => ({}));
    jest.doMock("../../backend/scripts/utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
    jest.doMock("../../backend/scripts/services/protocolConfig", () => ({ getConfig: () => ({ tokenMap: {} }) }));
    mod = require("../../backend/scripts/jobs/statsSnapshot");
  });
  return { mod, Trade };
}

describe("statsSnapshot aggregate sums (B23)", () => {
  afterEach(() => jest.resetModules());

  test("string volumes are exact beyond 2^53 and never loaded via Trade.find", async () => {
    const { mod, Trade } = load();
    const stats = await mod.computeCurrentStats();
    expect(Trade.find).not.toHaveBeenCalled();
    expect(stats.total_volume_usdt_str).toBe("123456789012345678901234567890");
    expect(stats.executed_volume_usdt_str).toBe("999999999999999999999999");
    expect(stats.burned_bonds_usdt_str).toBe("42");
  });

  test("pipeline converts strings to Decimal128 with safe onError and sums decay + burned for BURNED", async () => {
    const { mod, Trade } = load();
    await mod.computeCurrentStats();
    const pipelines = Trade.aggregate.mock.calls.map((c) => c[0]);
    const burned = pipelines.find((p) => p[0].$match?.status === "BURNED");
    const expr = burned[1].$group.total.$sum;
    expect(expr.$add).toHaveLength(2);
    expect(expr.$add[0].$convert).toMatchObject({ to: "decimal", onError: 0, onNull: 0 });
  });

  test("decimal128 text normalisation", () => {
    const { mod } = load();
    expect(mod._decimal128ToIntString("123")).toBe("123");
    expect(mod._decimal128ToIntString("1.5E+3")).toBe("1500");
    expect(mod._decimal128ToIntString("12E+2")).toBe("1200");
    expect(mod._decimal128ToIntString("-7")).toBe("-7");
    expect(mod._decimal128ToIntString(null)).toBe("0");
    expect(mod._decimal128ToIntString("garbage")).toBe("0");
  });
});
