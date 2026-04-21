"use strict";

const { buildBankProfileRisk, buildTradeHealthSignals } = require("../scripts/routes/tradeRisk");

function makeBaseTrade(overrides = {}) {
  return {
    payout_snapshot: {
      is_complete: true,
      incomplete_reason: null,
      captured_at: new Date("2026-04-01T00:00:00Z"),
      maker: {
        rail: "TR_IBAN",
        country: "TR",
        profile_version_at_lock: 2,
        bank_change_count_7d_at_lock: 1,
        bank_change_count_30d_at_lock: 2,
        last_bank_change_at_at_lock: new Date("2026-03-31T00:00:00Z"),
      },
      taker: {
        rail: "SEPA_IBAN",
        country: "DE",
      },
    },
    ...overrides,
  };
}

describe("tradeRisk read-model regression", () => {
  it("changed-after-lock durumunu maker breakdown + geriye uyumlu bank_profile_risk içinde taşır", () => {
    const trade = makeBaseTrade();
    const makerUser = {
      payout_profile: { fingerprint: { version: 4 } },
      profileVersion: 4,
      bankChangeCount7d: 0,
      reputation_cache: { effective_tier: 2, success_rate: 91, failed_disputes: 3 },
      is_banned: false,
    };
    const takerUser = { bankChangeCount7d: 0, reputation_cache: { effective_tier: 3 }, is_banned: false };

    const health = buildTradeHealthSignals(trade, makerUser, takerUser);
    const legacy = buildBankProfileRisk(trade, makerUser);

    expect(health.maker.changedAfterLock).toBe(true);
    expect(health.explainableReasons).toContain("maker_profile_changed_after_lock");
    expect(legacy.changedAfterLock).toBe(true);
    expect(legacy.highRiskBankProfile).toBe(true);
  });

  it("frequent-recent-changes sinyalini üretir ve reason listesine yazar", () => {
    const trade = makeBaseTrade({
      payout_snapshot: {
        is_complete: true,
        maker: {
          profile_version_at_lock: 1,
          bank_change_count_7d_at_lock: 3,
          bank_change_count_30d_at_lock: 5,
        },
      },
    });

    const health = buildTradeHealthSignals(trade, { profileVersion: 1 }, { bankChangeCount7d: 0 });
    const legacy = buildBankProfileRisk(trade, { profileVersion: 1 });

    expect(health.maker.frequentRecentChanges).toBe(true);
    expect(health.explainableReasons).toContain("maker_frequent_recent_bank_changes_at_lock");
    expect(legacy.frequentRecentChanges).toBe(true);
  });

  it("false-authority üretmez: read-only/non-blocking contractı açıkça taşır", () => {
    const trade = makeBaseTrade();
    const health = buildTradeHealthSignals(trade, { profileVersion: 2 }, { profileVersion: 1 });

    expect(health.readOnly).toBe(true);
    expect(health.nonBlocking).toBe(true);
    expect(health.canBlockProtocolActions).toBe(false);
  });

  it("partial veya eksik snapshot durumunu reason listesinde görünür kılar", () => {
    const trade = makeBaseTrade({
      payout_snapshot: {
        is_complete: false,
        incomplete_reason: "maker_payout_profile_missing",
        maker: {},
        taker: {},
      },
    });

    const health = buildTradeHealthSignals(trade, { profileVersion: 2 }, { profileVersion: 1 });

    expect(health.snapshot.isComplete).toBe(false);
    expect(health.explainableReasons).toContain("partial_or_incomplete_snapshot");
    expect(health.snapshot.incompleteReason).toBe("maker_payout_profile_missing");
  });
});
