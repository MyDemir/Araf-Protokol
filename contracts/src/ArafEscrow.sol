// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  ArafEscrow
 * @notice Oracle-free, humanless P2P fiat ↔ crypto escrow with
 *         Bleeding Escrow (time-decay) dispute resolution.
 * @dev    Security: ReentrancyGuard + CEI pattern + EIP-712 cancel.
 *         Network: Base (L2)
 * @author Araf Protocol — v1.2
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
        uint8   tier;           // 1, 2, or 3
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
        uint256 bannedUntil;    // timestamp; 0 = not banned
    }

    // ═══════════════════════════════════════════════════
    //  CONSTANTS — Finalized Protocol Parameters v1.2
    // ═══════════════════════════════════════════════════

    // Tier trade limits (in micro-USD equivalent, for on-chain checks)
    // Real-world TRY limits enforced off-chain; on-chain checks crypto amount

    // Bond percentages in basis points (BPS): 100 BPS = 1%
    uint256 public constant MAKER_BOND_TIER1_BPS = 1800; // 18%
    uint256 public constant MAKER_BOND_TIER2_BPS = 1500; // 15%
    uint256 public constant MAKER_BOND_TIER3_BPS = 1000; // 10%
    uint256 public constant TAKER_BOND_TIER1_BPS = 0;    // 0%  (Anti-Sybil protected)
    uint256 public constant TAKER_BOND_TIER2_BPS = 1200; // 12%
    uint256 public constant TAKER_BOND_TIER3_BPS = 800;  //  8%

    // Bond reputation modifiers
    uint256 public constant GOOD_REP_DISCOUNT_BPS = 300; // -3%
    uint256 public constant BAD_REP_PENALTY_BPS   = 500; // +5%

    // Protocol success fee — symmetric split: %0.1 taker (crypto'dan) + %0.1 maker (bond'dan)
    // Taker aldığı crypto'dan %0.1 öder → fiat/crypto paritesi korunur
    // Maker bond iadesinden %0.1 öder → aldığı TL'ye dokunulmaz
    // Toplam treasury geliri: %0.2/işlem
    uint256 public constant TAKER_FEE_BPS = 10; // %0.1 — taker crypto'sundan
    uint256 public constant MAKER_FEE_BPS = 10; // %0.1 — maker bond'undan

    // Timers
    uint256 public constant GRACE_PERIOD        = 48 hours;
    uint256 public constant CHALLENGE_COOLDOWN  = 1 hours;   // Min time after PAID before challenge
    uint256 public constant USDT_DECAY_START    = 96 hours;  // Day 4 of Bleeding (relative to challengedAt)
    uint256 public constant MAX_BLEEDING        = 240 hours; // 10 days — then BURNED
    uint256 public constant WALLET_AGE_MIN      = 7 days;
    uint256 public constant TIER1_TRADE_COOLDOWN = 24 hours;

    // Bleeding decay in BPS per day (86400 seconds)
    uint256 public constant BOND_DECAY_OPENER_BPS_DAY = 1500; // 15%/day
    uint256 public constant BOND_DECAY_OTHER_BPS_DAY  = 1000; // 10%/day
    uint256 public constant USDT_DECAY_BPS_DAY        = 400;  //  4%/day (both parties)

    // Anti-Sybil: minimum native token balance (~$2 worth)
    uint256 public constant DUST_LIMIT = 0.001 ether; // ~$2 on Base

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant SECONDS_PER_DAY = 86_400;

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
        require(_tier >= 1 && _tier <= 3, "ArafEscrow: invalid tier");

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

        // 4. Tier 1 cooldown: max 1 trade per 24h
        if (t.tier == 1) {
            require(
                lastTradeAt[msg.sender] == 0 ||
                block.timestamp >= lastTradeAt[msg.sender] + TIER1_TRADE_COOLDOWN,
                "ArafEscrow: Tier 1 cooldown active"
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
        // İlk 48 saat boyunca hiçbir şey erimez. Fonlar güvende.
        // 48h içinde anlaşma sağlanmazsa bleeding başlar.
        uint256 bleedingElapsed = elapsed > GRACE_PERIOD ? elapsed - GRACE_PERIOD : 0;

        // ── Bond Decay ──
        // Grace period (48h) bittikten sonra başlar.
        // Opener (maker) %15/gün, diğer taraf (taker) %10/gün erir.
        uint256 daysElapsed = bleedingElapsed / SECONDS_PER_DAY;

        uint256 makerBondDecayBps = daysElapsed * BOND_DECAY_OPENER_BPS_DAY;
        uint256 takerBondDecayBps = daysElapsed * BOND_DECAY_OTHER_BPS_DAY;

        // Cap at 100% (10000 BPS)
        if (makerBondDecayBps > BPS_DENOMINATOR) makerBondDecayBps = BPS_DENOMINATOR;
        if (takerBondDecayBps > BPS_DENOMINATOR) takerBondDecayBps = BPS_DENOMINATOR;

        uint256 makerBondDecayed = (t.makerBond * makerBondDecayBps) / BPS_DENOMINATOR;
        uint256 takerBondDecayed = (t.takerBond * takerBondDecayBps) / BPS_DENOMINATOR;

        currentMakerBond = t.makerBond - makerBondDecayed;
        currentTakerBond = t.takerBond - takerBondDecayed;

        // ── USDT/Crypto Decay ──
        // Grace(48h) + buffer(96h) = 144h sonra başlar.
        // Her iki taraftan %4/gün → toplam %8/gün crypto erimesi.
        uint256 cryptoDecayed = 0;
        if (bleedingElapsed > USDT_DECAY_START) {
            uint256 usdtElapsed = bleedingElapsed - USDT_DECAY_START;
            uint256 bleedingDays = usdtElapsed / SECONDS_PER_DAY;

            // %8/gün toplam (her taraf %4 öder)
            uint256 cryptoDecayBps = bleedingDays * USDT_DECAY_BPS_DAY * 2; // both sides
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
        if (_tier == 1) bondBps = MAKER_BOND_TIER1_BPS;
        else if (_tier == 2) bondBps = MAKER_BOND_TIER2_BPS;
        else bondBps = MAKER_BOND_TIER3_BPS;

        Reputation storage rep = reputation[_maker];
        if (rep.failedDisputes == 0 && rep.successfulTrades > 0) {
            // Good reputation discount
            bondBps = bondBps > GOOD_REP_DISCOUNT_BPS
                ? bondBps - GOOD_REP_DISCOUNT_BPS
                : 0;
        } else if (rep.failedDisputes >= 1) {
            // Bad reputation penalty
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
        if (_tier == 1) return TAKER_BOND_TIER1_BPS; // Always 0 for Tier 1

        if (_tier == 2) bondBps = TAKER_BOND_TIER2_BPS;
        else bondBps = TAKER_BOND_TIER3_BPS;

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
     * @dev Updates on-chain reputation. Applies 30-day ban if 2+ failed disputes.
     */
    function _updateReputation(address _wallet, bool _failed) internal {
        Reputation storage rep = reputation[_wallet];
        if (_failed) {
            rep.failedDisputes++;
            // 30-day Taker ban if 2+ failed disputes
            if (rep.failedDisputes >= 2) {
                rep.bannedUntil = block.timestamp + 30 days;
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
     * @notice Returns user reputation.
     */
    function getReputation(address _wallet)
        external
        view
        returns (uint256 successful, uint256 failed, uint256 bannedUntil)
    {
        Reputation storage rep = reputation[_wallet];
        return (rep.successfulTrades, rep.failedDisputes, rep.bannedUntil);
    }

    /**
     * @notice Check if wallet passes Anti-Sybil for Tier 1.
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
                     block.timestamp >= lastTradeAt[_wallet] + TIER1_TRADE_COOLDOWN;
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
