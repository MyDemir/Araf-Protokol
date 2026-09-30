// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ArafRevenueVault.sol";

interface IArafEscrowRewardView {
    // [TR] ArafEscrow.TerminalOutcome ile aynı sırada olmalı (test/contracts/terminalOutcomeParity.test.js korur).
    //      View struct'ında sonuç uint8 taşınır: enum olarak decode edilseydi escrow'a eklenen yeni bir değer
    //      aralık dışı sayılıp kaydı (ve toplu kaydın tamamını) revert ederdi. Bilinmeyen değer = 0 ağırlık.
    // [EN] Must match ArafEscrow.TerminalOutcome order (guarded by terminalOutcomeParity.test.js).
    //      The view carries the outcome as uint8: decoding it as an enum would revert on any value added to
    //      the escrow later, blocking the record (and the whole batch). Unknown values earn zero weight.
    enum TerminalOutcome {
        NONE,
        CLEAN_RELEASE,
        AUTO_RELEASE,
        MUTUAL_CANCEL,
        PARTIAL_SETTLEMENT,
        DISPUTED_RELEASE,
        BURNED,
        PAYMENT_WINDOW_EXPIRED
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
        uint8 outcome;
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
    error ClaimWindowActive();
    error ClaimWindowClosed();
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
    error RecordingWindowClosed();
    error RecordingWindowOpen();

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

    // [TR] Aylık dönem, bir haftalık talep penceresi: pencere dönemden kısa olduğu için aynı anda yalnız
    //      bir dönemin ödülü talep edilebilir; kullanıcıda geçmişten biriken talep hakkı kalmaz.
    //      Süresi dolan pay sweepEpochDust ile içinde bulunulan döneme devredilir.
    // [EN] Monthly epochs with a one-week claim window: the window is shorter than an epoch, so only one
    //      epoch is claimable at a time; expired shares roll into the current epoch via sweepEpochDust.
    // [TR] G3: setter'ı olmayan süreler constant (SLOAD yok); public getter'lar aynı ABI ile durur.
    // [EN] G3: durations without setters are constants (no SLOAD); public getters keep the same ABI.
    uint256 public constant epochDuration = 30 days;
    uint256 public constant claimDelay = 24 hours;
    uint256 public constant claimWindow = 7 days;

    mapping(uint256 => uint256) public totalWeight;
    mapping(uint256 => mapping(address => uint256)) public userWeight;
    mapping(uint256 => mapping(address => mapping(address => bool))) public claimed;
    mapping(uint256 => bool) public recordedTrade;
    mapping(uint256 => mapping(address => uint256)) public epochRewardPool;
    mapping(uint256 => mapping(address => uint256)) public epochClaimedAmount;
    mapping(uint256 => mapping(address => uint256)) public epochClaimedWeight;
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
        uint8 outcome
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
    event EpochDustRolledOver(
        uint256 indexed epoch,
        address indexed token,
        uint256 indexed targetEpoch,
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
     * @dev    Backend relayer'ı veya kullanıcı çağırabilir ama authority üretmez; kaynak yalnız
     *         escrow.getRewardableTrade'dır. Pause edilemez: owner kaydı durdurup trade'leri epoch dışında
     *         bırakamaz. Kayıt penceresi epoch bitişi + claimDelay'de zamanla kapanır; claim'ler ancak
     *         o andan sonra açıldığından toplam ağırlık claim'ler başlamadan kesinleşir.
     * @dev    Backend relayer or users may call it, but it produces no authority; the only source is
     *         escrow.getRewardableTrade. Not pausable: the owner cannot censor recordings. The recording
     *         window closes by time at epoch end + claimDelay; claims only open after that, so total
     *         weight is final before any claim.
     */
    function recordTradeOutcome(uint256 tradeId) external nonReentrant {
        _recordTradeOutcome(tradeId, true);
    }

    /**
     * @notice Toplu kayıt; kaydedilemeyen (terminal olmayan, Tier 0, zaten kayıtlı, pencere kapalı) id'ler atlanır.
     * @notice Batch recording; ids that cannot be recorded (non-terminal, Tier 0, recorded, window closed) are skipped.
     */
    function recordTradeOutcomes(uint256[] calldata tradeIds) external nonReentrant {
        uint256 n = tradeIds.length;
        for (uint256 i; i < n; ) {
            _recordTradeOutcome(tradeIds[i], false);
            unchecked { ++i; }
        }
    }

    function _recordTradeOutcome(uint256 tradeId, bool strict) internal {
        if (recordedTrade[tradeId]) {
            if (strict) revert AlreadyRecorded();
            return;
        }

        IArafEscrowRewardView.RewardableTradeView memory t = escrow.getRewardableTrade(tradeId);
        uint256 epoch = t.terminalAt / epochDuration;
        bytes4 failure;
        if (t.outcome == uint8(IArafEscrowRewardView.TerminalOutcome.NONE)) failure = NonTerminalOutcome.selector;
        else if (!t.isOrderChild) failure = DirectEscrowNotRewardable.selector;
        else if (t.tier == 0) failure = TierZeroNotRewardable.selector;
        else if (block.timestamp >= _recordingDeadline(epoch)) failure = RecordingWindowClosed.selector;
        if (failure != bytes4(0)) {
            if (!strict) return;
            assembly {
                mstore(0, failure)
                revert(0, 4)
            }
        }

        uint256 weight = 0;
        uint256 outcomeBps = _outcomeMultiplierBps(t);
        if (outcomeBps > 0) {
            // [TR] Maker ve taker aynı ağırlığı alır: temiz sonuç iki tarafın ortak başarısıdır.
            // [EN] Maker and taker get the same weight: a clean outcome is a joint success.
            weight = (t.stableNotional * outcomeBps * _tierMultiplierBps(t.tier)) / SCALE;
            userWeight[epoch][t.maker] += weight;
            userWeight[epoch][t.taker] += weight;
            totalWeight[epoch] += weight * 2;
        }

        recordedTrade[tradeId] = true;
        emit TradeOutcomeRecorded(tradeId, epoch, t.maker, t.taker, weight, weight, t.outcome);
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

    /**
     * @notice Pause edilemez: owner claim penceresini durdurup ödülü süpürme yoluna itemez.
     * @notice Not pausable: the owner cannot freeze the claim window to push rewards into a sweep.
     */
    function claim(uint256 epoch, address token) external nonReentrant {
        if (!epochTokenFinalized[epoch][token]) revert EpochTokenNotFinalized();
        uint256 epochEnd = (epoch + 1) * epochDuration;
        if (block.timestamp < epochEnd) revert EpochNotEnded();
        if (block.timestamp < epochEnd + claimDelay) revert ClaimDelayActive();
        if (block.timestamp > _claimWindowEnd(epochEnd)) revert ClaimWindowClosed();

        uint256 tWeight = totalWeight[epoch];
        if (tWeight == 0) revert ZeroTotalWeight();
        uint256 uWeight = userWeight[epoch][msg.sender];
        if (uWeight == 0) revert ZeroUserWeight();
        if (claimed[epoch][msg.sender][token]) revert AlreadyClaimed();

        uint256 amount = (epochRewardPool[epoch][token] * uWeight) / tWeight;
        if (amount == 0) revert ZeroAmount();
        claimed[epoch][msg.sender][token] = true;
        epochClaimedAmount[epoch][token] += amount;
        epochClaimedWeight[epoch][token] += uWeight;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit RewardClaimed(epoch, msg.sender, token, amount, uWeight, tWeight);
    }

    /**
     * @notice Kayıt penceresi kapandıktan sonra herkes finalize edebilir; owner claim'i geciktiremez.
     *         O epoch'a hedeflenmiş sponsor fonları da bu anda havuza çekilir, böylece kasada unutulmaz.
     * @notice Anyone can finalize once the recording window has closed; the owner cannot delay claims.
     *         Sponsor funding targeted at the epoch is pulled into the pool so it is never stranded.
     */
    function finalizeEpochToken(uint256 epoch, address token) external nonReentrant {
        if (epochTokenFinalized[epoch][token]) revert EpochTokenAlreadyFinalized();
        if (block.timestamp < _recordingDeadline(epoch)) revert RecordingWindowOpen();

        uint256 external_ = revenueVault.externalFundingByEpoch(epoch, token);
        if (external_ > 0) {
            revenueVault.transferEpochAllocation(epoch, token, external_);
            epochRewardPool[epoch][token] += external_;
            emit EpochRewardAllocated(epoch, token, external_);
        }

        epochTokenFinalized[epoch][token] = true;
        emit EpochTokenFinalizedEvent(epoch, token);
    }

    /**
     * @notice Claim penceresi bittikten (veya tüm ağırlık claim edildikten) sonra kalan pay içinde bulunulan
     *         epoch'un havuzuna devredilir. Alıcı seçilemez; talep edilmeyen ödül yine barışçıl kullanıcılara gider.
     * @notice After the claim window ends (or all weight has claimed) the remainder rolls into the current
     *         epoch's pool. No recipient can be chosen; unclaimed rewards still go to peaceful users.
     * @dev Conservation: claimed + rolledOver == epochRewardPool.
     */
    function sweepEpochDust(uint256 epoch, address token) external nonReentrant {
        if (!epochTokenFinalized[epoch][token]) revert EpochTokenNotFinalized();
        if (epochDustSwept[epoch][token]) revert EpochDustAlreadySwept();
        uint256 epochEnd = (epoch + 1) * epochDuration;
        if (epochClaimedWeight[epoch][token] < totalWeight[epoch] && block.timestamp <= _claimWindowEnd(epochEnd)) {
            revert ClaimWindowActive();
        }

        uint256 pool = epochRewardPool[epoch][token];
        uint256 claimedAmount = epochClaimedAmount[epoch][token];
        uint256 dust = pool > claimedAmount ? pool - claimedAmount : 0;
        if (dust == 0) revert NothingToSweep();

        uint256 targetEpoch = block.timestamp / epochDuration;
        epochDustSwept[epoch][token] = true;
        epochRewardPool[targetEpoch][token] += dust;
        emit EpochDustRolledOver(epoch, token, targetEpoch, dust);
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

    function _recordingDeadline(uint256 epoch) internal pure returns (uint256) {
        return (epoch + 1) * epochDuration + claimDelay;
    }

    function _claimWindowEnd(uint256 epochEnd) internal pure returns (uint256) {
        return epochEnd + claimDelay + claimWindow;
    }

    function _outcomeMultiplierBps(IArafEscrowRewardView.RewardableTradeView memory t)
        internal
        pure
        returns (uint256)
    {
        if (t.outcome == uint8(IArafEscrowRewardView.TerminalOutcome.CLEAN_RELEASE)) {
            if (t.paidAt > 0 && t.terminalAt >= t.paidAt) {
                uint256 delta = t.terminalAt - t.paidAt;
                if (delta <= 1 hours) return CLEAN_FAST_BPS;
                if (delta <= 24 hours) return CLEAN_24H_BPS;
                if (delta <= 72 hours) return CLEAN_72H_BPS;
            }
            return CLEAN_SLOW_BPS;
        }

        if (t.outcome == uint8(IArafEscrowRewardView.TerminalOutcome.PARTIAL_SETTLEMENT)) {
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
