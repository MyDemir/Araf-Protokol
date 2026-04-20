"use strict";

const {
  normalizeIdentityValue,
  buildBulkOps,
  detectLogicalCollisions,
} = require("../scripts/migrations/normalizeIdentityFields");

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
    const model = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            { _id: "a", onchain_order_id: "42" },
            { _id: "b", onchain_order_id: "42.0" },
          ]),
        }),
      }),
    };

    const collisions = await detectLogicalCollisions(model, "onchain_order_id");
    expect(collisions).toEqual([{ _id: "42", count: 2 }]);
  });
});
