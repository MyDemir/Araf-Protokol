"use strict";
const fs = require("fs");
const path = require("path");

describe("rewards routes mirror-not-authority safety", () => {
  it("end_to_end_backend_mirror_not_authority", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../backend/scripts/routes/rewards.js"), "utf8");
    expect(source).toContain('source: "WALL_CLOCK_ESTIMATE_NOT_AUTHORITY"');
    expect(source).toContain('source: "ESTIMATE_UNAVAILABLE_USE_ONCHAIN_GETTER"');
    expect(source).toContain('mirror_only: true');
    expect(source).not.toContain("setUserWeight");
    expect(source).not.toContain("setRewardBps");
    expect(source).not.toContain("allocateEpochRewards(");
  });
});
