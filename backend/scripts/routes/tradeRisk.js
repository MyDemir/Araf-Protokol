"use strict";

const BANK_PROFILE_RISK_THRESHOLD_7D = 3;

function _toSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _buildMirrorContext(lockContext, fallbackUser) {
  const authorityLock = {
    manual_release_count: lockContext?.manual_release_count,
    burn_count: lockContext?.burn_count,
    auto_release_count: lockContext?.auto_release_count,
    mutual_cancel_count: lockContext?.mutual_cancel_count,
    disputed_resolved_count:
      lockContext?.disputed_resolved_count ?? lockContext?.disputed_but_resolved_count,
    dispute_win_count: lockContext?.dispute_win_count,
    dispute_loss_count: lockContext?.dispute_loss_count,
    risk_points: lockContext?.risk_points,
  };
  return {
    successRate: lockContext?.success_rate ?? fallbackUser?.reputation_cache?.success_rate ?? null,
    failedDisputes: lockContext?.failed_disputes ?? fallbackUser?.reputation_cache?.failed_disputes ?? null,
    effectiveTier: lockContext?.effective_tier ?? fallbackUser?.reputation_cache?.effective_tier ?? null,
    isBannedMirror: lockContext?.is_banned ?? fallbackUser?.is_banned ?? null,
    bannedUntilMirror: lockContext?.banned_until ?? fallbackUser?.banned_until ?? null,
    consecutiveBansMirror: lockContext?.consecutive_bans ?? fallbackUser?.consecutive_bans ?? null,
    // [TR] Aşağıdaki sayaçlar kontrat authority'sinin backend aynasıdır; payload paketlemesi bilgilendirme amaçlıdır.
    // [EN] Counters below mirror contract authority; payload packaging is informational-only.
    reputation_authority_counters: {
      manual_release_count:
        authorityLock.manual_release_count ?? fallbackUser?.reputation_breakdown?.manual_release_count ?? null,
      burn_count: authorityLock.burn_count ?? fallbackUser?.reputation_breakdown?.burn_count ?? null,
      auto_release_count:
        authorityLock.auto_release_count ?? fallbackUser?.reputation_breakdown?.auto_release_count ?? null,
      mutual_cancel_count:
        authorityLock.mutual_cancel_count ?? fallbackUser?.reputation_breakdown?.mutual_cancel_count ?? null,
      disputed_resolved_count:
        authorityLock.disputed_resolved_count ??
        fallbackUser?.reputation_breakdown?.disputed_resolved_count ??
        null,
      dispute_win_count:
        authorityLock.dispute_win_count ?? fallbackUser?.reputation_breakdown?.dispute_win_count ?? null,
      dispute_loss_count:
        authorityLock.dispute_loss_count ?? fallbackUser?.reputation_breakdown?.dispute_loss_count ?? null,
      risk_points:
        authorityLock.risk_points ?? fallbackUser?.reputation_breakdown?.risk_points ?? null,
      // [TR] Geriye-uyum: eski isim route seviyesinde maplenir, DB truth çoğaltılmaz.
      // [EN] Backward-compat: legacy alias mapped at route layer only, no duplicated DB truth.
      disputed_but_resolved_count:
        authorityLock.disputed_resolved_count ??
        fallbackUser?.reputation_breakdown?.disputed_resolved_count ??
        null,
    },
    // [TR] Geriye-uyum için eski anahtar korunur (alias).
    // [EN] Preserve legacy key as alias for backward compatibility.
    reputation_semantics: {
      manual_release_count:
        authorityLock.manual_release_count ?? fallbackUser?.reputation_breakdown?.manual_release_count ?? null,
      burn_count: authorityLock.burn_count ?? fallbackUser?.reputation_breakdown?.burn_count ?? null,
      auto_release_count:
        authorityLock.auto_release_count ?? fallbackUser?.reputation_breakdown?.auto_release_count ?? null,
      mutual_cancel_count:
        authorityLock.mutual_cancel_count ?? fallbackUser?.reputation_breakdown?.mutual_cancel_count ?? null,
      disputed_resolved_count:
        authorityLock.disputed_resolved_count ??
        fallbackUser?.reputation_breakdown?.disputed_resolved_count ??
        null,
      dispute_win_count:
        authorityLock.dispute_win_count ?? fallbackUser?.reputation_breakdown?.dispute_win_count ?? null,
      dispute_loss_count:
        authorityLock.dispute_loss_count ?? fallbackUser?.reputation_breakdown?.dispute_loss_count ?? null,
      risk_points:
        authorityLock.risk_points ?? fallbackUser?.reputation_breakdown?.risk_points ?? null,
      disputed_but_resolved_count:
        authorityLock.disputed_resolved_count ??
        fallbackUser?.reputation_breakdown?.disputed_resolved_count ??
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
    reputation_authority_counters:
      _buildMirrorContext(makerReputationContextAtLock, makerUser).reputation_authority_counters,
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
    authoritative_counter_mirror: true,
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
