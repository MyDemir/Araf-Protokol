"use strict";

const { buildBankProfileRisk } = require("../tradeRisk");

describe("trade bank profile risk", () => {
  test("uses lock-time rolling bank-change counters", () => {
    const risk = buildBankProfileRisk(
      {
        payout_snapshot: {
          maker: {
            rail: "TR_IBAN",
            country: "TR",
            profile_version_at_lock: 3,
            bank_change_count_7d_at_lock: 3,
            bank_change_count_30d_at_lock: 5,
            last_bank_change_at_at_lock: new Date("2026-04-01T00:00:00.000Z"),
          },
        },
      },
      { payout_profile: { fingerprint: { version: 3 } } }
    );

    expect(risk.frequentRecentChanges).toBe(true);
    expect(risk.highRiskBankProfile).toBe(true);
    expect(risk.bankChangeCount7dAtLock).toBe(3);
    expect(risk.bankChangeCount30dAtLock).toBe(5);
  });
});
