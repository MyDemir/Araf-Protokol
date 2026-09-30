// SPDX-License-Identifier: Apache-2.0
/*
 * Copyright 2026 Araf Protocol
 *
 * Licensed under the Apache License, Version 2.0
 * http://www.apache.org/licenses/LICENSE-2.0
 */

pragma solidity ^0.8.24;

import "./ArafErrors.sol";

/**
 * @title  ArafReputationLib
 * @notice ArafEscrow'un reputation motoru: sonuç kaydı, risk puanı, ban/tier tavanı, politika ayarları.
 * @notice Reputation engine of ArafEscrow: outcome recording, risk points, ban/tier ceiling, policy settings.
 * @dev    [TR] External library: fonksiyonlar escrow'dan DELEGATECALL ile çalışır; storage escrow'undur, event'ler
 *         escrow adresinden aynı imzalarla yayınlanır. Adres deploy anında bytecode'a linklenir (değiştirilemez;
 *         yeni yetki, upgrade yolu ya da harici güven varsayımı yoktur). State değiştiren fonksiyonlar Solidity'nin
 *         library call-protection'ı sayesinde doğrudan CALL ile çağrılamaz. Yetki kontrolü (onlyOwner) escrow'da kalır.
 *         Yalnız EIP-170 (24.576 B) bütçesi için ayrılmıştır; davranış escrow içindeki eski internal koddur.
 * @dev    [EN] External library executed via DELEGATECALL: storage belongs to the escrow and events are emitted
 *         from the escrow address with identical signatures. Its address is linked into the escrow bytecode at
 *         deploy time (immutable; no new authority, upgrade path or external trust assumption). State-changing
 *         functions cannot be CALLed directly (library call protection). Access control stays in the escrow.
 */
library ArafReputationLib {
    struct Reputation {
        uint64 successfulTrades;
        uint32 failedDisputes;
        uint64 bannedUntil;
        uint16 consecutiveBans;
        uint32 manualReleaseCount;
        uint32 autoReleaseCount;
        uint32 mutualCancelCount;
        uint32 disputedResolvedCount;
        uint32 burnCount;
        uint32 disputeWinCount;
        uint32 disputeLossCount;
        uint32 partialSettlementCount;
        uint32 riskPoints;
        uint64 lastPositiveEventAt;
        uint64 lastNegativeEventAt;
    }

    // [TR] Reputation ile ilgili tüm escrow state'i tek storage kökünde; library'ye tek pointer olarak geçer.
    // [EN] All reputation-related escrow state under one storage root, passed to the library as one pointer.
    struct Store {
        mapping(address => Reputation) reputation;
        mapping(address => uint8) maxAllowedTier;
        mapping(address => bool) hasTierPenalty;
        mapping(address => uint256) firstSuccessfulTradeAt;
        uint256 cleanPeriod;
        uint32 manualReleaseRewardPts;
        uint32 autoReleasePenaltyPts;
        uint32 disputeWinRewardPts;
        uint32 disputeLossPenaltyPts;
        uint32 burnPenaltyPts;
        uint32 mutualCancelPenaltyPts;
        uint32 baseBanDuration;
        uint32 banRiskPointsThreshold;
        uint32[5] tierMinSuccessfulTrades;
        uint32[5] tierMaxRiskPoints;
    }

    // [TR] Escrow terminal yollarının reputation sınıfları. [EN] Reputation classes of escrow terminal paths.
    enum Outcome {
        MANUAL_RELEASE,
        AUTO_RELEASE,
        MUTUAL_CANCEL,
        DISPUTED_RELEASE,
        BURN,
        PARTIAL_SETTLEMENT,
        PAYMENT_WINDOW_EXPIRED
    }

    uint256 private constant MIN_ACTIVE_PERIOD = 15 days;
    uint256 private constant MAX_REPUTATION_DECAY_PERIOD = 365 days;
    uint256 private constant MAX_BAN_DURATION = 365 days;

    // [TR] ArafEscrow'daki bildirimlerle birebir aynı imzalar (topic0 değişmez).
    // [EN] Signatures identical to the ArafEscrow declarations (same topic0).
    event ReputationUpdated(
        address indexed wallet,
        uint256 successful,
        uint256 failed,
        uint256 bannedUntil,
        uint8 effectiveTier,
        uint256 manualReleaseCount,
        uint256 autoReleaseCount,
        uint256 mutualCancelCount,
        uint256 disputedResolvedCount,
        uint256 burnCount,
        uint256 disputeWinCount,
        uint256 disputeLossCount,
        uint256 partialSettlementCount,
        uint256 riskPoints,
        uint256 lastPositiveEventAt,
        uint256 lastNegativeEventAt
    );
    event ReputationPolicyUpdated(
        uint256 cleanPeriod,
        uint256 manualReleaseRewardPts,
        uint256 autoReleasePenaltyPts,
        uint256 disputeWinRewardPts,
        uint256 disputeLossPenaltyPts,
        uint256 burnPenaltyPts,
        uint256 mutualCancelPenaltyPts,
        uint256 baseBanDuration,
        uint256 banRiskPointsThreshold
    );
    event ReputationTierThresholdsUpdated(
        uint32[5] minSuccessfulTrades,
        uint32[5] maxRiskPoints
    );

    // ═══════════════════════════════════════════════════
    //  SONUÇ KAYDI / OUTCOME RECORDING
    // ═══════════════════════════════════════════════════

    /**
     * @notice Terminal trade sonucunu iki tarafın reputation'ına yazar ve ReputationUpdated yayınlar (maker, sonra taker).
     *         `qualifies` false ise (mikro işlem) pozitif sinyaller yok sayılır; cezalar her büyüklükte uygulanır.
     *         PAYMENT_WINDOW_EXPIRED yalnız taker'ı etkiler.
     * @notice Records a terminal outcome for both parties and emits ReputationUpdated (maker, then taker).
     *         Positive signals are ignored for non-qualifying (micro) trades; penalties apply at any size.
     */
    function recordOutcome(Store storage s, Outcome _kind, address _maker, address _taker, bool _qualifies) external {
        Reputation storage m = s.reputation[_maker];
        Reputation storage t = s.reputation[_taker];

        if (_kind == Outcome.PAYMENT_WINDOW_EXPIRED) {
            t.failedDisputes++;
            _applyNegativeSignal(s, _taker, t, s.autoReleasePenaltyPts);
            _emitReputationUpdated(s, _taker, t);
            return;
        }

        if (_kind == Outcome.MANUAL_RELEASE) {
            m.manualReleaseCount++;
            t.manualReleaseCount++;
            uint32 pts = s.manualReleaseRewardPts;
            _applyPositiveSignal(s, _maker, m, pts, _qualifies);
            _applyPositiveSignal(s, _taker, t, pts, _qualifies);
        } else if (_kind == Outcome.AUTO_RELEASE) {
            m.autoReleaseCount++;
            t.autoReleaseCount++;
            m.failedDisputes++;
            _applyNegativeSignal(s, _maker, m, s.autoReleasePenaltyPts);
            _applyPositiveSignal(s, _taker, t, s.manualReleaseRewardPts, _qualifies);
        } else if (_kind == Outcome.MUTUAL_CANCEL) {
            m.mutualCancelCount++;
            t.mutualCancelCount++;
            uint32 pts = s.mutualCancelPenaltyPts;
            _applyNegativeSignal(s, _maker, m, pts);
            _applyNegativeSignal(s, _taker, t, pts);
        } else if (_kind == Outcome.DISPUTED_RELEASE) {
            // [TR] CHALLENGED→RESOLVED (maker serbest bıraktı): maker'ın ödeme almadım iddiası başarısız sayılır.
            // [EN] CHALLENGED→RESOLVED (maker released): the maker's non-payment claim counts as lost.
            m.disputedResolvedCount++;
            t.disputedResolvedCount++;
            t.disputeWinCount++;
            m.disputeLossCount++;
            m.failedDisputes++;
            _applyPositiveSignal(s, _taker, t, s.disputeWinRewardPts, _qualifies);
            _applyNegativeSignal(s, _maker, m, s.disputeLossPenaltyPts);
        } else if (_kind == Outcome.BURN) {
            m.burnCount++;
            t.burnCount++;
            m.failedDisputes++;
            t.failedDisputes++;
            uint32 pts = s.burnPenaltyPts;
            _applyNegativeSignal(s, _maker, m, pts);
            _applyNegativeSignal(s, _taker, t, pts);
        } else {
            // PARTIAL_SETTLEMENT
            // [TR] Ceza semantiği yok; sıfır puanlı pozitif sinyal yalnız firstSuccessfulTradeAt/lastPositiveEventAt'i tutarlı başlatır.
            // [EN] Non-penal; the zero-point positive signal only keeps firstSuccessfulTradeAt/lastPositiveEventAt consistent.
            m.partialSettlementCount++;
            t.partialSettlementCount++;
            _applyPositiveSignal(s, _maker, m, 0, _qualifies);
            _applyPositiveSignal(s, _taker, t, 0, _qualifies);
        }

        _emitReputationUpdated(s, _maker, m);
        _emitReputationUpdated(s, _taker, t);
    }

    /**
     * @notice Temiz dönem sonrası ardışık ban geçmişini sıfırlar (kontrollü unutma kuralı).
     * @notice Resets consecutive ban history after a clean period (controlled forgetting rule).
     */
    function decayReputation(Store storage s, address _wallet) external {
        Reputation storage rep = s.reputation[_wallet];
        if (rep.bannedUntil == 0) revert IArafEscrowErrors.NoPriorBanHistory();
        if (block.timestamp <= rep.bannedUntil + s.cleanPeriod) revert IArafEscrowErrors.CleanPeriodNotElapsed();
        if (rep.consecutiveBans == 0) revert IArafEscrowErrors.NoBansToReset();

        rep.consecutiveBans = 0;
        rep.riskPoints = 0;
        s.hasTierPenalty[_wallet] = false;
        s.maxAllowedTier[_wallet] = 4;
        _emitReputationUpdated(s, _wallet, rep);
    }

    // ═══════════════════════════════════════════════════
    //  POLİTİKA / POLICY (yetki kontrolü escrow'da / access control lives in the escrow)
    // ═══════════════════════════════════════════════════

    function setReputationPolicy(
        Store storage s,
        uint256 _cleanPeriod,
        uint32 _manualReleaseRewardPts,
        uint32 _autoReleasePenaltyPts,
        uint32 _disputeWinRewardPts,
        uint32 _disputeLossPenaltyPts,
        uint32 _burnPenaltyPts,
        uint32 _mutualCancelPenaltyPts,
        uint32 _baseBanDuration,
        uint32 _banRiskPointsThreshold
    ) external {
        if (_cleanPeriod < 7 days) revert IArafEscrowErrors.InvalidState();
        if (_cleanPeriod > MAX_REPUTATION_DECAY_PERIOD) revert IArafEscrowErrors.DecayTooHigh();
        if (_baseBanDuration == 0) revert IArafEscrowErrors.ZeroAmount();
        if (_baseBanDuration > MAX_BAN_DURATION) revert IArafEscrowErrors.BanTooHigh();
        if (_banRiskPointsThreshold == 0) revert IArafEscrowErrors.ZeroAmount();
        if (_banRiskPointsThreshold > s.tierMaxRiskPoints[0]) revert IArafEscrowErrors.InvalidTier();
        // [TR] Ödül/ceza delta'ları ban eşiğini aşmamalı. [EN] Reward/penalty deltas must stay within ban threshold.
        if (
            _manualReleaseRewardPts > _banRiskPointsThreshold ||
            _autoReleasePenaltyPts > _banRiskPointsThreshold ||
            _disputeWinRewardPts > _banRiskPointsThreshold ||
            _disputeLossPenaltyPts > _banRiskPointsThreshold ||
            _burnPenaltyPts > _banRiskPointsThreshold ||
            _mutualCancelPenaltyPts > _banRiskPointsThreshold
        ) revert IArafEscrowErrors.InvalidState();

        s.cleanPeriod = _cleanPeriod;
        s.manualReleaseRewardPts = _manualReleaseRewardPts;
        s.autoReleasePenaltyPts = _autoReleasePenaltyPts;
        s.disputeWinRewardPts = _disputeWinRewardPts;
        s.disputeLossPenaltyPts = _disputeLossPenaltyPts;
        s.burnPenaltyPts = _burnPenaltyPts;
        s.mutualCancelPenaltyPts = _mutualCancelPenaltyPts;
        s.baseBanDuration = _baseBanDuration;
        s.banRiskPointsThreshold = _banRiskPointsThreshold;

        emit ReputationPolicyUpdated(
            _cleanPeriod,
            _manualReleaseRewardPts,
            _autoReleasePenaltyPts,
            _disputeWinRewardPts,
            _disputeLossPenaltyPts,
            _burnPenaltyPts,
            _mutualCancelPenaltyPts,
            _baseBanDuration,
            _banRiskPointsThreshold
        );
    }

    function setReputationTierThresholds(
        Store storage s,
        uint32[5] calldata _minSuccessfulTrades,
        uint32[5] calldata _maxRiskPoints
    ) external {
        for (uint256 i = 1; i < 5; ) {
            if (_minSuccessfulTrades[i] < _minSuccessfulTrades[i - 1]) revert IArafEscrowErrors.InvalidTier();
            if (_maxRiskPoints[i] > _maxRiskPoints[i - 1]) revert IArafEscrowErrors.InvalidTier();
            unchecked { ++i; }
        }
        if (_maxRiskPoints[0] < s.banRiskPointsThreshold) revert IArafEscrowErrors.InvalidTier();

        s.tierMinSuccessfulTrades = _minSuccessfulTrades;
        s.tierMaxRiskPoints = _maxRiskPoints;
        emit ReputationTierThresholdsUpdated(_minSuccessfulTrades, _maxRiskPoints);
    }

    // ═══════════════════════════════════════════════════
    //  OKUMA / VIEW (internal: escrow bytecode'una da kopyalanır / also inlined into the escrow)
    // ═══════════════════════════════════════════════════

    /**
     * @notice Efektif tier: performans + zaman + ceza tavanının birleşimi.
     * @notice Effective tier: combination of performance, time and penalty ceiling.
     */
    function effectiveTier(Store storage s, address _wallet) internal view returns (uint8) {
        Reputation storage rep = s.reputation[_wallet];
        uint8 calculatedTier;
        uint64 successful = rep.successfulTrades;
        uint32 risk = rep.riskPoints;

        for (uint256 i = 4; i > 0; ) {
            if (successful >= s.tierMinSuccessfulTrades[i] && risk <= s.tierMaxRiskPoints[i]) {
                calculatedTier = uint8(i);
                break;
            }
            unchecked { --i; }
        }

        if (calculatedTier > 0) {
            uint256 firstAt = s.firstSuccessfulTradeAt[_wallet];
            if (firstAt == 0 || block.timestamp < firstAt + MIN_ACTIVE_PERIOD) {
                calculatedTier = 0;
            }
        }

        if (!s.hasTierPenalty[_wallet]) return calculatedTier;
        uint8 cap = s.maxAllowedTier[_wallet];
        return calculatedTier > cap ? cap : calculatedTier;
    }

    // ═══════════════════════════════════════════════════
    //  İÇ YARDIMCILAR / INTERNAL HELPERS
    // ═══════════════════════════════════════════════════

    // [TR] Başarılı işlem sayacı yalnız burada artar; `qualifies` false ise (mikro işlem) sinyal yok sayılır.
    // [EN] The successful-trade counter only grows here; a non-qualifying (micro) trade is ignored.
    function _applyPositiveSignal(
        Store storage s,
        address _wallet,
        Reputation storage rep,
        uint32 rewardPts,
        bool qualifies
    ) private {
        if (!qualifies) return;
        rep.successfulTrades++;
        rep.lastPositiveEventAt = uint64(block.timestamp);

        // [TR] Başarı geçmişi oluştuğunda firstSuccessfulTradeAt, ödül puanı sıfır olsa bile bir kez initialize edilir.
        // [EN] Initialize firstSuccessfulTradeAt once when success history exists, even if reward points are zero.
        if (s.firstSuccessfulTradeAt[_wallet] == 0) {
            s.firstSuccessfulTradeAt[_wallet] = block.timestamp;
        }

        if (rewardPts > 0) {
            if (rep.riskPoints <= rewardPts) rep.riskPoints = 0;
            else rep.riskPoints -= rewardPts;
        }
        // [TR] Pozitif sinyal ban/tier cezası tetiklemez. [EN] Positive signals never trigger ban/tier penalties.
    }

    function _applyNegativeSignal(Store storage s, address _wallet, Reputation storage rep, uint32 penaltyPts) private {
        rep.lastNegativeEventAt = uint64(block.timestamp);

        if (penaltyPts > 0) {
            uint256 nextRisk = uint256(rep.riskPoints) + penaltyPts;
            rep.riskPoints = nextRisk > type(uint32).max ? type(uint32).max : uint32(nextRisk);
        }
        _refreshTierAndBanState(s, _wallet, rep);
    }

    function _refreshTierAndBanState(Store storage s, address _wallet, Reputation storage rep) private {
        if (rep.riskPoints < s.banRiskPointsThreshold) return;

        if (block.timestamp > rep.bannedUntil) {
            uint16 bans = rep.consecutiveBans + 1;
            rep.consecutiveBans = bans;
            // [TR] Overflow güvenliği için üstel katsayı saturating shift ile sınırlandırılır.
            // [EN] Exponential factor uses saturating shift bounds for overflow-safe escalation.
            uint256 escalationSteps = bans > 1 ? uint256(bans - 1) : 0;
            if (escalationSteps > 31) escalationSteps = 31;
            uint256 banWindow = uint256(s.baseBanDuration) * (uint256(1) << escalationSteps);
            if (banWindow > MAX_BAN_DURATION) banWindow = MAX_BAN_DURATION;
            rep.bannedUntil = uint64(block.timestamp + banWindow);
        }

        // [TR] İlk ceza tavanı 4'ten başlatır ve her ceza bir kademe düşürür; tavan tek yazımla güncellenir.
        // [EN] The first penalty seeds the ceiling at 4 and each penalty lowers it by one; single write.
        uint8 cap = 4;
        if (s.hasTierPenalty[_wallet]) cap = s.maxAllowedTier[_wallet];
        else s.hasTierPenalty[_wallet] = true;
        if (cap > 0) {
            unchecked { --cap; }
        }
        s.maxAllowedTier[_wallet] = cap;
    }

    function _emitReputationUpdated(Store storage s, address _wallet, Reputation storage rep) private {
        emit ReputationUpdated(
            _wallet,
            rep.successfulTrades,
            rep.failedDisputes,
            rep.bannedUntil,
            effectiveTier(s, _wallet),
            rep.manualReleaseCount,
            rep.autoReleaseCount,
            rep.mutualCancelCount,
            rep.disputedResolvedCount,
            rep.burnCount,
            rep.disputeWinCount,
            rep.disputeLossCount,
            rep.partialSettlementCount,
            rep.riskPoints,
            rep.lastPositiveEventAt,
            rep.lastNegativeEventAt
        );
    }
}
