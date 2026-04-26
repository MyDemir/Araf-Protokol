// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ArafRevenueVault
 * @notice Escrow'dan gelen protokol gelirini reward/treasury rezervlerine böler.
 * @dev    Ekonomi authority'si escrow'dadır; vault yalnız muhasebe + güvenli çekim katmanıdır.
 */
contract ArafRevenueVault is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    error OnlyEscrow();
    error UnsupportedRewardToken();
    error RewardBpsOutOfRange();
    error InvalidRecipient();
    error InsufficientTreasuryReserve();
    error UnauthorizedRewards();
    error ZeroAmount();

    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_REWARD_BPS = 4_000;
    uint256 public constant MAX_REWARD_BPS = 7_000;

    address public immutable escrow;
    address public finalTreasury;
    address public rewards;
    uint256 public rewardBps;

    mapping(address => bool) public supportedToken;
    mapping(address => uint256) public rewardReserve;
    mapping(address => uint256) public treasuryReserve;
    mapping(address => uint256) public totalEscrowRevenue;

    event EscrowRevenueReceived(
        address indexed token,
        uint256 amount,
        uint256 rewardShare,
        uint256 treasuryShare,
        uint8 kind,
        uint256 tradeId
    );
    event RewardBpsUpdated(uint256 newRewardBps);
    event TreasuryShareWithdrawn(address indexed token, address indexed to, uint256 amount);
    event SupportedTokenUpdated(address indexed token, bool supported);
    event RewardsUpdated(address indexed rewards);
    event FinalTreasuryUpdated(address indexed finalTreasury);

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert OnlyEscrow();
        _;
    }

    constructor(address _escrow, address _finalTreasury, address _owner) Ownable(_owner) {
        if (_escrow == address(0) || _finalTreasury == address(0)) revert InvalidRecipient();
        escrow = _escrow;
        finalTreasury = _finalTreasury;
        rewardBps = MIN_REWARD_BPS;
    }

    function setRewardBps(uint256 _rewardBps) external onlyOwner {
        if (_rewardBps < MIN_REWARD_BPS || _rewardBps > MAX_REWARD_BPS) revert RewardBpsOutOfRange();
        rewardBps = _rewardBps;
        emit RewardBpsUpdated(_rewardBps);
    }

    function setFinalTreasury(address _finalTreasury) external onlyOwner {
        if (_finalTreasury == address(0)) revert InvalidRecipient();
        finalTreasury = _finalTreasury;
        emit FinalTreasuryUpdated(_finalTreasury);
    }

    function setRewards(address _rewards) external onlyOwner {
        if (_rewards == address(0)) revert InvalidRecipient();
        rewards = _rewards;
        emit RewardsUpdated(_rewards);
    }

    function setSupportedToken(address _token, bool _supported) external onlyOwner {
        if (_token == address(0)) revert InvalidRecipient();
        supportedToken[_token] = _supported;
        emit SupportedTokenUpdated(_token, _supported);
    }

    /**
     * @notice Escrow hook'u: escrow zaten token transferini tamamladıktan sonra çağrılır.
     * @dev    Konservatif muhasebe: reserve toplamı + amount, mevcut bakiyeyi aşarsa revert eder.
     */
    function onArafRevenue(
        address token,
        uint256 amount,
        uint8 kind,
        uint256 tradeId
    ) external onlyEscrow whenNotPaused nonReentrant {
        if (!supportedToken[token]) revert UnsupportedRewardToken();
        if (amount == 0) revert ZeroAmount();

        uint256 currentLiability = rewardReserve[token] + treasuryReserve[token];
        uint256 balanceAfterTransfer = IERC20(token).balanceOf(address(this));
        if (balanceAfterTransfer < currentLiability + amount) revert ZeroAmount();

        uint256 rewardShare = (amount * rewardBps) / BPS;
        uint256 treasuryShare = amount - rewardShare;

        rewardReserve[token] += rewardShare;
        treasuryReserve[token] += treasuryShare;
        totalEscrowRevenue[token] += amount;

        emit EscrowRevenueReceived(token, amount, rewardShare, treasuryShare, kind, tradeId);
    }

    function withdrawTreasuryShare(
        address token,
        uint256 amount,
        address to
    ) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert InvalidRecipient();
        if (treasuryReserve[token] < amount) revert InsufficientTreasuryReserve();

        treasuryReserve[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
        emit TreasuryShareWithdrawn(token, to, amount);
    }

    function withdrawTreasuryShareToFinal(address token, uint256 amount) external onlyOwner nonReentrant {
        if (finalTreasury == address(0)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        if (treasuryReserve[token] < amount) revert InsufficientTreasuryReserve();

        treasuryReserve[token] -= amount;
        IERC20(token).safeTransfer(finalTreasury, amount);
        emit TreasuryShareWithdrawn(token, finalTreasury, amount);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
