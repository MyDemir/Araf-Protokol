"use strict";

const BANK_PROFILE_RISK_THRESHOLD_7D = 3;

function buildBankProfileRisk(trade, makerUser) {
  const payoutSnapshot = trade?.payout_snapshot?.maker || {};

  const profileVersionAtLock = Number(
    payoutSnapshot.profile_version_at_lock ?? 0
  );
  const currentProfileVersion = Number(
    makerUser?.payout_profile?.fingerprint?.version ?? makerUser?.profileVersion ?? 0
  );
  const changedAfterLock =
    profileVersionAtLock > 0 && currentProfileVersion > profileVersionAtLock;
  const bankChangeCount7dAtLock = Number(
    payoutSnapshot.bank_change_count_7d_at_lock ?? 0
  );
  const bankChangeCount30dAtLock = Number(
    payoutSnapshot.bank_change_count_30d_at_lock ?? 0
  );
  const lastBankChangeAtAtLock = payoutSnapshot.last_bank_change_at_at_lock || null;
  const frequentRecentChanges = bankChangeCount7dAtLock >= BANK_PROFILE_RISK_THRESHOLD_7D;
  const highRiskBankProfile = changedAfterLock || frequentRecentChanges;

  return {
    highRiskBankProfile,
    rail: payoutSnapshot.rail || null,
    country: payoutSnapshot.country || null,
    changedAfterLock,
    frequentRecentChanges,
    threshold7d: BANK_PROFILE_RISK_THRESHOLD_7D,
    profileVersionAtLock,
    currentProfileVersion,
    bankChangeCount7dAtLock,
    bankChangeCount30dAtLock,
    lastBankChangeAtAtLock,
  };
}

module.exports = {
  BANK_PROFILE_RISK_THRESHOLD_7D,
  buildBankProfileRisk,
};
