"use strict";

/**
 * Feedback Model
 *
 * M-04 Fix: Inline schema `routes/feedback.js` içinden buraya taşındı.
 * Mongoose modelleri her zaman `models/` altında tanımlanmalı —
 * route dosyaları sadece HTTP katmanını yönetmeli.
 *
 * AFS-011 Fix: 'category' alanı eklendi.
 * Route dosyası (feedback.js) Joi ile category doğrulaması yapıp
 * Feedback.create({ category: value.category }) ile kaydediyordu.
 * Ancak bu şemada 'category' alanı tanımlı değildi.
 * Mongoose strict mode varsayılan olarak açık olduğu için bu alan
 * sessizce drop ediliyordu — hiçbir feedback kategorisi kaydedilmiyordu.
 */

const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema({
  wallet_address: {
    type:     String,
    required: true,
    lowercase: true,
    match:    /^0x[a-fA-F0-9]{40}$/,
  },
  rating: {
    type:     Number,
    required: true,
    min:      1,
    max:      5,
  },
  comment: {
    type:      String,
    maxlength: 1000,
    default:   "",
  },
  // AFS-011 Fix: Geri bildirim kategorisi — route'daki Joi doğrulamasıyla senkronize
  category: {
    type:     String,
    required: true,
    enum:     ["bug", "suggestion", "ui/ux", "other"],
  },
  created_at: {
    type:    Date,
    default: Date.now,
  },
});

// GDPR: 1 yıl sonra otomatik silinir
feedbackSchema.index(
  { created_at: 1 },
  { expireAfterSeconds: 365 * 24 * 3600 }
);

// Wallet başına saatte max kaç feedback gönderildiğini sorgulamak için
feedbackSchema.index({ wallet_address: 1, created_at: -1 });

module.exports = mongoose.model("Feedback", feedbackSchema);
