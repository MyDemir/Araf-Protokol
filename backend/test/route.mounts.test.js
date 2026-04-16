"use strict";

const fs = require("fs");
const path = require("path");

describe("backend route mount consistency", () => {
  it("app.js mounts all UX-critical routes under /api", () => {
    const appSource = fs.readFileSync(path.join(__dirname, "../scripts/app.js"), "utf8");

    [
      'app.use("/api/logs", logRoutes);',
      'app.use("/api/auth", authRoutes);',
      'app.use("/api/orders", orderRoutes);',
      'app.use("/api/trades", tradeRoutes);',
      'app.use("/api/pii", piiRoutes);',
      'app.use("/api/stats", statsRoutes);',
      'app.use("/api/receipts", receiptRoutes);',
    ].forEach((line) => {
      expect(appSource).toContain(line);
    });
  });
});
