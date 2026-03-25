"use strict";

const fs = require("fs");
const path = require("path");

describe("Security hygiene hardening for auth/receipt/pii flows", () => {
  test("receipt upload route enforces content-signature validation and robust temp cleanup", () => {
    const receiptsRoute = fs.readFileSync(path.join(__dirname, "../routes/receipts.js"), "utf8");

    expect(receiptsRoute).toContain("validateFileMagicBytes");
    expect(receiptsRoute).toContain("Dosya içeriği bildirilen MIME tipiyle eşleşmiyor");
    expect(receiptsRoute).toContain("finally");
    expect(receiptsRoute).toContain("await fsp.unlink(tempFilePath)");
  });

  test("pii route validates tradeId format and marks decrypted response as no-store", () => {
    const piiRoute = fs.readFileSync(path.join(__dirname, "../routes/pii.js"), "utf8");
    const authMiddleware = fs.readFileSync(path.join(__dirname, "../middleware/auth.js"), "utf8");

    expect(piiRoute).toContain("Geçersiz tradeId formatı.");
    expect(piiRoute).toContain('res.set("Cache-Control", "no-store, max-age=0")');
    expect(authMiddleware).toContain("Geçersiz tradeId formatı.");
  });

  test("chargeback ack remains audit-only and does not become a protocol veto", () => {
    const appSource = fs.readFileSync(path.join(__dirname, "../../..", "frontend/src/App.jsx"), "utf8");
    const tradesRoute = fs.readFileSync(path.join(__dirname, "../routes/trades.js"), "utf8");

    expect(appSource).toContain("Backend chargeback-ack log hatası");
    expect(appSource).toContain("await releaseFunds(BigInt(activeTrade.onchainId));");
    expect(tradesRoute).toContain("yalnızca audit/log içindir");
  });
});

