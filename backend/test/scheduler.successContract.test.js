"use strict";

const { didScheduledJobSucceed } = require("../scripts/utils/schedulerSuccess");

describe("scheduler success contract helper", () => {
  it("treats explicit true and success:true object as successful", () => {
    expect(didScheduledJobSucceed(true)).toBe(true);
    expect(didScheduledJobSucceed({ success: true })).toBe(true);
  });

  it("treats explicit false and success:false object as failed", () => {
    expect(didScheduledJobSucceed(false)).toBe(false);
    expect(didScheduledJobSucceed({ success: false })).toBe(false);
  });

  it("fails closed for undefined/null/Error/empty object/malformed object", () => {
    expect(didScheduledJobSucceed(undefined)).toBe(false);
    expect(didScheduledJobSucceed(null)).toBe(false);
    expect(didScheduledJobSucceed(new Error("boom"))).toBe(false);
    expect(didScheduledJobSucceed({})).toBe(false);
    expect(didScheduledJobSucceed({ ok: true })).toBe(false);
    expect(didScheduledJobSucceed({ success: "true" })).toBe(false);
  });

  it("schedulerState lastRunAt only updates on successful contract", () => {
    const schedulerState = { reputationDecayLastRunAt: null };

    const apply = (result) => {
      if (didScheduledJobSucceed(result)) {
        schedulerState.reputationDecayLastRunAt = "updated";
      }
    };

    apply(undefined);
    expect(schedulerState.reputationDecayLastRunAt).toBeNull();
    apply({ success: false });
    expect(schedulerState.reputationDecayLastRunAt).toBeNull();
    apply(true);
    expect(schedulerState.reputationDecayLastRunAt).toBe("updated");
  });

  it("failed job contract logs warning and does not update lastRunAt", () => {
    const schedulerState = { statsSnapshotLastRunAt: null };
    const warn = jest.fn();
    const result = { ok: true };

    const isSuccess = didScheduledJobSucceed(result);
    if (isSuccess) {
      schedulerState.statsSnapshotLastRunAt = "updated";
    } else {
      warn("[Scheduler] statsSnapshot completed with unsuccessful result contract.");
    }

    expect(isSuccess).toBe(false);
    expect(schedulerState.statsSnapshotLastRunAt).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
