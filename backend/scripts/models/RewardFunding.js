"use strict";
const mongoose = require("mongoose");
if (typeof mongoose.Schema !== "function") {
  module.exports = {
    findOneAndUpdate: async () => null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    countDocuments: async () => 0,
  };
} else {

const rewardFundingSchema = new mongoose.Schema(
  {
    tx_hash: { type: String, required: true, index: true },
    block_number: { type: Number, required: true, index: true },
    log_index: { type: Number, required: true },
    funder: { type: String, required: true, lowercase: true, index: true },
    token: { type: String, required: true, lowercase: true, index: true },
    amount: { type: String, required: true },
    target_epoch: { type: String, required: true, index: true },
    product_id: { type: String, default: null, index: true },
    funding_ref: { type: String, default: null },
    type: { type: String, enum: ["GLOBAL", "PRODUCT"], required: true, index: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false }
);
rewardFundingSchema.index({ tx_hash: 1, log_index: 1 }, { unique: true });
module.exports = mongoose.model("RewardFunding", rewardFundingSchema);

}
