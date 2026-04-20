"use strict";

const { parsePositiveTimerMs, MAX_TIMER_MS } = require("../scripts/utils/timeEnv");

describe("time env parser", () => {
  it("falls back for invalid and unsafe values", () => {
    const fallback = 60000;
    const invalid = [undefined, null, "", "0", "-1", "0.5", "NaN", "Infinity", "abc", String(MAX_TIMER_MS + 1)];
    for (const raw of invalid) {
      expect(parsePositiveTimerMs(raw, fallback)).toBe(fallback);
    }
  });

  it("accepts only positive safe integer timer values within Node limit", () => {
    expect(parsePositiveTimerMs("1", 100)).toBe(1);
    expect(parsePositiveTimerMs(String(MAX_TIMER_MS), 100)).toBe(MAX_TIMER_MS);
    expect(parsePositiveTimerMs(2500, 100)).toBe(2500);
  });
});
