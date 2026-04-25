/*
 * Copyright 2026 Araf Protocol
 *
 * Licensed under the Apache License, Version 2.0
 * http://www.apache.org/licenses/LICENSE-2.0
 */

pragma solidity ^0.8.24;

/**
 * @title  ArafEscrow
 * @notice Oracle kullanmayan, P2P itibari para ↔ kripto takas kontratı.
 *         Zamanla eriyen (Bleeding Escrow) anlaşmazlık çözüm mekanizması içerir.
 * @notice Oracle-free P2P fiat ↔ crypto escrow with Bleeding Escrow (time-decay) dispute resolution.
 * @dev    Security: ReentrancyGuard + CEI pattern + EIP-712 cancel. Network: Base (L2)
 * @author Araf Protocol — v3.0
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ═══════════════════════════════════════════════════
//  ÖZEL HATALAR — require() string'lerine göre daha az gaz harcar
//  CUSTOM ERRORS — cheaper gas than require() strings
// ═══════════════════════════════════════════════════
error NotTradeParty();
error InvalidState();
error TakerBanActive();
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
error SignatureExpired();
error InvalidSignature();
error BurnPeriodNotReached();
error NoPriorBanHistory();
error CleanPeriodNotElapsed();
error NoBansToReset();
error DeadlineTooFar();
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
error SettlementAlreadyFinalized();

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

contract ArafEscrow is ReentrancyGuard, EIP712, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════
    //  VERİ YAPILARI — Enum'lar ve Struct'lar
    //  DATA STRUCTURES — Enums & Structs
    // ═══════════════════════════════════════════════════

    enum TradeState {
        OPEN,
        LOCKED,
        PAID,
        CHALLENGED,
        RESOLVED,
        CANCELED,
        BURNED
    }

    // [TR] Parent emir yönü — satım veya alım
    // [EN] Parent order direction — sell or buy
    enum OrderSide {
        SELL_CRYPTO,
        BUY_CRYPTO
    }

    // [TR] Parent emir yaşam döngüsü
    // [EN] Parent order lifecycle
    enum OrderState {
        OPEN,
        PARTIALLY_FILLED,
        FILLED,
        CANCELED
    }

    // [TR] Ödeme rail/jurisdiction operasyonel karmaşıklık sınıfı (davranış skoru değildir).
    // [EN] Payment rail/jurisdiction operational complexity class (not a behavioral score).
    enum PaymentRiskLevel {
        LOW,
        MEDIUM,
        HIGH,
        RESTRICTED
    }

    // [TR] Faz-2 partial settlement teklif yaşam döngüsü.
    // [EN] Phase-2 partial settlement proposal lifecycle.
    enum SettlementProposalState {
        NONE,
        PROPOSED,
        REJECTED,
        WITHDRAWN,
        EXPIRED,
        FINALIZED
    }

    struct Trade {
        uint256 id;
        // [TR] V3'te her child trade bir parent order fill'inden doğar; bu alan artık nullable semantik taşımaz.
        // [EN] In V3 every child trade is born from a parent order fill; this field no longer carries nullable semantics.
        uint256 parentOrderId;
        address maker;
        address taker;
        address tokenAddress;
        uint256 cryptoAmount;
        uint256 makerBond;
        uint256 takerBond;
        uint16  takerFeeBpsSnapshot;
        uint16  makerFeeBpsSnapshot;
        uint8   tier;
        PaymentRiskLevel paymentRiskLevelSnapshot;
        TradeState state;
        uint256 lockedAt;
        uint256 paidAt;
        uint256 challengedAt;
        string  ipfsReceiptHash;
        bool    cancelProposedByMaker;
        bool    cancelProposedByTaker;
        uint256 pingedAt;
        bool    pingedByTaker;
        uint256 challengePingedAt;
        bool    challengePingedByMaker;
    }

    // [TR] Parent Order — public emir katmanı
    // [EN] Parent Order — public order layer
    struct Order {
        uint256 id;
        address owner;
        OrderSide side;
        address tokenAddress;
        uint256 totalAmount;
        uint256 remainingAmount;
        uint256 minFillAmount;
        uint256 remainingMakerBondReserve;
        uint256 remainingTakerBondReserve;
        uint16  takerFeeBpsSnapshot;
        uint16  makerFeeBpsSnapshot;
        uint8   tier;
        PaymentRiskLevel paymentRiskLevel;
        OrderState state;
        bytes32 orderRef;
    }

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

    // [TR] Trade taraflarının tamamen on-chain iradeyle kurduğu split anlaşması.
    //      Backend/admin yalnız izleyebilir; ekonomik authority kontrattadır.
    // [EN] Split agreement formed by trade parties with fully on-chain consent.
    //      Backend/admin are observers only; economic authority remains in contract.
    struct SettlementProposal {
        uint256 id;
        uint256 tradeId;
        address proposer;
        uint16 makerShareBps;
        uint16 takerShareBps;
        uint64 proposedAt;
        uint64 expiresAt;
        SettlementProposalState state;
    }

    // [TR] Kontratın tek otorite olduğu terminal semantik sınıfları.
    // [EN] Contract-owned terminal semantic outcomes (sole authority).
    enum ReputationOutcome {
        MANUAL_RELEASE,
        AUTO_RELEASE,
        MUTUAL_CANCEL,
        DISPUTED_RESOLUTION_WIN,
        DISPUTED_RESOLUTION_LOSS,
        BURNED,
        PARTIAL_SETTLEMENT
    }

    // [TR] Token bazlı yön kontrolü — owner tarafından yönetilir.
    //      Bond oranları sabit kalırken, hangi token'ın hangi order yönünde
    //      kullanılacağı owner seviyesinde açılıp kapatılabilir.
    // [EN] Token direction controls — owner managed.
    //      While bond ratios stay fixed, the owner can decide which tokens
    //      are enabled for which order direction.
    struct TokenConfig {
        bool supported;
        bool allowSellOrders;
        bool allowBuyOrders;
        uint8 decimals;
        uint256[4] tierMaxAmountsBaseUnit;
    }

    // ═══════════════════════════════════════════════════
    //  SABİTLER — Protokol Parametreleri v2.1
    //  CONSTANTS — Protocol Parameters v2.1
    // ═══════════════════════════════════════════════════

    uint256 public constant MAKER_BOND_TIER0_BPS =    0;
    uint256 public constant MAKER_BOND_TIER1_BPS =  800;
    uint256 public constant MAKER_BOND_TIER2_BPS =  600;
    uint256 public constant MAKER_BOND_TIER3_BPS =  500;
    uint256 public constant MAKER_BOND_TIER4_BPS =  200;

    uint256 public constant TAKER_BOND_TIER0_BPS =    0;
    uint256 public constant TAKER_BOND_TIER1_BPS = 1000;
    uint256 public constant TAKER_BOND_TIER2_BPS =  800;
    uint256 public constant TAKER_BOND_TIER3_BPS =  500;
    uint256 public constant TAKER_BOND_TIER4_BPS =  200;

    uint256 public constant GOOD_REP_DISCOUNT_BPS = 100;
    uint256 public constant BAD_REP_PENALTY_BPS   = 300;

    // [TR] Fee ve cooldown artık mutable'dır.
    //      Bu default değerler constructor sırasında başlangıç değeri olarak yüklenir.
    // [EN] Fee and cooldown are now mutable.
    //      These defaults are loaded as initial values in the constructor.
    uint256 public constant DEFAULT_TAKER_FEE_BPS = 15;
    uint256 public constant DEFAULT_MAKER_FEE_BPS = 15;

    uint256 public constant AUTO_RELEASE_PENALTY_BPS = 200;

    uint256 public constant GRACE_PERIOD         =  48 hours;
    uint256 public constant USDT_DECAY_START     =  96 hours;
    uint256 public constant MAX_BLEEDING         = 240 hours;
    uint256 public constant WALLET_AGE_MIN       =   7 days;
    uint256 public constant DEFAULT_TIER0_TRADE_COOLDOWN = 4 hours;
    uint256 public constant DEFAULT_TIER1_TRADE_COOLDOWN = 4 hours;
    uint256 public constant MAX_CANCEL_DEADLINE  =   7 days;
    uint256 public constant MIN_SETTLEMENT_EXPIRY = 10 minutes;
    uint256 public constant MIN_ACTIVE_PERIOD    =  15 days;

    uint256 public constant TAKER_BOND_DECAY_BPS_H = 42;
    uint256 public constant MAKER_BOND_DECAY_BPS_H = 26;
    uint256 public constant CRYPTO_DECAY_BPS_H     = 34;

    uint256 public constant DUST_LIMIT = 0.001 ether;
    // [TR] Governance yanlış konfigürasyon riskine karşı süre üst sınırları.
    // [EN] Duration upper bounds against governance misconfiguration risk.
    uint256 public constant MAX_TRADE_COOLDOWN = 30 days;
    uint256 public constant MAX_REPUTATION_DECAY_PERIOD = 365 days;
    uint256 private constant MAX_BAN_DURATION = 365 days;

    uint256 private constant BPS_DENOMINATOR  = 10_000;
    // [TR] Fee modeli (taker/maker ayrı + snapshot) korunur.
    //      Bu sabit "model"i değiştirmez; yalnız owner'ın ayarlayabileceği
    //      ekonomik tavanı daraltır (admin authority restriction).
    // [EN] The fee model (separate taker/maker + snapshots) stays unchanged.
    //      This constant does not alter the model itself; it only narrows
    //      the owner-adjustable economic ceiling (admin authority restriction).
    uint256 private constant MAX_FEE_CONFIG_BPS = 2_000;
    uint256 private constant SECONDS_PER_HOUR = 3_600;
    uint256 public cleanPeriod;
    uint32 public manualReleaseRewardPts;
    uint32 public autoReleasePenaltyPts;
    uint32 public disputeWinRewardPts;
    uint32 public disputeLossPenaltyPts;
    uint32 public burnPenaltyPts;
    uint32 public mutualCancelPenaltyPts;
    uint32 public baseBanDuration;
    uint32 public banRiskPointsThreshold;
    uint32[5] public tierMinSuccessfulTrades;
    uint32[5] public tierMaxRiskPoints;

    // ═══════════════════════════════════════════════════
    //  EIP-712 TYPEHASH
    // ═══════════════════════════════════════════════════

    bytes32 private constant CANCEL_TYPEHASH = keccak256(
        "CancelProposal(uint256 tradeId,address proposer,uint256 nonce,uint256 deadline)"
    );

    // ═══════════════════════════════════════════════════
    //  DURUM DEĞİŞKENLERİ / STATE VARIABLES
    // ═══════════════════════════════════════════════════

    uint256 public tradeCounter;
    uint256 public orderCounter;
    address public treasury;

    mapping(uint256 => Trade) public trades;
    mapping(uint256 => Order) public orders;
    mapping(uint256 => SettlementProposal) public settlementProposalsByTrade;
    mapping(uint256 => uint256) public settlementProposalNonceByTrade;
    mapping(address => Reputation) public reputation;

    mapping(address => uint256) public walletRegisteredAt;
    mapping(address => uint256) public lastTradeAt;

    mapping(address => uint8) public maxAllowedTier;
    mapping(address => bool)  public hasTierPenalty;

    mapping(address => uint256) public firstSuccessfulTradeAt;
    mapping(address => TokenConfig) public tokenConfigs;
    mapping(address => mapping(uint256 => uint256)) public sigNonces;

    // [TR] Owner kontrollü mutable fee / cooldown alanları
    // [EN] Owner-controlled mutable fee / cooldown state
    uint256 public takerFeeBps;
    uint256 public makerFeeBps;
    uint256 public tier0TradeCooldown;
    uint256 public tier1TradeCooldown;

    // ═══════════════════════════════════════════════════
    //  OLAYLAR / EVENTS
    // ═══════════════════════════════════════════════════

    event WalletRegistered(address indexed wallet, uint256 timestamp);
    event PaymentReported(uint256 indexed tradeId, string ipfsHash, uint256 timestamp);
    event EscrowReleased(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 takerFee, uint256 makerFee);
    event DisputeOpened(uint256 indexed tradeId, address indexed challenger, uint256 timestamp);
    event CancelProposed(uint256 indexed tradeId, address indexed proposer);
    event EscrowCanceled(uint256 indexed tradeId, uint256 makerRefund, uint256 takerRefund);
    event MakerPinged(uint256 indexed tradeId, address indexed pinger, uint256 timestamp);
    event BleedingDecayed(uint256 indexed tradeId, uint256 decayedAmount, uint256 timestamp);
    event EscrowBurned(uint256 indexed tradeId, uint256 burnedAmount);
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
    event TreasuryUpdated(address indexed newTreasury);
    // [TR] V3 Order / Config event'leri
    // [EN] V3 Order / Config events
    event OrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        OrderSide side,
        address token,
        uint256 totalAmount,
        uint256 minFillAmount,
        uint8 tier,
        PaymentRiskLevel paymentRiskLevel,
        bytes32 orderRef
    );

    event OrderFilled(
        uint256 indexed orderId,
        uint256 indexed tradeId,
        address indexed filler,
        uint256 fillAmount,
        uint256 remainingAmount,
        PaymentRiskLevel paymentRiskLevelSnapshot,
        bytes32 childListingRef
    );

    event OrderCanceled(
        uint256 indexed orderId,
        OrderSide side,
        uint256 remainingAmount,
        uint256 makerBondRefund,
        uint256 takerBondRefund
    );

    event FeeConfigUpdated(uint256 takerFeeBps, uint256 makerFeeBps);
    event CooldownConfigUpdated(uint256 tier0TradeCooldown, uint256 tier1TradeCooldown);

    event TokenConfigUpdated(
        address indexed token,
        bool supported,
        bool allowSellOrders,
        bool allowBuyOrders
    );
    event SettlementProposed(
        uint256 indexed tradeId,
        uint256 indexed proposalId,
        address indexed proposer,
        uint16 makerShareBps,
        uint16 takerShareBps,
        uint256 expiresAt
    );
    event SettlementRejected(
        uint256 indexed tradeId,
        uint256 indexed proposalId,
        address indexed rejecter
    );
    event SettlementWithdrawn(
        uint256 indexed tradeId,
        uint256 indexed proposalId,
        address indexed proposer
    );
    event SettlementExpired(
        uint256 indexed tradeId,
        uint256 indexed proposalId
    );
    event SettlementFinalized(
        uint256 indexed tradeId,
        uint256 indexed proposalId,
        uint256 makerPayout,
        uint256 takerPayout,
        uint256 takerFee,
        uint256 makerFee
    );

    // ═══════════════════════════════════════════════════
    //  MODIFIER'LAR / MODIFIERS
    // ═══════════════════════════════════════════════════

    modifier inState(uint256 _tradeId, TradeState _expected) {
        if (trades[_tradeId].state != _expected) revert InvalidState();
        _;
    }

    // ═══════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════

    constructor(address _treasury)
        EIP712("ArafEscrow", "1")
        Ownable(msg.sender)
    {
        if (_treasury == address(0)) revert OwnableInvalidOwner(address(0));
        treasury = _treasury;

        // [TR] Mutable fee / cooldown için varsayılan başlangıç değerleri
        // [EN] Default initial values for mutable fee / cooldown
        takerFeeBps = DEFAULT_TAKER_FEE_BPS;
        makerFeeBps = DEFAULT_MAKER_FEE_BPS;
        tier0TradeCooldown = DEFAULT_TIER0_TRADE_COOLDOWN;
        tier1TradeCooldown = DEFAULT_TIER1_TRADE_COOLDOWN;

        // [TR] Reputation policy defaults (yalnız ileriye dönük etkiler).
        // [EN] Reputation policy defaults (future effect only).
        cleanPeriod = 90 days;
        manualReleaseRewardPts = 8;
        autoReleasePenaltyPts = 60;
        disputeWinRewardPts = 10;
        disputeLossPenaltyPts = 60;
        burnPenaltyPts = 90;
        mutualCancelPenaltyPts = 20;
        baseBanDuration = uint32(30 days);
        banRiskPointsThreshold = 100;

        tierMinSuccessfulTrades = [uint32(0), uint32(15), uint32(50), uint32(100), uint32(200)];
        tierMaxRiskPoints = [uint32(100), uint32(80), uint32(50), uint32(30), uint32(15)];
    }

    // ═══════════════════════════════════════════════════
    //  KAYIT — Anti-Sybil Cüzdan Yaşı Kapısı
    //  REGISTRATION — Anti-Sybil Wallet Age Gate
    // ═══════════════════════════════════════════════════

    /**
     * @notice Cüzdanı kaydeder ve yaşlandırma sürecini başlatır.
     *         Taker rolü için bu zaman eşiği anti-sybil savunmasının parçasıdır.
     * @notice Registers a wallet and starts its aging period.
     *         This timestamp is part of the anti-sybil gate for the taker role.
     */
    function registerWallet() external {
        if (walletRegisteredAt[msg.sender] != 0) revert AlreadyRegistered();
        walletRegisteredAt[msg.sender] = block.timestamp;
        emit WalletRegistered(msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════════════════
    //  V3 ORDER KATMANI — SELL / BUY EMİRLER
    //  V3 ORDER LAYER — SELL / BUY ORDERS
    // ═══════════════════════════════════════════════════

    /**
     * @notice Public sell order oluşturur.
     *         Seller token inventory + toplam maker bond reserve'ini peşin kilitler.
     * @notice Creates a public sell order.
     *         The seller locks token inventory + total maker bond reserve upfront.
     */
    function createSellOrder(
        address _token,
        uint256 _totalAmount,
        uint256 _minFillAmount,
        uint8   _tier,
        bytes32 _orderRef,
        PaymentRiskLevel _paymentRiskLevel
    ) public nonReentrant whenNotPaused returns (uint256 orderId) {
        if (!_isTokenAllowedForSellOrder(_token)) revert TokenDirectionNotAllowed();
        if (_totalAmount == 0) revert ZeroAmount();
        if (_minFillAmount == 0 || _minFillAmount > _totalAmount) revert InvalidMinFill();
        if (_tier > 4) revert InvalidTier();
        if (_orderRef == bytes32(0)) revert InvalidOrderRef();

        uint8 effectiveTier = _getEffectiveTier(msg.sender);
        if (_tier > effectiveTier) revert TierNotAllowed();

        uint256 tierMax = _getTierMaxAmount(_token, _tier);
        if (tierMax > 0 && _totalAmount > tierMax) revert AmountExceedsTierLimit();

        uint256 makerBondBps   = _getMakerBondBps(msg.sender, _tier);
        uint256 makerBondTotal = (_totalAmount * makerBondBps) / BPS_DENOMINATOR;

        orderId = ++orderCounter;
        orders[orderId] = Order({
            id:                         orderId,
            owner:                      msg.sender,
            side:                       OrderSide.SELL_CRYPTO,
            tokenAddress:               _token,
            totalAmount:                _totalAmount,
            remainingAmount:            _totalAmount,
            minFillAmount:              _minFillAmount,
            remainingMakerBondReserve:  makerBondTotal,
            remainingTakerBondReserve:  0,
            takerFeeBpsSnapshot:        uint16(_getCurrentTakerFeeBps(_tier)),
            makerFeeBpsSnapshot:        uint16(_getCurrentMakerFeeBps(_tier)),
            tier:                       _tier,
            paymentRiskLevel:           _paymentRiskLevel,
            state:                      OrderState.OPEN,
            orderRef:                   _orderRef
        });

        _safeTransferExactIn(IERC20(_token), msg.sender, _totalAmount + makerBondTotal);

        emit OrderCreated(
            orderId,
            msg.sender,
            OrderSide.SELL_CRYPTO,
            _token,
            _totalAmount,
            _minFillAmount,
            _tier,
            _paymentRiskLevel,
            _orderRef
        );
    }


    /**
     * @notice Legacy createSellOrder imzası — geriye dönük uyumluluk için MEDIUM risk varsayımı.
     * @notice Legacy createSellOrder signature — defaults to MEDIUM risk for backward compatibility.
     */
    function createSellOrder(
        address _token,
        uint256 _totalAmount,
        uint256 _minFillAmount,
        uint8   _tier,
        bytes32 _orderRef
    ) external returns (uint256 orderId) {
        return createSellOrder(_token, _totalAmount, _minFillAmount, _tier, _orderRef, PaymentRiskLevel.MEDIUM);
    }

    /**
     * @notice Public sell order'ı exact fill ile child trade'e dönüştürür.
     *         Child trade aynı tx içinde doğrudan LOCKED olarak üretilir.
     * @notice Converts a public sell order into an exact-fill child trade.
     *         The child trade is spawned as LOCKED directly in the same tx.
     */
    function fillSellOrder(
        uint256 _orderId,
        uint256 _fillAmount,
        bytes32 _childListingRef
    ) external nonReentrant whenNotPaused returns (uint256 tradeId) {
        Order storage o = orders[_orderId];

        if (o.side != OrderSide.SELL_CRYPTO) revert OrderSideMismatch();
        if (o.state != OrderState.OPEN && o.state != OrderState.PARTIALLY_FILLED) revert InvalidOrderState();
        if (_fillAmount == 0) revert ZeroAmount();
        // [TR] Child trade linkage için listingRef zorunludur; zero ref event-consumer bütünlüğünü bozar.
        // [EN] listingRef is mandatory for child-trade linkage; zero ref breaks event-consumer integrity.
        if (_childListingRef == bytes32(0)) revert InvalidListingRef();
        if (msg.sender == o.owner) revert SelfTradeForbidden();
        if (_fillAmount > o.remainingAmount) revert FillAmountExceedsRemaining();
        if (_fillAmount < o.minFillAmount && _fillAmount != o.remainingAmount) revert FillAmountBelowMinimum();

        _enforceTakerEntry(msg.sender, o.tier);

        uint256 takerBondBps = _getTakerBondBps(msg.sender, o.tier);
        uint256 takerBond    = (_fillAmount * takerBondBps) / BPS_DENOMINATOR;

        uint256 makerBondSlice = _proportionalSlice(
            o.remainingMakerBondReserve,
            o.remainingAmount,
            _fillAmount
        );

        o.remainingAmount -= _fillAmount;
        o.remainingMakerBondReserve -= makerBondSlice;
        o.state = o.remainingAmount == 0 ? OrderState.FILLED : OrderState.PARTIALLY_FILLED;

        if (takerBond > 0) {
            _safeTransferExactIn(IERC20(o.tokenAddress), msg.sender, takerBond);
        }

        tradeId = ++tradeCounter;
        trades[tradeId] = Trade({
            id:                     tradeId,
            parentOrderId:          _orderId,
            maker:                  o.owner,
            taker:                  msg.sender,
            tokenAddress:           o.tokenAddress,
            cryptoAmount:           _fillAmount,
            makerBond:              makerBondSlice,
            takerBond:              takerBond,
            takerFeeBpsSnapshot:    o.takerFeeBpsSnapshot,
            makerFeeBpsSnapshot:    o.makerFeeBpsSnapshot,
            tier:                   o.tier,
            paymentRiskLevelSnapshot:o.paymentRiskLevel,
            state:                  TradeState.LOCKED,
            ipfsReceiptHash:        "",
            lockedAt:               block.timestamp,
            paidAt:                 0,
            challengedAt:           0,
            cancelProposedByMaker:  false,
            cancelProposedByTaker:  false,
            pingedAt:               0,
            pingedByTaker:          false,
            challengePingedAt:      0,
            challengePingedByMaker: false
        });

        lastTradeAt[msg.sender] = block.timestamp;

        emit OrderFilled(_orderId, tradeId, msg.sender, _fillAmount, o.remainingAmount, o.paymentRiskLevel, _childListingRef);

        // [TR] V3 saf modelde child trade otoritesi OrderFilled + getTrade() kombinasyonudur.
        //      Legacy create/lock mirror event zinciri artık üretilmez.
        // [EN] In pure V3, child trade authority is OrderFilled + getTrade().
        //      The legacy create/lock mirror event chain is no longer emitted.
    }

    /**
     * @notice Sell order'ın henüz doldurulmamış kalan kısmını iptal eder.
     *         Yalnız kullanılmamış inventory ve maker reserve iade edilir.
     * @notice Cancels the still-unfilled remainder of a sell order.
     *         Only unused inventory and maker reserve are refunded.
     */
    function cancelSellOrder(uint256 _orderId) external nonReentrant {
        Order storage o = orders[_orderId];

        if (o.side != OrderSide.SELL_CRYPTO) revert OrderSideMismatch();
        if (msg.sender != o.owner) revert OnlyOrderOwner();
        if (o.state != OrderState.OPEN && o.state != OrderState.PARTIALLY_FILLED) revert InvalidOrderState();

        uint256 remainingAmount   = o.remainingAmount;
        uint256 makerBondRefund   = o.remainingMakerBondReserve;
        uint256 takerBondRefund   = 0;
        uint256 totalRefund       = remainingAmount + makerBondRefund;

        o.state = OrderState.CANCELED;
        o.remainingAmount = 0;
        o.remainingMakerBondReserve = 0;

        if (totalRefund > 0) {
            IERC20(o.tokenAddress).safeTransfer(o.owner, totalRefund);
        }

        emit OrderCanceled(_orderId, o.side, remainingAmount, makerBondRefund, takerBondRefund);
    }

    /**
     * @notice Public buy order oluşturur.
     *         Buyer, eventual taker olarak kendi toplam taker bond reserve'ini peşin kilitler.
     * @notice Creates a public buy order.
     *         The buyer prepays the full taker bond reserve as the eventual taker.
     */
    function createBuyOrder(
        address _token,
        uint256 _totalAmount,
        uint256 _minFillAmount,
        uint8   _tier,
        bytes32 _orderRef,
        PaymentRiskLevel _paymentRiskLevel
    ) public nonReentrant whenNotPaused returns (uint256 orderId) {
        if (!_isTokenAllowedForBuyOrder(_token)) revert TokenDirectionNotAllowed();
        if (_totalAmount == 0) revert ZeroAmount();
        if (_minFillAmount == 0 || _minFillAmount > _totalAmount) revert InvalidMinFill();
        if (_tier > 4) revert InvalidTier();
        if (_orderRef == bytes32(0)) revert InvalidOrderRef();

        uint8 effectiveTier = _getEffectiveTier(msg.sender);
        if (_tier > effectiveTier) revert TierNotAllowed();

        // [TR] Buy order sahibi child trade'de taker rolünü üstleneceği için
        //      create aşamasında da taker giriş kapısı zorlanır.
        // [EN] Since buy order owner becomes taker in child trades,
        //      enforce taker entry gate at create time as well.
        _enforceTakerEntry(msg.sender, _tier);

        uint256 tierMax = _getTierMaxAmount(_token, _tier);
        if (tierMax > 0 && _totalAmount > tierMax) revert AmountExceedsTierLimit();

        uint256 takerBondBps   = _getTakerBondBps(msg.sender, _tier);
        uint256 takerBondTotal = (_totalAmount * takerBondBps) / BPS_DENOMINATOR;

        orderId = ++orderCounter;
        orders[orderId] = Order({
            id:                         orderId,
            owner:                      msg.sender,
            side:                       OrderSide.BUY_CRYPTO,
            tokenAddress:               _token,
            totalAmount:                _totalAmount,
            remainingAmount:            _totalAmount,
            minFillAmount:              _minFillAmount,
            remainingMakerBondReserve:  0,
            remainingTakerBondReserve:  takerBondTotal,
            takerFeeBpsSnapshot:        uint16(_getCurrentTakerFeeBps(_tier)),
            makerFeeBpsSnapshot:        uint16(_getCurrentMakerFeeBps(_tier)),
            tier:                       _tier,
            paymentRiskLevel:           _paymentRiskLevel,
            state:                      OrderState.OPEN,
            orderRef:                   _orderRef
        });

        if (takerBondTotal > 0) {
            _safeTransferExactIn(IERC20(_token), msg.sender, takerBondTotal);
        }

        emit OrderCreated(
            orderId,
            msg.sender,
            OrderSide.BUY_CRYPTO,
            _token,
            _totalAmount,
            _minFillAmount,
            _tier,
            _paymentRiskLevel,
            _orderRef
        );
    }


    /**
     * @notice Legacy createBuyOrder imzası — geriye dönük uyumluluk için MEDIUM risk varsayımı.
     * @notice Legacy createBuyOrder signature — defaults to MEDIUM risk for backward compatibility.
     */
    function createBuyOrder(
        address _token,
        uint256 _totalAmount,
        uint256 _minFillAmount,
        uint8   _tier,
        bytes32 _orderRef
    ) external returns (uint256 orderId) {
        return createBuyOrder(_token, _totalAmount, _minFillAmount, _tier, _orderRef, PaymentRiskLevel.MEDIUM);
    }

    /**
     * @notice Public buy order'ı exact fill ile child trade'e dönüştürür.
     *         Seller child trade'de maker olur; buyer order owner taker olarak atanır.
     * @notice Converts a public buy order into an exact-fill child trade.
     *         The seller becomes maker in the child trade; the buyer order owner is assigned as taker.
     */
    function fillBuyOrder(
        uint256 _orderId,
        uint256 _fillAmount,
        bytes32 _childListingRef
    ) external nonReentrant whenNotPaused returns (uint256 tradeId) {
        Order storage o = orders[_orderId];

        if (o.side != OrderSide.BUY_CRYPTO) revert OrderSideMismatch();
        if (o.state != OrderState.OPEN && o.state != OrderState.PARTIALLY_FILLED) revert InvalidOrderState();
        if (_fillAmount == 0) revert ZeroAmount();
        // [TR] Child trade linkage için listingRef zorunludur; zero ref event-consumer bütünlüğünü bozar.
        // [EN] listingRef is mandatory for child-trade linkage; zero ref breaks event-consumer integrity.
        if (_childListingRef == bytes32(0)) revert InvalidListingRef();
        if (msg.sender == o.owner) revert SelfTradeForbidden();
        if (_fillAmount > o.remainingAmount) revert FillAmountExceedsRemaining();
        if (_fillAmount < o.minFillAmount && _fillAmount != o.remainingAmount) revert FillAmountBelowMinimum();

        // [TR] Buy order owner, child trade'de taker olacağı için lock benzeri
        //      anti-sybil kapısından fill anında yeniden geçirilir.
        // [EN] Since the buy order owner becomes the taker in the child trade,
        //      the lock-equivalent anti-sybil gate is re-applied at fill time.
        _enforceTakerEntry(o.owner, o.tier);

        uint8 makerEffectiveTier = _getEffectiveTier(msg.sender);
        if (o.tier > makerEffectiveTier) revert TierNotAllowed();

        uint256 makerBondBps = _getMakerBondBps(msg.sender, o.tier);
        uint256 makerBond    = (_fillAmount * makerBondBps) / BPS_DENOMINATOR;
        uint256 totalLock    = _fillAmount + makerBond;

        uint256 takerBondSlice = _proportionalSlice(
            o.remainingTakerBondReserve,
            o.remainingAmount,
            _fillAmount
        );

        o.remainingAmount -= _fillAmount;
        o.remainingTakerBondReserve -= takerBondSlice;
        o.state = o.remainingAmount == 0 ? OrderState.FILLED : OrderState.PARTIALLY_FILLED;

        _safeTransferExactIn(IERC20(o.tokenAddress), msg.sender, totalLock);

        tradeId = ++tradeCounter;
        trades[tradeId] = Trade({
            id:                     tradeId,
            parentOrderId:          _orderId,
            maker:                  msg.sender,
            taker:                  o.owner,
            tokenAddress:           o.tokenAddress,
            cryptoAmount:           _fillAmount,
            makerBond:              makerBond,
            takerBond:              takerBondSlice,
            takerFeeBpsSnapshot:    o.takerFeeBpsSnapshot,
            makerFeeBpsSnapshot:    o.makerFeeBpsSnapshot,
            tier:                   o.tier,
            paymentRiskLevelSnapshot:o.paymentRiskLevel,
            state:                  TradeState.LOCKED,
            ipfsReceiptHash:        "",
            lockedAt:               block.timestamp,
            paidAt:                 0,
            challengedAt:           0,
            cancelProposedByMaker:  false,
            cancelProposedByTaker:  false,
            pingedAt:               0,
            pingedByTaker:          false,
            challengePingedAt:      0,
            challengePingedByMaker: false
        });

        lastTradeAt[o.owner] = block.timestamp;

        emit OrderFilled(_orderId, tradeId, msg.sender, _fillAmount, o.remainingAmount, o.paymentRiskLevel, _childListingRef);

        // [TR] V3 saf modelde child trade otoritesi OrderFilled + getTrade() kombinasyonudur.
        //      Legacy create/lock mirror event zinciri artık üretilmez.
        // [EN] In pure V3, child trade authority is OrderFilled + getTrade().
        //      The legacy create/lock mirror event chain is no longer emitted.
    }

    /**
     * @notice Buy order'ın henüz doldurulmamış kalan kısmını iptal eder.
     *         Yalnız kullanılmamış taker bond reserve'i iade edilir.
     * @notice Cancels the still-unfilled remainder of a buy order.
     *         Only unused taker bond reserve is refunded.
     */
    function cancelBuyOrder(uint256 _orderId) external nonReentrant {
        Order storage o = orders[_orderId];

        if (o.side != OrderSide.BUY_CRYPTO) revert OrderSideMismatch();
        if (msg.sender != o.owner) revert OnlyOrderOwner();
        if (o.state != OrderState.OPEN && o.state != OrderState.PARTIALLY_FILLED) revert InvalidOrderState();

        uint256 remainingAmount   = o.remainingAmount;
        uint256 makerBondRefund   = 0;
        uint256 takerBondRefund   = o.remainingTakerBondReserve;

        o.state = OrderState.CANCELED;
        o.remainingAmount = 0;
        o.remainingTakerBondReserve = 0;

        if (takerBondRefund > 0) {
            IERC20(o.tokenAddress).safeTransfer(o.owner, takerBondRefund);
        }

        emit OrderCanceled(_orderId, o.side, remainingAmount, makerBondRefund, takerBondRefund);
    }

    // ═══════════════════════════════════════════════════
    //  TAKER AKIŞI — Ödeme Bildirme
    //  TAKER FLOW — Report Payment
    // ═══════════════════════════════════════════════════

    /**
     * @notice Taker fiat ödemenin yapıldığını bildirir.
     *         Bu çağrı sonrası grace period ve ilgili dispute yolları açılır.
     * @notice Marks the fiat payment as reported by the taker.
     *         This opens the grace period and the relevant dispute paths.
     */
    function reportPayment(uint256 _tradeId, string calldata _ipfsHash)
        external
        nonReentrant
        inState(_tradeId, TradeState.LOCKED)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.taker) revert OnlyTaker();
        if (bytes(_ipfsHash).length == 0) revert EmptyIpfsHash();

        t.state           = TradeState.PAID;
        t.paidAt          = block.timestamp;
        t.ipfsReceiptHash = _ipfsHash;
        emit PaymentReported(_tradeId, _ipfsHash, block.timestamp);
    }

    /**
     * @notice Maker ödemeyi onaylayıp fonları serbest bırakır.
     *         Contract hakemlik yapmaz; yalnız geçerli state geçişini ve ekonomik dağıtımı uygular.
     * @notice The maker confirms payment and releases funds.
     *         The contract does not arbitrate truth; it only enforces valid state transition and payouts.
     */
    function releaseFunds(uint256 _tradeId)
        external
        nonReentrant
    {
        Trade storage t = trades[_tradeId];
        if (t.state != TradeState.PAID && t.state != TradeState.CHALLENGED) revert CannotReleaseInState();
        if (msg.sender != t.maker) revert OnlyMaker();

        (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond, uint256 decayed) =
            _calculateCurrentAmounts(_tradeId);

        bool makerOpenedDispute = (t.state == TradeState.CHALLENGED);

        t.state = TradeState.RESOLVED;

        if (decayed > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, decayed);
            emit BleedingDecayed(_tradeId, decayed, block.timestamp);
        }

        uint256 takerFee      = (currentCrypto * t.takerFeeBpsSnapshot) / BPS_DENOMINATOR;
        uint256 takerReceives = currentCrypto - takerFee;

        uint256 makerFee          = (currentCrypto * t.makerFeeBpsSnapshot) / BPS_DENOMINATOR;
        uint256 makerBondAfterFee = currentMakerBond > makerFee ? currentMakerBond - makerFee : 0;
        uint256 actualMakerFee    = currentMakerBond > makerFee ? makerFee : currentMakerBond;

        IERC20(t.tokenAddress).safeTransfer(t.taker, takerReceives);
        if (takerFee + actualMakerFee > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, takerFee + actualMakerFee);
        }
        if (makerBondAfterFee > 0) {
            IERC20(t.tokenAddress).safeTransfer(t.maker, makerBondAfterFee);
        }
        if (currentTakerBond > 0) {
            IERC20(t.tokenAddress).safeTransfer(t.taker, currentTakerBond);
        }

        if (makerOpenedDispute) {
            // [TR] CHALLENGED→RESOLVED yolu maker'ın challenge iddiasının başarısızlığı olarak sınıflanır.
            // [EN] CHALLENGED→RESOLVED path is classified as maker challenge-loss semantics.
            _recordDisputeResolution(t.maker, t.taker, false);
        } else {
            _recordManualRelease(t.maker, t.taker);
        }

        emit EscrowReleased(_tradeId, t.maker, t.taker, takerFee, actualMakerFee);
    }

    /**
     * @notice Maker, challenge açmadan önce taker'a uyarı pingi gönderir.
     *         Challenge yolu ile auto-release yolunun aynı anda açılmaması için bu sinyal izlenir.
     * @notice The maker sends a warning ping to the taker before opening a challenge.
     *         This signal also prevents the challenge path and auto-release path from opening simultaneously.
     */
    function pingTakerForChallenge(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.PAID)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.maker) revert OnlyMaker();
        if (block.timestamp < t.paidAt + 24 hours) revert PingCooldownNotElapsed(t.paidAt + 24 hours);
        if (t.challengePingedByMaker) revert AlreadyPinged();
        if (t.pingedByTaker) revert ConflictingPingPath();

        t.challengePingedByMaker = true;
        t.challengePingedAt      = block.timestamp;
        emit MakerPinged(_tradeId, msg.sender, block.timestamp);
    }

    /**
     * @notice Maker dispute akışını başlatır.
     *         Contract bu aşamada kimin haklı olduğunu söylemez; yalnız oyun teorik yolu açar.
     * @notice Opens the dispute path for the maker.
     *         At this stage the contract does not decide who is right; it only opens the game-theoretic path.
     */
    function challengeTrade(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.PAID)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.maker) revert OnlyMaker();
        if (!t.challengePingedByMaker) revert MustPingFirst();
        if (block.timestamp < t.challengePingedAt + 24 hours) revert ResponseWindowActive();

        t.state        = TradeState.CHALLENGED;
        t.challengedAt = block.timestamp;
        emit DisputeOpened(_tradeId, msg.sender, block.timestamp);
    }

    /**
     * @notice Karşılıklı iptal, yalnız iki tarafın imzalı iradesiyle tamamlanır.
     *         Backend bu akışta hakem değildir; imza ve nonce doğrulaması contract içinde yapılır.
     * @notice Mutual cancel completes only with signed intent from both parties.
     *         The backend is not the arbiter here; signature and nonce validation happen inside the contract.
     */
    function proposeOrApproveCancel(
        uint256 _tradeId,
        uint256 _deadline,
        bytes calldata _sig
    ) external nonReentrant {
        Trade storage t = trades[_tradeId];

        if (t.state != TradeState.LOCKED &&
            t.state != TradeState.PAID &&
            t.state != TradeState.CHALLENGED) revert CannotReleaseInState();
        if (block.timestamp > _deadline) revert SignatureExpired();
        if (msg.sender != t.maker && msg.sender != t.taker) revert NotTradeParty();
        if (_deadline > block.timestamp + MAX_CANCEL_DEADLINE) revert DeadlineTooFar();

        uint256 currentNonce = sigNonces[msg.sender][_tradeId];

        bytes32 structHash = keccak256(abi.encode(
            CANCEL_TYPEHASH,
            _tradeId,
            msg.sender,
            currentNonce,
            _deadline
        ));

        bytes32 digest    = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, _sig);
        if (recovered != msg.sender) revert InvalidSignature();

        // [TR] Replay koruması trade-scoped nonce ile uygulanır; başka trade'leri etkilemez.
        // [EN] Replay protection uses trade-scoped nonce and does not affect other trades.
        sigNonces[msg.sender][_tradeId]++;

        if (msg.sender == t.maker) t.cancelProposedByMaker = true;
        else                       t.cancelProposedByTaker = true;

        emit CancelProposed(_tradeId, msg.sender);

        if (t.cancelProposedByMaker && t.cancelProposedByTaker) {
            _executeCancel(_tradeId);
        }
    }

    /**
     * @notice Bleeding süresi dolduğunda kalan her şey burn edilir.
     *         Bu, anlaşmazlığı yorumlayarak değil zaman ve maliyet üzerinden çözen son çıkıştır.
     * @notice Burns all remaining value when the bleeding window is exhausted.
     *         This is the final escape hatch that resolves by time and cost, not by interpretation.
     */
    function burnExpired(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.CHALLENGED)
    {
        Trade storage t = trades[_tradeId];
        if (block.timestamp < t.challengedAt + MAX_BLEEDING) revert BurnPeriodNotReached();

        (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond,) =
            _calculateCurrentAmounts(_tradeId);

        uint256 totalBurn = currentCrypto + currentMakerBond + currentTakerBond;

        t.state = TradeState.BURNED;

        if (totalBurn > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, totalBurn);
        }

        _recordBurn(t.maker, t.taker);

        emit EscrowBurned(_tradeId, totalBurn);
    }

    /**
     * @notice Taker, sessiz kalan maker için liveness pingi gönderir.
     *         Bu ping auto-release yolunu açar; contract iki ping yolunun çakışmasına izin vermez.
     * @notice The taker sends a liveness ping to an inactive maker.
     *         This opens the auto-release path; the contract does not allow both ping paths to coexist.
     */
    function pingMaker(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.PAID)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.taker) revert OnlyTaker();
        if (block.timestamp < t.paidAt + GRACE_PERIOD) revert PingCooldownNotElapsed(t.paidAt + GRACE_PERIOD);
        if (t.pingedByTaker) revert AlreadyPinged();
        if (t.challengePingedByMaker) revert ConflictingPingPath();

        t.pingedByTaker = true;
        t.pingedAt      = block.timestamp;
        emit MakerPinged(_tradeId, msg.sender, block.timestamp);
    }

    /**
     * @notice Maker cevap vermezse taker auto-release yolunu kullanabilir.
     *         Contract yine niyeti yorumlamaz; yalnız ön koşullar ve ekonomik sonucu uygular.
     * @notice If the maker stays inactive, the taker may use the auto-release path.
     *         The contract still does not interpret intent; it only enforces preconditions and economic outcome.
     */
    function autoRelease(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.PAID)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.taker) revert OnlyTaker();
        if (!t.pingedByTaker) revert MustPingFirst();
        if (block.timestamp < t.pingedAt + 24 hours) revert ResponseWindowActive();

        (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond, uint256 decayed) =
            _calculateCurrentAmounts(_tradeId);

        t.state = TradeState.RESOLVED;

        if (decayed > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, decayed);
            emit BleedingDecayed(_tradeId, decayed, block.timestamp);
        }

        uint256 makerPenalty      = (currentMakerBond * AUTO_RELEASE_PENALTY_BPS) / BPS_DENOMINATOR;
        uint256 takerPenalty      = (currentTakerBond * AUTO_RELEASE_PENALTY_BPS) / BPS_DENOMINATOR;
        uint256 makerReceives     = currentMakerBond - makerPenalty;
        uint256 takerReceivesBond = currentTakerBond - takerPenalty;
        uint256 totalPenalty      = makerPenalty + takerPenalty;

        IERC20(t.tokenAddress).safeTransfer(t.taker, currentCrypto);
        if (makerReceives > 0) IERC20(t.tokenAddress).safeTransfer(t.maker, makerReceives);
        if (takerReceivesBond > 0) IERC20(t.tokenAddress).safeTransfer(t.taker, takerReceivesBond);
        if (totalPenalty > 0) IERC20(t.tokenAddress).safeTransfer(treasury, totalPenalty);

        _recordAutoRelease(t.maker, t.taker);

        // Event payload order must stay aligned with EscrowReleased(takerFee, makerFee)
        // so off-chain listeners book penalties to the correct party.
        emit EscrowReleased(_tradeId, t.maker, t.taker, takerPenalty, makerPenalty);
    }

    // ═══════════════════════════════════════════════════
    //  PARTIAL SETTLEMENT — ON-CHAIN SPLIT AGREEMENT
    // ═══════════════════════════════════════════════════

    /**
     * @notice Trade taraflarından biri split settlement teklifi açar.
     *         Bu teklif yalnızca on-chain taraf iradesiyle kurulabilir.
     * @notice One trade party opens a split-settlement proposal.
     *         The proposal can only be formed by on-chain party consent.
     */
    function proposeSettlement(
        uint256 _tradeId,
        uint16 _makerShareBps,
        uint64 _expiresAt
    ) external nonReentrant {
        Trade storage t = trades[_tradeId];
        if (!_isSettlementAllowedTradeState(t.state)) revert SettlementNotAllowedInState();
        if (msg.sender != t.maker && msg.sender != t.taker) revert NotTradeParty();

        SettlementProposal storage current = settlementProposalsByTrade[_tradeId];
        _expireSettlementProposalIfNeeded(_tradeId, current);
        if (current.state == SettlementProposalState.PROPOSED) revert ActiveSettlementProposalExists();
        if (current.state == SettlementProposalState.FINALIZED) revert SettlementAlreadyFinalized();

        if (_makerShareBps > BPS_DENOMINATOR) revert InvalidSettlementSplit();
        uint16 takerShareBps = uint16(BPS_DENOMINATOR - _makerShareBps);
        if (uint256(_makerShareBps) + uint256(takerShareBps) != BPS_DENOMINATOR) revert InvalidSettlementSplit();

        uint256 nowTs = block.timestamp;
        if (_expiresAt <= nowTs) revert InvalidSettlementDeadline();
        if (_expiresAt < nowTs + MIN_SETTLEMENT_EXPIRY) revert InvalidSettlementDeadline();
        if (_expiresAt > nowTs + MAX_CANCEL_DEADLINE) revert InvalidSettlementDeadline();

        uint256 proposalId = ++settlementProposalNonceByTrade[_tradeId];
        settlementProposalsByTrade[_tradeId] = SettlementProposal({
            id: proposalId,
            tradeId: _tradeId,
            proposer: msg.sender,
            makerShareBps: _makerShareBps,
            takerShareBps: takerShareBps,
            proposedAt: uint64(nowTs),
            expiresAt: _expiresAt,
            state: SettlementProposalState.PROPOSED
        });

        emit SettlementProposed(_tradeId, proposalId, msg.sender, _makerShareBps, takerShareBps, _expiresAt);
    }

    /**
     * @notice Karşı taraf aktif settlement teklifini reddeder.
     * @notice Counterparty rejects an active settlement proposal.
     */
    function rejectSettlement(uint256 _tradeId) external nonReentrant {
        Trade storage t = trades[_tradeId];
        SettlementProposal storage sp = settlementProposalsByTrade[_tradeId];

        if (sp.state == SettlementProposalState.FINALIZED) revert SettlementAlreadyFinalized();
        _expireSettlementProposalIfNeeded(_tradeId, sp);
        if (sp.state == SettlementProposalState.EXPIRED) revert SettlementProposalExpired();
        if (sp.state != SettlementProposalState.PROPOSED) revert NoActiveSettlementProposal();
        if (msg.sender != t.maker && msg.sender != t.taker) revert NotTradeParty();
        if (msg.sender == sp.proposer) revert OnlySettlementCounterparty();

        sp.state = SettlementProposalState.REJECTED;
        emit SettlementRejected(_tradeId, sp.id, msg.sender);
    }

    /**
     * @notice Teklif sahibi aktif settlement teklifini geri çeker.
     * @notice Proposal owner withdraws an active settlement proposal.
     */
    function withdrawSettlement(uint256 _tradeId) external nonReentrant {
        SettlementProposal storage sp = settlementProposalsByTrade[_tradeId];

        if (sp.state == SettlementProposalState.FINALIZED) revert SettlementAlreadyFinalized();
        _expireSettlementProposalIfNeeded(_tradeId, sp);
        if (sp.state == SettlementProposalState.EXPIRED) revert SettlementProposalExpired();
        if (sp.state != SettlementProposalState.PROPOSED) revert NoActiveSettlementProposal();
        if (sp.proposer != msg.sender) revert OnlySettlementProposer();

        sp.state = SettlementProposalState.WITHDRAWN;
        emit SettlementWithdrawn(_tradeId, sp.id, msg.sender);
    }

    /**
     * @notice Süresi dolan settlement teklifini herkes expire edebilir.
     * @notice Anyone can expire a settlement proposal once its deadline passes.
     */
    function expireSettlement(uint256 _tradeId) external nonReentrant {
        SettlementProposal storage sp = settlementProposalsByTrade[_tradeId];
        if (sp.state == SettlementProposalState.FINALIZED) revert SettlementAlreadyFinalized();
        if (sp.state != SettlementProposalState.PROPOSED) revert NoActiveSettlementProposal();
        if (block.timestamp <= sp.expiresAt) revert SettlementProposalNotExpired();

        sp.state = SettlementProposalState.EXPIRED;
        emit SettlementExpired(_tradeId, sp.id);
    }

    /**
     * @notice Karşı taraf aktif split settlement teklifini kabul eder ve fon dağıtımı yapılır.
     *         Trade terminal state olarak RESOLVED'a çekilir.
     * @notice Counterparty accepts active split settlement proposal and executes payouts.
     *         Trade transitions to RESOLVED as terminal state.
     */
    function acceptSettlement(uint256 _tradeId) external nonReentrant {
        Trade storage t = trades[_tradeId];
        SettlementProposal storage sp = settlementProposalsByTrade[_tradeId];

        if (sp.state == SettlementProposalState.FINALIZED) revert SettlementAlreadyFinalized();
        _expireSettlementProposalIfNeeded(_tradeId, sp);
        if (sp.state == SettlementProposalState.EXPIRED) revert SettlementProposalExpired();
        if (sp.state != SettlementProposalState.PROPOSED) revert NoActiveSettlementProposal();
        if (!_isSettlementAllowedTradeState(t.state)) revert SettlementNotAllowedInState();
        if (msg.sender != t.maker && msg.sender != t.taker) revert NotTradeParty();
        if (msg.sender == sp.proposer) revert OnlySettlementCounterparty();
        if (uint256(sp.makerShareBps) + uint256(sp.takerShareBps) != BPS_DENOMINATOR) revert InvalidSettlementSplit();

        uint256 settlementPool = t.cryptoAmount + t.makerBond + t.takerBond;
        uint256 makerPayout = (settlementPool * sp.makerShareBps) / BPS_DENOMINATOR;
        uint256 takerPayout = settlementPool - makerPayout;

        // [TR] Fee snapshot modeli release/autoRelease yolunda principal ağırlıklıdır.
        //      Partial settlement'te principal+bond tek havuz split edildiği için belirsiz
        //     /çifte kesinti riski oluşturmamak adına MVP'de fee=0 uygulanır.
        // [EN] Fee snapshots are principal-oriented on release/autoRelease paths.
        //      Since partial settlement splits a unified principal+bond pool, MVP keeps fee=0
        //      to avoid semantic ambiguity and accidental double-charging.
        uint256 takerFee = 0;
        uint256 makerFee = 0;

        sp.state = SettlementProposalState.FINALIZED;
        t.state = TradeState.RESOLVED;

        if (makerPayout > 0) IERC20(t.tokenAddress).safeTransfer(t.maker, makerPayout);
        if (takerPayout > 0) IERC20(t.tokenAddress).safeTransfer(t.taker, takerPayout);

        _recordPartialSettlement(t.maker, t.taker);

        emit SettlementFinalized(_tradeId, sp.id, makerPayout, takerPayout, takerFee, makerFee);
    }

    /**
     * @notice Karşılıklı iptalin fon dağıtımını yürütür.
     *         LOCKED ile PAID/CHALLENGED akışları ekonomik olarak bilinçli biçimde ayrılır.
     * @notice Executes the payout logic for mutual cancel.
     *         LOCKED and PAID/CHALLENGED flows are intentionally treated differently economically.
     */
    function _executeCancel(uint256 _tradeId) internal {
        Trade storage t = trades[_tradeId];
        TradeState currentState = t.state;

        (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond, uint256 decayed) =
            _calculateCurrentAmounts(_tradeId);

        t.state = TradeState.CANCELED;

        if (decayed > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, decayed);
            emit BleedingDecayed(_tradeId, decayed, block.timestamp);
        }

        uint256 takerFee = 0;
        uint256 makerFee = 0;

        if (currentState == TradeState.PAID || currentState == TradeState.CHALLENGED) {
            takerFee = (currentCrypto * t.takerFeeBpsSnapshot) / BPS_DENOMINATOR;
            makerFee = (currentCrypto * t.makerFeeBpsSnapshot) / BPS_DENOMINATOR;
        }

        uint256 totalFeeToTreasury = 0;
        uint256 makerRefund;
        uint256 takerRefund;

        if (currentMakerBond >= makerFee) {
            makerRefund = currentCrypto + (currentMakerBond - makerFee);
            totalFeeToTreasury += makerFee;
        } else {
            makerRefund = currentCrypto;
            totalFeeToTreasury += currentMakerBond;
        }

        if (currentTakerBond >= takerFee) {
            takerRefund = currentTakerBond - takerFee;
            totalFeeToTreasury += takerFee;
        } else {
            takerRefund = 0;
            totalFeeToTreasury += currentTakerBond;
        }

        if (totalFeeToTreasury > 0) IERC20(t.tokenAddress).safeTransfer(treasury, totalFeeToTreasury);
        if (makerRefund > 0) IERC20(t.tokenAddress).safeTransfer(t.maker, makerRefund);
        if (takerRefund > 0) IERC20(t.tokenAddress).safeTransfer(t.taker, takerRefund);

        _recordMutualCancel(t.maker, t.taker);

        emit EscrowCanceled(_tradeId, makerRefund, takerRefund);
    }

    /**
     * @notice Bleeding sonrası anlık miktarları hesaplar.
     *         Bu fonksiyon yorum yapmaz; yalnız zaman bazlı ekonomik gerçeği çıkarır.
     * @notice Computes current amounts after bleeding.
     *         This function does not interpret intent; it only derives the time-based economic state.
     */
    function _calculateCurrentAmounts(uint256 _tradeId)
        internal
        view
        returns (
            uint256 currentCrypto,
            uint256 currentMakerBond,
            uint256 currentTakerBond,
            uint256 totalDecayed
        )
    {
        Trade storage t = trades[_tradeId];

        if (t.state != TradeState.CHALLENGED || t.challengedAt == 0) {
            return (t.cryptoAmount, t.makerBond, t.takerBond, 0);
        }

        uint256 elapsed = block.timestamp - t.challengedAt;
        if (elapsed > MAX_BLEEDING) elapsed = MAX_BLEEDING;

        uint256 bleedingElapsed = elapsed > GRACE_PERIOD ? elapsed - GRACE_PERIOD : 0;

        uint256 makerBondDecayed = (t.makerBond * MAKER_BOND_DECAY_BPS_H * bleedingElapsed) / (BPS_DENOMINATOR * SECONDS_PER_HOUR);
        if (makerBondDecayed > t.makerBond) makerBondDecayed = t.makerBond;

        uint256 takerBondDecayed = (t.takerBond * TAKER_BOND_DECAY_BPS_H * bleedingElapsed) / (BPS_DENOMINATOR * SECONDS_PER_HOUR);
        if (takerBondDecayed > t.takerBond) takerBondDecayed = t.takerBond;

        currentMakerBond = t.makerBond - makerBondDecayed;
        currentTakerBond = t.takerBond - takerBondDecayed;

        uint256 cryptoDecayed = 0;
        if (bleedingElapsed > USDT_DECAY_START) {
            uint256 usdtElapsed = bleedingElapsed - USDT_DECAY_START;
            cryptoDecayed = (t.cryptoAmount * CRYPTO_DECAY_BPS_H * 2 * usdtElapsed) / (BPS_DENOMINATOR * SECONDS_PER_HOUR);
            if (cryptoDecayed > t.cryptoAmount) cryptoDecayed = t.cryptoAmount;
        }

        currentCrypto = t.cryptoAmount - cryptoDecayed;
        totalDecayed  = makerBondDecayed + takerBondDecayed + cryptoDecayed;
    }

    /**
     * @notice Maker bond oranını reputation'a göre ayarlar.
     *         Contract ekonomik sürtünmeyi kullanıcı geçmişine göre modüle eder.
     * @notice Adjusts maker bond based on reputation.
     *         The contract modulates economic friction based on user history.
     */
    function _getMakerBondBps(address _maker, uint8 _tier)
        internal
        view
        returns (uint256 bondBps)
    {
        if      (_tier == 0) return MAKER_BOND_TIER0_BPS;
        else if (_tier == 1) bondBps = MAKER_BOND_TIER1_BPS;
        else if (_tier == 2) bondBps = MAKER_BOND_TIER2_BPS;
        else if (_tier == 3) bondBps = MAKER_BOND_TIER3_BPS;
        else                 bondBps = MAKER_BOND_TIER4_BPS;

        Reputation storage rep = reputation[_maker];
        if (rep.riskPoints == 0 && rep.successfulTrades > 0) {
            bondBps = bondBps > GOOD_REP_DISCOUNT_BPS ? bondBps - GOOD_REP_DISCOUNT_BPS : 0;
        } else if (rep.riskPoints > 0) {
            bondBps += BAD_REP_PENALTY_BPS;
        }
    }

    /**
     * @notice Taker bond oranını reputation'a göre ayarlar.
     *         Buradaki amaç ahlaki hüküm değil, risk fiyatlamasıdır.
     * @notice Adjusts taker bond based on reputation.
     *         The purpose here is not moral judgment, but risk pricing.
     */
    function _getTakerBondBps(address _taker, uint8 _tier)
        internal
        view
        returns (uint256 bondBps)
    {
        if      (_tier == 0) return TAKER_BOND_TIER0_BPS;
        else if (_tier == 1) bondBps = TAKER_BOND_TIER1_BPS;
        else if (_tier == 2) bondBps = TAKER_BOND_TIER2_BPS;
        else if (_tier == 3) bondBps = TAKER_BOND_TIER3_BPS;
        else                 bondBps = TAKER_BOND_TIER4_BPS;

        Reputation storage rep = reputation[_taker];
        if (rep.riskPoints == 0 && rep.successfulTrades > 0) {
            bondBps = bondBps > GOOD_REP_DISCOUNT_BPS ? bondBps - GOOD_REP_DISCOUNT_BPS : 0;
        } else if (rep.riskPoints > 0) {
            bondBps += BAD_REP_PENALTY_BPS;
        }
    }

    function _recordManualRelease(address _maker, address _taker) internal {
        Reputation storage makerRep = reputation[_maker];
        Reputation storage takerRep = reputation[_taker];
        makerRep.successfulTrades++;
        takerRep.successfulTrades++;
        makerRep.manualReleaseCount++;
        takerRep.manualReleaseCount++;

        _applyPositiveSignal(_maker, makerRep, manualReleaseRewardPts);
        _applyPositiveSignal(_taker, takerRep, manualReleaseRewardPts);
        _emitReputationUpdated(_maker, makerRep);
        _emitReputationUpdated(_taker, takerRep);
    }

    function _recordAutoRelease(address _maker, address _taker) internal {
        Reputation storage makerRep = reputation[_maker];
        Reputation storage takerRep = reputation[_taker];
        takerRep.successfulTrades++;
        makerRep.autoReleaseCount++;
        takerRep.autoReleaseCount++;
        makerRep.failedDisputes++;

        _applyNegativeSignal(_maker, makerRep, autoReleasePenaltyPts);
        _applyPositiveSignal(_taker, takerRep, manualReleaseRewardPts);
        _emitReputationUpdated(_maker, makerRep);
        _emitReputationUpdated(_taker, takerRep);
    }

    function _recordMutualCancel(address _maker, address _taker) internal {
        Reputation storage makerRep = reputation[_maker];
        Reputation storage takerRep = reputation[_taker];
        makerRep.mutualCancelCount++;
        takerRep.mutualCancelCount++;

        _applyNegativeSignal(_maker, makerRep, mutualCancelPenaltyPts);
        _applyNegativeSignal(_taker, takerRep, mutualCancelPenaltyPts);
        _emitReputationUpdated(_maker, makerRep);
        _emitReputationUpdated(_taker, takerRep);
    }

    function _recordDisputeResolution(address _maker, address _taker, bool makerWon) internal {
        Reputation storage makerRep = reputation[_maker];
        Reputation storage takerRep = reputation[_taker];
        makerRep.disputedResolvedCount++;
        takerRep.disputedResolvedCount++;

        if (makerWon) {
            makerRep.successfulTrades++;
            makerRep.disputeWinCount++;
            takerRep.disputeLossCount++;
            takerRep.failedDisputes++;
            _applyPositiveSignal(_maker, makerRep, disputeWinRewardPts);
            _applyNegativeSignal(_taker, takerRep, disputeLossPenaltyPts);
        } else {
            takerRep.successfulTrades++;
            takerRep.disputeWinCount++;
            makerRep.disputeLossCount++;
            makerRep.failedDisputes++;
            _applyPositiveSignal(_taker, takerRep, disputeWinRewardPts);
            _applyNegativeSignal(_maker, makerRep, disputeLossPenaltyPts);
        }

        _emitReputationUpdated(_maker, makerRep);
        _emitReputationUpdated(_taker, takerRep);
    }

    function _recordBurn(address _maker, address _taker) internal {
        Reputation storage makerRep = reputation[_maker];
        Reputation storage takerRep = reputation[_taker];
        makerRep.burnCount++;
        takerRep.burnCount++;
        makerRep.failedDisputes++;
        takerRep.failedDisputes++;

        _applyNegativeSignal(_maker, makerRep, burnPenaltyPts);
        _applyNegativeSignal(_taker, takerRep, burnPenaltyPts);
        _emitReputationUpdated(_maker, makerRep);
        _emitReputationUpdated(_taker, takerRep);
    }

    function _recordPartialSettlement(address _maker, address _taker) internal {
        Reputation storage makerRep = reputation[_maker];
        Reputation storage takerRep = reputation[_taker];
        makerRep.successfulTrades++;
        takerRep.successfulTrades++;
        makerRep.partialSettlementCount++;
        takerRep.partialSettlementCount++;

        // [TR] Partial settlement ceza semantiği taşımaz; risk/failure artışı üretmez.
        // [EN] Partial settlement is non-penal; it never increments risk/failure paths.
        _emitReputationUpdated(_maker, makerRep);
        _emitReputationUpdated(_taker, takerRep);
    }

    function _applyPositiveSignal(address _wallet, Reputation storage rep, uint32 rewardPts) internal {
        uint64 nowTs = uint64(block.timestamp);
        rep.lastPositiveEventAt = nowTs;

        // [TR] Başarı geçmişi oluştuğunda firstSuccessfulTradeAt, ödül puanı sıfır olsa bile bir kez initialize edilir.
        // [EN] Initialize firstSuccessfulTradeAt once when success history exists, even if reward points are zero.
        if (firstSuccessfulTradeAt[_wallet] == 0 && rep.successfulTrades > 0) {
            firstSuccessfulTradeAt[_wallet] = block.timestamp;
        }

        if (rewardPts > 0) {
            if (rep.riskPoints <= rewardPts) rep.riskPoints = 0;
            else rep.riskPoints -= rewardPts;
        }
        _refreshTierAndBanState(_wallet, rep);
    }

    function _applyNegativeSignal(address _wallet, Reputation storage rep, uint32 penaltyPts) internal {
        uint64 nowTs = uint64(block.timestamp);
        rep.lastNegativeEventAt = nowTs;

        if (penaltyPts > 0) {
            uint256 nextRisk = uint256(rep.riskPoints) + penaltyPts;
            rep.riskPoints = nextRisk > type(uint32).max ? type(uint32).max : uint32(nextRisk);
        }
        _refreshTierAndBanState(_wallet, rep);
    }

    function _refreshTierAndBanState(address _wallet, Reputation storage rep) internal {
        if (rep.riskPoints >= banRiskPointsThreshold) {
            if (block.timestamp > rep.bannedUntil) {
                rep.consecutiveBans++;
                // [TR] Overflow güvenliği için üstel katsayı saturating shift ile sınırlandırılır.
                // [EN] Exponential factor uses saturating shift bounds for overflow-safe escalation.
                uint256 escalationSteps = rep.consecutiveBans > 1 ? uint256(rep.consecutiveBans - 1) : 0;
                if (escalationSteps > 31) escalationSteps = 31;
                uint256 banWindow = uint256(baseBanDuration) * (uint256(1) << escalationSteps);
                if (banWindow > MAX_BAN_DURATION) banWindow = MAX_BAN_DURATION;
                rep.bannedUntil = uint64(block.timestamp + banWindow);
            }
            if (!hasTierPenalty[_wallet]) {
                hasTierPenalty[_wallet] = true;
                maxAllowedTier[_wallet] = 4;
            }
            if (maxAllowedTier[_wallet] > 0) {
                maxAllowedTier[_wallet] = maxAllowedTier[_wallet] - 1;
            }
        }
    }

    function _emitReputationUpdated(address _wallet, Reputation storage rep) internal {
        emit ReputationUpdated(
            _wallet,
            rep.successfulTrades,
            rep.failedDisputes,
            rep.bannedUntil,
            _getEffectiveTier(_wallet),
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

    /**
     * @notice Temiz dönem sonrası ardışık ban geçmişini sıfırlar.
     *         Bu, cezanın sonsuza kadar taşınmaması için kontrollü bir unutma kuralıdır.
     * @notice Resets consecutive ban history after a clean period.
     *         This is a controlled forgetting rule so penalties do not persist forever.
     */
    function decayReputation(address _wallet) external nonReentrant {
        Reputation storage rep = reputation[_wallet];
        if (rep.bannedUntil == 0) revert NoPriorBanHistory();
        if (block.timestamp <= rep.bannedUntil + cleanPeriod) revert CleanPeriodNotElapsed();
        if (rep.consecutiveBans == 0) revert NoBansToReset();

        rep.consecutiveBans = 0;
        rep.riskPoints = 0;
        hasTierPenalty[_wallet] = false;
        maxAllowedTier[_wallet] = 4;
        _emitReputationUpdated(_wallet, rep);
    }

    /**
     * @notice Kullanıcının efektif tier'ını hesaplar.
     *         Bu sonuç performans, zaman ve ceza tavanının birleşimidir.
     * @notice Computes the effective tier for a wallet.
     *         The result is a combination of performance, time, and penalty ceiling.
     */
    function _getEffectiveTier(address _wallet) internal view returns (uint8) {
        Reputation storage rep = reputation[_wallet];
        uint8 calculatedTier;

        if      (rep.successfulTrades >= tierMinSuccessfulTrades[4] && rep.riskPoints <= tierMaxRiskPoints[4]) calculatedTier = 4;
        else if (rep.successfulTrades >= tierMinSuccessfulTrades[3] && rep.riskPoints <= tierMaxRiskPoints[3]) calculatedTier = 3;
        else if (rep.successfulTrades >= tierMinSuccessfulTrades[2] && rep.riskPoints <= tierMaxRiskPoints[2]) calculatedTier = 2;
        else if (rep.successfulTrades >= tierMinSuccessfulTrades[1] && rep.riskPoints <= tierMaxRiskPoints[1]) calculatedTier = 1;
        else                                                                                                     calculatedTier = 0;

        if (calculatedTier > 0) {
            if (firstSuccessfulTradeAt[_wallet] == 0 ||
                block.timestamp < firstSuccessfulTradeAt[_wallet] + MIN_ACTIVE_PERIOD) {
                calculatedTier = 0;
            }
        }

        if (!hasTierPenalty[_wallet]) return calculatedTier;
        return calculatedTier > maxAllowedTier[_wallet] ? maxAllowedTier[_wallet] : calculatedTier;
    }

    /**
     * @notice Tier başına izin verilen maksimum escrow miktarını döndürür.
     *         Tier 4 bilinçli olarak sınırsızdır.
     * @notice Returns the maximum escrow amount allowed for each tier.
     *         Tier 4 is intentionally unlimited.
     */
    function _getTierMaxAmount(address _token, uint8 _tier) internal view returns (uint256) {
        if (_tier > 3) return 0;
        return tokenConfigs[_token].tierMaxAmountsBaseUnit[_tier];
    }

    /**
     * @notice Token config'i UI/backend read-model katmanları için döndürür.
     *         tierMaxAmountsBaseUnit değerleri token'ın base-unit cinsindendir.
     * @notice Returns token config for UI/backend read-model layers.
     *         tierMaxAmountsBaseUnit values are in token base units.
     */
    function getTokenConfig(address _token)
        external
        view
        returns (
            bool supported,
            bool allowSellOrders,
            bool allowBuyOrders,
            uint8 decimals,
            uint256[4] memory tierMaxAmountsBaseUnit
        )
    {
        TokenConfig storage cfg = tokenConfigs[_token];
        supported = cfg.supported;
        allowSellOrders = cfg.allowSellOrders;
        allowBuyOrders = cfg.allowBuyOrders;
        decimals = cfg.decimals;
        tierMaxAmountsBaseUnit = cfg.tierMaxAmountsBaseUnit;
    }

    /**
     * @notice Tier başına token-spesifik maksimum escrow miktarını döndürür.
     *         Dönüş değeri token base-unit cinsindendir. Tier 4 sınırsızdır.
     * @notice Returns token-specific max escrow amount by tier.
     *         Return value is in token base units. Tier 4 is unlimited.
     */
    function getTierMaxAmount(address _token, uint8 _tier) external view returns (uint256) {
        if (_tier > 4) revert InvalidTier();
        if (_tier == 4) return 0;
        return tokenConfigs[_token].tierMaxAmountsBaseUnit[_tier];
    }

    /**
     * @notice Kullanıcının reputation özetini döndürür.
     *         Frontend bu veriyi gösterir; hakemlik mantığı yine contract içindedir.
     * @notice Returns the reputation summary for a wallet.
     *         The frontend may display this data, but adjudication logic still lives in the contract.
     */
    function getReputation(address _wallet)
        external
        view
        returns (
            uint256 successful,
            uint256 failed,
            uint256 bannedUntil,
            uint256 consecutiveBans,
            uint8   effectiveTier,
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
        )
    {
        Reputation storage rep = reputation[_wallet];
        return (
            rep.successfulTrades,
            rep.failedDisputes,
            rep.bannedUntil,
            rep.consecutiveBans,
            _getEffectiveTier(_wallet),
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

    /**
     * @notice İlk başarılı işlem zamanını döndürür.
     *         Tier yükselişinin zaman bileşeni frontend tarafından da açıklanabilir olsun diye ayrıdır.
     * @notice Returns the timestamp of the first successful trade.
     *         Kept separate so the time component of tier progression can also be explained in the frontend.
     */
    function getFirstSuccessfulTradeAt(address _wallet) external view returns (uint256) {
        return firstSuccessfulTradeAt[_wallet];
    }

    /**
     * @notice Cooldown kalan süresini döndürür.
     *         Bu bilgi UX içindir; cooldown kuralının kendisi yine contract tarafından zorlanır.
     * @notice Returns the remaining cooldown time.
     *         This value is for UX; the cooldown rule itself is still enforced by the contract.
     */
    function getCooldownRemaining(address _wallet) external view returns (uint256) {
        uint256 last = lastTradeAt[_wallet];
        if (last == 0) return 0;

        uint256 infoCooldown = _getInformationalCooldown();
        if (infoCooldown == 0) return 0;

        uint256 cooldownEnd = last + infoCooldown;
        if (block.timestamp >= cooldownEnd) return 0;
        return cooldownEnd - block.timestamp;
    }

    /**
     * @notice Trade verisini named field erişimiyle okunabilir kılmak için döndürür.
     * @notice Returns the trade struct so consumers can read it with meaningful field semantics.
     */
    function getTrade(uint256 _tradeId) external view returns (Trade memory) {
        return trades[_tradeId];
    }

    /**
     * @notice Trade'e bağlı settlement teklifini döndürür.
     *         Bu getter yalnız mirror/UI tüketimi içindir; authority yine state-changing fonksiyonlardadır.
     * @notice Returns the settlement proposal associated with a trade.
     *         This getter is for mirror/UI consumption only; authority remains in state-changing functions.
     */
    function getSettlementProposal(uint256 _tradeId) external view returns (SettlementProposal memory) {
        return settlementProposalsByTrade[_tradeId];
    }

    /**
     * @notice Parent order verisini döndürür.
     *         Frontend ve backend bu katmanı read-model olarak kullanabilir.
     * @notice Returns the parent order struct.
     *         Frontend and backend may use this layer as a read model.
     */
    function getOrder(uint256 _orderId) external view returns (Order memory) {
        return orders[_orderId];
    }

    /**
     * @notice Güncel global fee config'i döndürür.
     *         Aktif trade'ler yine snapshot ile korunur.
     * @notice Returns the current global fee config.
     *         Active trades remain protected by their snapshots.
     */
    function getFeeConfig() external view returns (uint256 currentTakerFeeBps, uint256 currentMakerFeeBps) {
        return (takerFeeBps, makerFeeBps);
    }

    /**
     * @notice Güncel global cooldown config'i döndürür.
     * @notice Returns the current global cooldown config.
     */
    function getCooldownConfig() external view returns (uint256 currentTier0TradeCooldown, uint256 currentTier1TradeCooldown) {
        return (tier0TradeCooldown, tier1TradeCooldown);
    }

    /**
     * @notice Bleeding sonrası güncel ekonomik durumu döndürür.
     *         Bu view fonksiyonu üçüncü tarafların contract state'ini doğrulamasını kolaylaştırır.
     * @notice Returns the current economic state after bleeding.
     *         This view makes it easier for third parties to verify contract state directly.
     */
    function getCurrentAmounts(uint256 _tradeId)
        external
        view
        returns (
            uint256 currentCrypto,
            uint256 currentMakerBond,
            uint256 currentTakerBond,
            uint256 totalDecayed
        )
    {
        return _calculateCurrentAmounts(_tradeId);
    }

    /**
     * @notice Anti-sybil uygunluk özetini döndürür.
     *         Bu helper bilgi verir; bağlayıcı karar yine state-changing fonksiyonlarda alınır.
     * @notice Returns a summary of anti-sybil eligibility.
     *         This helper is informational; the binding decision is still made in state-changing functions.
     */
    function antiSybilCheck(address _wallet)
        external
        view
        returns (bool aged, bool funded, bool cooldownOk)
    {
        aged = walletRegisteredAt[_wallet] != 0 &&
               block.timestamp >= walletRegisteredAt[_wallet] + WALLET_AGE_MIN;

        funded = _wallet.balance >= DUST_LIMIT;

        uint256 infoCooldown = _getInformationalCooldown();
        cooldownOk = infoCooldown == 0 ||
                     lastTradeAt[_wallet] == 0 ||
                     block.timestamp >= lastTradeAt[_wallet] + infoCooldown;
    }

    /**
     * @notice Frontend imzalama akışları için EIP-712 domain separator döndürür.
     * @notice Returns the EIP-712 domain separator for frontend signing flows.
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Hazine adresini günceller.
     *         Treasury payout yönü protokol ekonomisinin canonical parçasıdır.
     * @notice Updates the treasury address.
     *         Treasury payout routing is a canonical part of the protocol economy.
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert OwnableInvalidOwner(address(0));
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /**
     * @notice Güncel fee config'ini owner seviyesinde günceller.
     *         Yeni trade / yeni order açılışları yeni değerleri kullanır;
     *         mevcut aktif trade'ler fee snapshot ile korunur.
     *         Not: Bu fonksiyon fee modelini değiştirmez (taker/maker ayrı kalır,
     *         snapshot davranışı korunur). Yalnız admin authority daha dar bir
     *         ekonomik üst sınırla sınırlandırılır.
     * @notice Updates the current fee config at owner level.
     *         New trades / new orders use the new values;
     *         existing active trades remain protected by fee snapshots.
     *         Note: This does not change the fee model (separate taker/maker,
     *         snapshots preserved). It only restricts admin authority with a
     *         tighter economic upper bound.
     */
    function setFeeConfig(uint256 _takerFeeBps, uint256 _makerFeeBps) external onlyOwner {
        if (_takerFeeBps > type(uint16).max) revert FeeBpsExceedsUint16(_takerFeeBps);
        if (_makerFeeBps > type(uint16).max) revert FeeBpsExceedsUint16(_makerFeeBps);
        if (_takerFeeBps > MAX_FEE_CONFIG_BPS) revert FeeBpsExceedsEconomicLimit(_takerFeeBps);
        if (_makerFeeBps > MAX_FEE_CONFIG_BPS) revert FeeBpsExceedsEconomicLimit(_makerFeeBps);

        takerFeeBps = _takerFeeBps;
        makerFeeBps = _makerFeeBps;
        emit FeeConfigUpdated(_takerFeeBps, _makerFeeBps);
    }

    /**
     * @notice Güncel cooldown config'ini owner seviyesinde günceller.
     *         Bu değişiklik yeni lock / fill girişlerinde uygulanır.
     * @notice Updates the current cooldown config at owner level.
     *         The change applies to new lock / fill entries.
     */
    function setCooldownConfig(uint256 _tier0TradeCooldown, uint256 _tier1TradeCooldown) external onlyOwner {
        if (_tier0TradeCooldown > MAX_TRADE_COOLDOWN) revert CooldownTooHigh();
        if (_tier1TradeCooldown > MAX_TRADE_COOLDOWN) revert CooldownTooHigh();

        tier0TradeCooldown = _tier0TradeCooldown;
        tier1TradeCooldown = _tier1TradeCooldown;
        emit CooldownConfigUpdated(_tier0TradeCooldown, _tier1TradeCooldown);
    }

    /**
     * @notice Token yön izinlerini owner seviyesinde günceller.
     *         Sell / buy order yüzeyleri ayrı ayrı açılıp kapatılabilir.
     * @notice Updates token direction permissions at owner level.
     *         Sell / buy order surfaces can be enabled or disabled independently.
     */
    function setTokenConfig(
        address _token,
        bool _supported,
        bool _allowSellOrders,
        bool _allowBuyOrders,
        uint8 _decimals,
        uint256[4] calldata _tierMaxAmountsBaseUnit
    ) external onlyOwner {
        if (_token == address(0)) revert OwnableInvalidOwner(address(0));
        if (_decimals == 0 || _decimals > 18) revert InvalidDecimals();
        for (uint256 i = 0; i < 4; i++) {
            if (_tierMaxAmountsBaseUnit[i] == 0) revert ZeroAmount();
        }

        TokenConfig storage cfg = tokenConfigs[_token];
        cfg.supported = _supported;
        cfg.allowSellOrders = _allowSellOrders;
        cfg.allowBuyOrders = _allowBuyOrders;
        cfg.decimals = _decimals;
        cfg.tierMaxAmountsBaseUnit = _tierMaxAmountsBaseUnit;

        emit TokenConfigUpdated(_token, _supported, _allowSellOrders, _allowBuyOrders);
    }

    /**
     * @notice Reputation policy katsayılarını owner seviyesinde günceller.
     *         Değişiklikler yalnız gelecekteki outcome kayıtlarına uygulanır.
     * @notice Updates reputation policy coefficients at owner level.
     *         Changes apply only to future outcome recordings.
     */
    function setReputationPolicy(
        uint256 _cleanPeriod,
        uint32 _manualReleaseRewardPts,
        uint32 _autoReleasePenaltyPts,
        uint32 _disputeWinRewardPts,
        uint32 _disputeLossPenaltyPts,
        uint32 _burnPenaltyPts,
        uint32 _mutualCancelPenaltyPts,
        uint32 _baseBanDuration,
        uint32 _banRiskPointsThreshold
    ) external onlyOwner {
        if (_cleanPeriod < 7 days) revert InvalidState();
        if (_cleanPeriod > MAX_REPUTATION_DECAY_PERIOD) revert DecayTooHigh();
        if (_baseBanDuration == 0) revert ZeroAmount();
        if (_baseBanDuration > MAX_BAN_DURATION) revert BanTooHigh();
        if (_banRiskPointsThreshold == 0) revert ZeroAmount();
        if (_banRiskPointsThreshold > tierMaxRiskPoints[0]) revert InvalidTier();
        // [TR] Ödül/ceza delta'ları ban eşiğini aşmamalı.
        // [EN] Reward/penalty deltas must stay within ban threshold.
        if (
            _manualReleaseRewardPts > _banRiskPointsThreshold ||
            _autoReleasePenaltyPts > _banRiskPointsThreshold ||
            _disputeWinRewardPts > _banRiskPointsThreshold ||
            _disputeLossPenaltyPts > _banRiskPointsThreshold ||
            _burnPenaltyPts > _banRiskPointsThreshold ||
            _mutualCancelPenaltyPts > _banRiskPointsThreshold
        ) revert InvalidState();

        cleanPeriod = _cleanPeriod;
        manualReleaseRewardPts = _manualReleaseRewardPts;
        autoReleasePenaltyPts = _autoReleasePenaltyPts;
        disputeWinRewardPts = _disputeWinRewardPts;
        disputeLossPenaltyPts = _disputeLossPenaltyPts;
        burnPenaltyPts = _burnPenaltyPts;
        mutualCancelPenaltyPts = _mutualCancelPenaltyPts;
        baseBanDuration = _baseBanDuration;
        banRiskPointsThreshold = _banRiskPointsThreshold;

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

    /**
     * @notice Tier eşiklerini owner seviyesinde günceller.
     *         minSuccessfulTrades artan, maxRiskPoints azalan olmalıdır.
     * @notice Updates tier thresholds at owner level.
     *         minSuccessfulTrades must be ascending and maxRiskPoints descending.
     */
    function setReputationTierThresholds(
        uint32[5] calldata _minSuccessfulTrades,
        uint32[5] calldata _maxRiskPoints
    ) external onlyOwner {
        for (uint256 i = 1; i < 5; i++) {
            if (_minSuccessfulTrades[i] < _minSuccessfulTrades[i - 1]) revert InvalidTier();
            if (_maxRiskPoints[i] > _maxRiskPoints[i - 1]) revert InvalidTier();
        }
        if (_maxRiskPoints[0] < banRiskPointsThreshold) revert InvalidTier();

        tierMinSuccessfulTrades = _minSuccessfulTrades;
        tierMaxRiskPoints = _maxRiskPoints;
        emit ReputationTierThresholdsUpdated(_minSuccessfulTrades, _maxRiskPoints);
    }

    /**
     * @notice Pause yalnız yeni create/lock akışlarını durdurur.
     *         Mevcut işlemler emergency durumda da kapanabilir kalmalıdır.
     * @notice Pause only stops new create/lock flows.
     *         Existing trades must remain closeable even during an emergency.
     */
    function pause() external onlyOwner { _pause(); }

    /**
     * @notice Pause durumunu kaldırır.
     *         Bu, yeni create/lock akışlarının tekrar açılmasını sağlar.
     * @notice Removes the paused state.
     *         This re-opens new create/lock flows.
     */
    function unpause() external onlyOwner { _unpause(); }

    // ═══════════════════════════════════════════════════
    //  İÇ YARDIMCILAR — V3 EXTENSIONS
    //  INTERNAL HELPERS — V3 EXTENSIONS
    // ═══════════════════════════════════════════════════

    /**
     * @notice Tier bazlı güncel taker fee değerini döndürür.
     *         Tier 0'da da taker fee uygulanır.
     * @notice Returns the current taker fee by tier.
     *         Taker fee also applies on Tier 0.
     */
    function _getCurrentTakerFeeBps(uint8 /* _tier */) internal view returns (uint256) {
        return takerFeeBps;
    }

    /**
     * @notice Tier bazlı güncel maker fee değerini döndürür.
     *         Tier 0 deliberately uses makerFee = 0 so new users stay friction-light.
     * @notice Returns the current maker fee by tier.
     *         Tier 0 deliberately uses makerFee = 0 so new users stay friction-light.
     */
    function _getCurrentMakerFeeBps(uint8 _tier) internal view returns (uint256) {
        if (_tier == 0) return 0;
        return makerFeeBps;
    }

    /**
     * @notice Tier bazlı uygulanacak cooldown'u döndürür.
     *         Tier 2+ tarafında cooldown uygulanmaz.
     * @notice Returns the cooldown that applies for a given tier.
     *         No cooldown is applied on Tier 2+.
     */
    function _getCooldownForTier(uint8 _tier) internal view returns (uint256) {
        if (_tier == 0) return tier0TradeCooldown;
        if (_tier == 1) return tier1TradeCooldown;
        return 0;
    }

    /**
     * @notice Parametresiz UX helper'lar için bilgi amaçlı cooldown döndürür.
     *         Bu değer bağlayıcı enforcement değildir; yalnız view helper içindir.
     * @notice Returns an informational cooldown for param-less UX helpers.
     *         This value is not the binding enforcement rule; it is used only in view helpers.
     */
    function _getInformationalCooldown() internal view returns (uint256) {
        return tier0TradeCooldown >= tier1TradeCooldown ? tier0TradeCooldown : tier1TradeCooldown;
    }

    /**
     * @notice Taker giriş kapısını tek yerden zorlar.
     *         V3 order child-trade girişleri (fillSellOrder/fillBuyOrder) bu helper'ı ortak kullanır.
     * @notice Enforces the taker entry gate in one place.
     *         V3 order child-trade entries (fillSellOrder/fillBuyOrder) share this helper.
     */
    function _enforceTakerEntry(address _wallet, uint8 _tier) internal view {
        Reputation storage rep = reputation[_wallet];
        if (rep.bannedUntil != 0 && block.timestamp <= rep.bannedUntil) revert TakerBanActive();

        if (walletRegisteredAt[_wallet] == 0 ||
            block.timestamp < walletRegisteredAt[_wallet] + WALLET_AGE_MIN) {
            revert WalletTooYoung();
        }

        if (_wallet.balance < DUST_LIMIT) revert InsufficientNativeBalance();

        uint256 cooldown = _getCooldownForTier(_tier);
        if (cooldown > 0) {
            if (lastTradeAt[_wallet] != 0 &&
                block.timestamp < lastTradeAt[_wallet] + cooldown) {
                revert TierCooldownActive();
            }
        }
    }

    function _isSettlementAllowedTradeState(TradeState _state) internal pure returns (bool) {
        return _state == TradeState.LOCKED || _state == TradeState.PAID || _state == TradeState.CHALLENGED;
    }

    function _expireSettlementProposalIfNeeded(
        uint256 _tradeId,
        SettlementProposal storage _proposal
    ) internal {
        if (_proposal.state == SettlementProposalState.PROPOSED && block.timestamp > _proposal.expiresAt) {
            _proposal.state = SettlementProposalState.EXPIRED;
            emit SettlementExpired(_tradeId, _proposal.id);
        }
    }

    /**
     * @notice Sell order yönünde token açık mı helper'ı.
     * @notice Helper that checks if a token is enabled for sell orders.
     */
    function _isTokenAllowedForSellOrder(address _token) internal view returns (bool) {
        TokenConfig memory cfg = tokenConfigs[_token];
        if (!cfg.supported) return false;
        return cfg.allowSellOrders;
    }

    /**
     * @notice Buy order yönünde token açık mı helper'ı.
     * @notice Helper that checks if a token is enabled for buy orders.
     */
    function _isTokenAllowedForBuyOrder(address _token) internal view returns (bool) {
        TokenConfig memory cfg = tokenConfigs[_token];
        if (!cfg.supported) return false;
        return cfg.allowBuyOrders;
    }

    /**
     * @notice Kontrata gelen token girişini exact miktar olarak zorlar.
     *         Fee-on-transfer / deflasyonist tokenlar eksik giriş üretirse revert eder.
     * @notice Enforces exact token inflow into the contract.
     *         Reverts when fee-on-transfer / deflationary tokens deliver less than expected.
     */
    function _safeTransferExactIn(IERC20 _token, address _from, uint256 _amount) internal {
        if (_amount == 0) return;

        uint256 beforeBalance = _token.balanceOf(address(this));
        _token.safeTransferFrom(_from, address(this), _amount);
        uint256 afterBalance = _token.balanceOf(address(this));

        if (afterBalance < beforeBalance) revert InvalidTransferAmount();
        if (afterBalance - beforeBalance != _amount) revert InvalidTransferAmount();
    }

    /**
     * @notice Kalan reserve'den exact fill'e karşılık gelen slice'ı hesaplar.
     *         Son fill kalan rezervin tamamını süpürür; rounding drift birikmez.
     * @notice Computes the reserve slice that corresponds to an exact fill.
     *         The final fill sweeps the entire remaining reserve, preventing rounding drift accumulation.
     */
    function _proportionalSlice(
        uint256 _remainingReserve,
        uint256 _remainingAmount,
        uint256 _fillAmount
    ) internal pure returns (uint256) {
        if (_remainingReserve == 0 || _remainingAmount == 0) return 0;
        if (_fillAmount == _remainingAmount) return _remainingReserve;
        return (_remainingReserve * _fillAmount) / _remainingAmount;
    }
}
