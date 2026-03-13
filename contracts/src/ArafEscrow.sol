// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  ArafEscrow
 * @notice Oracle-free, humanless P2P fiat ↔ crypto escrow with
 * Bleeding Escrow (time-decay) dispute resolution.
 * @dev    Security: ReentrancyGuard + CEI pattern + EIP-712 cancel.
 * Network: Base (L2)
 * @author Araf Protocol — v2.0
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol"; // C-03 Fix: Emergency pause mekanizması
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// GAZ OPTİMİZASYONU: require() string'leri yerine Custom Error'lar kullanmak,
// hem deploy maliyetini hem de runtime'da revert maliyetini düşürür.
error NotTradeParty();
error InvalidState();
error TakerBanActive();
error OnlyMaker();
error OnlyTaker();
error AlreadyRegistered();
error TokenNotSupported();
error ZeroAmount();
error InvalidTier();
error TierNotAllowed();
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
error DeadlineTooFar(); // AFS-017 Fix: Cancel deadline üst limiti
// AUDIT FIX C-02: Karşı taraf zaten alternatif çözüm yolu başlattığında
// aynı işlemde ikinci bir ping yolunun açılmasını engeller.
error ConflictingPingPath();

contract ArafEscrow is ReentrancyGuard, EIP712, Ownable, Pausable { // C-03 Fix: Pausable eklendi
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════
    //  ENUMS & STRUCTS
    // ═══════════════════════════════════════════════════

    enum TradeState {
        OPEN,       // Maker locked funds, listing is live
        LOCKED,     // Taker matched, funds secured
        PAID,       // Taker reported payment, 48h grace starts
        CHALLENGED, // Maker disputed — Bleeding Escrow active
        RESOLVED,   // Successfully closed
        CANCELED,   // Mutual 2/2 cancel
        BURNED      // 10-day timeout — all to treasury
    }

    struct Trade {
        uint256 id;
        address maker;
        address taker;
        address tokenAddress;   // USDT / USDC on Base
        uint256 cryptoAmount;   // Locked crypto (no bond — stored separately)
        uint256 makerBond;      // Maker's bond in token
        uint256 takerBond;      // Taker's bond in token (0 for Tier 0)
        uint8   tier;           // 0, 1, 2, 3 or 4
        TradeState state;
        // AFS-020 Fix: uint48 cast kaldırıldı — struct alanları uint256, cast tutarsızdı
        uint256 lockedAt;
        uint256 paidAt;
        uint256 challengedAt;
        string  ipfsReceiptHash; // Taker's payment proof
        bool    cancelProposedByMaker;
        bool    cancelProposedByTaker;
        // GÜVENLİK GÜNCELLEMESİ: autoRelease istismarını önlemek için ping mekanizması
        uint256 pingedAt;              // Taker'ın Maker'a "hayatta mısın?" sinyali gönderdiği zaman
        bool    pingedByTaker;         // Ping'in gönderilip gönderilmediğini işaretler
        // YENİ: Simetrik Ping Modeli - Maker'ın itiraz öncesi uyarısı
        uint256 challengePingedAt;     // Maker'ın Taker'a "ödeme gelmedi" uyarısı gönderdiği zaman
        bool    challengePingedByMaker; // Maker'ın uyarısının gönderilip gönderilmediğini işaretler
    }

    struct Reputation {
        uint256 successfulTrades;
        uint256 failedDisputes;
        uint256 bannedUntil;      // timestamp; 0 = not banned
        uint256 consecutiveBans;  // Ard arda ban sayisi — sure ve tier cezasi icin
    }

    // ═══════════════════════════════════════════════════
    //  CONSTANTS — Finalized Protocol Parameters v1.2
    // ═══════════════════════════════════════════════════

    // ── 5-Tier Bond System ──────────────────────────────────────────────────────
    // TRY limitleri off-chain (backend) tarafindan zorunlu tutulur.
    // On-chain: tier numarasina gore bond BPS hesaplanir.
    //
    // Tier 0 |  250 - 5.000 TRY  | Maker %0 | Taker %0  | Yeni kullanici tesviki
    // Tier 1 | 5.001-50.000 TRY  | Maker %8 | Taker %10 | 1:1.25 asimetri
    // Tier 2 | 50K - 250K TRY    | Maker %6 | Taker %8  | 1:1.33 asimetri
    // Tier 3 | 250K - 1M TRY     | Maker %5 | Taker %5  | 1:1 (esit, guven artar)
    // Tier 4 | 1M+ TRY           | Maker %2 | Taker %2  | 1:1 (premium, dusuk yuk)
    //
    // Tier 0: bond yoktur — sadece kilitli crypto erimeye tabidir.
    // Tasarim notu: Tier 0, yeni kullanici cekmek icin dusuk miktarlarla sinirlandirilmistir.
    // MAD prensibi bu tier'da uygulanmaz — risk, dusuk limitlerle azaltilir.

    uint256 public constant MAKER_BOND_TIER0_BPS =    0; //  0%
    uint256 public constant MAKER_BOND_TIER1_BPS =  800; //  8%
    uint256 public constant MAKER_BOND_TIER2_BPS =  600; //  6%
    uint256 public constant MAKER_BOND_TIER3_BPS =  500; //  5%
    uint256 public constant MAKER_BOND_TIER4_BPS =  200; //  2%

    uint256 public constant TAKER_BOND_TIER0_BPS =    0; //  0%  (bond yok, sadece crypto riski)
    uint256 public constant TAKER_BOND_TIER1_BPS = 1000; // 10%
    uint256 public constant TAKER_BOND_TIER2_BPS =  800; //  8%
    uint256 public constant TAKER_BOND_TIER3_BPS =  500; //  5%
    uint256 public constant TAKER_BOND_TIER4_BPS =  200; //  2%

    // Tier gecis kriterleri (off-chain zorunlu, on-chain referans):
    // T0->T1: 15 basarili islem, 0 failed dispute
    // T1->T2: 50 basarili + 100.000 TRY hacim, <=1 failed dispute
    // T2->T3: 100 basarili + 500.000 TRY hacim, <=1 failed dispute
    // T3->T4: 200 basarili + 2.000.000 TRY hacim, 0 failed dispute
    // Ceza: Her yeni failed dispute bir ust tier sayacini sifirlar.
    //       2+ failed dispute mevcut tier'i bir asagi dusurur.

    // ── Reputation Modifiers ─────────────────────────────────────────────────
    uint256 public constant GOOD_REP_DISCOUNT_BPS = 100; // -1% (temiz gecmise hafif tesvik)
    uint256 public constant BAD_REP_PENALTY_BPS   = 300; // +3% (ceza — magdur etmeden)

    // ── Protocol Fee ─────────────────────────────────────────────────────────
    // Simetrik split: %0.1 taker (crypto'dan) + %0.1 maker (bond'dan)
    // Toplam treasury geliri: %0.2/islem
    uint256 public constant TAKER_FEE_BPS = 10; // %0.1
    uint256 public constant MAKER_FEE_BPS = 10; // %0.1

    // ── Timers ───────────────────────────────────────────────────────────────
    uint256 public constant GRACE_PERIOD         =  48 hours; // Challenge sonrasi guvenli pencere
    uint256 public constant CHALLENGE_COOLDOWN   =   1 hours; // PAID'dan sonra min bekleme
    uint256 public constant USDT_DECAY_START     =  96 hours; // Grace bittikten 96h sonra crypto erir
    uint256 public constant MAX_BLEEDING         = 240 hours; // 10 gun -> BURN
    uint256 public constant WALLET_AGE_MIN       =   7 days;
    uint256 public constant TIER0_TRADE_COOLDOWN =  24 hours; // Tier 0: gunde 1 islem
    uint256 public constant TIER1_TRADE_COOLDOWN =  24 hours; // Tier 1: gunde 1 islem
    // AFS-017 Fix: Cancel imzası için maksimum deadline süresi
    uint256 public constant MAX_CANCEL_DEADLINE  =   7 days;

    // AUDIT FIX C-04: Wash trading caydırıcı — Tier 1+ erişimi için minimum aktif süre.
    // 24h cooldown ile en hızlı 15 işlem = 15 gün. 30 gün zorunluluğu,
    // Sybil hesaplarının hızlı tier atlamasını ekonomik olarak caydırır.
    uint256 public constant MIN_ACTIVE_PERIOD    =  30 days;

    // autoRelease: Taker, pasif Maker'a karşı işlemi sonlandırdığında, her iki
    // tarafın teminatından kesilen "ihmal cezası". Bu, Taker'ın da süreci
    // zorla sonlandırmasının küçük bir maliyeti olmasını sağlar.
    // GÜVENLİK GÜNCELLEMESİ: autoRelease için karşılıklı kesinti
    uint256 public constant AUTO_RELEASE_PENALTY_BPS = 500; // 5%

    // ── Saatlik Decay (Hourly BPS) ────────────────────────────────────────────
    // Efektif bleeding: MAX_BLEEDING(240h) - GRACE(48h) = 192h
    //
    // AUDIT FIX C-01: Decay oranları artık saniye bazlı hesaplanıyor.
    // Saatlik BPS değerleri aynı kalıyor, formül saniye cinsinden uygulanıyor:
    //   decayed = (original * RATE_BPS_H * elapsedSeconds) / (BPS_DENOM * 3600)
    // Bu, integer bölme step-function sorununu ortadan kaldırır.
    //
    // Taker bond : 42 BPS/saat -> 192h'de %80.6 erimis, %19.4 kalmis
    // Maker bond : 26 BPS/saat -> 192h'de %50.1 erimis (crypto zaten kilitli)
    // Crypto     : 34 BPS/saat x2 taraf -> USDT_DECAY_START'tan sonra baslar
    //
    // Tier 0: bond yoktur -> yalnizca crypto decay uygulanir.
    uint256 public constant TAKER_BOND_DECAY_BPS_H = 42; // BPS/saat
    uint256 public constant MAKER_BOND_DECAY_BPS_H = 26; // BPS/saat
    uint256 public constant CRYPTO_DECAY_BPS_H     = 34; // BPS/saat x2 = 68 BPS/h toplam

    // ── Anti-Sybil ───────────────────────────────────────────────────────────
    uint256 public constant DUST_LIMIT = 0.001 ether; // ~$2 on Base

    uint256 private constant BPS_DENOMINATOR  = 10_000;
    uint256 private constant SECONDS_PER_HOUR = 3_600;

    // ═══════════════════════════════════════════════════
    //  EIP-712 TYPEHASH
    // ═══════════════════════════════════════════════════

    bytes32 private constant CANCEL_TYPEHASH = keccak256(
        "CancelProposal(uint256 tradeId,address proposer,uint256 nonce,uint256 deadline)"
    );

    // ═══════════════════════════════════════════════════
    //  STATE VARIABLES
    // ═══════════════════════════════════════════════════

    uint256 public tradeCounter;
    address public treasury;

    mapping(uint256 => Trade) public trades;
    mapping(address => Reputation) public reputation;

    // Anti-Sybil: wallet registration timestamp (first interaction)
    mapping(address => uint256) public walletRegisteredAt;

    // Anti-Sybil: last trade timestamp for Tier 1 cooldown
    mapping(address => uint256) public lastTradeAt;

    // AFS-002 Fix: Tier ceza sistemi yeniden tasarlandı.
    // maxAllowedTier: Ceza nedeniyle kullanıcının erişebileceği en yüksek tier.
    // hasTierPenalty: Bu cüzdana hiç tier cezası uygulanıp uygulanmadığını izler.
    // Sorun: Solidity mapping varsayılanı 0'dır ve Tier 0 geçerli bir değerdir.
    // hasTierPenalty olmadan, "hiç ceza almamış" ve "Tier 0'a düşürülmüş" ayırt edilemez.
    mapping(address => uint8) public maxAllowedTier;
    mapping(address => bool)  public hasTierPenalty; // AFS-002 Fix: sentinel bayrağı

    // AUDIT FIX C-04: İlk başarılı işlem zamanı — wash trading caydırıcı.
    // Tier 1+ erişimi için bu timestamp'ten itibaren MIN_ACTIVE_PERIOD geçmiş olmalı.
    // Bu, Sybil hesaplarının 15 gün içinde Tier 1'e atlamasını engeller.
    mapping(address => uint256) public firstSuccessfulTradeAt;

    // Supported payment tokens (USDT, USDC on Base)
    mapping(address => bool) public supportedTokens;

    // EIP-712 nonce per user for replay protection
    mapping(address => uint256) public sigNonces;

    // ═══════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════

    event WalletRegistered(address indexed wallet, uint256 timestamp);
    event EscrowCreated(uint256 indexed tradeId, address indexed maker, address token, uint256 amount, uint8 tier);
    event EscrowLocked(uint256 indexed tradeId, address indexed taker, uint256 takerBond);
    event PaymentReported(uint256 indexed tradeId, string ipfsHash, uint256 timestamp);
    event EscrowReleased(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 takerFee, uint256 makerFee);
    event DisputeOpened(uint256 indexed tradeId, address indexed challenger, uint256 timestamp);
    event CancelProposed(uint256 indexed tradeId, address indexed proposer);
    event EscrowCanceled(uint256 indexed tradeId, uint256 makerRefund, uint256 takerRefund);
    event MakerPinged(uint256 indexed tradeId, address indexed pinger, uint256 timestamp);
    event BleedingDecayed(uint256 indexed tradeId, uint256 decayedAmount, uint256 timestamp);
    event EscrowBurned(uint256 indexed tradeId, uint256 burnedAmount);
    event ReputationUpdated(address indexed wallet, uint256 successful, uint256 failed, uint256 bannedUntil, uint8 effectiveTier);
    event TreasuryUpdated(address indexed newTreasury);
    event TokenSupportUpdated(address indexed token, bool supported);

    // ═══════════════════════════════════════════════════
    //  MODIFIERS
    // ═══════════════════════════════════════════════════

    modifier inState(uint256 _tradeId, TradeState _expected) {
        if (trades[_tradeId].state != _expected) revert InvalidState();
        _;
    }

    modifier notBanned() {
        Reputation storage rep = reputation[msg.sender];
        if (rep.bannedUntil != 0 && block.timestamp <= rep.bannedUntil) revert TakerBanActive();
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
    }

    // ═══════════════════════════════════════════════════
    //  REGISTRATION — Anti-Sybil Wallet Age Gate
    // ═══════════════════════════════════════════════════

    /**
     * @notice Register wallet to start the 7-day aging countdown.
     * Must be called before acting as Taker.
     */
    function registerWallet() external {
        if (walletRegisteredAt[msg.sender] != 0) revert AlreadyRegistered();
        walletRegisteredAt[msg.sender] = block.timestamp;
        emit WalletRegistered(msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════════════════
    //  MAKER FLOW — Create Escrow
    // ═══════════════════════════════════════════════════

    /**
     * @notice Maker creates a P2P listing. Locks crypto + bond.
     * @param  _token         ERC20 token address (USDT/USDC)
     * @param  _cryptoAmount  Amount to sell (6 decimals for USDT)
     * @param  _tier          0, 1, 2, 3 or 4
     */
    function createEscrow(
        address _token,
        uint256 _cryptoAmount,
        uint8   _tier
    ) external nonReentrant whenNotPaused returns (uint256 tradeId) {
        // ── Checks ──
        if (!supportedTokens[_token]) revert TokenNotSupported();
        if (_cryptoAmount == 0) revert ZeroAmount();
        if (_tier > 4) revert InvalidTier();
        
        // YENİ MİMARİ: Kullanıcının itibarına göre izin verilen en yüksek tier'ı kontrol et.
        uint8 effectiveTier = _getEffectiveTier(msg.sender);
        if (_tier > effectiveTier) revert TierNotAllowed();

        // Calculate maker bond
        uint256 bondBps = _getMakerBondBps(msg.sender, _tier);
        uint256 makerBond = (_cryptoAmount * bondBps) / BPS_DENOMINATOR;
        uint256 totalLock = _cryptoAmount + makerBond;

        // ── Effects ──
        tradeId = ++tradeCounter;
        trades[tradeId] = Trade({
            id:                   tradeId,
            maker:                msg.sender,
            taker:                address(0),
            tokenAddress:         _token,
            cryptoAmount:         _cryptoAmount,
            makerBond:            makerBond,
            takerBond:            0,
            tier:                 _tier,
            state:                TradeState.OPEN,
            ipfsReceiptHash:      "",
            lockedAt:             0,
            paidAt:               0,
            challengedAt:         0,
            pingedAt:             0,
            challengePingedAt:    0,
            cancelProposedByMaker: false,
            cancelProposedByTaker: false,
            pingedByTaker:        false,
            challengePingedByMaker: false
        });

        // ── Interactions ──
        IERC20(_token).safeTransferFrom(msg.sender, address(this), totalLock);

        emit EscrowCreated(tradeId, msg.sender, _token, _cryptoAmount, _tier);
    }

    // ═══════════════════════════════════════════════════
    //  MAKER FLOW — Cancel OPEN Escrow (C-02 Fix)
    // ═══════════════════════════════════════════════════

    /**
     * @notice Maker, hiç eşleşmemiş (taker gelmemiş) OPEN escrow'u iptal eder.
     * Tüm fonlar (cryptoAmount + makerBond) maker'a iade edilir.
     * OPEN state'te taker yoktur — iade sırasında chargeback riski bulunmaz.
     * @param  _tradeId  Trade ID
     */
    function cancelOpenEscrow(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.OPEN)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.maker) revert OnlyMaker();

        uint256 refundAmount = t.cryptoAmount + t.makerBond;

        // ── Effects (CEI Deseni) ──
        t.state = TradeState.CANCELED;
        emit EscrowCanceled(_tradeId, refundAmount, 0);

        // ── Interactions ──
        IERC20(t.tokenAddress).safeTransfer(t.maker, refundAmount);
    }

    // ═══════════════════════════════════════════════════
    //  TAKER FLOW — Lock Escrow (Anti-Sybil Shield)
    // ═══════════════════════════════════════════════════

    /**
     * @notice Taker matches a listing. Full Anti-Sybil check runs here.
     * @param  _tradeId  Target trade ID
     */
    function lockEscrow(uint256 _tradeId)
        external
        nonReentrant
        notBanned
        whenNotPaused
        inState(_tradeId, TradeState.OPEN)
    {
        Trade storage t = trades[_tradeId];

        // ── Anti-Sybil Shield ──
        if (msg.sender == t.maker) revert SelfTradeForbidden();
        if (walletRegisteredAt[msg.sender] == 0 || block.timestamp < walletRegisteredAt[msg.sender] + WALLET_AGE_MIN) {
            revert WalletTooYoung();
        }
        if (msg.sender.balance < DUST_LIMIT) revert InsufficientNativeBalance();
        if (t.tier == 0 || t.tier == 1) {
            if (lastTradeAt[msg.sender] != 0 && block.timestamp < lastTradeAt[msg.sender] + TIER0_TRADE_COOLDOWN) {
                revert TierCooldownActive();
            }
        }

        // YENİ MİMARİ: Taker'ın itibarına göre bu tier'daki ilanı almasına izin veriliyor mu?
        uint8 takerEffectiveTier = _getEffectiveTier(msg.sender);
        if (t.tier > takerEffectiveTier) revert TierNotAllowed();

        // Calculate taker bond
        uint256 takerBondBps = _getTakerBondBps(msg.sender, t.tier);
        uint256 takerBond = (t.cryptoAmount * takerBondBps) / BPS_DENOMINATOR;

        // ── Effects ──
        t.taker = msg.sender;
        t.takerBond = takerBond;
        t.state = TradeState.LOCKED;
        // AFS-020 Fix: uint48 cast kaldırıldı — struct alanı zaten uint256
        t.lockedAt = block.timestamp;
        lastTradeAt[msg.sender] = block.timestamp;

        // ── Interactions ──
        if (takerBond > 0) {
            IERC20(t.tokenAddress).safeTransferFrom(msg.sender, address(this), takerBond);
        }

        emit EscrowLocked(_tradeId, msg.sender, takerBond);
    }

    // ═══════════════════════════════════════════════════
    //  TAKER FLOW — Report Payment
    // ═══════════════════════════════════════════════════

    /**
     * @notice Taker reports off-chain fiat payment. Starts 48h grace.
     * @param  _tradeId    Trade ID
     * @param  _ipfsHash   IPFS hash of payment receipt
     */
    // AUDIT FIX C-05: nonReentrant eklendi — state değişikliği yapan fonksiyon
    function reportPayment(uint256 _tradeId, string calldata _ipfsHash)
        external
        nonReentrant
        inState(_tradeId, TradeState.LOCKED)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.taker) revert OnlyTaker();
        if (bytes(_ipfsHash).length == 0) revert EmptyIpfsHash();

        t.state = TradeState.PAID;
        // AFS-020 Fix: uint48 cast kaldırıldı
        t.paidAt = block.timestamp;
        t.ipfsReceiptHash = _ipfsHash;

        emit PaymentReported(_tradeId, _ipfsHash, block.timestamp);
    }

    // ═══════════════════════════════════════════════════
    //  MAKER FLOW — Release Funds (Happy Path)
    // ═══════════════════════════════════════════════════

    /**
     * @notice Maker confirms receipt and releases USDT to Taker.
     * Can also be called during Bleeding phase.
     *
     * Fee dağılımı:
     * takerFee  = cryptoAmount × TAKER_FEE_BPS → taker'ın alacağından kesilir
     * makerFee  = cryptoAmount × MAKER_FEE_BPS → maker'ın bond iadesinden kesilir
     * Treasury  = takerFee + makerFee (toplam %0.2 — her iki taraftan %0.1'er)
     *
     * @param  _tradeId  Trade ID
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

        // C-02 Fix: Reputation kararı state değişiminden ÖNCE alınmalı.
        bool makerOpenedDispute = (t.state == TradeState.CHALLENGED);

        // ── Effects ──
        t.state = TradeState.RESOLVED;

        // ── Interactions (CEI: state set before transfers) ──
        if (decayed > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, decayed);
            emit BleedingDecayed(_tradeId, decayed, block.timestamp);
        }

        uint256 takerFee      = (currentCrypto * TAKER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 takerReceives = currentCrypto - takerFee;

        uint256 makerFee          = (currentCrypto * MAKER_FEE_BPS) / BPS_DENOMINATOR;
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

        _updateReputation(t.maker, makerOpenedDispute);
        _updateReputation(t.taker, false);

        emit EscrowReleased(_tradeId, t.maker, t.taker, takerFee, actualMakerFee);
    }

    // ═══════════════════════════════════════════════════
    //  MAKER FLOW — Ping Taker (Challenge Liveness)
    // ═══════════════════════════════════════════════════

    /**
     * @notice Maker, ödeme bildirildikten 24 saat sonra hala fiat ödemesi gelmediyse
     * Taker'a "ödeme gelmedi" uyarısı gönderir.
     * @dev    Bu, challengeTrade için zorunlu bir ön koşuldur. Taker'a 24 saatlik
     * yanıt penceresi açarak hatalı itirazları önler.
     * @param  _tradeId  Trade ID
     */
    // AUDIT FIX C-05: nonReentrant eklendi — state değişikliği yapan fonksiyon
    function pingTakerForChallenge(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.PAID)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.maker) revert OnlyMaker();
        if (block.timestamp < t.paidAt + 24 hours) {
            revert PingCooldownNotElapsed(t.paidAt + 24 hours);
        }
        if (t.challengePingedByMaker) revert AlreadyPinged();

        // AUDIT FIX C-02: Taker zaten autoRelease yolunu başlattıysa,
        // Maker challenge yolunu açamaz. MEV/transaction ordering manipülasyonunu önler.
        if (t.pingedByTaker) revert ConflictingPingPath();

        t.challengePingedByMaker = true;
        t.challengePingedAt = block.timestamp;
        emit MakerPinged(_tradeId, msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════════════════
    //  MAKER FLOW — Challenge (Dispute)
    // ═══════════════════════════════════════════════════

    /**
     * @notice Maker opens a dispute. Enters Grace Period (48h).
     * @dev    Simetrik Ping Modeli: Maker önce ping göndermeli ve 24 saat beklemelidir.
     * @param  _tradeId  Trade ID
     */
    // AUDIT FIX C-05: nonReentrant eklendi — state değişikliği + timer başlatma
    function challengeTrade(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.PAID)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.maker) revert OnlyMaker();

        if (!t.challengePingedByMaker) revert MustPingFirst();
        if (block.timestamp < t.challengePingedAt + 24 hours) revert ResponseWindowActive();

        t.state = TradeState.CHALLENGED;
        // AFS-020 Fix: uint48 cast kaldırıldı
        t.challengedAt = block.timestamp;

        emit DisputeOpened(_tradeId, msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════════════════
    //  COLLABORATIVE CANCEL — EIP-712 Signature Based
    // ═══════════════════════════════════════════════════

    /**
     * @notice Propose or approve a collaborative cancel.
     * First caller proposes; second caller (other party) finalizes.
     * Both must provide valid EIP-712 signatures (relayer pattern).
     * @param  _tradeId   Trade ID
     * @param  _deadline  Signature expiry
     * @param  _sig       EIP-712 signature
     */
    function proposeOrApproveCancel(
        uint256 _tradeId,
        uint256 _deadline,
        bytes calldata _sig
    ) external nonReentrant {
        Trade storage t = trades[_tradeId];
        if (t.state != TradeState.LOCKED && t.state != TradeState.PAID && t.state != TradeState.CHALLENGED) revert CannotReleaseInState();
        if (block.timestamp > _deadline) revert SignatureExpired();
        if (msg.sender != t.maker && msg.sender != t.taker) revert NotTradeParty();

        // AFS-017 Fix: Deadline üst limiti — backend bypass eden doğrudan kontrat çağrılarını da sınırlar
        if (_deadline > block.timestamp + MAX_CANCEL_DEADLINE) revert DeadlineTooFar();

        // Verify EIP-712 signature
        bytes32 structHash = keccak256(abi.encode(
            CANCEL_TYPEHASH,
            _tradeId,
            msg.sender,
            sigNonces[msg.sender],
            _deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, _sig);
        if (recovered != msg.sender) revert InvalidSignature();

        sigNonces[msg.sender]++;

        if (msg.sender == t.maker) {
            t.cancelProposedByMaker = true;
        } else {
            t.cancelProposedByTaker = true;
        }
        emit CancelProposed(_tradeId, msg.sender);

        if (t.cancelProposedByMaker && t.cancelProposedByTaker) {
            _executeCancel(_tradeId);
        }
    }

    /**
     * @dev Internal cancel execution. Refunds both parties (minus decay if CHALLENGED).
     * Cancel'da fee kesilmez — tam iade.
     */
    function _executeCancel(uint256 _tradeId) internal {
        Trade storage t = trades[_tradeId];

        (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond, uint256 decayed) =
            _calculateCurrentAmounts(_tradeId);

        t.state = TradeState.CANCELED;

        if (decayed > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, decayed);
            emit BleedingDecayed(_tradeId, decayed, block.timestamp);
        }

        uint256 makerRefund = currentCrypto + currentMakerBond;
        if (makerRefund > 0) {
            IERC20(t.tokenAddress).safeTransfer(t.maker, makerRefund);
        }

        if (currentTakerBond > 0) {
            IERC20(t.tokenAddress).safeTransfer(t.taker, currentTakerBond);
        }

        emit EscrowCanceled(_tradeId, makerRefund, currentTakerBond);
    }

    // ═══════════════════════════════════════════════════
    //  BURN — 10-Day Timeout
    // ═══════════════════════════════════════════════════

    /**
     * @notice Anyone can trigger burn after 10-day Bleeding timeout.
     * All remaining funds go to treasury.
     * @param  _tradeId  Trade ID
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

        _updateReputation(t.maker, true);
        _updateReputation(t.taker, true);

        emit EscrowBurned(_tradeId, totalBurn);
    }

    // ═══════════════════════════════════════════════════
    //  TAKER FLOW — Ping Maker (Liveness Check)
    // ═══════════════════════════════════════════════════

    /**
     * @notice Taker, ödeme bildirildikten 24 saat sonra pasif kalan Maker'a
     * "hayat sinyali" gönderir. Bu, autoRelease için bir ön koşuldur.
     * @param  _tradeId  Trade ID
     */
    // AUDIT FIX C-05: nonReentrant eklendi — state değişikliği yapan fonksiyon
    function pingMaker(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.PAID)
    {
        Trade storage t = trades[_tradeId];
        if (msg.sender != t.taker) revert OnlyTaker();
        if (block.timestamp < t.paidAt + 24 hours) revert PingCooldownNotElapsed(t.paidAt + 24 hours);
        if (t.pingedByTaker) revert AlreadyPinged();

        // AUDIT FIX C-02: Maker zaten challenge yolunu başlattıysa,
        // Taker autoRelease yolunu açamaz. MEV/transaction ordering manipülasyonunu önler.
        if (t.challengePingedByMaker) revert ConflictingPingPath();

        t.pingedByTaker = true;
        t.pingedAt = block.timestamp;
        emit MakerPinged(_tradeId, msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════════════════
    //  AUTO-RELEASE — 48h Grace Period Timeout (Taker Fallback)
    // ═══════════════════════════════════════════════════

    /**
     * @notice If 48h passes with no challenge, Taker can self-release.
     * Protects honest Takers from maker inaction.
     * @param  _tradeId  Trade ID
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

        uint256 makerPenalty = (currentMakerBond * AUTO_RELEASE_PENALTY_BPS) / BPS_DENOMINATOR;
        uint256 takerPenalty = (currentTakerBond * AUTO_RELEASE_PENALTY_BPS) / BPS_DENOMINATOR;

        uint256 makerReceives = currentMakerBond - makerPenalty;
        uint256 takerReceivesBond = currentTakerBond - takerPenalty;
        uint256 totalPenalty = makerPenalty + takerPenalty;

        IERC20(t.tokenAddress).safeTransfer(t.taker, currentCrypto);
        if (makerReceives > 0) IERC20(t.tokenAddress).safeTransfer(t.maker, makerReceives);
        if (takerReceivesBond > 0) IERC20(t.tokenAddress).safeTransfer(t.taker, takerReceivesBond);
        if (totalPenalty > 0) IERC20(t.tokenAddress).safeTransfer(treasury, totalPenalty);

        _updateReputation(t.maker, true);
        _updateReputation(t.taker, false);

        emit EscrowReleased(_tradeId, t.maker, t.taker, makerPenalty, takerPenalty);
    }

    // ═══════════════════════════════════════════════════
    //  INTERNAL HELPERS
    // ═══════════════════════════════════════════════════

    /**
     * @dev Calculates current amounts after bleeding decay.
     *
     * AUDIT FIX C-01: Saniye bazlı lineer decay hesaplaması.
     * ÖNCEKİ: hoursElapsed = bleedingElapsed / 3600 (integer bölme → step-function)
     *   Sorun: İlk 3599 saniyede decay = 0. Küçük miktarlarda saatlik decay sıfıra
     *   yuvarlanıyordu ve fonlar hiç erimeye başlamıyordu.
     * ŞİMDİ: decayed = (original * rateBpsH * elapsedSeconds) / (BPS_DENOM * 3600)
     *   Aynı saatlik oran, saniye cinsinde uygulanır. Step-function yerine sürekli
     *   ve pürüzsüz (smooth) decay sağlar.
     *
     * Overflow analizi (uint256 güvenli):
     *   Max cryptoAmount: ~10^12 (1B USDT, 6 decimal)
     *   Max rate * 2: 68
     *   Max elapsedSeconds: 691200 (192h)
     *   Çarpım: 10^12 * 68 * 691200 = 4.7 * 10^19 ≪ 2^256
     *
     * @return currentCrypto    Remaining USDT after USDT decay
     * @return currentMakerBond Remaining maker bond after bond decay
     * @return currentTakerBond Remaining taker bond after bond decay
     * @return totalDecayed     Total amount decayed (to treasury)
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
        if (elapsed > MAX_BLEEDING) {
            elapsed = MAX_BLEEDING;
        }

        uint256 bleedingElapsed = elapsed > GRACE_PERIOD ? elapsed - GRACE_PERIOD : 0;

        // AUDIT FIX C-01: Saniye bazlı bond decay
        // Formül: decayed = (bond * BPS_per_hour * seconds) / (10000 * 3600)
        uint256 makerBondDecayed = (t.makerBond * MAKER_BOND_DECAY_BPS_H * bleedingElapsed) / (BPS_DENOMINATOR * SECONDS_PER_HOUR);
        if (makerBondDecayed > t.makerBond) makerBondDecayed = t.makerBond;

        uint256 takerBondDecayed = (t.takerBond * TAKER_BOND_DECAY_BPS_H * bleedingElapsed) / (BPS_DENOMINATOR * SECONDS_PER_HOUR);
        if (takerBondDecayed > t.takerBond) takerBondDecayed = t.takerBond;

        currentMakerBond = t.makerBond - makerBondDecayed;
        currentTakerBond = t.takerBond - takerBondDecayed;

        // AUDIT FIX C-01: Saniye bazlı crypto decay
        uint256 cryptoDecayed = 0;
        if (bleedingElapsed > USDT_DECAY_START) {
            uint256 usdtElapsed = bleedingElapsed - USDT_DECAY_START;
            cryptoDecayed = (t.cryptoAmount * CRYPTO_DECAY_BPS_H * 2 * usdtElapsed) / (BPS_DENOMINATOR * SECONDS_PER_HOUR);
            if (cryptoDecayed > t.cryptoAmount) cryptoDecayed = t.cryptoAmount;
        }

        currentCrypto = t.cryptoAmount - cryptoDecayed;
        totalDecayed = makerBondDecayed + takerBondDecayed + cryptoDecayed;
    }

    /**
     * @dev Returns maker bond BPS adjusted for reputation.
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
        if (rep.failedDisputes == 0 && rep.successfulTrades > 0) {
            bondBps = bondBps > GOOD_REP_DISCOUNT_BPS
                ? bondBps - GOOD_REP_DISCOUNT_BPS
                : 0;
        } else if (rep.failedDisputes >= 1) {
            bondBps += BAD_REP_PENALTY_BPS;
        }
    }

    /**
     * @dev Returns taker bond BPS adjusted for reputation.
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
        if (rep.failedDisputes == 0 && rep.successfulTrades > 0) {
            bondBps = bondBps > GOOD_REP_DISCOUNT_BPS
                ? bondBps - GOOD_REP_DISCOUNT_BPS
                : 0;
        } else if (rep.failedDisputes >= 1) {
            bondBps += BAD_REP_PENALTY_BPS;
        }
    }

    /**
     * @dev Updates on-chain reputation.
     *
     * Ban mekanizmasi (2+ failed dispute tetikler):
     * - 1. ban : 30 gun  — consecutiveBans = 1
     * - 2. ban : 60 gun  — consecutiveBans = 2 + tier 1 duser
     * - 3. ban : 120 gun — consecutiveBans = 3 + tier 1 daha duser
     * - ...   : sure 2 katina cikar, her seferinde tier 1 duser
     *
     * AFS-002 Fix: maxAllowedTier artık hasTierPenalty bayrağı ile korunuyor.
     * Sentinel problemi çözüldü — "hiç ceza almamış" ve "Tier 0'a düşürülmüş" artık ayırt edilebilir.
     */
    function _updateReputation(address _wallet, bool _failed) internal {
        Reputation storage rep = reputation[_wallet];
        if (_failed) {
            rep.failedDisputes++;

            if (rep.failedDisputes >= 2) {
                rep.consecutiveBans++;

                uint256 banDays = 30 days * (2 ** (rep.consecutiveBans - 1));
                if (banDays > 365 days) banDays = 365 days;
                rep.bannedUntil = block.timestamp + banDays;

                // AFS-002 Fix: Tier demosyon — hasTierPenalty bayrağı ile ilk ceza 4'ten başlar
                if (rep.consecutiveBans >= 2) {
                    // İlk kez tier cezası alıyorsa, maxAllowedTier'ı 4 ile başlat
                    if (!hasTierPenalty[_wallet]) {
                        hasTierPenalty[_wallet] = true;
                        maxAllowedTier[_wallet] = 4;
                    }
                    // Tier 0'ın altına düşemez
                    if (maxAllowedTier[_wallet] > 0) {
                        maxAllowedTier[_wallet] = maxAllowedTier[_wallet] - 1;
                    }
                    // maxAllowedTier 0'a ulaştığında, kullanıcı sadece Tier 0 işlem yapabilir.
                    // hasTierPenalty true olduğu için _getEffectiveTier 0'ı "ceza" olarak okur.
                }
            }
        } else {
            rep.successfulTrades++;

            // AUDIT FIX C-04: İlk başarılı işlem zamanını kaydet (wash trading caydırıcı).
            // Bu değer bir kez set edilir ve değişmez — ilk kez başarılı işlem yapıldığında.
            if (firstSuccessfulTradeAt[_wallet] == 0) {
                firstSuccessfulTradeAt[_wallet] = block.timestamp;
            }
        }

        emit ReputationUpdated(
            _wallet, rep.successfulTrades, rep.failedDisputes,
            rep.bannedUntil, _getEffectiveTier(_wallet)
        );
    }

    // ═══════════════════════════════════════════════════
    //  REPUTATION DECAY — Clean Slate Rule
    // ═══════════════════════════════════════════════════

    /**
     * @notice "Temiz Sayfa" kuralını uygular. Herkes tarafından çağrılabilir.
     * @dev    Eğer bir kullanıcının son yasağının üzerinden 180 günden fazla
     * geçtiyse, ardışık yasak sayacını sıfırlar.
     * @param  _wallet  İtibarı temizlenecek kullanıcının adresi.
     */
    function decayReputation(address _wallet) external nonReentrant {
        Reputation storage rep = reputation[_wallet];

        if (rep.bannedUntil == 0) revert NoPriorBanHistory();
        if (block.timestamp <= rep.bannedUntil + 180 days) revert CleanPeriodNotElapsed();
        if (rep.consecutiveBans == 0) revert NoBansToReset();

        rep.consecutiveBans = 0;
        // GÜVENLİK NOTU: maxAllowedTier ve hasTierPenalty burada sıfırlanmaz.
        // Kullanıcı, ardışık yasak cezasından kurtulur ancak kaybettiği Tier'ları
        // _getEffectiveTier kurallarına göre yeniden başarılı işlemler yaparak kazanmalıdır.

        emit ReputationUpdated(
            _wallet, rep.successfulTrades, rep.failedDisputes,
            rep.bannedUntil, _getEffectiveTier(_wallet)
        );
    }

    /**
     * @dev YENİ MİMARİ: Kullanıcının itibar ve ceza durumuna göre efektif tier'ını hesaplar.
     *
     * Kurallar (ARCHITECTURE_TR.md ile senkronize):
     * - T4: 200+ başarılı, <=15 failed
     * - T3: 100+ başarılı, <=10 failed
     * - T2: 50+ başarılı, <=5 failed
     * - T1: 15+ başarılı, <=2 failed
     * - T0: Diğer tüm durumlar
     *
     * AUDIT FIX C-04: MIN_ACTIVE_PERIOD kontrolü eklendi.
     * İlk başarılı işlemden itibaren 30 gün geçmeden Tier 1+ erişimi verilmez.
     * Bu, Sybil hesaplarının hızlı tier atlamasını caydırır.
     *
     * AFS-002 Fix: `hasTierPenalty` bayrağı ile maxAllowedTier sentinel problemi çözüldü.
     * hasTierPenalty false → hiç ceza almamış → tier tavanı yok (4 döner).
     * hasTierPenalty true  → maxAllowedTier gerçek ceza değeridir (0 dahil).
     */
    function _getEffectiveTier(address _wallet) internal view returns (uint8) {
        Reputation storage rep = reputation[_wallet];
        uint8 calculatedTier;

        if (rep.successfulTrades >= 200 && rep.failedDisputes <= 15) {
            calculatedTier = 4;
        } else if (rep.successfulTrades >= 100 && rep.failedDisputes <= 10) {
            calculatedTier = 3;
        } else if (rep.successfulTrades >= 50 && rep.failedDisputes <= 5) {
            calculatedTier = 2;
        } else if (rep.successfulTrades >= 15 && rep.failedDisputes <= 2) {
            calculatedTier = 1;
        } else {
            calculatedTier = 0;
        }

        // AUDIT FIX C-04: Minimum aktif süre kontrolü — wash trading caydırıcı.
        // İlk başarılı işlemden itibaren MIN_ACTIVE_PERIOD (30 gün) geçmeden
        // Tier 1+ erişimi verilmez. Bu sayede Sybil hesapları en az 30 gün boyunca
        // Tier 0'da kalır ve düşük limitlerle (max 5000 TRY) sınırlı olur.
        if (calculatedTier > 0) {
            if (firstSuccessfulTradeAt[_wallet] == 0 ||
                block.timestamp < firstSuccessfulTradeAt[_wallet] + MIN_ACTIVE_PERIOD) {
                calculatedTier = 0;
            }
        }

        // AFS-002 Fix: hasTierPenalty bayrağı ile kontrol
        // Eğer hiç tier cezası almamışsa, hesaplanan tier'ı olduğu gibi döndür
        if (!hasTierPenalty[_wallet]) {
            return calculatedTier;
        }

        // Ceza varsa, hesaplanan tier ile ceza tavanının en düşüğünü döndür
        return calculatedTier > maxAllowedTier[_wallet] ? maxAllowedTier[_wallet] : calculatedTier;
    }

    // ═══════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════

    /**
     * @notice Returns user reputation and ban details.
     */
    function getReputation(address _wallet)
        external
        view
        returns (
            uint256 successful,
            uint256 failed,
            uint256 bannedUntil,
            uint256 consecutiveBans,
            uint8   effectiveTier
        )
    {
        Reputation storage rep = reputation[_wallet];
        return (
            rep.successfulTrades,
            rep.failedDisputes,
            rep.bannedUntil,
            rep.consecutiveBans,
            _getEffectiveTier(_wallet)
        );
    }

    /**
     * AFS-004 Fix: getTrade — explicit view fonksiyonu.
     * @notice Returns full trade details.
     * @dev    Solidity auto-getter struct için tuple döndürür ve named field erişimi
     *         vermez. Bu fonksiyon frontend ve test entegrasyonu için gereklidir.
     */
    function getTrade(uint256 _tradeId) external view returns (Trade memory) {
        return trades[_tradeId];
    }

    /**
     * AFS-005 Fix: getCurrentAmounts — external view wrapper.
     * @notice Bir uyuşmazlık durumunda, Bleeding Escrow mekanizması sonrası
     *         anlık olarak kalan kripto ve teminat miktarlarını hesaplar.
     * @dev    ARCHITECTURE dokümanında public view olarak belgelenmişti ancak
     *         sadece internal tanımlıydı. Frontend ve üçüncü taraflar bu fonksiyonu
     *         çağırarak decay miktarını on-chain'den okuyabilir.
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
     * @notice Check if wallet passes Anti-Sybil (Tier 0 and Tier 1).
     */
    function antiSybilCheck(address _wallet)
        external
        view
        returns (bool aged, bool funded, bool cooldownOk)
    {
        aged = walletRegisteredAt[_wallet] != 0 &&
               block.timestamp >= walletRegisteredAt[_wallet] + WALLET_AGE_MIN;
        funded = _wallet.balance >= DUST_LIMIT;
        cooldownOk = lastTradeAt[_wallet] == 0 ||
                     block.timestamp >= lastTradeAt[_wallet] + TIER0_TRADE_COOLDOWN;
    }

    /**
     * @notice EIP-712 domain separator for frontend signing.
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ═══════════════════════════════════════════════════
    //  ADMIN — Owner Only
    // ═══════════════════════════════════════════════════

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert OwnableInvalidOwner(address(0));
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    // AFS-001 Fix: supportedTokens mapping'i artık güncelleniyor.
    // Önceki kod sadece event emit edip mapping'i yazmıyordu — hiçbir token desteklenmiyordu.
    function setSupportedToken(address _token, bool _supported) external onlyOwner {
        if (_token == address(0)) revert OwnableInvalidOwner(address(0));
        supportedTokens[_token] = _supported; // AFS-001 Fix: KRİTİK — bu satır eksikti
        emit TokenSupportUpdated(_token, _supported);
    }

    // C-03 Fix: Emergency pause — exploit tespit edildiğinde yeni işlem girişini durdurur
    // NOT: pause sadece createEscrow ve lockEscrow'u etkiler.
    // releaseFunds, autoRelease, burnExpired ve proposeOrApproveCancel pause sırasında da çalışır —
    // bu kasıtlıdır: mevcut işlemlerin sonlandırılabilmesi gerekir.
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
