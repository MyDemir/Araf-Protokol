"use strict";

const { __testables: decayTestables } = require("../jobs/reputationDecay");
const { __testables: configTestables } = require("../services/protocolConfig");

describe("safe integer parsing guards", () => {
  test("reputationDecay positive int parser falls back on invalid values", () => {
    expect(decayTestables._parsePositiveInt("abc", 250)).toBe(250);
    expect(decayTestables._parsePositiveInt("0", 250)).toBe(250);
    expect(decayTestables._parsePositiveInt("-5", 250)).toBe(250);
    expect(decayTestables._parsePositiveInt("100", 250)).toBe(100);
  });

  test("protocol config cache ttl parser falls back on invalid values", () => {
    expect(configTestables._parseCacheTtlSeconds("xyz")).toBe(3600);
    expect(configTestables._parseCacheTtlSeconds("0")).toBe(3600);
    expect(configTestables._parseCacheTtlSeconds("-10")).toBe(3600);
    expect(configTestables._parseCacheTtlSeconds("120")).toBe(120);
  });
});
