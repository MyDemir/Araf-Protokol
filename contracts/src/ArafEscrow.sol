// SPDX-License-Identifier: Apache-2.0
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
 * @dev    Security: ReentrancyGuard + CEI pattern. Network: Base (L2)
 * @author Araf Protocol — v3.0
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ArafErrors.sol";
import "./ArafReputationLib.sol";
import "./ArafSettlementLib.sol";


interface IArafRevenueReceiver {
    function noteEscrowRevenueIntent(
        address token,
        uint256 amount,
        uint8 kind,
        uint256 tradeId
    ) external;

    function onArafRevenue(
        address token,
        uint256 amount,
        uint8 kind,
        uint256 tradeId
    ) external;
}

contract ArafEscrow is IArafEscrowErrors, ReentrancyGuard, Ownable, Pausable {
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

    // [TR] Reward/read-model için terminal outcome sınıflandırması (authority kontratta).
    // [EN] Terminal outcome classification for reward/read-model surfaces (contract-authoritative).
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

    // [TR] Treasury'ye aktarılan protokol gelirinin semantik sınıfları.
    // [EN] Semantic classes for protocol revenue transferred to treasury.
    enum RevenueKind {
        MANUAL_RELEASE_FEE,
        AUTO_RELEASE_FEE_OR_PENALTY,
        PARTIAL_SETTLEMENT_FEE,
        DISPUTED_RELEASE_FEE,
        BURN_RESIDUAL
    }

    // [TR] Storage düzeni gas için paketlenmiştir; alan sırası (ve getTrade ABI word sırası) korunur:
    //      id+parentOrderId | maker | taker | token | cryptoAmount | makerBond | takerBond |
    //      snapshot'lar+state+lockedAt+paidAt+challengedAt | cancel+ping+challengePing (9 slot, eskiden 18).
    //      Ödeme bildirimi ve itiraz yeni slot açmaz. Dekont hash'i storage'da tutulmaz; kanonik kaydı
    //      PaymentReported event'idir (hiçbir kontrat kararı onu okumaz).
    // [EN] Storage is packed for gas; field order (and getTrade ABI word order) is unchanged (9 slots, was 18).
    //      Reporting payment and challenging open no new slot. The receipt hash is not stored; its canonical
    //      record is the PaymentReported event (no contract decision reads it).
    struct Trade {
        uint64  id;
        // [TR] V3'te her child trade bir parent order fill'inden doğar; bu alan artık nullable semantik taşımaz.
        // [EN] In V3 every child trade is born from a parent order fill; this field no longer carries nullable semantics.
        uint64  parentOrderId;
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
        uint64  lockedAt;
        uint64  paidAt;
        uint64  challengedAt;
        bool    cancelProposedByMaker;
        bool    cancelProposedByTaker;
        uint64  pingedAt;
        bool    pingedByTaker;
        uint64  challengePingedAt;
        bool    challengePingedByMaker;
    }

    // [TR] Parent Order — public emir katmanı
    // [EN] Parent Order — public order layer
    // [TR] id, owner+side ile aynı slotta (alan sırası korunur). [EN] id shares the owner+side slot.
    struct Order {
        uint64  id;
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

    // [TR] Terminalized trade için minimal fee/outcome snapshot.
    // [EN] Minimal fee/outcome snapshot for terminalized trades.
    // [TR] 2 slot: outcome+terminalAt | takerFeePaid+makerFeePaid (uint128, doygun yazım). Getter'lar uint256 döndürür.
    // [EN] 2 slots: outcome+terminalAt | both fees as uint128 (saturating write). Getters still return uint256.
    struct TerminalTradeSnapshot {
        TerminalOutcome outcome;
        uint64  terminalAt;
        uint128 takerFeePaid;
        uint128 makerFeePaid;
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

    uint256 internal constant GOOD_REP_DISCOUNT_BPS = 100;
    uint256 internal constant BAD_REP_PENALTY_BPS   = 300;

    // [TR] Fee ve cooldown artık mutable'dır.
    //      Bu default değerler constructor sırasında başlangıç değeri olarak yüklenir.
    // [EN] Fee and cooldown are now mutable.
    //      These defaults are loaded as initial values in the constructor.
    uint256 internal constant DEFAULT_TAKER_FEE_BPS = 15;
    uint256 internal constant DEFAULT_MAKER_FEE_BPS = 15;

    uint256 public constant AUTO_RELEASE_PENALTY_BPS = 200;

    uint256 public constant GRACE_PERIOD         =  48 hours;
    // [TR] LOCKED trade'de taker'ın ödeme bildirmesi için süre. Dolunca kilit taker aleyhine çözülür.
    // [EN] Window for the taker to report payment on a LOCKED trade. After it, the lock unwinds against the taker.
    uint256 public constant PAYMENT_WINDOW       =  48 hours;
    uint256 public constant USDT_DECAY_START     =  96 hours;
    uint256 public constant MAX_BLEEDING         = 240 hours;
    uint256 internal constant WALLET_AGE_MIN       =   2 days;
    uint256 internal constant DEFAULT_TIER0_TRADE_COOLDOWN = 4 hours;
    uint256 internal constant DEFAULT_TIER1_TRADE_COOLDOWN = 4 hours;
    uint256 internal constant MAX_CANCEL_DEADLINE  =   7 days;
    uint256 internal constant MIN_SETTLEMENT_EXPIRY = 10 minutes;
    uint256 public constant MIN_ACTIVE_PERIOD    =  15 days;
    // [TR] Reputation'a sayılan en küçük trade (6 ondalığa normalize, 20 USD). [EN] Smallest trade counted for reputation.
    uint256 internal constant MIN_REPUTATION_NOTIONAL = 20e6;

    uint256 internal constant TAKER_BOND_DECAY_BPS_H = 42;
    uint256 internal constant MAKER_BOND_DECAY_BPS_H = 26;
    uint256 internal constant CRYPTO_DECAY_BPS_H     = 34;

    uint256 internal constant DUST_LIMIT = 0.001 ether;
    // [TR] Governance yanlış konfigürasyon riskine karşı süre üst sınırları.
    // [EN] Duration upper bounds against governance misconfiguration risk.
    uint256 internal constant MAX_TRADE_COOLDOWN = 30 days;
    // [TR] Reputation politika sınırları (MAX_REPUTATION_DECAY_PERIOD, MAX_BAN_DURATION) ArafReputationLib'dedir.
    // [EN] Reputation policy bounds live in ArafReputationLib.

    uint256 private constant BPS_DENOMINATOR  = 10_000;
    // [TR] Fee modeli (taker/maker ayrı + snapshot) korunur.
    //      Bu sabit "model"i değiştirmez; yalnız owner'ın ayarlayabileceği
    //      ekonomik tavanı daraltır (admin authority restriction).
    // [EN] The fee model (separate taker/maker + snapshots) stays unchanged.
    //      This constant does not alter the model itself; it only narrows
    //      the owner-adjustable economic ceiling (admin authority restriction).
    uint256 private constant MAX_FEE_CONFIG_BPS = 2_000;
    uint256 private constant SECONDS_PER_HOUR = 3_600;

    // ═══════════════════════════════════════════════════
    //  DURUM DEĞİŞKENLERİ / STATE VARIABLES
    // ═══════════════════════════════════════════════════

    uint256 public tradeCounter;
    uint256 public orderCounter;
    address public treasury;

    // [TR] Struct mapping'leri internal: aynı veri getTrade/getOrder/getReputation/getSettlementProposal/
    //      getTokenConfig ile okunur. Otomatik public getter'lar EIP-170 (24KB) sınırını aşan kopya bytecode üretir.
    // [EN] Struct mappings are internal: the same data is served by the named getters above.
    //      Auto-generated public getters duplicated bytecode and pushed the contract past EIP-170 (24KB).
    mapping(uint256 => Trade) internal trades;
    mapping(uint256 => Order) internal orders;
    mapping(uint256 => SettlementProposal) internal settlementProposalsByTrade;
    mapping(uint256 => TerminalTradeSnapshot) internal terminalTradeSnapshots;
    mapping(uint256 => uint256) internal settlementProposalNonceByTrade;
    // [TR] Reputation state'i (kayıtlar, ban/tier tavanı, politika, tier eşikleri) tek kökte; ArafReputationLib
    //      DELEGATECALL ile bu kök üzerinde çalışır. cleanPeriod() ve maxAllowedTier(address) getter'ları aşağıda.
    // [EN] Reputation state under one root; ArafReputationLib operates on it via DELEGATECALL.
    ArafReputationLib.Store internal rs;

    mapping(address => uint256) public walletRegisteredAt;
    mapping(address => uint256) internal lastTradeAt;

    mapping(address => TokenConfig) internal tokenConfigs;

    // [TR] Owner kontrollü mutable fee / cooldown alanları (getFeeConfig / getCooldownConfig ile okunur).
    // [EN] Owner-controlled mutable fee / cooldown state (read via getFeeConfig / getCooldownConfig).
    uint256 internal takerFeeBps;
    uint256 internal makerFeeBps;
    uint256 internal tier0TradeCooldown;
    uint256 internal tier1TradeCooldown;

    // ═══════════════════════════════════════════════════
    //  OLAYLAR / EVENTS
    // ═══════════════════════════════════════════════════

    event WalletRegistered(address indexed wallet, uint256 timestamp);
    event PaymentReported(uint256 indexed tradeId, string ipfsHash, uint256 timestamp);
    event EscrowReleased(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 takerFee, uint256 makerFee);
    event DisputeOpened(uint256 indexed tradeId, address indexed challenger, uint256 timestamp);
    event CancelProposed(uint256 indexed tradeId, address indexed proposer);
    // [TR] K11: iptal onayı geri çekildi. [EN] K11: cancel consent revoked.
    event CancelRevoked(uint256 indexed tradeId, address indexed revoker);
    event EscrowCanceled(uint256 indexed tradeId, uint256 makerRefund, uint256 takerRefund);
    event MakerPinged(uint256 indexed tradeId, address indexed pinger, uint256 timestamp);
    event BleedingDecayed(uint256 indexed tradeId, uint256 decayedAmount, uint256 timestamp);
    event EscrowBurned(uint256 indexed tradeId, uint256 burnedAmount);
    event PaymentWindowExpired(uint256 indexed tradeId, uint256 makerRefund, uint256 takerRefund, uint256 takerPenalty);
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
    event ProtocolRevenueSent(
        address indexed token,
        uint256 amount,
        RevenueKind indexed kind,
        uint256 indexed tradeId,
        address treasury
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
        rs.cleanPeriod = 90 days;
        rs.manualReleaseRewardPts = 8;
        rs.autoReleasePenaltyPts = 60;
        rs.disputeWinRewardPts = 10;
        rs.disputeLossPenaltyPts = 60;
        rs.burnPenaltyPts = 90;
        rs.mutualCancelPenaltyPts = 20;
        rs.baseBanDuration = uint32(30 days);
        rs.banRiskPointsThreshold = 100;

        rs.tierMinSuccessfulTrades = [uint32(0), uint32(15), uint32(50), uint32(100), uint32(200)];
        rs.tierMaxRiskPoints = [uint32(100), uint32(80), uint32(50), uint32(30), uint32(15)];

        // [TR] Politika değerleri runtime getter yerine event ile şeffaf tutulur (EIP-170 bütçesi); ilk değerler de yayınlanır.
        // [EN] Policy values stay transparent via events instead of runtime getters (EIP-170 budget); initial values are emitted too.
        emit ReputationPolicyUpdated(90 days, 8, 60, 10, 60, 90, 20, 30 days, 100);
        emit ReputationTierThresholdsUpdated(rs.tierMinSuccessfulTrades, rs.tierMaxRiskPoints);
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
    ) external nonReentrant whenNotPaused returns (uint256 orderId) {
        if (!_isTokenAllowedForSellOrder(_token)) revert TokenDirectionNotAllowed();
        // [TR] Sell order sahibi child trade'lerde maker olur: yalnız aktif ban kontrol edilir.
        // [EN] The sell order owner becomes maker in child trades: only an active ban is checked.
        _enforceNotBanned(msg.sender, true);

        uint256 makerBondTotal = (_totalAmount * _getMakerBondBps(msg.sender, _tier)) / BPS_DENOMINATOR;
        orderId = _createOrder(OrderSide.SELL_CRYPTO, _token, _totalAmount, _minFillAmount, _tier, _orderRef, _paymentRiskLevel, makerBondTotal, 0);

        _safeTransferExactIn(IERC20(_token), msg.sender, _totalAmount + makerBondTotal);
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
        Order storage o = _validateFill(_orderId, OrderSide.SELL_CRYPTO, _fillAmount, _childListingRef);

        // [TR] K6: order sahibi child trade'de maker olur; create sonrası ban yemişse fill edilemez (fillBuyOrder simetriği).
        // [EN] K6: the order owner becomes maker; a ban received after create blocks fills (mirrors fillBuyOrder).
        _enforceNotBanned(o.owner, true);
        _enforceTakerEntry(msg.sender, o.tier);
        // [TR] K3 + K6: filler (taker) ve order sahibi (maker) order tier'ına fill anında hâlâ yetkili olmalı.
        // [EN] K3 + K6: both the filler (taker) and the owner (maker) must still qualify for the order tier at fill time.
        _enforceFillTiers(o.tier, o.owner);

        uint256 takerBond      = (_fillAmount * _getTakerBondBps(msg.sender, o.tier)) / BPS_DENOMINATOR;
        uint256 makerBondSlice = _proportionalSlice(o.remainingMakerBondReserve, o.remainingAmount, _fillAmount);

        o.remainingMakerBondReserve -= makerBondSlice;
        _consumeFill(o, _fillAmount);

        _safeTransferExactIn(IERC20(o.tokenAddress), msg.sender, takerBond);

        tradeId = _spawnTrade(o, _orderId, o.owner, msg.sender, _fillAmount, makerBondSlice, takerBond, _childListingRef);
        // [TR] Cooldown yalnız Tier 0/1 order'larında uygulanır; Tier 2+ fill'i gereksiz storage yazmaz.
        // [EN] Cooldown only applies to Tier 0/1 orders; a Tier 2+ fill skips the needless storage write.
        if (o.tier < 2) lastTradeAt[msg.sender] = block.timestamp;
    }

    /**
     * @notice Sell order'ın henüz doldurulmamış kalan kısmını iptal eder.
     *         Yalnız kullanılmamış inventory ve maker reserve iade edilir.
     * @notice Cancels the still-unfilled remainder of a sell order.
     *         Only unused inventory and maker reserve are refunded.
     */
    function cancelSellOrder(uint256 _orderId) external nonReentrant {
        _cancelOrder(_orderId, OrderSide.SELL_CRYPTO);
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
    ) external nonReentrant whenNotPaused returns (uint256 orderId) {
        if (!_isTokenAllowedForBuyOrder(_token)) revert TokenDirectionNotAllowed();
        // [TR] Buy order sahibi child trade'de taker rolünü üstleneceği için
        //      create aşamasında da taker giriş kapısı zorlanır.
        // [EN] Since buy order owner becomes taker in child trades,
        //      enforce taker entry gate at create time as well.
        _enforceTakerEntry(msg.sender, _tier);

        uint256 takerBondTotal = (_totalAmount * _getTakerBondBps(msg.sender, _tier)) / BPS_DENOMINATOR;
        orderId = _createOrder(OrderSide.BUY_CRYPTO, _token, _totalAmount, _minFillAmount, _tier, _orderRef, _paymentRiskLevel, 0, takerBondTotal);

        _safeTransferExactIn(IERC20(_token), msg.sender, takerBondTotal);
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
        Order storage o = _validateFill(_orderId, OrderSide.BUY_CRYPTO, _fillAmount, _childListingRef);

        // [TR] Buy order owner, child trade'de taker olacağı için lock benzeri
        //      anti-sybil kapısından fill anında yeniden geçirilir. Filler ise maker'dır.
        // [EN] The buy order owner becomes taker, so the lock-equivalent anti-sybil gate
        //      is re-applied at fill time. The filler is the maker.
        _enforceTakerEntry(o.owner, o.tier);
        _enforceNotBanned(msg.sender, true);
        // [TR] K6: order sahibinin (taker) tier tavanı create sonrası düşmüşse de fill reddedilir.
        // [EN] K6: also rejects the fill when the owner's (taker) tier ceiling dropped after create.
        _enforceFillTiers(o.tier, o.owner);

        uint256 makerBond      = (_fillAmount * _getMakerBondBps(msg.sender, o.tier)) / BPS_DENOMINATOR;
        uint256 takerBondSlice = _proportionalSlice(o.remainingTakerBondReserve, o.remainingAmount, _fillAmount);

        o.remainingTakerBondReserve -= takerBondSlice;
        _consumeFill(o, _fillAmount);

        _safeTransferExactIn(IERC20(o.tokenAddress), msg.sender, _fillAmount + makerBond);

        tradeId = _spawnTrade(o, _orderId, msg.sender, o.owner, _fillAmount, makerBond, takerBondSlice, _childListingRef);
        if (o.tier < 2) lastTradeAt[o.owner] = block.timestamp;
    }

    /**
     * @notice Buy order'ın henüz doldurulmamış kalan kısmını iptal eder.
     *         Yalnız kullanılmamış taker bond reserve'i iade edilir.
     * @notice Cancels the still-unfilled remainder of a buy order.
     *         Only unused taker bond reserve is refunded.
     */
    function cancelBuyOrder(uint256 _orderId) external nonReentrant {
        _cancelOrder(_orderId, OrderSide.BUY_CRYPTO);
    }

    /**
     * @notice Ortak order doğrulaması + kayıt + OrderCreated. Tier, sahibinin efektif tier'ını aşamaz.
     * @notice Shared order validation + storage + OrderCreated. Tier cannot exceed the owner's effective tier.
     */
    function _createOrder(
        OrderSide _side,
        address _token,
        uint256 _totalAmount,
        uint256 _minFillAmount,
        uint8   _tier,
        bytes32 _orderRef,
        PaymentRiskLevel _paymentRiskLevel,
        uint256 _makerBondReserve,
        uint256 _takerBondReserve
    ) internal returns (uint256 orderId) {
        if (_totalAmount == 0) revert ZeroAmount();
        if (_minFillAmount == 0 || _minFillAmount > _totalAmount) revert InvalidMinFill();
        if (_tier > 4) revert InvalidTier();
        if (_orderRef == bytes32(0)) revert InvalidOrderRef();
        if (_tier > _getEffectiveTier(msg.sender)) revert TierNotAllowed();

        uint256 tierMax = _getTierMaxAmount(_token, _tier);
        if (tierMax > 0 && _totalAmount > tierMax) revert AmountExceedsTierLimit();

        orderId = ++orderCounter;
        Order storage o = orders[orderId];
        o.id                        = uint64(orderId);
        o.owner                     = msg.sender;
        o.side                      = _side;
        o.tokenAddress              = _token;
        o.totalAmount               = _totalAmount;
        o.remainingAmount           = _totalAmount;
        o.minFillAmount             = _minFillAmount;
        o.remainingMakerBondReserve = _makerBondReserve;
        o.remainingTakerBondReserve = _takerBondReserve;
        o.takerFeeBpsSnapshot       = uint16(takerFeeBps);
        // [TR] Tier 0'da maker fee bilinçli olarak 0'dır; yeni kullanıcılar için sürtünme düşük tutulur.
        // [EN] Tier 0 deliberately uses makerFee = 0 so new users stay friction-light.
        o.makerFeeBpsSnapshot       = _tier == 0 ? 0 : uint16(makerFeeBps);
        o.tier                      = _tier;
        o.paymentRiskLevel          = _paymentRiskLevel;
        o.state                     = OrderState.OPEN;
        o.orderRef                  = _orderRef;

        emit OrderCreated(orderId, msg.sender, _side, _token, _totalAmount, _minFillAmount, _tier, _paymentRiskLevel, _orderRef);
    }

    /**
     * @notice Fill ön koşullarını tek yerden doğrular.
     * @notice Validates fill preconditions in one place.
     */
    function _validateFill(
        uint256 _orderId,
        OrderSide _side,
        uint256 _fillAmount,
        bytes32 _childListingRef
    ) internal view returns (Order storage o) {
        o = orders[_orderId];
        if (o.side != _side) revert OrderSideMismatch();
        if (o.state != OrderState.OPEN && o.state != OrderState.PARTIALLY_FILLED) revert InvalidOrderState();
        if (_fillAmount == 0) revert ZeroAmount();
        // [TR] Child trade linkage için listingRef zorunludur; zero ref event-consumer bütünlüğünü bozar.
        // [EN] listingRef is mandatory for child-trade linkage; zero ref breaks event-consumer integrity.
        if (_childListingRef == bytes32(0)) revert InvalidListingRef();
        if (msg.sender == o.owner) revert SelfTradeForbidden();
        if (_fillAmount > o.remainingAmount) revert FillAmountExceedsRemaining();
        if (_fillAmount < o.minFillAmount && _fillAmount != o.remainingAmount) revert FillAmountBelowMinimum();
    }

    /**
     * @notice Order tier'ının hem order sahibi hem filler (msg.sender) için fill anındaki efektif tier'ı aşmadığını zorlar.
     *         Create anındaki kontrol tek başına yetmez: sahibinin tavanı sonradan cezayla düşebilir.
     * @notice Enforces that the order tier does not exceed the fill-time effective tier of both the owner and the filler.
     */
    function _enforceFillTiers(uint8 _tier, address _owner) internal view {
        if (_tier == 0) return;
        if (_tier > _getEffectiveTier(_owner) || _tier > _getEffectiveTier(msg.sender)) revert TierNotAllowed();
    }

    function _consumeFill(Order storage o, uint256 _fillAmount) internal {
        o.remainingAmount -= _fillAmount;
        o.state = o.remainingAmount == 0 ? OrderState.FILLED : OrderState.PARTIALLY_FILLED;
    }

    /**
     * @notice Order'ın doldurulmamış kısmını iptal eder; yalnız kullanılmamış envanter + bond rezervi iade edilir.
     * @notice Cancels the unfilled remainder; only unused inventory + bond reserve are refunded.
     */
    function _cancelOrder(uint256 _orderId, OrderSide _side) internal {
        Order storage o = orders[_orderId];

        if (o.side != _side) revert OrderSideMismatch();
        if (msg.sender != o.owner) revert OnlyOrderOwner();
        if (o.state != OrderState.OPEN && o.state != OrderState.PARTIALLY_FILLED) revert InvalidOrderState();

        uint256 remainingAmount = o.remainingAmount;
        uint256 makerBondRefund = o.remainingMakerBondReserve;
        uint256 takerBondRefund = o.remainingTakerBondReserve;
        // [TR] Sell order'da envanter kontrattadır; buy order'da yalnız taker bond rezervi vardır.
        // [EN] Sell orders escrow inventory; buy orders only escrow the taker bond reserve.
        uint256 totalRefund = (_side == OrderSide.SELL_CRYPTO ? remainingAmount : 0) + makerBondRefund + takerBondRefund;

        o.state = OrderState.CANCELED;
        o.remainingAmount = 0;
        o.remainingMakerBondReserve = 0;
        o.remainingTakerBondReserve = 0;

        if (totalRefund > 0) IERC20(o.tokenAddress).safeTransfer(o.owner, totalRefund);

        emit OrderCanceled(_orderId, _side, remainingAmount, makerBondRefund, takerBondRefund);
    }

    /**
     * @notice Parent order fill'inden LOCKED child trade üretir ve OrderFilled yayınlar.
     *         Child trade otoritesi OrderFilled + getTrade() kombinasyonudur.
     * @notice Spawns a LOCKED child trade from a parent order fill and emits OrderFilled.
     *         Child trade authority is the OrderFilled + getTrade() pair.
     */
    function _spawnTrade(
        Order storage o,
        uint256 _orderId,
        address _maker,
        address _taker,
        uint256 _fillAmount,
        uint256 _makerBond,
        uint256 _takerBond,
        bytes32 _childListingRef
    ) internal returns (uint256 tradeId) {
        tradeId = ++tradeCounter;
        Trade storage t = trades[tradeId];
        t.id                       = uint64(tradeId);
        t.parentOrderId            = uint64(_orderId);
        t.maker                    = _maker;
        t.taker                    = _taker;
        t.tokenAddress             = o.tokenAddress;
        t.cryptoAmount             = _fillAmount;
        t.makerBond                = _makerBond;
        t.takerBond                = _takerBond;
        t.takerFeeBpsSnapshot      = o.takerFeeBpsSnapshot;
        t.makerFeeBpsSnapshot      = o.makerFeeBpsSnapshot;
        t.tier                     = o.tier;
        t.paymentRiskLevelSnapshot = o.paymentRiskLevel;
        t.state                    = TradeState.LOCKED;
        t.lockedAt                 = uint64(block.timestamp);

        emit OrderFilled(_orderId, tradeId, msg.sender, _fillAmount, o.remainingAmount, o.paymentRiskLevel, _childListingRef);
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
        // [TR] K10: bildirim yalnız PAYMENT_WINDOW içinde kabul edilir. Sınır saniyesi expirePaymentWindow'a aittir
        //      (orada `>= expiresAt` geçerli), böylece iki yol aynı saniyede çakışmaz.
        // [EN] K10: reports are only accepted inside PAYMENT_WINDOW. The boundary second belongs to
        //      expirePaymentWindow (valid at `>= expiresAt`), so the two paths never overlap.
        uint256 windowEnd = t.lockedAt + PAYMENT_WINDOW;
        if (block.timestamp >= windowEnd) revert PaymentWindowClosed(windowEnd);

        t.state           = TradeState.PAID;
        t.paidAt          = uint64(block.timestamp);
        // [TR] Önceki state'te verilen iptal onayı yeni ekonomik duruma taşınmaz (ödeme sonrası bayat onay istismarı).
        // [EN] Cancel consent given in a previous state does not carry into the new economic state.
        t.cancelProposedByMaker = false;
        t.cancelProposedByTaker = false;
        emit PaymentReported(_tradeId, _ipfsHash, block.timestamp);
    }

    /**
     * @notice LOCKED trade'de taker PAYMENT_WINDOW içinde ödeme bildirmezse kilit çözülür.
     *         Kontrat kimin haklı olduğunu yorumlamaz; yalnız zamanın dolduğunu uygular: maker envanter + bond'unu
     *         geri alır, taker bond'undan küçük bir liveness cezası kesilir ve taker'a negatif sinyal yazılır.
     *         Bu yol olmadan bond'suz (Tier 0) bir taker maker fonunu süresiz rehin tutabilirdi.
     * @notice If the taker does not report payment within PAYMENT_WINDOW, the lock unwinds.
     *         The contract does not judge; it only enforces elapsed time: the maker gets inventory + bond back,
     *         a small liveness penalty is taken from the taker bond and the taker receives a negative signal.
     *         Without this path a bond-free (Tier 0) taker could hold maker funds hostage indefinitely.
     */
    function expirePaymentWindow(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.LOCKED)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.maker && msg.sender != t.taker) revert NotTradeParty();
        uint256 expiresAt = t.lockedAt + PAYMENT_WINDOW;
        if (block.timestamp < expiresAt) revert PaymentWindowActive(expiresAt);

        t.state = TradeState.CANCELED;

        uint256 takerPenalty = (t.takerBond * AUTO_RELEASE_PENALTY_BPS) / BPS_DENOMINATOR;
        uint256 makerRefund  = t.cryptoAmount + t.makerBond;
        uint256 takerRefund  = t.takerBond - takerPenalty;

        _payout(t, _tradeId, makerRefund, takerRefund, takerPenalty, 0, RevenueKind.AUTO_RELEASE_FEE_OR_PENALTY);

        _recordTerminalOutcome(_tradeId, TerminalOutcome.PAYMENT_WINDOW_EXPIRED, takerPenalty, 0);
        _recordReputation(t, ArafReputationLib.Outcome.PAYMENT_WINDOW_EXPIRED);

        emit PaymentWindowExpired(_tradeId, makerRefund, takerRefund, takerPenalty);
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

        // [TR] Sınıflama challenge'ı kimin açtığına değil state'e bağlıdır. CHALLENGED'a yalnız maker'ın
        //      pingTakerForChallenge ("ödeme gelmedi" iddiası) sonrasında girilir; challengeTrade'i maker da, maker
        //      susunca taker da (K2) açabilir. Her iki durumda maker'ın CHALLENGED'dan serbest bırakması o iddiadan
        //      vazgeçmesidir: DISPUTED_RELEASE + maker dispute kaybı doğru sınıftır.
        // [EN] Classification depends on state, not on who opened the challenge. CHALLENGED is only reachable after
        //      the maker's pingTakerForChallenge ("not paid" claim); challengeTrade may be opened by the maker or, once
        //      the maker goes silent, by the taker (K2). Either way, a maker release from CHALLENGED abandons that claim:
        //      DISPUTED_RELEASE + maker dispute loss is the correct class.
        bool disputed = (t.state == TradeState.CHALLENGED);

        t.state = TradeState.RESOLVED;

        uint256 takerFee       = (currentCrypto * t.takerFeeBpsSnapshot) / BPS_DENOMINATOR;
        uint256 makerFee       = (currentCrypto * t.makerFeeBpsSnapshot) / BPS_DENOMINATOR;
        uint256 actualMakerFee = currentMakerBond > makerFee ? makerFee : currentMakerBond;

        _payout(
            t,
            _tradeId,
            currentMakerBond - actualMakerFee,
            currentCrypto - takerFee + currentTakerBond,
            decayed + takerFee + actualMakerFee,
            decayed,
            disputed ? RevenueKind.DISPUTED_RELEASE_FEE : RevenueKind.MANUAL_RELEASE_FEE
        );

        if (disputed) {
            // [TR] CHALLENGED→RESOLVED yolu maker'ın challenge iddiasının başarısızlığı olarak sınıflanır.
            // [EN] CHALLENGED→RESOLVED path is classified as maker challenge-loss semantics.
            _recordTerminalOutcome(_tradeId, TerminalOutcome.DISPUTED_RELEASE, takerFee, actualMakerFee);
            _recordReputation(t, ArafReputationLib.Outcome.DISPUTED_RELEASE);
        } else {
            _recordTerminalOutcome(_tradeId, TerminalOutcome.CLEAN_RELEASE, takerFee, actualMakerFee);
            _recordReputation(t, ArafReputationLib.Outcome.MANUAL_RELEASE);
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
        t.challengePingedAt      = uint64(block.timestamp);
        emit MakerPinged(_tradeId, msg.sender, block.timestamp);
    }

    /**
     * @notice Dispute (bleeding) akışını başlatır. Maker'ın pingTakerForChallenge çağrısı şarttır; cevap penceresi
     *         (ping + 24 saat) dolduktan sonra challenge'ı maker ya da taker açabilir. Taker'ın bu yolu, maker ping
     *         atıp susarsa (pingMaker/autoRelease ConflictingPingPath ile kapalıyken) PAID trade'in sonsuza dek
     *         kilitli kalmasını önler: bleeding başlar ve en geç MAX_BLEEDING sonunda burnExpired garantilidir.
     *         Contract bu aşamada kimin haklı olduğunu söylemez; yalnız oyun teorik yolu açar.
     * @notice Opens the dispute (bleeding) path. Requires the maker's pingTakerForChallenge; once the response window
     *         (ping + 24h) has elapsed, either the maker or the taker may open it. The taker path prevents a PAID trade
     *         from being locked forever when the maker pings and goes silent (pingMaker/autoRelease are blocked by
     *         ConflictingPingPath): bleeding starts and burnExpired is guaranteed after MAX_BLEEDING at the latest.
     *         At this stage the contract does not decide who is right; it only opens the game-theoretic path.
     */
    function challengeTrade(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.PAID)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.maker && msg.sender != t.taker) revert NotTradeParty();
        if (!t.challengePingedByMaker) revert MustPingFirst();
        if (block.timestamp < t.challengePingedAt + 24 hours) revert ResponseWindowActive();

        t.state        = TradeState.CHALLENGED;
        t.challengedAt = uint64(block.timestamp);
        t.cancelProposedByMaker = false;
        t.cancelProposedByTaker = false;
        emit DisputeOpened(_tradeId, msg.sender, block.timestamp);
    }

    /**
     * @notice Karşılıklı iptal: her taraf kendi on-chain işlemiyle onay verir; ikinci onay iptali yürütür.
     *         msg.sender zaten kimliği kanıtladığından ayrıca EIP-712 imzası istenmez. Onaylar yalnız
     *         verildikleri state için geçerlidir (reportPayment/challengeTrade onayları sıfırlar).
     * @notice Mutual cancel: each party consents with its own on-chain call; the second consent executes.
     *         msg.sender already proves identity, so no separate EIP-712 signature is required. Consents are
     *         valid only for the state in which they were given (reportPayment/challengeTrade reset them).
     */
    function proposeOrApproveCancel(uint256 _tradeId) external nonReentrant {
        Trade storage t = trades[_tradeId];

        if (t.state != TradeState.LOCKED &&
            t.state != TradeState.PAID &&
            t.state != TradeState.CHALLENGED) revert CannotReleaseInState();

        if (msg.sender == t.maker)      t.cancelProposedByMaker = true;
        else if (msg.sender == t.taker) t.cancelProposedByTaker = true;
        else                            revert NotTradeParty();

        emit CancelProposed(_tradeId, msg.sender);

        if (t.cancelProposedByMaker && t.cancelProposedByTaker) {
            _executeCancel(_tradeId);
        }
    }

    /**
     * @notice K11: Taraf, karşı taraf ikinci onayı vererek iptali yürütmeden önce kendi iptal onayını geri çeker.
     *         Yalnız açık (LOCKED/PAID/CHALLENGED) trade'de ve verilmiş bir onay varsa çalışır.
     * @notice K11: A party withdraws its own cancel consent before the counterparty executes the cancel with
     *         the second consent. Only for live (LOCKED/PAID/CHALLENGED) trades with an outstanding consent.
     */
    function revokeCancel(uint256 _tradeId) external nonReentrant {
        Trade storage t = trades[_tradeId];

        if (t.state != TradeState.LOCKED &&
            t.state != TradeState.PAID &&
            t.state != TradeState.CHALLENGED) revert CannotReleaseInState();

        if (msg.sender == t.maker) {
            if (!t.cancelProposedByMaker) revert NoCancelConsent();
            t.cancelProposedByMaker = false;
        } else if (msg.sender == t.taker) {
            if (!t.cancelProposedByTaker) revert NoCancelConsent();
            t.cancelProposedByTaker = false;
        } else {
            revert NotTradeParty();
        }

        emit CancelRevoked(_tradeId, msg.sender);
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

        // [TR] K1: Trade'e ait kalan her şey (erimiş kısım dahil) hazineye gider. Eskiden yalnız current (post-decay)
        //      tutarlar gönderiliyor, erimiş kısım escrow'da kalıcı kilitli kalıyordu. Decay tavanları orijinal
        //      tutarlar olduğundan current + decayed == cryptoAmount + makerBond + takerBond; trade bakiyesi 0'a iner.
        //      burnExpired BleedingDecayed yaymaz (backend sözleşmesi); yakılan toplam EscrowBurned'dedir.
        // [EN] K1: everything left for the trade (decayed part included) goes to treasury. Previously only the
        //      current (post-decay) amounts were sent and the decayed part stayed locked in the escrow forever.
        //      Since decay is capped at the original amounts, current + decayed == crypto + makerBond + takerBond.
        //      burnExpired emits no BleedingDecayed (backend contract); the burned total is in EscrowBurned.
        uint256 totalBurn = t.cryptoAmount + t.makerBond + t.takerBond;

        t.state = TradeState.BURNED;

        _payout(t, _tradeId, 0, 0, totalBurn, 0, RevenueKind.BURN_RESIDUAL);

        _recordTerminalOutcome(_tradeId, TerminalOutcome.BURNED, 0, 0);
        _recordReputation(t, ArafReputationLib.Outcome.BURN);

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
        t.pingedAt      = uint64(block.timestamp);
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

        // [TR] PAID state'te bleeding işlemez; tutarlar doğrudan trade snapshot'ıdır.
        // [EN] No bleeding runs in PAID; amounts are the trade snapshot itself.
        t.state = TradeState.RESOLVED;

        uint256 makerPenalty = (t.makerBond * AUTO_RELEASE_PENALTY_BPS) / BPS_DENOMINATOR;
        uint256 takerPenalty = (t.takerBond * AUTO_RELEASE_PENALTY_BPS) / BPS_DENOMINATOR;

        _payout(
            t,
            _tradeId,
            t.makerBond - makerPenalty,
            t.cryptoAmount + t.takerBond - takerPenalty,
            makerPenalty + takerPenalty,
            0,
            RevenueKind.AUTO_RELEASE_FEE_OR_PENALTY
        );

        _recordTerminalOutcome(_tradeId, TerminalOutcome.AUTO_RELEASE, takerPenalty, makerPenalty);
        _recordReputation(t, ArafReputationLib.Outcome.AUTO_RELEASE);

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
        // [TR] Doğrulama + kayıt + SettlementProposed ArafSettlementLib'de (DELEGATECALL, escrow storage/adresi).
        // [EN] Validation + storage + SettlementProposed live in ArafSettlementLib (DELEGATECALL).
        ArafSettlementLib.propose(
            trades[_tradeId],
            settlementProposalsByTrade[_tradeId],
            settlementProposalNonceByTrade,
            _tradeId,
            _makerShareBps,
            _expiresAt
        );
    }

    /**
     * @notice Karşı taraf aktif settlement teklifini reddeder.
     * @notice Counterparty rejects an active settlement proposal.
     */
    function rejectSettlement(uint256 _tradeId) external nonReentrant {
        _closeProposal(_tradeId, ArafSettlementLib.OP_REJECT);
    }

    /**
     * @notice Teklif sahibi aktif settlement teklifini geri çeker.
     * @notice Proposal owner withdraws an active settlement proposal.
     */
    function withdrawSettlement(uint256 _tradeId) external nonReentrant {
        _closeProposal(_tradeId, ArafSettlementLib.OP_WITHDRAW);
    }

    /**
     * @notice Süresi dolan settlement teklifini herkes expire edebilir.
     * @notice Anyone can expire a settlement proposal once its deadline passes.
     */
    function expireSettlement(uint256 _tradeId) external nonReentrant {
        _closeProposal(_tradeId, ArafSettlementLib.OP_EXPIRE);
    }

    function _closeProposal(uint256 _tradeId, uint8 _op) internal {
        ArafSettlementLib.close(trades[_tradeId], settlementProposalsByTrade[_tradeId], _tradeId, _op);
    }

    /**
     * @notice Karşı taraf aktif split settlement teklifini kabul eder ve fon dağıtımı yapılır.
     *         Trade terminal state olarak RESOLVED'a çekilir.
     * @notice Counterparty accepts active split settlement proposal and executes payouts.
     *         Trade transitions to RESOLVED as terminal state.
     * @param  _expectedProposalId [TR] K5: kabul edilen teklifin kimliği (SettlementProposed.proposalId /
     *         getSettlementProposal().id). Teklif sahibi withdraw + yeniden teklif ile oranı değiştirirse id değişir
     *         ve kabul SettlementProposalMismatch ile revert eder. [EN] K5: id of the proposal being accepted; a
     *         withdraw + re-propose changes the id and the acceptance reverts with SettlementProposalMismatch.
     */
    function acceptSettlement(uint256 _tradeId, uint256 _expectedProposalId) external nonReentrant {
        Trade storage t = trades[_tradeId];
        SettlementProposal storage sp = _counterpartyProposal(_tradeId);
        if (sp.id != _expectedProposalId) revert SettlementProposalMismatch(_expectedProposalId, sp.id);

        // [TR] Settlement matematiği kabul anındaki current (post-decay) değerlerle hesaplanır.
        //      Önce decayed tutar treasury'ye alınır, kalan current havuz split edilir.
        // [EN] Settlement math is computed on acceptance-time current (post-decay) amounts.
        //      Decay is sent to treasury first, then the remaining current pool is split.
        (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond, uint256 decayed) =
            _calculateCurrentAmounts(_tradeId);

        uint256 settlementPool = currentCrypto + currentMakerBond + currentTakerBond;
        uint256 makerGrossPayout = (settlementPool * sp.makerShareBps) / BPS_DENOMINATOR;
        uint256 takerGrossPayout = settlementPool - makerGrossPayout;

        // [TR] Fee snapshot'ları gross settlement payout üzerinden uygulanır.
        //      Event'te net payout + gerçek fee değerleri yayınlanır.
        // [EN] Fee snapshots are applied on gross settlement payouts.
        //      Event emits net payout values plus actual fee amounts.
        uint256 makerFee = (makerGrossPayout * t.makerFeeBpsSnapshot) / BPS_DENOMINATOR;
        uint256 takerFee = (takerGrossPayout * t.takerFeeBpsSnapshot) / BPS_DENOMINATOR;
        uint256 makerPayout = makerGrossPayout - makerFee;
        uint256 takerPayout = takerGrossPayout - takerFee;

        sp.state = SettlementProposalState.FINALIZED;
        t.state = TradeState.RESOLVED;

        // [TR] CEI korunur: state güncellendi, ardından dış transferler yapılır.
        // [EN] CEI preserved: state is updated before external transfers.
        _payout(t, _tradeId, makerPayout, takerPayout, decayed + makerFee + takerFee, decayed, RevenueKind.PARTIAL_SETTLEMENT_FEE);

        _recordTerminalOutcome(_tradeId, TerminalOutcome.PARTIAL_SETTLEMENT, takerFee, makerFee);
        _recordReputation(t, ArafReputationLib.Outcome.PARTIAL_SETTLEMENT);

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

        // [TR] LOCKED iptalinde fee yoktur; PAID/CHALLENGED iptalinde fee'ler tarafların kendi bond'undan kesilir.
        // [EN] No fee on LOCKED cancel; on PAID/CHALLENGED each side's fee is capped by its own bond.
        uint256 makerFee;
        uint256 takerFee;
        if (currentState != TradeState.LOCKED) {
            makerFee = (currentCrypto * t.makerFeeBpsSnapshot) / BPS_DENOMINATOR;
            takerFee = (currentCrypto * t.takerFeeBpsSnapshot) / BPS_DENOMINATOR;
            if (makerFee > currentMakerBond) makerFee = currentMakerBond;
            if (takerFee > currentTakerBond) takerFee = currentTakerBond;
        }

        uint256 makerRefund = currentCrypto + currentMakerBond - makerFee;
        uint256 takerRefund = currentTakerBond - takerFee;

        _payout(
            t,
            _tradeId,
            makerRefund,
            takerRefund,
            decayed + makerFee + takerFee,
            decayed,
            currentState == TradeState.CHALLENGED ? RevenueKind.DISPUTED_RELEASE_FEE : RevenueKind.MANUAL_RELEASE_FEE
        );

        _recordTerminalOutcome(_tradeId, TerminalOutcome.MUTUAL_CANCEL, takerFee, makerFee);
        _recordReputation(t, ArafReputationLib.Outcome.MUTUAL_CANCEL);

        emit EscrowCanceled(_tradeId, makerRefund, takerRefund);
    }

    /**
     * @notice Terminal dağıtımı tek yerden yapar: protokol payı (decay + fee/ceza) treasury'ye, kalanlar taraflara.
     * @notice Single terminal distribution path: protocol share (decay + fee/penalty) to treasury, rest to parties.
     */
    function _payout(
        Trade storage t,
        uint256 _tradeId,
        uint256 _toMaker,
        uint256 _toTaker,
        uint256 _toTreasury,
        uint256 _decayed,
        RevenueKind _kind
    ) internal {
        ArafSettlementLib.payout(
            t.tokenAddress,
            t.maker,
            t.taker,
            treasury,
            _tradeId,
            _toMaker,
            _toTaker,
            _toTreasury,
            _decayed,
            uint8(_kind)
        );
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
     * @notice Terminal outcome + fee snapshot bilgisini trade bazında sabitler.
     * @dev    Aynı trade için yalnız ilk terminal kayıt geçerlidir (set-once).
     */
    function _recordTerminalOutcome(
        uint256 _tradeId,
        TerminalOutcome _outcome,
        uint256 _takerFeePaid,
        uint256 _makerFeePaid
    ) internal {
        TerminalTradeSnapshot storage snapshot = terminalTradeSnapshots[_tradeId];
        if (snapshot.terminalAt != 0) return;

        snapshot.outcome = _outcome;
        snapshot.terminalAt = uint64(block.timestamp);
        // [TR] G1: iki ücret tek slotta (uint128). Ücret ≤ trade tutarı olduğundan pratikte taşmaz; yine de terminal
        //      yolu asla revert etmesin diye doygun (saturating) yazılır. Yalnız reward read-model'i etkiler.
        // [EN] G1: both fees share one slot (uint128). Saturating write so a terminal path can never revert.
        snapshot.takerFeePaid = _toUint128Saturating(_takerFeePaid);
        snapshot.makerFeePaid = _toUint128Saturating(_makerFeePaid);
    }

    function _toUint128Saturating(uint256 _v) internal pure returns (uint128) {
        return _v > type(uint128).max ? type(uint128).max : uint128(_v);
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

        ArafReputationLib.Reputation storage rep = rs.reputation[_maker];
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

        ArafReputationLib.Reputation storage rep = rs.reputation[_taker];
        if (rep.riskPoints == 0 && rep.successfulTrades > 0) {
            bondBps = bondBps > GOOD_REP_DISCOUNT_BPS ? bondBps - GOOD_REP_DISCOUNT_BPS : 0;
        } else if (rep.riskPoints > 0) {
            bondBps += BAD_REP_PENALTY_BPS;
        }
    }

    // [TR] Mikro işlem koruması: MIN_REPUTATION_NOTIONAL altındaki trade'ler başarılı işlem sayısına ve
    //      risk puanı iyileşmesine katkı vermez (tier şişirme maliyetsiz olmasın). Ceza sinyalleri her
    //      büyüklükte uygulanır; ödül ağırlığı ise hacme göre ayrıca hesaplanır.
    // [EN] Micro-trade guard: trades below MIN_REPUTATION_NOTIONAL add no successful-trade count and no
    //      risk-point recovery, so tier inflation is not free. Penalties apply at any size; reward weight
    //      is volume-based and computed separately.
    function _repUnit(Trade storage t) internal view returns (bool) {
        return _toStableUnits(t.cryptoAmount, tokenConfigs[t.tokenAddress].decimals) >= MIN_REPUTATION_NOTIONAL;
    }

    /**
     * @notice Terminal sonucu reputation motoruna (ArafReputationLib, DELEGATECALL) yazar; ReputationUpdated
     *         event'leri escrow adresinden yayınlanır.
     * @notice Records a terminal outcome through the reputation engine (ArafReputationLib, DELEGATECALL);
     *         ReputationUpdated events are emitted from the escrow address.
     */
    function _recordReputation(Trade storage t, ArafReputationLib.Outcome _kind) internal {
        ArafReputationLib.recordOutcome(rs, _kind, t.maker, t.taker, _repUnit(t));
    }

    /**
     * @notice Temiz dönem sonrası ardışık ban geçmişini sıfırlar.
     *         Bu, cezanın sonsuza kadar taşınmaması için kontrollü bir unutma kuralıdır.
     * @notice Resets consecutive ban history after a clean period.
     *         This is a controlled forgetting rule so penalties do not persist forever.
     */
    function decayReputation(address _wallet) external nonReentrant {
        ArafReputationLib.decayReputation(rs, _wallet);
    }

    /**
     * @notice Kullanıcının efektif tier'ını hesaplar.
     *         Bu sonuç performans, zaman ve ceza tavanının birleşimidir.
     * @notice Computes the effective tier for a wallet.
     *         The result is a combination of performance, time, and penalty ceiling.
     */
    function _getEffectiveTier(address _wallet) internal view returns (uint8) {
        return ArafReputationLib.effectiveTier(rs, _wallet);
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
        ArafReputationLib.Reputation storage rep = rs.reputation[_wallet];
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
        return rs.firstSuccessfulTradeAt[_wallet];
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

    // [TR] Ödül ağırlığı token'lar arası karşılaştırılabilir olsun diye notional 6 ondalığa normalize edilir;
    //      aksi halde 18 ondalıklı bir stable aynı dolar hacmi için 1e12 kat ağırlık alırdı.
    // [EN] Normalizes notional to 6 decimals so reward weight is comparable across tokens; otherwise an
    //      18-decimal stable would earn 1e12x the weight for the same dollar volume.
    function _toStableUnits(uint256 _amount, uint8 _decimals) internal pure returns (uint256) {
        if (_decimals > 6) return _amount / (10 ** (_decimals - 6));
        if (_decimals < 6) return _amount * (10 ** (6 - _decimals));
        return _amount;
    }

    /**
     * @notice Reward motoru için trade'in contract-authoritative terminal görünümünü döndürür.
     * @dev    Backend/admin kaynaklarından türetilmez; yalnız kontrat state/snapshot'larından beslenir.
     */
    function getRewardableTrade(uint256 _tradeId) external view returns (RewardableTradeView memory) {
        Trade storage t = trades[_tradeId];
        TerminalTradeSnapshot storage terminalSnapshot = terminalTradeSnapshots[_tradeId];

        return RewardableTradeView({
            tradeId: t.id,
            parentOrderId: t.parentOrderId,
            maker: t.maker,
            taker: t.taker,
            token: t.tokenAddress,
            stableNotional: _toStableUnits(t.cryptoAmount, tokenConfigs[t.tokenAddress].decimals),
            takerFeePaid: terminalSnapshot.takerFeePaid,
            makerFeePaid: terminalSnapshot.makerFeePaid,
            tier: t.tier,
            outcome: terminalSnapshot.outcome,
            lockedAt: t.lockedAt,
            paidAt: t.paidAt,
            terminalAt: terminalSnapshot.terminalAt,
            hadChallenge: t.challengedAt != 0,
            isOrderChild: t.parentOrderId != 0
        });
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
        // [TR] K14: girilen ondalık token'ın kendi decimals() değeriyle aynı olmalı; çağrı başarısızsa (kod yok,
        //      fonksiyon yok, kısa dönüş) da revert. Yanlış decimals tier limitlerini ve reward notional'ını bozar.
        // [EN] K14: the supplied decimals must equal the token's own decimals(); a failed/short call reverts too.
        (bool ok, bytes memory ret) = _token.staticcall(abi.encodeWithSelector(0x313ce567)); // decimals()
        if (!ok || ret.length < 32 || abi.decode(ret, (uint256)) != _decimals) revert InvalidDecimals();
        for (uint256 i; i < 4; ) {
            if (_tierMaxAmountsBaseUnit[i] == 0) revert ZeroAmount();
            unchecked { ++i; }
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
     *         Değişiklikler yalnız gelecekteki outcome kayıtlarına uygulanır. Doğrulama + event ArafReputationLib'de.
     * @notice Updates reputation policy coefficients at owner level.
     *         Changes apply only to future outcome recordings. Validation + event live in ArafReputationLib.
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
        ArafReputationLib.setReputationPolicy(
            rs,
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
        ArafReputationLib.setReputationTierThresholds(rs, _minSuccessfulTrades, _maxRiskPoints);
    }

    /**
     * @notice Temiz dönem süresi (eski `uint256 public cleanPeriod` getter'ı ile aynı ABI).
     * @notice Clean period (same ABI as the former `uint256 public cleanPeriod` getter).
     */
    function cleanPeriod() external view returns (uint256) {
        return rs.cleanPeriod;
    }

    /**
     * @notice Cüzdanın ceza tier tavanı (eski `mapping(address => uint8) public maxAllowedTier` getter'ı ile aynı ABI).
     * @notice Penalty tier ceiling of a wallet (same ABI as the former public mapping getter).
     */
    function maxAllowedTier(address _wallet) external view returns (uint8) {
        return rs.maxAllowedTier[_wallet];
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
        _enforceNotBanned(_wallet, false);

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

    /**
     * @notice Aktif ban'ı iki rol için de zorlar (simetrik koruma). Maker için yalnız ban bakılır;
     *         yaş/dust/cooldown kapıları taker girişine özgüdür çünkü maker zaten bond + envanter kilitler.
     * @notice Enforces an active ban for both roles (symmetric protection). Makers are only checked
     *         for bans; age/dust/cooldown gates are taker-entry specific since makers lock bond + inventory.
     */
    function _enforceNotBanned(address _wallet, bool _asMaker) internal view {
        uint64 bannedUntil = rs.reputation[_wallet].bannedUntil;
        if (bannedUntil != 0 && block.timestamp <= bannedUntil) {
            if (_asMaker) revert MakerBanActive();
            revert TakerBanActive();
        }
    }


    /**
     * @notice Canlı teklifi yalnız karşı taraf (teklif sahibi olmayan trade tarafı) için döndürür.
     * @notice Returns the live proposal only for the counterparty (the non-proposing trade party).
     */
    function _counterpartyProposal(uint256 _tradeId) internal view returns (SettlementProposal storage sp) {
        Trade storage t = trades[_tradeId];
        if (t.state != TradeState.CHALLENGED) revert SettlementNotAllowedInState();
        sp = settlementProposalsByTrade[_tradeId];
        if (sp.state != SettlementProposalState.PROPOSED) revert NoActiveSettlementProposal();
        if (block.timestamp > sp.expiresAt) revert SettlementProposalExpired();
        if (msg.sender != t.maker && msg.sender != t.taker) revert NotTradeParty();
        if (msg.sender == sp.proposer) revert OnlySettlementCounterparty();
    }

    /**
     * @notice Sell order yönünde token açık mı helper'ı.
     * @notice Helper that checks if a token is enabled for sell orders.
     */
    function _isTokenAllowedForSellOrder(address _token) internal view returns (bool) {
        TokenConfig storage cfg = tokenConfigs[_token];
        return cfg.supported && cfg.allowSellOrders;
    }

    /**
     * @notice Buy order yönünde token açık mı helper'ı.
     * @notice Helper that checks if a token is enabled for buy orders.
     */
    function _isTokenAllowedForBuyOrder(address _token) internal view returns (bool) {
        TokenConfig storage cfg = tokenConfigs[_token];
        return cfg.supported && cfg.allowBuyOrders;
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
