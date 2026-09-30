// SPDX-License-Identifier: Apache-2.0
/*
 * Copyright 2026 Araf Protocol
 *
 * Licensed under the Apache License, Version 2.0
 * http://www.apache.org/licenses/LICENSE-2.0
 */

pragma solidity ^0.8.24;

// ═══════════════════════════════════════════════════
//  ÖZEL HATALAR — require() string'lerine göre daha az gaz harcar
//  CUSTOM ERRORS — cheaper gas than require() strings
//  [TR] ArafEscrow ve ArafReputationLib ortak kullanır; ABI'de hepsi ArafEscrow'da da görünür
//       (IArafEscrowErrors kalıtımı; library'ler IArafEscrowErrors.X ile revert eder). [EN] Shared by ArafEscrow and ArafReputationLib; all of them stay in
//       the ArafEscrow ABI via the IArafEscrowErrors base.
// ═══════════════════════════════════════════════════
interface IArafEscrowErrors {
    error NotTradeParty();
    error InvalidState();
    error TakerBanActive();
    error MakerBanActive();
    error PaymentWindowActive(uint256 expiresAt);
    error OnlyMaker();
    error OnlyTaker();
    error AlreadyRegistered();
    error ZeroAmount();
    error InvalidTier();
    error InvalidListingRef();
    error TierNotAllowed();
    error AmountExceedsTierLimit();
    error SelfTradeForbidden();
    error WalletTooYoung();
    error InsufficientNativeBalance();
    error TierCooldownActive();
    error EmptyIpfsHash();
    error CannotReleaseInState();
    error PingCooldownNotElapsed(uint256 requiredTime);
    error AlreadyPinged();
    error MustPingFirst();
    error ResponseWindowActive();
    error BurnPeriodNotReached();
    error NoPriorBanHistory();
    error CleanPeriodNotElapsed();
    error NoBansToReset();
    error ConflictingPingPath();
    error InvalidSettlementSplit();
    error SettlementNotAllowedInState();
    error ActiveSettlementProposalExists();
    error NoActiveSettlementProposal();
    error OnlySettlementProposer();
    error OnlySettlementCounterparty();
    error SettlementProposalExpired();
    error SettlementProposalNotExpired();
    error InvalidSettlementDeadline();
    error RevenueHookFailed();

    // [TR] V3 Order katmanı için yeni özel hatalar
    // [EN] New custom errors for the V3 Order layer
    error InvalidOrderRef();
    error InvalidOrderState();
    error OnlyOrderOwner();
    error FillAmountExceedsRemaining();
    error FillAmountBelowMinimum();
    error InvalidMinFill();
    error OrderSideMismatch();
    error TokenDirectionNotAllowed();
    error FeeBpsExceedsUint16(uint256 value);
    error FeeBpsExceedsEconomicLimit(uint256 value);
    error InvalidTransferAmount();
    error InvalidDecimals();
    error CooldownTooHigh();
    error DecayTooHigh();
    error BanTooHigh();

    // [TR] Güvenlik düzeltmeleriyle eklenen hatalar. [EN] Errors added by the security fixes.
    // K5: acceptSettlement beklenen teklif kimliği canlı teklifle uyuşmuyor / expected proposal id mismatch.
    error SettlementProposalMismatch(uint256 expectedProposalId, uint256 liveProposalId);
    // K10: LOCKED trade'de ödeme penceresi kapandı / payment window already closed.
    error PaymentWindowClosed(uint256 expiredAt);
    // K11: geri çekilecek iptal onayı yok / no cancel consent to revoke.
    error NoCancelConsent();
}
