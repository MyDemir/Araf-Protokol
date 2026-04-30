"use strict";

const mongoose = require("mongoose");
if (typeof mongoose.Schema !== "function") {
  module.exports = {
    findOneAndUpdate: async () => null,
    find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }),
    countDocuments: async () => 0,
  };
} else {

const revenueEventSchema = new mongoose.Schema(
  {
    tx_hash: { type: String, required: true, index: true },
    block_number: { type: Number, required: true, index: true },
    log_index: { type: Number, required: true },
    token: { type: String, required: true, lowercase: true, index: true },
    amount: { type: String, required: true },
    reward_share: { type: String, default: null },
    treasury_share: { type: String, default: null },
    kind: { type: Number, required: true },
    trade_id: { type: String, default: null, index: true },
    source: { type: String, enum: ["ESCROW_REVENUE"], required: true, index: true },
    created_at_onchain: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false }
);

revenueEventSchema.index({ tx_hash: 1, log_index: 1 }, { unique: true });

module.exports = mongoose.model("RevenueEvent", revenueEventSchema);

}
