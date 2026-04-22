"use strict";

const { _didScheduledJobSucceed } = require("../scripts/app");

describe("scheduler success contract helper", () => {
  it("treats explicit false and success:false object as failed", () => {
    expect(_didScheduledJobSucceed(false)).toBe(false);
    expect(_didScheduledJobSucceed({ success: false })).toBe(false);
  });

  it("treats success:true object and undefined as successful", () => {
    expect(_didScheduledJobSucceed({ success: true })).toBe(true);
    expect(_didScheduledJobSucceed(undefined)).toBe(true);
  });
});
