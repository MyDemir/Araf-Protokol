// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IArafRewardsEpochClock {
    function currentEpoch() external view returns (uint256);
}

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
    error ProductPoolDisabled();
    error ExactInMismatch();
    error InsufficientRewardReserve();
    error RevenueLiabilityMismatch();
    error MissingRevenueIntent();
    error RevenueAmountMismatch();
    error StaleTargetEpoch();
    error RewardsAlreadySet();

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
    mapping(address => uint256) public totalExternalFunding;
    mapping(uint256 => mapping(address => uint256)) public externalFundingByEpoch;

    struct ProductPool {
        bool enabled;
        bytes32 productId;
        string metadataURI;
    }

    mapping(bytes32 => ProductPool) public productPools;
    mapping(uint256 => mapping(bytes32 => mapping(address => uint256))) public productFundingByEpoch;
    // [TR] G2: escrow intent handshake'i (balanceBefore + amount) transient storage'da tutulur (EIP-1153, tstore/tload).
    //      Niyet ve tüketim aynı escrow işleminin içindedir; tx sonunda kendiliğinden silinir, kalıcı SSTORE yoktur.
    //      Slot = keccak256(intentKey, TRANSIENT_*_SALT); kalıcı storage ile çakışmaz (transient ayrı adres uzayıdır).
    // [EN] G2: the escrow intent handshake lives in transient storage (EIP-1153); intent and consumption happen in
    //      the same escrow transaction and are cleared automatically at tx end.
    bytes32 private constant TRANSIENT_BALANCE_SALT = keccak256("araf.vault.intent.balanceBefore");
    bytes32 private constant TRANSIENT_AMOUNT_SALT = keccak256("araf.vault.intent.amount");

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
    event ExternalRewardFunded(
        address indexed funder,
        address indexed token,
        uint256 amount,
        uint256 indexed targetEpoch,
        bytes32 fundingRef
    );
    event ProductPoolUpdated(bytes32 indexed productId, bool enabled, string metadataURI);
    event ProductRewardFunded(
        address indexed funder,
        bytes32 indexed productId,
        address indexed token,
        uint256 amount,
        uint256 targetEpoch,
        bytes32 fundingRef
    );
    event EscrowRevenueIntent(address indexed token, uint256 amount, uint8 kind, uint256 tradeId);

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

    /**
     * @notice Rewards kontratını bağlar. K4: yalnız bir kez ayarlanabilir; aksi halde owner rewards'ı kendi adresine
     *         çevirip transferEpochAllocation ile reward rezervini ve sponsor fonlarını çekebilirdi.
     * @notice Wires the rewards contract. K4: settable only once; otherwise the owner could repoint rewards to itself
     *         and drain the reward reserve and sponsor funding via transferEpochAllocation.
     */
    function setRewards(address _rewards) external onlyOwner {
        if (_rewards == address(0)) revert InvalidRecipient();
        if (rewards != address(0)) revert RewardsAlreadySet();
        rewards = _rewards;
        emit RewardsUpdated(_rewards);
    }

    function setSupportedToken(address _token, bool _supported) external onlyOwner {
        if (_token == address(0)) revert InvalidRecipient();
        supportedToken[_token] = _supported;
        emit SupportedTokenUpdated(_token, _supported);
    }

    function setProductPool(
        bytes32 productId,
        bool enabled,
        string calldata metadataURI
    ) external onlyOwner {
        productPools[productId] = ProductPool({
            enabled: enabled,
            productId: productId,
            metadataURI: metadataURI
        });
        emit ProductPoolUpdated(productId, enabled, metadataURI);
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
    ) external onlyEscrow nonReentrant {
        // [TR] Bu hook escrow'daki release/cancel/burn işlemlerinin içinde çalışır. Revert ederse
        //      escrow RevenueHookFailed ile tüm kullanıcı çıkışını geri alır. Bu yüzden pause veya
        //      desteklenmeyen token durumunda revert edilmez. Bölüşüm (rewardBps) her durumda aynı
        //      kalır; böylece owner pause/token ayarıyla ödül payını hazineye yönlendiremez.
        // [EN] This hook runs inside escrow release/cancel/burn. A revert here rolls back the user's
        //      exit via RevenueHookFailed, so pause / unsupported token never revert. The rewardBps
        //      split is unchanged in every case so the owner cannot divert the reward share.
        if (amount == 0) revert ZeroAmount();

        bytes32 key = _revenueIntentKey(token, kind, tradeId);
        (bytes32 amountSlot, bytes32 balanceSlot) = _intentSlots(key);
        uint256 expectedAmount = _tload(amountSlot);
        if (expectedAmount == 0) revert MissingRevenueIntent();
        if (expectedAmount != amount) revert RevenueAmountMismatch();

        uint256 balanceBefore = _tload(balanceSlot);
        // [TR] Aynı tx içinde tekrar kullanılamasın diye tüketilen niyet silinir. [EN] Consumed intent is cleared.
        _tstore(balanceSlot, 0);
        _tstore(amountSlot, 0);

        uint256 balanceAfterTransfer = IERC20(token).balanceOf(address(this));
        if (balanceAfterTransfer - balanceBefore != amount) revert ExactInMismatch();

        uint256 currentLiability = rewardReserve[token] + treasuryReserve[token];
        if (balanceAfterTransfer < currentLiability + amount) revert RevenueLiabilityMismatch();

        uint256 rewardShare = (amount * rewardBps) / BPS;
        uint256 treasuryShare = amount - rewardShare;

        rewardReserve[token] += rewardShare;
        treasuryReserve[token] += treasuryShare;
        totalEscrowRevenue[token] += amount;

        emit EscrowRevenueReceived(token, amount, rewardShare, treasuryShare, kind, tradeId);
    }

    /**
     * @notice Global reward havuzuna sponsor/funder katkısı.
     * @dev    Recipients/weights seçimi yoktur; yalnız epoch-token bazlı funding muhasebesi tutar.
     */
    function fundGlobalRewards(
        address token,
        uint256 amount,
        uint256 targetEpoch,
        bytes32 fundingRef
    ) external nonReentrant whenNotPaused {
        _pullEpochFunding(token, amount, targetEpoch);
        emit ExternalRewardFunded(msg.sender, token, amount, targetEpoch, fundingRef);
    }

    /**
     * @notice Product/campaign metadata havuzuna sponsor/funder katkısı.
     * @dev    MVP'de eligibility üretmez; yalnız funding bucket + analytics verisidir.
     */
    function fundProductRewards(
        bytes32 productId,
        address token,
        uint256 amount,
        uint256 targetEpoch,
        bytes32 fundingRef
    ) external nonReentrant whenNotPaused {
        if (!productPools[productId].enabled) revert ProductPoolDisabled();
        // [TR] Ürün fonu da epoch havuzuna akar; önceden hiçbir yol bu bakiyeyi harcamadığı için fon kasada kilitli kalıyordu.
        //      productFundingByEpoch yalnız kampanya analitiği içindir.
        // [EN] Product funding also flows into the epoch pool; previously no path ever spent it and funds stayed locked.
        //      productFundingByEpoch is campaign analytics only.
        _pullEpochFunding(token, amount, targetEpoch);
        productFundingByEpoch[targetEpoch][productId][token] += amount;

        emit ProductRewardFunded(msg.sender, productId, token, amount, targetEpoch, fundingRef);
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

    /**
     * @notice Epoch allocation transfer: önce epoch external funding, kalan varsa reward reserve'den karşılar.
     * @dev    Sadece rewards kontratı çağırabilir.
     */
    function transferEpochAllocation(
        uint256 epoch,
        address token,
        uint256 amount
    ) external nonReentrant {
        // [TR] Pause edilmez: finalize/allocation akışı vault pause ile kilitlenip sponsor fonları bekletilemez.
        // [EN] Not pausable: vault pause must not block finalize/allocation and strand sponsor funds.
        if (msg.sender != rewards) revert UnauthorizedRewards();
        if (amount == 0) revert ZeroAmount();

        uint256 fromExternal = externalFundingByEpoch[epoch][token];
        if (fromExternal > amount) fromExternal = amount;
        if (fromExternal > 0) {
            externalFundingByEpoch[epoch][token] -= fromExternal;
        }

        uint256 remaining = amount - fromExternal;
        if (remaining > 0) {
            if (rewardReserve[token] < remaining) revert InsufficientRewardReserve();
            rewardReserve[token] -= remaining;
        }

        IERC20(token).safeTransfer(rewards, amount);
    }

    /**
     * @notice Sponsor fonunu exact-in doğrulamasıyla alır ve hedef epoch'a yazar. Geçmiş epoch hedeflenemez:
     *         o epoch finalize edilmiş olabilir ve fon kimseye ulaşmaz.
     * @notice Pulls sponsor funding with exact-in verification and credits the target epoch. Past epochs
     *         are rejected: they may already be finalized and the funds would reach no one.
     */
    function _pullEpochFunding(address token, uint256 amount, uint256 targetEpoch) internal {
        if (!supportedToken[token]) revert UnsupportedRewardToken();
        if (amount == 0) revert ZeroAmount();
        if (rewards.code.length > 0 && targetEpoch < IArafRewardsEpochClock(rewards).currentEpoch()) {
            revert StaleTargetEpoch();
        }

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        if (balanceAfter - balanceBefore != amount) revert ExactInMismatch();

        externalFundingByEpoch[targetEpoch][token] += amount;
        totalExternalFunding[token] += amount;
    }

    function _revenueIntentKey(
        address token,
        uint8 kind,
        uint256 tradeId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(token, kind, tradeId));
    }

    /**
     * @notice Escrow transferinden hemen önce çağrılır; aynı path'te exact-in doğrulaması için handshake oluşturur.
     * @dev    Bu kayıt yoksa veya transfer tam amount kadar değilse onArafRevenue revert eder.
     */
    function noteEscrowRevenueIntent(
        address token,
        uint256 amount,
        uint8 kind,
        uint256 tradeId
    ) external onlyEscrow {
        // [TR] onArafRevenue ile aynı gerekçe: escrow çıkışlarını bloklamamak için pause/token kontrolü yok.
        // [EN] Same rationale as onArafRevenue: no pause/token gate so escrow exits are never blocked.
        if (amount == 0) revert ZeroAmount();

        bytes32 key = _revenueIntentKey(token, kind, tradeId);
        (bytes32 amountSlot, bytes32 balanceSlot) = _intentSlots(key);
        _tstore(balanceSlot, IERC20(token).balanceOf(address(this)));
        _tstore(amountSlot, amount);
        emit EscrowRevenueIntent(token, amount, kind, tradeId);
    }

    function _intentSlots(bytes32 key) internal pure returns (bytes32 amountSlot, bytes32 balanceSlot) {
        amountSlot = keccak256(abi.encode(key, TRANSIENT_AMOUNT_SALT));
        balanceSlot = keccak256(abi.encode(key, TRANSIENT_BALANCE_SALT));
    }

    function _tstore(bytes32 slot, uint256 value) private {
        assembly ("memory-safe") {
            tstore(slot, value)
        }
    }

    function _tload(bytes32 slot) private view returns (uint256 value) {
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
