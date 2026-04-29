"use strict";
const mongoose = require("mongoose");
if (typeof mongoose.Schema !== "function") {
  module.exports = {
    findOneAndUpdate: async () => null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    countDocuments: async () => 0,
  };
} else {

const rewardClaimSchema = new mongoose.Schema(
  {
    tx_hash: { type: String, required: true, index: true },
    block_number: { type: Number, required: true, index: true },
    log_index: { type: Number, required: true },
    epoch: { type: String, required: true, index: true },
    user: { type: String, required: true, lowercase: true, index: true },
    token: { type: String, required: true, lowercase: true, index: true },
    amount: { type: String, required: true },
    user_weight: { type: String, required: true },
    total_weight: { type: String, required: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false }
);
rewardClaimSchema.index({ tx_hash: 1, log_index: 1 }, { unique: true });
module.exports = mongoose.model("RewardClaim", rewardClaimSchema);

}
