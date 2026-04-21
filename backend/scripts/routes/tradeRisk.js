"use strict";

const BANK_PROFILE_RISK_THRESHOLD_7D = 3;

function _toSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _buildMirrorContext(user) {
  return {
    successRate: user?.reputation_cache?.success_rate ?? null,
    failedDisputes: user?.reputation_cache?.failed_disputes ?? null,
    effectiveTier: user?.reputation_cache?.effective_tier ?? null,
    isBannedMirror: user?.is_banned ?? null,
    bannedUntilMirror: user?.banned_until ?? null,
    consecutiveBansMirror: user?.consecutive_bans ?? null,
  };
}

function buildTradeHealthSignals(trade, makerUser, takerUser) {
  const payoutSnapshot = trade?.payout_snapshot || {};
  const makerSnapshot = payoutSnapshot?.maker || {};
  const takerSnapshot = payoutSnapshot?.taker || {};

  const profileVersionAtLock = _toSafeNumber(makerSnapshot.profile_version_at_lock, 0);
  const currentProfileVersion = _toSafeNumber(
    makerUser?.payout_profile?.fingerprint?.version ?? makerUser?.profileVersion,
    0
  );
  const profileVersionDrift = Math.max(0, currentProfileVersion - profileVersionAtLock);
  const changedAfterLock = profileVersionAtLock > 0 && profileVersionDrift > 0;

  const bankChangeCount7dAtLock = _toSafeNumber(makerSnapshot.bank_change_count_7d_at_lock, 0);
  const bankChangeCount30dAtLock = _toSafeNumber(makerSnapshot.bank_change_count_30d_at_lock, 0);
  const frequentRecentChanges = bankChangeCount7dAtLock >= BANK_PROFILE_RISK_THRESHOLD_7D;

  const snapshotMissing =
    !payoutSnapshot ||
    payoutSnapshot.is_complete === false ||
    !makerSnapshot.profile_version_at_lock;

  const reasons = [];
  if (changedAfterLock) {
    reasons.push("maker_profile_changed_after_lock");
  }
  if (frequentRecentChanges) {
    reasons.push("maker_frequent_recent_bank_changes_at_lock");
  }
  if (snapshotMissing) {
    reasons.push("partial_or_incomplete_snapshot");
  }
  if (makerUser?.is_banned) {
    reasons.push("maker_ban_mirror_active");
  }

  // [TR] Bu nesne yalnız explainability için üretilir; authority değildir.
  // [EN] This object is explainability-only and non-authoritative.
  const makerBreakdown = {
    railAtLock: makerSnapshot.rail || null,
    countryAtLock: makerSnapshot.country || null,
    profileVersionAtLock,
    currentProfileVersion,
    profileVersionDrift,
    changedAfterLock,
    bankChangeCount7dAtLock,
    bankChangeCount30dAtLock,
    lastBankChangeAtAtLock: makerSnapshot.last_bank_change_at_at_lock || null,
    threshold7d: BANK_PROFILE_RISK_THRESHOLD_7D,
    frequentRecentChanges,
    reputationBanMirrorContext: _buildMirrorContext(makerUser),
  };

  const takerCompactSignal = {
    railAtLock: takerSnapshot.rail || null,
    hasRecentBankProfileChangeMirror: _toSafeNumber(takerUser?.bankChangeCount7d, 0) > 0,
    effectiveTierMirror: takerUser?.reputation_cache?.effective_tier ?? null,
    isBannedMirror: takerUser?.is_banned ?? null,
  };

  return {
    readOnly: true,
    nonBlocking: true,
    // [TR] Bu katman protokol aksiyonlarını asla kilitlemez.
    // [EN] This layer never blocks protocol actions.
    canBlockProtocolActions: false,
    explainableReasons: reasons,
    maker: makerBreakdown,
    taker: takerCompactSignal,
    snapshot: {
      capturedAt: payoutSnapshot?.captured_at || null,
      isComplete: payoutSnapshot?.is_complete !== false,
      incompleteReason: payoutSnapshot?.incomplete_reason || null,
    },
  };
}

function buildBankProfileRisk(trade, makerUser) {
  const healthSignals = buildTradeHealthSignals(trade, makerUser, null);
  const maker = healthSignals.maker || {};

  const highRiskBankProfile = Boolean(
    maker.changedAfterLock || maker.frequentRecentChanges
  );

  // [TR] Geriye uyumluluk: mevcut response sözleşmesi korunur.
  // [EN] Backward compatibility: preserve existing response contract.
  return {
    highRiskBankProfile,
    rail: maker.railAtLock || null,
    country: maker.countryAtLock || null,
    changedAfterLock: Boolean(maker.changedAfterLock),
    frequentRecentChanges: Boolean(maker.frequentRecentChanges),
    threshold7d: BANK_PROFILE_RISK_THRESHOLD_7D,
    profileVersionAtLock: maker.profileVersionAtLock ?? 0,
    currentProfileVersion: maker.currentProfileVersion ?? 0,
    bankChangeCount7dAtLock: maker.bankChangeCount7dAtLock ?? 0,
    bankChangeCount30dAtLock: maker.bankChangeCount30dAtLock ?? 0,
    lastBankChangeAtAtLock: maker.lastBankChangeAtAtLock || null,
  };
}

module.exports = {
  BANK_PROFILE_RISK_THRESHOLD_7D,
  buildBankProfileRisk,
  buildTradeHealthSignals,
};
