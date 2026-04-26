// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ArafRevenueVault.sol";

interface IArafEscrowRewardView {
    enum TerminalOutcome {
        NONE,
        CLEAN_RELEASE,
        AUTO_RELEASE,
        MUTUAL_CANCEL,
        PARTIAL_SETTLEMENT,
        DISPUTED_RELEASE,
        BURNED
    }

    struct RewardableTradeView {
        uint256 tradeId;
        uint256 parentOrderId;
        address maker;
        address taker;
        address token;
        uint256 stableNotional;
        uint256 takerFeePaid;
        uint256 makerFeePaid;
        uint8 tier;
        TerminalOutcome outcome;
        uint256 lockedAt;
        uint256 paidAt;
        uint256 terminalAt;
        bool hadChallenge;
        bool isOrderChild;
    }

    function getRewardableTrade(uint256 tradeId)
        external
        view
        returns (RewardableTradeView memory);
}

contract ArafRewards is Ownable, ReentrancyGuard, Pausable {
    error AlreadyRecorded();
    error NonTerminalOutcome();
    error DirectEscrowNotRewardable();
    error TierZeroNotRewardable();

    uint256 public constant BPS = 10_000;
    uint256 public constant SCALE = 100_000_000; // outcomeBps(1e4) * tierBps(1e4)

    // Outcome multipliers (BPS)
    uint256 public constant CLEAN_FAST_BPS = 25_000;      // <=1h
    uint256 public constant CLEAN_24H_BPS = 15_000;       // <=24h
    uint256 public constant CLEAN_72H_BPS = 10_000;       // <=72h
    uint256 public constant CLEAN_SLOW_BPS = 5_000;       // >72h or paidAt=0
    uint256 public constant PARTIAL_SETTLEMENT_BPS = 3_000;

    // Tier multipliers (BPS)
    uint256 public constant TIER1_BPS = 10_000;
    uint256 public constant TIER2_BPS = 11_000;
    uint256 public constant TIER3_BPS = 12_000;
    uint256 public constant TIER4_BPS = 13_000;

    IArafEscrowRewardView public immutable escrow;
    ArafRevenueVault public immutable revenueVault;

    uint256 public epochDuration = 7 days;
    uint256 public claimDelay = 24 hours;

    mapping(uint256 => uint256) public totalWeight;
    mapping(uint256 => mapping(address => uint256)) public userWeight;
    mapping(uint256 => mapping(address => mapping(address => bool))) public claimed;
    mapping(uint256 => bool) public recordedTrade;

    event TradeOutcomeRecorded(
        uint256 indexed tradeId,
        uint256 indexed epoch,
        address indexed maker,
        address taker,
        uint256 makerWeight,
        uint256 takerWeight,
        IArafEscrowRewardView.TerminalOutcome outcome
    );

    constructor(address _escrow, address _revenueVault, address _owner) Ownable(_owner) {
        escrow = IArafEscrowRewardView(_escrow);
        revenueVault = ArafRevenueVault(_revenueVault);
    }

    /**
     * @notice Permissionless outcome recording from contract-authoritative escrow view.
     * @dev    Backend çağırabilir ama authority üretmez; kaynak yalnız escrow.getRewardableTrade'dır.
     */
    function recordTradeOutcome(uint256 tradeId) external nonReentrant whenNotPaused {
        if (recordedTrade[tradeId]) revert AlreadyRecorded();

        IArafEscrowRewardView.RewardableTradeView memory t = escrow.getRewardableTrade(tradeId);
        if (t.outcome == IArafEscrowRewardView.TerminalOutcome.NONE) revert NonTerminalOutcome();
        if (!t.isOrderChild) revert DirectEscrowNotRewardable();
        if (t.tier == 0) revert TierZeroNotRewardable();

        uint256 epoch = t.terminalAt / epochDuration;
        uint256 outcomeBps = _outcomeMultiplierBps(t);
        uint256 tierBps = _tierMultiplierBps(t.tier);

        uint256 makerW = 0;
        uint256 takerW = 0;
        if (outcomeBps > 0 && tierBps > 0) {
            uint256 base = t.stableNotional;
            makerW = (base * outcomeBps * tierBps) / SCALE;
            takerW = (base * outcomeBps * tierBps) / SCALE;

            userWeight[epoch][t.maker] += makerW;
            userWeight[epoch][t.taker] += takerW;
            totalWeight[epoch] += makerW + takerW;
        }

        recordedTrade[tradeId] = true;
        emit TradeOutcomeRecorded(tradeId, epoch, t.maker, t.taker, makerW, takerW, t.outcome);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _outcomeMultiplierBps(IArafEscrowRewardView.RewardableTradeView memory t)
        internal
        pure
        returns (uint256)
    {
        if (t.outcome == IArafEscrowRewardView.TerminalOutcome.CLEAN_RELEASE) {
            if (t.paidAt > 0 && t.terminalAt >= t.paidAt) {
                uint256 delta = t.terminalAt - t.paidAt;
                if (delta <= 1 hours) return CLEAN_FAST_BPS;
                if (delta <= 24 hours) return CLEAN_24H_BPS;
                if (delta <= 72 hours) return CLEAN_72H_BPS;
            }
            return CLEAN_SLOW_BPS;
        }

        if (t.outcome == IArafEscrowRewardView.TerminalOutcome.PARTIAL_SETTLEMENT) {
            return PARTIAL_SETTLEMENT_BPS;
        }

        return 0;
    }

    function _tierMultiplierBps(uint8 tier) internal pure returns (uint256) {
        if (tier == 1) return TIER1_BPS;
        if (tier == 2) return TIER2_BPS;
        if (tier == 3) return TIER3_BPS;
        if (tier == 4) return TIER4_BPS;
        return 0;
    }
}
