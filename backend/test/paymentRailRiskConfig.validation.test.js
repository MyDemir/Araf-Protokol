"use strict";

const {
  getPaymentRailRiskConfig,
  validatePaymentRailRiskConfig,
  resolvePaymentRailRiskEntry,
} = require("../scripts/config/paymentRailRiskConfig");

describe("payment rail risk config validation and fallback", () => {
  it("returns validated coarse risk config without user trust semantics", () => {
    const cfg = getPaymentRailRiskConfig();
    expect(cfg.TR.TR_IBAN.riskLevel).toBe("MEDIUM");
    expect(cfg.US.US_ACH.warningKey).toBe("ACH_REVERSAL_AND_SETTLEMENT_DELAY_RISK");
  });

  it("fails closed when riskLevel is invalid", () => {
    expect(() =>
      validatePaymentRailRiskConfig({
        TR: {
          TR_IBAN: {
            riskLevel: "CRITICAL",
            minBondSurchargeBps: 0,
            feeSurchargeBps: 0,
            warningKey: "X",
            enabled: true,
            description: { TR: "x", EN: "y" },
          },
        },
      })
    ).toThrow(/riskLevel invalid/i);
  });

  it("supports EU fallback resolution for SEPA allowlist countries", () => {
    const cfg = getPaymentRailRiskConfig();
    const sepaRisk = resolvePaymentRailRiskEntry("DE", "SEPA_IBAN", cfg);
    expect(sepaRisk).toBeTruthy();
    expect(sepaRisk.riskLevel).toBe("MEDIUM");
  });
});
