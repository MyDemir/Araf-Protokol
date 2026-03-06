// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  ArafEscrow
 * @notice Oracle-free, humanless P2P fiat ↔ crypto escrow with
 *         Bleeding Escrow (time-decay) dispute resolution.
 * @dev    Security: ReentrancyGuard + CEI pattern + EIP-712 cancel.
 *         Network: Base (L2)
 * @author Araf Protocol — v2.0
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol"; // C-03 Fix: Emergency pause mekanizması
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
        uint256 takerBond;      // Taker's bond in token (0 for Tier 1)
        uint8   tier;           // 0, 1, 2, 3 or 4
        TradeState state;
        uint256 lockedAt;
        uint256 paidAt;
        uint256 challengedAt;
        string  ipfsReceiptHash; // Taker's payment proof
        bool    cancelProposedByMaker;
        bool    cancelProposedByTaker;
        // M-02 Fix: cancelNonce kaldırıldı — replay protection sigNonces mapping'i kullanır
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
    // Psikolojik baski: Taker ispat yukunu tasir; Tier 1-2'de bond asimetrisi bunu hissettirir.

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

    // ── Saatlik Decay (Hourly BPS) ────────────────────────────────────────────
    // Efektif bleeding: MAX_BLEEDING(240h) - GRACE(48h) = 192h
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

    // H-08 Fix: RELEASE_TYPEHASH kaldırıldı — karşılık gelen bir fonksiyon yoktu, auditor yanıltıcıydı

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

    // Consecutive ban cezasi: cuzdan bu tierin uzerinde islem acamaz.
    // Varsayilan: 4 (Tier 4 = kısıtsız). Her consecutive ban 1 duser.
    // Off-chain backend bu degeri okuyup tier secimini kisitlar.
    mapping(address => uint8) public maxAllowedTier;

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
    event BleedingDecayed(uint256 indexed tradeId, uint256 decayedAmount, uint256 timestamp);
    event EscrowBurned(uint256 indexed tradeId, uint256 burnedAmount);
    event TreasuryUpdated(address indexed newTreasury);
    event TokenSupportUpdated(address indexed token, bool supported);

    // ═══════════════════════════════════════════════════
    //  MODIFIERS
    // ═══════════════════════════════════════════════════

    modifier onlyTradeParty(uint256 _tradeId) {
        Trade storage t = trades[_tradeId];
        require(
            msg.sender == t.maker || msg.sender == t.taker,
            "ArafEscrow: not a trade party"
        );
        _;
    }

    modifier inState(uint256 _tradeId, TradeState _expected) {
        require(
            trades[_tradeId].state == _expected,
            "ArafEscrow: invalid state"
        );
        _;
    }

    modifier notBanned() {
        Reputation storage rep = reputation[msg.sender];
        require(
            rep.bannedUntil == 0 || block.timestamp > rep.bannedUntil,
            "ArafEscrow: 30-day Taker ban active"
        );
        _;
    }

    // ═══════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════

    constructor(address _treasury)
        EIP712("ArafEscrow", "1")
        Ownable(msg.sender)
    {
        require(_treasury != address(0), "ArafEscrow: zero treasury");
        treasury = _treasury;
    }

    // ═══════════════════════════════════════════════════
    //  REGISTRATION — Anti-Sybil Wallet Age Gate
    // ═══════════════════════════════════════════════════

    /**
     * @notice Register wallet to start the 7-day aging countdown.
     *         Must be called before acting as Taker.
     */
    function registerWallet() external {
        require(
            walletRegisteredAt[msg.sender] == 0,
            "ArafEscrow: already registered"
        );
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
     * @param  _tier          1, 2, or 3
     */
    function createEscrow(
        address _token,
        uint256 _cryptoAmount,
        uint8   _tier
    ) external nonReentrant whenNotPaused returns (uint256 tradeId) { // C-03 Fix: whenNotPaused eklendi
        // ── Checks ──
        require(supportedTokens[_token], "ArafEscrow: token not supported");
        require(_cryptoAmount > 0, "ArafEscrow: zero amount");
        require(_tier <= 4, "ArafEscrow: invalid tier");

        // Consecutive ban cezasi: cuzdan ban nedeniyle tier kisitlandi mi?
        uint8 maxTier = maxAllowedTier[msg.sender];
        if (maxTier > 0) {
            require(_tier <= maxTier, "ArafEscrow: tier restricted by consecutive ban");
        }

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
            lockedAt:             0,
            paidAt:               0,
            challengedAt:         0,
            ipfsReceiptHash:      "",
            cancelProposedByMaker: false,
            cancelProposedByTaker: false
            // M-02 Fix: cancelNonce kaldırıldı — sigNonces mapping replay'i önler
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
     *         Tüm fonlar (cryptoAmount + makerBond) maker'a iade edilir.
     *         OPEN state'te taker yoktur — iade sırasında chargeback riski bulunmaz.
     * @param  _tradeId  Trade ID
     */
    function cancelOpenEscrow(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.OPEN)
    {
        Trade storage t = trades[_tradeId];
        require(msg.sender == t.maker, "ArafEscrow: only maker");

        uint256 refund = t.cryptoAmount + t.makerBond;

        // ── Effects ──
        t.state = TradeState.CANCELED;

        // ── Interactions ──
        IERC20(t.tokenAddress).safeTransfer(t.maker, refund);
        emit EscrowCanceled(_tradeId, refund, 0);
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
        whenNotPaused // C-03 Fix: whenNotPaused eklendi
        inState(_tradeId, TradeState.OPEN)
    {
        Trade storage t = trades[_tradeId];

        // ── Anti-Sybil Shield ──
        // 1. Self-trade prevention
        require(msg.sender != t.maker, "ArafEscrow: self-trade forbidden");

        // 2. Wallet age check
        require(
            walletRegisteredAt[msg.sender] != 0 &&
            block.timestamp >= walletRegisteredAt[msg.sender] + WALLET_AGE_MIN,
            "ArafEscrow: wallet too young (<7 days)"
        );

        // 3. Dust limit (native balance)
        require(
            msg.sender.balance >= DUST_LIMIT,
            "ArafEscrow: insufficient native balance"
        );

        // 4. Cooldown: Tier 0 ve Tier 1 icin gunde max 1 islem
        if (t.tier == 0 || t.tier == 1) {
            require(
                lastTradeAt[msg.sender] == 0 ||
                block.timestamp >= lastTradeAt[msg.sender] + TIER0_TRADE_COOLDOWN,
                "ArafEscrow: Tier 0/1 cooldown active (24h)"
            );
        }

        // Calculate taker bond
        uint256 takerBondBps = _getTakerBondBps(msg.sender, t.tier);
        uint256 takerBond = (t.cryptoAmount * takerBondBps) / BPS_DENOMINATOR;

        // ── Effects ──
        t.taker = msg.sender;
        t.takerBond = takerBond;
        t.state = TradeState.LOCKED;
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
    function reportPayment(uint256 _tradeId, string calldata _ipfsHash)
        external
        onlyTradeParty(_tradeId)
        inState(_tradeId, TradeState.LOCKED)
    {
        Trade storage t = trades[_tradeId];
        require(msg.sender == t.taker, "ArafEscrow: only taker");
        require(bytes(_ipfsHash).length > 0, "ArafEscrow: empty IPFS hash");

        // Effects
        t.state = TradeState.PAID;
        t.paidAt = block.timestamp;
        t.ipfsReceiptHash = _ipfsHash;

        emit PaymentReported(_tradeId, _ipfsHash, block.timestamp);
    }

    // ═══════════════════════════════════════════════════
    //  MAKER FLOW — Release Funds (Happy Path)
    // ═══════════════════════════════════════════════════

    /**
     * @notice Maker confirms receipt and releases USDT to Taker.
     *         Can also be called during Bleeding phase.
     *
     * Fee dağılımı:
     *   takerFee  = cryptoAmount × TAKER_FEE_BPS → taker'ın alacağından kesilir
     *   makerFee  = cryptoAmount × MAKER_FEE_BPS → maker'ın bond iadesinden kesilir
     *   Treasury  = takerFee + makerFee (toplam %0.4)
     *
     * @param  _tradeId  Trade ID
     */
    function releaseFunds(uint256 _tradeId)
        external
        nonReentrant
        onlyTradeParty(_tradeId)
    {
        Trade storage t = trades[_tradeId];
        require(
            t.state == TradeState.PAID || t.state == TradeState.CHALLENGED,
            "ArafEscrow: cannot release in current state"
        );
        require(msg.sender == t.maker, "ArafEscrow: only maker can release");

        // If CHALLENGED, apply decay first to get current amounts
        (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond, uint256 decayed) =
            _calculateCurrentAmounts(_tradeId);

        // ── Effects ──
        t.state = TradeState.RESOLVED;

        // ── Interactions (CEI: state set before transfers) ──

        // Send decayed amount to treasury
        if (decayed > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, decayed);
            emit BleedingDecayed(_tradeId, decayed, block.timestamp);
        }

        // Taker fee: crypto'dan kesilir
        uint256 takerFee      = (currentCrypto * TAKER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 takerReceives = currentCrypto - takerFee;

        // Maker fee: bond'dan kesilir (bond yetmezse kalan kadar)
        uint256 makerFee          = (currentCrypto * MAKER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 makerBondAfterFee = currentMakerBond > makerFee ? currentMakerBond - makerFee : 0;
        uint256 actualMakerFee    = currentMakerBond > makerFee ? makerFee : currentMakerBond;

        // Taker gets crypto - takerFee
        IERC20(t.tokenAddress).safeTransfer(t.taker, takerReceives);

        // Treasury gets takerFee + makerFee
        if (takerFee + actualMakerFee > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, takerFee + actualMakerFee);
        }

        // Maker gets bond back minus makerFee
        if (makerBondAfterFee > 0) {
            IERC20(t.tokenAddress).safeTransfer(t.maker, makerBondAfterFee);
        }

        // Taker gets bond back (full)
        if (currentTakerBond > 0) {
            IERC20(t.tokenAddress).safeTransfer(t.taker, currentTakerBond);
        }

        // Update reputation
        // S2: CHALLENGED state'ten release → maker haksız challenge açtı → +1 Failed
        // PAID state'ten release → normal happy path → her ikisi +1 Successful
        bool makerOpenedDispute = (t.state == TradeState.CHALLENGED);
        _updateReputation(t.maker, makerOpenedDispute);
        _updateReputation(t.taker, false);

        emit EscrowReleased(_tradeId, t.maker, t.taker, takerFee, actualMakerFee);
    }

    // ═══════════════════════════════════════════════════
    //  MAKER FLOW — Challenge (Dispute)
    // ═══════════════════════════════════════════════════

    /**
     * @notice Maker opens a dispute. Enters Grace Period (48h).
     *         Requires 1h cooldown from PAID state (anti-spam).
     * @param  _tradeId  Trade ID
     */
    function challengeTrade(uint256 _tradeId)
        external
        onlyTradeParty(_tradeId)
        inState(_tradeId, TradeState.PAID)
    {
        Trade storage t = trades[_tradeId];
        require(msg.sender == t.maker, "ArafEscrow: only maker can challenge");

        // 1-hour cooldown after PAID to prevent instant griefing
        require(
            block.timestamp >= t.paidAt + CHALLENGE_COOLDOWN,
            "ArafEscrow: challenge cooldown active"
        );

        // Effects
        t.state = TradeState.CHALLENGED;
        t.challengedAt = block.timestamp;

        emit DisputeOpened(_tradeId, msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════════════════
    //  COLLABORATIVE CANCEL — EIP-712 Signature Based
    // ═══════════════════════════════════════════════════

    /**
     * @notice Propose or approve a collaborative cancel.
     *         First caller proposes; second caller (other party) finalizes.
     *         Both must provide valid EIP-712 signatures (relayer pattern).
     * @param  _tradeId   Trade ID
     * @param  _deadline  Signature expiry
     * @param  _sig       EIP-712 signature
     */
    function proposeOrApproveCancel(
        uint256 _tradeId,
        uint256 _deadline,
        bytes calldata _sig
    ) external nonReentrant onlyTradeParty(_tradeId) {
        Trade storage t = trades[_tradeId];
        require(
            t.state == TradeState.LOCKED ||
            t.state == TradeState.PAID   ||
            t.state == TradeState.CHALLENGED,
            "ArafEscrow: cannot cancel in current state"
        );
        require(block.timestamp <= _deadline, "ArafEscrow: signature expired");

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
        require(recovered == msg.sender, "ArafEscrow: invalid signature");

        // Increment nonce to prevent replay
        sigNonces[msg.sender]++;

        // Record proposal
        if (msg.sender == t.maker) {
            t.cancelProposedByMaker = true;
        } else {
            t.cancelProposedByTaker = true;
        }
        emit CancelProposed(_tradeId, msg.sender);

        // If both parties agreed → execute cancel
        if (t.cancelProposedByMaker && t.cancelProposedByTaker) {
            _executeCancel(_tradeId);
        }
    }

    /**
     * @dev Internal cancel execution. Refunds both parties (minus decay if CHALLENGED).
     *      Cancel'da fee kesilmez — tam iade.
     */
    function _executeCancel(uint256 _tradeId) internal {
        Trade storage t = trades[_tradeId];

        (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond, uint256 decayed) =
            _calculateCurrentAmounts(_tradeId);

        // Effects
        t.state = TradeState.CANCELED;

        // Interactions
        if (decayed > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, decayed);
            emit BleedingDecayed(_tradeId, decayed, block.timestamp);
        }

        // Maker gets crypto back + their bond
        uint256 makerRefund = currentCrypto + currentMakerBond;
        if (makerRefund > 0) {
            IERC20(t.tokenAddress).safeTransfer(t.maker, makerRefund);
        }

        // Taker gets their bond back
        if (currentTakerBond > 0) {
            IERC20(t.tokenAddress).safeTransfer(t.taker, currentTakerBond);
        }

        // No reputation penalty for mutual cancel
        emit EscrowCanceled(_tradeId, makerRefund, currentTakerBond);
    }

    // ═══════════════════════════════════════════════════
    //  BURN — 10-Day Timeout
    // ═══════════════════════════════════════════════════

    /**
     * @notice Anyone can trigger burn after 10-day Bleeding timeout.
     *         All remaining funds go to treasury.
     * @param  _tradeId  Trade ID
     */
    function burnExpired(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.CHALLENGED)
    {
        Trade storage t = trades[_tradeId];
        require(
            block.timestamp >= t.challengedAt + MAX_BLEEDING,
            "ArafEscrow: 10-day burn period not reached"
        );

        // Calculate remaining after max decay
        (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond,) =
            _calculateCurrentAmounts(_tradeId);

        uint256 totalBurn = currentCrypto + currentMakerBond + currentTakerBond;

        // Effects
        t.state = TradeState.BURNED;

        // Interactions
        if (totalBurn > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, totalBurn);
        }

        // Both parties get failed dispute
        _updateReputation(t.maker, true);
        _updateReputation(t.taker, true);

        emit EscrowBurned(_tradeId, totalBurn);
    }

    // ═══════════════════════════════════════════════════
    //  AUTO-RELEASE — 48h Grace Period Timeout (Taker Fallback)
    // ═══════════════════════════════════════════════════

    /**
     * @notice If 48h passes with no challenge, Taker can self-release.
     *         Protects honest Takers from maker inaction.
     *         Fee dağılımı releaseFunds ile aynıdır.
     * @param  _tradeId  Trade ID
     */
    function autoRelease(uint256 _tradeId)
        external
        nonReentrant
        inState(_tradeId, TradeState.PAID)
    {
        Trade storage t = trades[_tradeId];
        require(msg.sender == t.taker, "ArafEscrow: only taker");
        require(
            block.timestamp >= t.paidAt + GRACE_PERIOD,
            "ArafEscrow: 48h grace period not elapsed"
        );

        // L-03 FIX: autoRelease'de de decay hesabı yapılmalı.
        // PAID state'i için decay yoktur (challenged değil), ama tutarlılık için
        // _calculateCurrentAmounts kullanıyoruz — gelecekte state değişirse de güvenli.
        (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond, uint256 decayed) =
            _calculateCurrentAmounts(_tradeId);

        // Effects
        t.state = TradeState.RESOLVED;

        // Interactions
        if (decayed > 0) {
            IERC20(t.tokenAddress).safeTransfer(treasury, decayed);
            emit BleedingDecayed(_tradeId, decayed, block.timestamp);
        }

        // Taker fee: crypto'dan kesilir
        uint256 takerFee      = (currentCrypto * TAKER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 takerReceives = currentCrypto - takerFee;

        // Maker fee: bond'dan kesilir
        uint256 makerFee          = (currentCrypto * MAKER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 makerBondAfterFee = currentMakerBond > makerFee ? currentMakerBond - makerFee : 0;
        uint256 actualMakerFee    = currentMakerBond > makerFee ? makerFee : currentMakerBond;

        IERC20(t.tokenAddress).safeTransfer(t.taker, takerReceives);
        if (takerFee + actualMakerFee > 0) IERC20(t.tokenAddress).safeTransfer(treasury, takerFee + actualMakerFee);
        if (makerBondAfterFee > 0) IERC20(t.tokenAddress).safeTransfer(t.maker, makerBondAfterFee);
        if (currentTakerBond > 0) IERC20(t.tokenAddress).safeTransfer(t.taker, currentTakerBond);

        // S1: autoRelease → maker 48h içinde release etmedi, pasif kaldı → +1 Failed
        // Taker ödemeyi yaptı ve bekledi → +1 Successful
        _updateReputation(t.maker, true);
        _updateReputation(t.taker, false);

        emit EscrowReleased(_tradeId, t.maker, t.taker, takerFee, actualMakerFee);
    }

    // ═══════════════════════════════════════════════════
    //  INTERNAL HELPERS
    // ═══════════════════════════════════════════════════

    /**
     * @dev Calculates current amounts after bleeding decay (linear approximation).
     *      Decay is calculated lazily on-chain — gas efficient.
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

        // No bleeding if not CHALLENGED
        if (t.state != TradeState.CHALLENGED || t.challengedAt == 0) {
            return (t.cryptoAmount, t.makerBond, t.takerBond, 0);
        }

        uint256 elapsed = block.timestamp - t.challengedAt;

        // Cap at MAX_BLEEDING
        if (elapsed > MAX_BLEEDING) {
            elapsed = MAX_BLEEDING;
        }

        // ── Grace Period (48h) ──
        // Ilk 48 saat hicbir sey erimez — fonlar guvende.
        // 48h'de anlaşma yoksa bleeding baslar.
        uint256 bleedingElapsed = elapsed > GRACE_PERIOD ? elapsed - GRACE_PERIOD : 0;

        // ── Bond Decay (Saatlik / Hourly) ──
        // Grace period bittikten sonra baslar.
        // Tier 0'da makerBond ve takerBond sifir oldugundan etki yoktur.
        // Tier 1-4: Taker 42 BPS/h, Maker 26 BPS/h
        uint256 hoursElapsed = bleedingElapsed / SECONDS_PER_HOUR;

        uint256 makerBondDecayBps = hoursElapsed * MAKER_BOND_DECAY_BPS_H;
        uint256 takerBondDecayBps = hoursElapsed * TAKER_BOND_DECAY_BPS_H;

        // Cap at 100% (10000 BPS)
        if (makerBondDecayBps > BPS_DENOMINATOR) makerBondDecayBps = BPS_DENOMINATOR;
        if (takerBondDecayBps > BPS_DENOMINATOR) takerBondDecayBps = BPS_DENOMINATOR;

        uint256 makerBondDecayed = (t.makerBond * makerBondDecayBps) / BPS_DENOMINATOR;
        uint256 takerBondDecayed = (t.takerBond * takerBondDecayBps) / BPS_DENOMINATOR;

        currentMakerBond = t.makerBond - makerBondDecayed;
        currentTakerBond = t.takerBond - takerBondDecayed;

        // ── Crypto Decay (Saatlik / Hourly) ──
        // Grace(48h) + USDT_DECAY_START(96h) = 144h'den sonra baslar.
        // Her iki taraftan 34 BPS/h = toplam 68 BPS/h crypto erimesi.
        // Tier 0 dahil tum tierlar icin uygulanir.
        uint256 cryptoDecayed = 0;
        if (bleedingElapsed > USDT_DECAY_START) {
            uint256 usdtElapsed  = bleedingElapsed - USDT_DECAY_START;
            uint256 usdtHours    = usdtElapsed / SECONDS_PER_HOUR;
            uint256 cryptoDecayBps = usdtHours * CRYPTO_DECAY_BPS_H * 2; // her iki taraf
            if (cryptoDecayBps > BPS_DENOMINATOR) cryptoDecayBps = BPS_DENOMINATOR;
            cryptoDecayed = (t.cryptoAmount * cryptoDecayBps) / BPS_DENOMINATOR;
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
        if      (_tier == 0) return MAKER_BOND_TIER0_BPS; // 0% — rep modifier uygulanmaz
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
        if      (_tier == 0) return TAKER_BOND_TIER0_BPS; // 0% — rep modifier uygulanmaz
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
     *  Ban mekanizmasi (2+ failed dispute tetikler):
     *  - 1. ban : 30 gun  — consecutiveBans = 1
     *  - 2. ban : 60 gun  — consecutiveBans = 2 + tier 1 duser
     *  - 3. ban : 120 gun — consecutiveBans = 3 + tier 1 daha duser
     *  - ...   : sure 2 katina cikar, her seferinde tier 1 duser
     *
     *  Ard arda ban sayimi: onceki ban hala aktifken yeni ban alinirsa
     *  "consecutive" sayilir. Ban sureleri arasinda temiz gecis olursa
     *  consecutiveBans sifirlanmaz — kalici hafiza (ceza birikir).
     *
     *  maxAllowedTier: consecutive ban cezasiyla tier kisitlanir.
     *  Orn: T3 cuzdanina 2. consecutive ban gelirse maxAllowedTier = 2.
     */
    function _updateReputation(address _wallet, bool _failed) internal {
        Reputation storage rep = reputation[_wallet];
        if (_failed) {
            rep.failedDisputes++;

            // Ban tetikleme: 2+ failed dispute
            if (rep.failedDisputes >= 2) {
                rep.consecutiveBans++;

                // Escalating ban duration: 30 * 2^(consecutiveBans-1) gun
                // 1. ban: 30g, 2. ban: 60g, 3. ban: 120g, ...
                uint256 banDays = 30 days * (2 ** (rep.consecutiveBans - 1));
                // Cap: maksimum 365 gun (asiri gaz maliyetini onle)
                if (banDays > 365 days) banDays = 365 days;
                rep.bannedUntil = block.timestamp + banDays;

                // Tier demosyon: 2. ban ve sonrasinda maxAllowedTier 1 duser
                if (rep.consecutiveBans >= 2) {
                    uint8 current = maxAllowedTier[_wallet];
                    // Hic set edilmemisse varsayilan = 4
                    if (current == 0) current = 4;
                    // Tier 0'in altina dusemez
                    if (current > 0) {
                        maxAllowedTier[_wallet] = current - 1;
                    }
                }
            }
        } else {
            rep.successfulTrades++;
        }
    }

    // ═══════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════

    /**
     * @notice Returns current (post-decay) amounts for a trade.
     */
    function getCurrentAmounts(uint256 _tradeId)
        external
        view
        returns (
            uint256 crypto,
            uint256 makerBond,
            uint256 takerBond,
            uint256 decayed
        )
    {
        return _calculateCurrentAmounts(_tradeId);
    }

    /**
     * @notice Returns full trade details.
     */
    function getTrade(uint256 _tradeId) external view returns (Trade memory) {
        return trades[_tradeId];
    }

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
            uint8   tierCap
        )
    {
        Reputation storage rep = reputation[_wallet];
        uint8 cap = maxAllowedTier[_wallet];
        if (cap == 0) cap = 4; // varsayilan: kısıtsız
        return (
            rep.successfulTrades,
            rep.failedDisputes,
            rep.bannedUntil,
            rep.consecutiveBans,
            cap
        );
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
        require(_treasury != address(0), "ArafEscrow: zero address");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setSupportedToken(address _token, bool _supported) external onlyOwner {
        supportedTokens[_token] = _supported;
        emit TokenSupportUpdated(_token, _supported);
    }

    // C-03 Fix: Emergency pause — exploit tespit edildiğinde yeni işlem girişini durdurur
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
