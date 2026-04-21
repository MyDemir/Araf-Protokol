"use strict";

const {
  normalizeIdentityValue,
  buildBulkOps,
  resolveBatchSize,
  detectLogicalCollisions,
  migrateFieldInBatches,
} = require("../scripts/migrations/normalizeIdentityFields");

function makeCursorQuery(docs) {
  return {
    cursor: jest.fn(() => ({
      async *[Symbol.asyncIterator]() {
        for (const doc of docs) yield doc;
      },
    })),
  };
}

describe("identity normalization migration helpers", () => {
  it("normalizes numeric legacy IDs to canonical strings", () => {
    expect(normalizeIdentityValue(42)).toBe("42");
    expect(normalizeIdentityValue("900719925474099312345")).toBe("900719925474099312345");
    expect(normalizeIdentityValue("42.0")).toBe("42");
    expect(normalizeIdentityValue("42.000")).toBe("42");
  });

  it("keeps parent zero semantics as null when configured", () => {
    expect(normalizeIdentityValue(0, { allowZero: true, toNullOnZero: true })).toBeNull();
    expect(normalizeIdentityValue("0", { allowZero: true, toNullOnZero: true })).toBeNull();
  });

  it("rejects invalid or unsafe identity formats", () => {
    expect(() => normalizeIdentityValue("-1")).toThrow(/IDENTITY_NEGATIVE/);
    expect(() => normalizeIdentityValue("1.5")).toThrow(/IDENTITY_NOT_INTEGER/);
    expect(() => normalizeIdentityValue("abc")).toThrow(/IDENTITY_NOT_NUMERIC/);
  });

  it("is idempotent: already normalized docs do not produce updates", () => {
    const docs = [{ _id: "a", onchain_order_id: "123" }];
    const plan = buildBulkOps(docs, "onchain_order_id");
    expect(plan.changed).toBe(0);
    expect(plan.ops).toHaveLength(0);
  });

  it("creates update ops for numeric legacy docs", () => {
    const docs = [
      { _id: "a", onchain_order_id: 123 },
      { _id: "b", onchain_order_id: "123" },
    ];
    const plan = buildBulkOps(docs, "onchain_order_id");
    expect(plan.changed).toBe(1);
    expect(plan.ops[0].updateOne.update.$set.onchain_order_id).toBe("123");
  });

  it("detects collisions after decimal canonicalization in preflight", async () => {
    const query = makeCursorQuery([
      { _id: "a", onchain_order_id: "42" },
      { _id: "b", onchain_order_id: "42.0" },
    ]);
    const model = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue(query) }),
      }),
    };

    const collisions = await detectLogicalCollisions(model, "onchain_order_id", { batchSize: 2 });
    expect(collisions).toEqual([{ _id: "42", count: 2 }]);
    expect(query.cursor).toHaveBeenCalledWith({ batchSize: 2 });
  });

  it("migrates in bounded chunks without full collection materialization", async () => {
    const docs = [
      { _id: "a", onchain_order_id: 1 },
      { _id: "b", onchain_order_id: 2 },
      { _id: "c", onchain_order_id: 3 },
    ];
    const query = makeCursorQuery(docs);
    const bulkWrite = jest.fn().mockResolvedValue({});
    const model = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue(query) }),
      }),
      bulkWrite,
    };

    const result = await migrateFieldInBatches(model, {
      field: "onchain_order_id",
      findFilter: { onchain_order_id: { $type: ["int"] } },
      normalizeOptions: { allowZero: false },
      dryRun: false,
      batchSize: 2,
    });

    expect(query.cursor).toHaveBeenCalledWith({ batchSize: 2 });
    expect(result).toEqual({ numericFound: 3, willUpdate: 3 });
    expect(bulkWrite).toHaveBeenCalledTimes(2);
    expect(bulkWrite.mock.calls[0][0]).toHaveLength(2);
    expect(bulkWrite.mock.calls[1][0]).toHaveLength(1);
  });

  it("keeps parent zero/null semantics during chunked migration", async () => {
    const docs = [{ _id: "a", parent_order_id: 0 }];
    const query = makeCursorQuery(docs);
    const bulkWrite = jest.fn().mockResolvedValue({});
    const model = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue(query) }),
      }),
      bulkWrite,
    };

    const result = await migrateFieldInBatches(model, {
      field: "parent_order_id",
      findFilter: { parent_order_id: { $type: ["int"] } },
      normalizeOptions: { allowZero: true, toNullOnZero: true },
      dryRun: false,
      batchSize: 1,
    });

    expect(result).toEqual({ numericFound: 1, willUpdate: 1 });
    expect(bulkWrite.mock.calls[0][0][0].updateOne.update.$set.parent_order_id).toBeNull();
  });

  it("resolves invalid batch size to safe default", () => {
    expect(resolveBatchSize(undefined)).toBe(1000);
    expect(resolveBatchSize("0")).toBe(1000);
    expect(resolveBatchSize("abc")).toBe(1000);
    expect(resolveBatchSize("256")).toBe(256);
  });
});
