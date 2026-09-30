// SPDX-License-Identifier: Apache-2.0
/*
 * Copyright 2026 Araf Protocol
 *
 * Licensed under the Apache License, Version 2.0
 * http://www.apache.org/licenses/LICENSE-2.0
 */

pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ArafErrors.sol";
// [TR] Yalnız tip referansı (Trade/SettlementProposal); bytecode bağımlılığı yoktur. [EN] Type references only.
import "./ArafEscrow.sol";

/**
 * @title  ArafSettlementLib
 * @notice ArafEscrow'un terminal fon dağıtımı (payout + treasury revenue hook'ları) ve partial-settlement
 *         teklif yönetimi (propose / reject / withdraw / expire).
 * @notice Terminal payout (incl. treasury revenue hooks) and partial-settlement proposal management of ArafEscrow.
 * @dev    [TR] External library: DELEGATECALL ile escrow bağlamında çalışır. Token'lar escrow bakiyesinden, event'ler
 *         escrow adresinden, aynı imzalarla çıkar; msg.sender orijinal çağırandır. Adres deploy anında linklenir
 *         (değiştirilemez; yeni yetki / upgrade yolu / harici güven varsayımı yoktur). Reentrancy koruması escrow'un
 *         nonReentrant modifier'ıdır (aynı storage slotu). State değiştiren fonksiyonlar doğrudan CALL ile çağrılamaz
 *         (library call-protection). Treasury hook semantiği escrow'daki eski _sendProtocolRevenue ile birebir aynıdır.
 * @dev    [EN] External library executed via DELEGATECALL in the escrow context: tokens move from the escrow
 *         balance, events are emitted from the escrow address with identical signatures, msg.sender is the original
 *         caller. Linked at deploy time (immutable; no new authority, upgrade path or trust assumption).
 */
library ArafSettlementLib {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant MIN_SETTLEMENT_EXPIRY = 10 minutes;
    uint256 private constant MAX_SETTLEMENT_DEADLINE = 7 days;

    // [TR] Teklif kapatma işlemleri. [EN] Proposal closing operations.
    uint8 internal constant OP_REJECT = 0;
    uint8 internal constant OP_WITHDRAW = 1;
    uint8 internal constant OP_EXPIRE = 2;

    // [TR] ArafEscrow bildirimleriyle birebir aynı imzalar (enum ABI tipi uint8 → topic0 aynı).
    // [EN] Identical to the ArafEscrow declarations (enum ABI type is uint8 → same topic0).
    event BleedingDecayed(uint256 indexed tradeId, uint256 decayedAmount, uint256 timestamp);
    event ProtocolRevenueSent(
        address indexed token,
        uint256 amount,
        uint8 indexed kind,
        uint256 indexed tradeId,
        address treasury
    );
    event SettlementProposed(
        uint256 indexed tradeId,
        uint256 indexed proposalId,
        address indexed proposer,
        uint16 makerShareBps,
        uint16 takerShareBps,
        uint256 expiresAt
    );
    event SettlementRejected(uint256 indexed tradeId, uint256 indexed proposalId, address indexed rejecter);
    event SettlementWithdrawn(uint256 indexed tradeId, uint256 indexed proposalId, address indexed proposer);
    event SettlementExpired(uint256 indexed tradeId, uint256 indexed proposalId);

    // ═══════════════════════════════════════════════════
    //  TERMİNAL DAĞITIM / TERMINAL PAYOUT
    // ═══════════════════════════════════════════════════

    /**
     * @notice Terminal dağıtımı tek yerden yapar: protokol payı (decay + fee/ceza) treasury'ye, kalanlar taraflara.
     *         Treasury kontratsa önce niyet (intent) kaydı, transfer, ardından onArafRevenue hook'u; hook revert
     *         ederse tüm işlem RevenueHookFailed ile geri alınır.
     * @notice Single terminal distribution path: protocol share to treasury (intent → transfer → hook), rest to parties.
     */
    function payout(
        address _token,
        address _maker,
        address _taker,
        address _treasury,
        uint256 _tradeId,
        uint256 _toMaker,
        uint256 _toTaker,
        uint256 _toTreasury,
        uint256 _decayed,
        uint8 _kind
    ) external {
        if (_decayed > 0) emit BleedingDecayed(_tradeId, _decayed, block.timestamp);
        if (_toTreasury > 0) _sendProtocolRevenue(_token, _treasury, _toTreasury, _kind, _tradeId);
        if (_toMaker > 0) IERC20(_token).safeTransfer(_maker, _toMaker);
        if (_toTaker > 0) IERC20(_token).safeTransfer(_taker, _toTaker);
    }

    function _sendProtocolRevenue(
        address _token,
        address _to,
        uint256 _amount,
        uint8 _kind,
        uint256 _tradeId
    ) private {
        // [TR] G4: treasury kod uzunluğu bir kez okunur. [EN] G4: treasury code length is read once.
        bool isContract = _to.code.length > 0;

        // [TR] Treasury vault destekliyorsa same-path exact-in doğrulaması için niyet kaydı bırakılır.
        // [EN] If treasury vault supports it, register intent for same-path exact-in verification.
        if (isContract) {
            try IArafRevenueReceiver(_to).noteEscrowRevenueIntent(_token, _amount, _kind, _tradeId) {
                // no-op
            } catch {
                // Backward compatibility: legacy treasury receivers may not implement intent hook.
            }
        }

        IERC20(_token).safeTransfer(_to, _amount);

        if (isContract) {
            try IArafRevenueReceiver(_to).onArafRevenue(_token, _amount, _kind, _tradeId) {
                // no-op
            } catch {
                revert IArafEscrowErrors.RevenueHookFailed();
            }
        }

        emit ProtocolRevenueSent(_token, _amount, _kind, _tradeId, _to);
    }

    // ═══════════════════════════════════════════════════
    //  PARTIAL SETTLEMENT TEKLİFLERİ / PROPOSALS
    // ═══════════════════════════════════════════════════

    /**
     * @notice Trade taraflarından biri split settlement teklifi açar (yalnız CHALLENGED).
     * @notice One trade party opens a split-settlement proposal (CHALLENGED only).
     */
    function propose(
        ArafEscrow.Trade storage t,
        ArafEscrow.SettlementProposal storage sp,
        mapping(uint256 => uint256) storage nonces,
        uint256 _tradeId,
        uint16 _makerShareBps,
        uint64 _expiresAt
    ) external {
        // [TR] Split/partial settlement yalnız aktif uyuşmazlık (CHALLENGED) safhasında mümkündür.
        // [EN] Split/partial settlement is only possible during an active dispute (CHALLENGED).
        if (t.state != ArafEscrow.TradeState.CHALLENGED) revert IArafEscrowErrors.SettlementNotAllowedInState();
        if (msg.sender != t.maker && msg.sender != t.taker) revert IArafEscrowErrors.NotTradeParty();

        // [TR] Süresi dolmuş teklif yenisiyle doğrudan üzerine yazılır (FINALIZED burada ulaşılamaz: trade RESOLVED olur).
        // [EN] An expired proposal is simply overwritten (FINALIZED is unreachable here: the trade is RESOLVED).
        if (sp.state == ArafEscrow.SettlementProposalState.PROPOSED && block.timestamp <= sp.expiresAt) {
            revert IArafEscrowErrors.ActiveSettlementProposalExists();
        }

        if (_makerShareBps > BPS_DENOMINATOR) revert IArafEscrowErrors.InvalidSettlementSplit();
        uint16 takerShareBps = uint16(BPS_DENOMINATOR - _makerShareBps);

        uint256 nowTs = block.timestamp;
        if (_expiresAt < nowTs + MIN_SETTLEMENT_EXPIRY) revert IArafEscrowErrors.InvalidSettlementDeadline();
        if (_expiresAt > nowTs + MAX_SETTLEMENT_DEADLINE) revert IArafEscrowErrors.InvalidSettlementDeadline();

        uint256 proposalId = ++nonces[_tradeId];
        sp.id = proposalId;
        sp.tradeId = _tradeId;
        sp.proposer = msg.sender;
        sp.makerShareBps = _makerShareBps;
        sp.takerShareBps = takerShareBps;
        sp.proposedAt = uint64(nowTs);
        sp.expiresAt = _expiresAt;
        sp.state = ArafEscrow.SettlementProposalState.PROPOSED;

        emit SettlementProposed(_tradeId, proposalId, msg.sender, _makerShareBps, takerShareBps, _expiresAt);
    }

    /**
     * @notice Teklifi kapatır: OP_REJECT (karşı taraf, canlı teklif), OP_WITHDRAW (teklif sahibi, canlı teklif),
     *         OP_EXPIRE (herkes, süresi dolmuş teklif).
     * @notice Closes a proposal: reject (counterparty, live), withdraw (proposer, live), expire (anyone, expired).
     */
    function close(
        ArafEscrow.Trade storage t,
        ArafEscrow.SettlementProposal storage sp,
        uint256 _tradeId,
        uint8 _op
    ) external {
        if (t.state != ArafEscrow.TradeState.CHALLENGED) revert IArafEscrowErrors.SettlementNotAllowedInState();
        if (sp.state != ArafEscrow.SettlementProposalState.PROPOSED) revert IArafEscrowErrors.NoActiveSettlementProposal();

        if (_op == OP_EXPIRE) {
            if (block.timestamp <= sp.expiresAt) revert IArafEscrowErrors.SettlementProposalNotExpired();
            sp.state = ArafEscrow.SettlementProposalState.EXPIRED;
            emit SettlementExpired(_tradeId, sp.id);
            return;
        }

        if (block.timestamp > sp.expiresAt) revert IArafEscrowErrors.SettlementProposalExpired();

        if (_op == OP_WITHDRAW) {
            if (sp.proposer != msg.sender) revert IArafEscrowErrors.OnlySettlementProposer();
            sp.state = ArafEscrow.SettlementProposalState.WITHDRAWN;
            emit SettlementWithdrawn(_tradeId, sp.id, msg.sender);
        } else {
            if (msg.sender != t.maker && msg.sender != t.taker) revert IArafEscrowErrors.NotTradeParty();
            if (msg.sender == sp.proposer) revert IArafEscrowErrors.OnlySettlementCounterparty();
            sp.state = ArafEscrow.SettlementProposalState.REJECTED;
            emit SettlementRejected(_tradeId, sp.id, msg.sender);
        }
    }
}
