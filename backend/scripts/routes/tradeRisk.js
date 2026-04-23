"use strict";

const BANK_PROFILE_RISK_THRESHOLD_7D = 3;

function _toSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _buildMirrorContext(lockContext, fallbackUser) {
  const semanticLock = {
    burn_count: lockContext?.burn_count,
    auto_release_count: lockContext?.auto_release_count,
    mutual_cancel_count: lockContext?.mutual_cancel_count,
    disputed_but_resolved_count: lockContext?.disputed_but_resolved_count,
  };
  return {
    successRate: lockContext?.success_rate ?? fallbackUser?.reputation_cache?.success_rate ?? null,
    failedDisputes: lockContext?.failed_disputes ?? fallbackUser?.reputation_cache?.failed_disputes ?? null,
    effectiveTier: lockContext?.effective_tier ?? fallbackUser?.reputation_cache?.effective_tier ?? null,
    isBannedMirror: lockContext?.is_banned ?? fallbackUser?.is_banned ?? null,
    bannedUntilMirror: lockContext?.banned_until ?? fallbackUser?.banned_until ?? null,
    consecutiveBansMirror: lockContext?.consecutive_bans ?? fallbackUser?.consecutive_bans ?? null,
    reputation_semantics: {
      burn_count: semanticLock.burn_count ?? fallbackUser?.reputation_breakdown?.burn_count ?? null,
      auto_release_count:
        semanticLock.auto_release_count ?? fallbackUser?.reputation_breakdown?.auto_release_count ?? null,
      mutual_cancel_count:
        semanticLock.mutual_cancel_count ?? fallbackUser?.reputation_breakdown?.mutual_cancel_count ?? null,
      disputed_but_resolved_count:
        semanticLock.disputed_but_resolved_count ??
        fallbackUser?.reputation_breakdown?.disputed_but_resolved_count ??
        null,
    },
  };
}

function buildTradeHealthSignals(trade, makerUser, takerUser) {
  const payoutSnapshot = trade?.payout_snapshot || {};
  const makerSnapshot = payoutSnapshot?.maker || {};
  const makerReputationContextAtLock = makerSnapshot?.reputation_context_at_lock || {};

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
  const hasProfileVersionAtLock =
    makerSnapshot.profile_version_at_lock !== null &&
    makerSnapshot.profile_version_at_lock !== undefined;

  // [TR] profile_version_at_lock=0 geçerli lock-time değerdir; missing snapshot nedeni sayılmaz.
  // [EN] profile_version_at_lock=0 is a valid lock-time value; do not mark as missing.
  const snapshotMissing =
    payoutSnapshot.is_complete === false ||
    !hasProfileVersionAtLock;
  const isSnapshotComplete = !snapshotMissing;

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
  if (_buildMirrorContext(makerReputationContextAtLock, makerUser).isBannedMirror) {
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
    // [TR] Öncelik lock-time snapshot'tadır; legacy kayıtlar için fallback live mirror.
    // [EN] Prefer lock-time snapshot; fallback to live mirror only for legacy records.
    reputationBanMirrorContext: _buildMirrorContext(makerReputationContextAtLock, makerUser),
  };

  // [TR] "taker" anahtarı compatibility için korunur; payload takerin kendisini değil,
  //      takerin göreceği maker karşı-taraf risk özetidir.
  // [EN] Keep "taker" key for compatibility; payload is maker counterparty summary for taker.
  const takerFacingCounterpartySummary = {
    counterparty: "maker",
    highRiskBankProfile: Boolean(changedAfterLock || frequentRecentChanges),
    changedAfterLock,
    frequentRecentChanges,
    reasonCount: reasons.length,
    makerEffectiveTierMirrorAtLock: makerReputationContextAtLock?.effective_tier ?? null,
    makerFailedDisputesMirrorAtLock: makerReputationContextAtLock?.failed_disputes ?? null,
    makerWasBannedMirrorAtLock: makerReputationContextAtLock?.is_banned ?? null,
    reputation_semantics: _buildMirrorContext(makerReputationContextAtLock, makerUser).reputation_semantics,
  };

  return {
    readOnly: true,
    nonBlocking: true,
    // [TR] Bu katman protokol aksiyonlarını asla kilitlemez.
    // [EN] This layer never blocks protocol actions.
    canBlockProtocolActions: false,
    explainableReasons: reasons,
    maker: makerBreakdown,
    taker: takerFacingCounterpartySummary,
    informational_only: true,
    non_authoritative_semantics: true,
    snapshot: {
      capturedAt: payoutSnapshot?.captured_at || null,
      isComplete: isSnapshotComplete,
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
