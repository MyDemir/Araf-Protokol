"use strict";

const User = require("../scripts/models/User");

describe("User.toPublicProfile exposure guard", () => {
  it("does not expose reputation_breakdown on public profile payload", () => {
    const user = new User({
      wallet_address: "0x1111111111111111111111111111111111111111",
      reputation_breakdown: {
        manual_release_count: 1,
        burn_count: 5,
        auto_release_count: 4,
        mutual_cancel_count: 3,
        disputed_resolved_count: 2,
        dispute_win_count: 1,
        dispute_loss_count: 1,
        risk_points: 7,
      },
    });

    const profile = user.toPublicProfile();
    expect(profile.reputation_cache).toBeDefined();
    expect(profile.reputation_breakdown).toBeUndefined();
  });
});
