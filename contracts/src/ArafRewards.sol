// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
    using SafeERC20 for IERC20;
    error AlreadyRecorded();
    error NonTerminalOutcome();
    error DirectEscrowNotRewardable();
    error TierZeroNotRewardable();
    error NotAllocationSource();
    error EpochNotEnded();
    error ClaimDelayActive();
    error ZeroTotalWeight();
    error ZeroUserWeight();
    error AlreadyClaimed();
    error ZeroAmount();
    error EpochTokenNotFinalized();
    error EpochTokenAlreadyFinalized();
    error EpochTokenFinalized();
    error InvalidRecipient();
    error EpochDustAlreadySwept();
    error NothingToSweep();

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
    mapping(uint256 => mapping(address => uint256)) public epochRewardPool;
    mapping(uint256 => mapping(address => uint256)) public epochClaimedAmount;
    mapping(uint256 => mapping(address => bool)) public epochTokenAllocated;
    mapping(uint256 => mapping(address => bool)) public epochTokenFinalized;
    mapping(uint256 => mapping(address => bool)) public epochDustSwept;

    event TradeOutcomeRecorded(
        uint256 indexed tradeId,
        uint256 indexed epoch,
        address indexed maker,
        address taker,
        uint256 makerWeight,
        uint256 takerWeight,
        IArafEscrowRewardView.TerminalOutcome outcome
    );
    event EpochRewardAllocated(uint256 indexed epoch, address indexed token, uint256 amount);
    event EpochTokenFinalizedEvent(uint256 indexed epoch, address indexed token);
    event RewardClaimed(
        uint256 indexed epoch,
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 userWeight,
        uint256 totalWeight
    );
    event EpochDustSwept(
        uint256 indexed epoch,
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    constructor(address _escrow, address _revenueVault, address _owner) Ownable(_owner) {
        if (_escrow == address(0) || _revenueVault == address(0)) revert InvalidRecipient();
        escrow = IArafEscrowRewardView(_escrow);
        revenueVault = ArafRevenueVault(_revenueVault);
    }

    function currentEpoch() external view returns (uint256) {
        return block.timestamp / epochDuration;
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

    /**
     * @notice Epoch havuzuna reward reserve'den tahsis ekler.
     * @dev    Fon kaynağı revenueVault'tur; owner yalnız allocation tetikler.
     */
    function allocateEpochRewards(uint256 epoch, address token, uint256 amount)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (epochTokenFinalized[epoch][token]) revert EpochTokenFinalized();
        revenueVault.transferEpochAllocation(epoch, token, amount);
        epochRewardPool[epoch][token] += amount;
        epochTokenAllocated[epoch][token] = true;
        emit EpochRewardAllocated(epoch, token, amount);
    }

    function claim(uint256 epoch, address token) external nonReentrant whenNotPaused {
        if (!epochTokenFinalized[epoch][token]) revert EpochTokenNotFinalized();
        uint256 epochEnd = (epoch + 1) * epochDuration;
        if (block.timestamp < epochEnd) revert EpochNotEnded();
        if (block.timestamp < epochEnd + claimDelay) revert ClaimDelayActive();

        uint256 tWeight = totalWeight[epoch];
        if (tWeight == 0) revert ZeroTotalWeight();
        uint256 uWeight = userWeight[epoch][msg.sender];
        if (uWeight == 0) revert ZeroUserWeight();
        if (claimed[epoch][msg.sender][token]) revert AlreadyClaimed();

        uint256 amount = (epochRewardPool[epoch][token] * uWeight) / tWeight;
        if (amount == 0) revert ZeroAmount();
        claimed[epoch][msg.sender][token] = true;
        epochClaimedAmount[epoch][token] += amount;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit RewardClaimed(epoch, msg.sender, token, amount, uWeight, tWeight);
    }

    function finalizeEpochToken(uint256 epoch, address token) external onlyOwner {
        if (epochTokenFinalized[epoch][token]) revert EpochTokenAlreadyFinalized();
        uint256 epochEnd = (epoch + 1) * epochDuration;
        if (block.timestamp < epochEnd) revert EpochNotEnded();
        epochTokenFinalized[epoch][token] = true;
        emit EpochTokenFinalizedEvent(epoch, token);
    }

    /**
     * @notice Claim penceresi sonrası integer division dust'ını protokol alıcısına süpürür.
     * @dev Conservation: claimed + swept == epochRewardPool.
     */
    function sweepEpochDust(uint256 epoch, address token, address recipient)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        if (recipient == address(0)) revert InvalidRecipient();
        if (!epochTokenFinalized[epoch][token]) revert EpochTokenNotFinalized();
        if (epochDustSwept[epoch][token]) revert EpochDustAlreadySwept();
        uint256 epochEnd = (epoch + 1) * epochDuration;
        if (block.timestamp < epochEnd + claimDelay) revert ClaimDelayActive();

        uint256 pool = epochRewardPool[epoch][token];
        uint256 claimedAmount = epochClaimedAmount[epoch][token];
        uint256 dust = pool > claimedAmount ? pool - claimedAmount : 0;
        if (dust == 0) revert NothingToSweep();

        epochDustSwept[epoch][token] = true;
        IERC20(token).safeTransfer(recipient, dust);
        emit EpochDustSwept(epoch, token, recipient, dust);
    }

    function claimable(uint256 epoch, address user, address token) external view returns (uint256) {
        if (claimed[epoch][user][token]) return 0;
        uint256 tWeight = totalWeight[epoch];
        if (tWeight == 0) return 0;
        uint256 uWeight = userWeight[epoch][user];
        if (uWeight == 0) return 0;
        return (epochRewardPool[epoch][token] * uWeight) / tWeight;
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
