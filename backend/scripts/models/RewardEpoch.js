"use strict";
const mongoose = require("mongoose");
if (typeof mongoose.Schema !== "function") {
  module.exports = {
    findOneAndUpdate: async () => null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    countDocuments: async () => 0,
  };
} else {

const rewardEpochSchema = new mongoose.Schema(
  {
    epoch: { type: String, required: true, index: true },
    token: { type: String, required: true, lowercase: true, index: true },
    epoch_pool: { type: String, required: true, default: "0" },
    total_weight: { type: String, default: null },
    indexed_at: { type: Date, default: null },
    status: { type: String, enum: ["OPEN", "CLAIMABLE", "CLOSED"], default: "OPEN", index: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false }
);
rewardEpochSchema.index({ epoch: 1, token: 1 }, { unique: true });
module.exports = mongoose.model("RewardEpoch", rewardEpochSchema);

}
