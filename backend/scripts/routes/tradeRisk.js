"use strict";

const BANK_PROFILE_RISK_THRESHOLD_7D = 3;

function _toSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _buildMirrorContext(lockContext, fallbackUser) {
  const breakdown = fallbackUser?.reputation_breakdown || {};
  const semanticLock = {
    manual_release_count: lockContext?.manual_release_count,
    burn_count: lockContext?.burn_count,
    auto_release_count: lockContext?.auto_release_count,
    mutual_cancel_count: lockContext?.mutual_cancel_count,
    disputed_resolved_count: lockContext?.disputed_resolved_count ?? lockContext?.disputed_but_resolved_count,
    dispute_win_count: lockContext?.dispute_win_count,
    dispute_loss_count: lockContext?.dispute_loss_count,
    risk_points: lockContext?.risk_points,
    last_positive_event_at: lockContext?.last_positive_event_at,
    last_negative_event_at: lockContext?.last_negative_event_at,
  };
  return {
    successRate: lockContext?.success_rate ?? fallbackUser?.reputation_cache?.success_rate ?? null,
    failedDisputes: lockContext?.failed_disputes ?? fallbackUser?.reputation_cache?.failed_disputes ?? null,
    effectiveTier: lockContext?.effective_tier ?? fallbackUser?.reputation_cache?.effective_tier ?? null,
    isBannedMirror: lockContext?.is_banned ?? fallbackUser?.is_banned ?? null,
    bannedUntilMirror: lockContext?.banned_until ?? fallbackUser?.banned_until ?? null,
    consecutiveBansMirror: lockContext?.consecutive_bans ?? fallbackUser?.consecutive_bans ?? null,
    reputation_semantics: {
      manual_release_count:
        semanticLock.manual_release_count ?? breakdown.manual_release_count ?? null,
      burn_count: semanticLock.burn_count ?? breakdown.burn_count ?? null,
      auto_release_count:
        semanticLock.auto_release_count ?? breakdown.auto_release_count ?? null,
      mutual_cancel_count:
        semanticLock.mutual_cancel_count ?? breakdown.mutual_cancel_count ?? null,
      disputed_resolved_count:
        semanticLock.disputed_resolved_count ??
        breakdown.disputed_resolved_count ??
        breakdown.disputed_but_resolved_count ??
        null,
      dispute_win_count:
        semanticLock.dispute_win_count ?? breakdown.dispute_win_count ?? null,
      dispute_loss_count:
        semanticLock.dispute_loss_count ?? breakdown.dispute_loss_count ?? null,
      risk_points:
        semanticLock.risk_points ?? breakdown.risk_points ?? null,
      last_positive_event_at:
        semanticLock.last_positive_event_at ?? breakdown.last_positive_event_at ?? null,
      last_negative_event_at:
        semanticLock.last_negative_event_at ?? breakdown.last_negative_event_at ?? null,
      // [TR] Backward-compatible response alias; canonical alan disputed_resolved_count'tur.
      // [EN] Backward-compatible response alias; canonical field is disputed_resolved_count.
      disputed_but_resolved_count:
        semanticLock.disputed_resolved_count ??
        breakdown.disputed_resolved_count ??
        breakdown.disputed_but_resolved_count ??
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

  // [TR] Bu nesne explainability paketidir (read-only/non-blocking).
  //      İçindeki reputation sayaçları kontrat-otoritatif mirror kaynaklıdır.
  // [EN] This object is an explainability package (read-only/non-blocking).
  //      Reputation counters inside it come from contract-authoritative mirrors.
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
    // [TR] Deprecated flag: compatibility için korunur; yeni consumer'lar authoritative_mirror_semantics'i kullanmalı.
    // [EN] Deprecated compatibility flag; new consumers should use authoritative_mirror_semantics.
    non_authoritative_semantics: false,
    authoritative_mirror_semantics: true,
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
