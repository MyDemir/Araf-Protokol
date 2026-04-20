"use strict";

const fs = require("fs");
const path = require("path");

describe("identity lookup layer cleanup", () => {
  it("does not keep $expr/$toString compatibility matcher in target files", () => {
    const targets = [
      "../scripts/routes/orders.js",
      "../scripts/routes/trades.js",
      "../scripts/routes/receipts.js",
      "../scripts/services/eventListener.js",
    ];

    for (const rel of targets) {
      const source = fs.readFileSync(path.join(__dirname, rel), "utf8");
      expect(source).not.toContain("$expr: {");
      expect(source).not.toContain("$eq: [{ $toString: `$");
    }
  });
});
