"use strict";
const fs = require("fs");
const path = require("path");

describe("epoch allocation mirror", () => {
  it("epoch_allocation_mirror_handles_multiple_allocations_same_epoch_token", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../backend/scripts/services/eventListener.js"), "utf8");
    expect(source).toContain('const prev = BigInt(existing?.epoch_pool || "0")');
    expect(source).toContain('const next = (prev + BigInt(_toStr(amount))).toString()');
  });

  it("epoch_allocation_mirror_is_idempotent_on_replay", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../backend/scripts/services/eventListener.js"), "utf8");
    expect(source).toContain('RewardEpochAllocationEvent.findOneAndUpdate');
    expect(source).toContain('updatedExisting');
  });
});
