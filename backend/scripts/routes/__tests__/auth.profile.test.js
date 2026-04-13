"use strict";

const { normalizeProfileBody, PROFILE_SCHEMA } = require("../profileUtils");

describe("auth payout profile normalization and schema", () => {
  test("normalize does not fallback empty rail to TR_IBAN", () => {
    const normalized = normalizeProfileBody({ iban: "TR12 3456 7890" });
    expect(normalized.rail).toBe("");
  });

  test("schema rejects unsupported rails", () => {
    const { error } = PROFILE_SCHEMA.validate({
      rail: "UK_FPS",
      country: "GB",
      contactChannel: "",
      contactValue: "",
      bankOwner: "",
      iban: "",
      telegram: "",
      routingNumber: "",
      accountNumber: "",
      accountType: "",
      bic: "",
      bankName: "",
    });

    expect(error).toBeTruthy();
  });
});
