"use strict";

const { didScheduledJobSucceed } = require("../scripts/utils/schedulerSuccess");

describe("scheduler success contract helper", () => {
  it("treats explicit false and success:false object as failed", () => {
    expect(didScheduledJobSucceed(false)).toBe(false);
    expect(didScheduledJobSucceed({ success: false })).toBe(false);
  });

  it("treats success:true object and undefined as successful", () => {
    expect(didScheduledJobSucceed({ success: true })).toBe(true);
    expect(didScheduledJobSucceed(undefined)).toBe(true);
  });
});
