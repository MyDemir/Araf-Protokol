"use strict";

const fs = require("fs");
const path = require("path");

const ENFORCEMENT_SURFACES = [
  "../scripts/services/eventListener.js",
  "../scripts/routes/tradeRisk.js",
  "../scripts/routes/trades.js",
  "../scripts/routes/admin.js",
  "../scripts/jobs/reputationDecay.js",
  "../scripts/jobs/statsSnapshot.js",
];

const FORBIDDEN_TOKENS = [
  "referenceTicker",
  "referenceRates",
  "reference-rates",
  "getReferenceTickerPayload",
  "refreshReferenceTicker",
];

describe("reference ticker non-authority coupling guard", () => {
  it("does not couple informational ticker code into enforcement/risk/reputation surfaces", () => {
    ENFORCEMENT_SURFACES.forEach((relPath) => {
      const absPath = path.join(__dirname, relPath);
      expect(fs.existsSync(absPath)).toBe(true);

      const source = fs.readFileSync(absPath, "utf8");

      FORBIDDEN_TOKENS.forEach((token) => {
        // [TR] Bu guard, referans kur kodunun settlement/dispute/risk/reputation
        //      modüllerine yanlışlıkla bağlanmasını regresyon seviyesinde engeller.
        // [EN] This guard blocks accidental coupling of informational rates into
        //      settlement/dispute/risk/reputation enforcement surfaces.
        expect(source).not.toContain(token);
      });
    });
  });
});
