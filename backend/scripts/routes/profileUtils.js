"use strict";

const Joi = require("joi");

function normalizeProfileBody(rawBody = {}) {
  const normalizedLegacyIban =
    typeof rawBody.iban === "string" ? rawBody.iban.replace(/\s+/g, "").toUpperCase() : "";
  const rail =
    typeof rawBody.rail === "string" && rawBody.rail.trim()
      ? rawBody.rail.trim().toUpperCase()
      : "";
  const country = typeof rawBody.country === "string" ? rawBody.country.trim().toUpperCase() : "";
  const contactChannel =
    typeof rawBody.contactChannel === "string" ? rawBody.contactChannel.trim().toLowerCase() : "";
  const contactValue =
    typeof rawBody.contactValue === "string" ? rawBody.contactValue.trim().replace(/^@+/, "") : "";

  return {
    rail,
    country,
    contactChannel,
    contactValue,
    bankOwner:
      typeof rawBody.bankOwner === "string"
        ? rawBody.bankOwner.trim().replace(/\s+/g, " ")
        : "",
    iban: normalizedLegacyIban,
    telegram:
      typeof rawBody.telegram === "string"
        ? rawBody.telegram.trim().replace(/^@+/, "")
        : "",
    routingNumber:
      typeof rawBody.routingNumber === "string"
        ? rawBody.routingNumber.replace(/\s+/g, "")
        : "",
    accountNumber:
      typeof rawBody.accountNumber === "string"
        ? rawBody.accountNumber.replace(/\s+/g, "")
        : "",
    accountType:
      typeof rawBody.accountType === "string"
        ? rawBody.accountType.trim().toLowerCase()
        : "",
    bic:
      typeof rawBody.bic === "string"
        ? rawBody.bic.trim().toUpperCase()
        : "",
    bankName:
      typeof rawBody.bankName === "string"
        ? rawBody.bankName.trim()
        : "",
  };
}

const PROFILE_SCHEMA = Joi.object({
  rail: Joi.string().valid("TR_IBAN", "US_ACH", "SEPA_IBAN", "").required(),
  country: Joi.string().max(3).allow("").required(),
  contactChannel: Joi.string().valid("telegram", "email", "phone", "").required(),
  contactValue: Joi.string().max(120).allow("").required(),
  bankOwner: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-ZğüşöçİĞÜŞÖÇ\s]+$/, "geçerli isim karakterleri")
    .allow("")
    .required()
    .messages({
      "string.pattern.name": "Banka sahibi adı sadece harf içerebilir.",
    }),

  iban: Joi.string().allow("").required(),

  telegram: Joi.string()
    .max(50)
    .pattern(/^[a-zA-Z0-9_]{5,}$/, "Telegram kullanıcı adı")
    .allow("")
    .required(),
  routingNumber: Joi.string().allow("").required(),
  accountNumber: Joi.string().allow("").required(),
  accountType: Joi.string().valid("checking", "savings", "").required(),
  bic: Joi.string().allow("").required(),
  bankName: Joi.string().max(120).allow("").required(),
}).custom((value, helpers) => {
  if (!value.rail) return value;

  if (value.rail === "TR_IBAN" && value.iban && !/^TR\d{24}$/.test(value.iban)) {
    return helpers.error("any.invalid", { message: "TR_IBAN için iban TR formatında olmalı." });
  }

  if (value.rail === "US_ACH") {
    const routing = String(value.routingNumber || "").replace(/\s+/g, "");
    const account = String(value.accountNumber || "").replace(/\s+/g, "");
    if (!/^\d{9}$/.test(routing) || !/^\d{4,17}$/.test(account)) {
      return helpers.error("any.invalid", { message: "US_ACH için routing/account number geçersiz." });
    }
  }

  if (value.rail === "SEPA_IBAN" && value.iban && !/^[A-Z]{2}[A-Z0-9]{13,32}$/.test(value.iban)) {
    return helpers.error("any.invalid", { message: "SEPA_IBAN için iban formatı geçersiz." });
  }

  return value;
});

module.exports = {
  normalizeProfileBody,
  PROFILE_SCHEMA,
};
