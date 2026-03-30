"use strict";

/*
 * Feedback Model
 */

const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema({
  wallet_address: {
    type: String,
    required: true,
    lowercase: true,
    match: /^0x[a-fA-F0-9]{40}$/,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  comment: {
    type: String,
    maxlength: 1000,
    default: "",
  },
  category: {
    type: String,
    required: true,
    enum: ["bug", "suggestion", "ui/ux", "other"],
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

feedbackSchema.index({ created_at: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });
feedbackSchema.index({ wallet_address: 1, created_at: -1 });

module.exports = mongoose.model("Feedback", feedbackSchema);
