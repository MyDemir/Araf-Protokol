"use strict";
const mongoose = require("mongoose");
if (typeof mongoose.Schema !== "function") {
  module.exports = {
    findOneAndUpdate: async () => null,
  };
} else {
  const schema = new mongoose.Schema({
    tx_hash: { type: String, required: true, index: true },
    log_index: { type: Number, required: true, index: true },
    epoch: { type: String, required: true },
    token: { type: String, required: true, lowercase: true },
    amount: { type: String, required: true },
  }, { timestamps: { createdAt: "created_at", updatedAt: false }, versionKey: false });
  schema.index({ tx_hash: 1, log_index: 1 }, { unique: true });
  module.exports = mongoose.model("RewardEpochAllocationEvent", schema);
}
