"use strict";
/* ## eventListener.js hardening and integrity cleanup

This PR updates `backend/scripts/services/eventListener.js` to preserve the existing event-processing safety fixes while making `EscrowCreated` linkage failures stricter and more explicit.

### Existing protections that remain

This file already contained multiple important hardening changes, and they remain in place:

- challenged → resolved reputation flow penalizes the unjust challenger instead of the maker
- listing matching no longer falls back to hardcoded financial defaults
- checkpoint advancement remains tied to successful processing instead of blindly moving forward on failure
- reconnect still cleans up old provider listeners / sockets before rebuilding
- release / burn flows still use MongoDB transactions for atomic updates
- bleeding decay idempotency still uses canonical event identity (`txHash:logIndex`)
- `reputation_history` remains capped instead of growing forever
- IPFS hash input still goes through CID validation before persistence
- `MakerPinged` still waits for DB state instead of guessing missing taker state
- large financial amounts continue to be mirrored as strings to avoid precision loss

### Previous behavior

`EscrowCreated` already preferred authoritative `listingRef` matching, but if the event arrived with a zero or missing `listingRef`, the worker treated it more like a delayed / recoverable linkage problem:

- log a warning
- send the event to DLQ
- stop processing

That was safer than heuristics, but it still framed the condition as an operational lag problem rather than a protocol/API integrity failure.

### New behavior

Zero `listingRef` is now treated as a critical invalid creation path.

New behavior in `_onEscrowCreated()`:

- detect missing or zero `listingRef`
- log the condition as `CRITICAL`
- explicitly mark it as invalid contract / API usage
- send it to DLQ with a critical linkage error message
- do not treat it as recoverable heuristic matching failure

### Effect

This makes the worker align with the stricter linkage doctrine:

- no heuristic backfill
- no silent recovery
- no pretending that on-chain creation is valid when canonical off-chain linkage was never established

In other words, this change upgrades zero-ref handling from:

> “missing data, retry later”

to:

> “invalid canonical creation path, investigate immediately”

### Scope

Only `backend/scripts/services/eventListener.js` was targeted here.

### V3 extension

This version extends the worker for the V3 architecture while preserving the same mirror-only doctrine:

- parent orders are mirrored explicitly from `OrderCreated / OrderFilled / OrderCanceled`
- child trades are enriched from canonical on-chain `getTrade()` / `getOrder()` reads
- same-tx `OrderFilled -> EscrowCreated -> EscrowLocked` chains are handled without heuristics
- mutable fee / cooldown / token config updates are mirrored as read-model config, not as backend authority
- direct-escrow legacy flow and V3 child-trade flow coexist in the same worker
*/
const { ethers } = require("ethers");
const mongoose = require("mongoose");
const { getRedisClient } = require("../config/redis");
const { Trade, Listing } = require("../models/Trade");
const User = require("../models/User");
const logger = require("../utils/logger");

// [TR] V3 ile birlikte Order modeli yeni bir koleksiyon olarak önerilir.
//      Ancak diğer dosyalar henüz güncellenmemişse worker'ın tamamen açılmaması
//      yerine fallback bir strict:false model ile devam etmek daha güvenlidir.
// [EN] V3 introduces a dedicated Order collection.
//      If the rest of the backend has not been updated yet, we prefer a permissive
//      fallback model over crashing the whole worker at bootstrap.
let Order;
try {
  // eslint-disable-next-line global-require
  Order = require("../models/Order");
} catch (err) {
  const fallbackOrderSchema = new mongoose.Schema(
    {},
    {
      strict: false,
      minimize: false,
      timestamps: true,
      collection: "orders",
    }
  );

  Order = mongoose.models.Order || mongoose.model("Order", fallbackOrderSchema);
  logger.warn("[Worker] ../models/Order bulunamadı — strict:false fallback Order modeli kullanılıyor.");
}

const CHECKPOINT_KEY = "worker:last_block";
const LAST_SAFE_BLOCK_KEY = "worker:last_safe_block";
const DLQ_KEY = "worker:dlq";
const RETRY_DELAY_MS = 5_000;
const MAX_RETRIES = 3;
const BLOCK_BATCH_SIZE = 1_000;
const CHECKPOINT_INTERVAL_BLOCKS = 50;

// [TR] V3 mutable config aynası için Redis anahtarları.
// [EN] Redis mirror keys for V3 mutable config state.
const FEE_CONFIG_KEY = "protocol:fee_config";
const COOLDOWN_CONFIG_KEY = "protocol:cooldown_config";
const TOKEN_CONFIG_PREFIX = "protocol:token_config:";
const TREASURY_CONFIG_KEY = "protocol:treasury";

// reputation_history sınırsız büyümesin diye üst sınır tutulur.
const MAX_REPUTATION_HISTORY = 100;

const FAILURE_SCORE_WEIGHTS = {
  burned: 50,
  unjust_challenge: 20,
  passive_maker: 20,
  failed_dispute: 20,
};

// Kabul edilen IPFS/CID biçimleri.
// Geçersiz hash durumunda trade state güncellenebilir ama hash saklanmaz.
const CID_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58}|[a-f0-9]{64})$/;

const ORDER_SIDE_LABELS = ["SELL_CRYPTO", "BUY_CRYPTO"];
const ORDER_STATE_LABELS = ["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELED"];

const EVENT_NAMES = [
  "WalletRegistered",
  "EscrowCreated", "EscrowLocked", "PaymentReported",
  "EscrowReleased", "DisputeOpened",
  "CancelProposed", "EscrowCanceled",
  "MakerPinged", "ReputationUpdated",
  "BleedingDecayed", "EscrowBurned",
  "TreasuryUpdated", "TokenSupportUpdated",
  "OrderCreated", "OrderFilled", "OrderCanceled",
  "FeeConfigUpdated", "CooldownConfigUpdated", "TokenConfigUpdated",
];

const ARAF_ABI = [
  "event WalletRegistered(address indexed wallet, uint256 timestamp)",
  "event EscrowCreated(uint256 indexed tradeId, address indexed maker, address token, uint256 amount, uint8 tier, bytes32 listingRef)",
  "event EscrowLocked(uint256 indexed tradeId, address indexed taker, uint256 takerBond)",
  "event PaymentReported(uint256 indexed tradeId, string ipfsHash, uint256 timestamp)",
  "event EscrowReleased(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 takerFee, uint256 makerFee)",
  "event DisputeOpened(uint256 indexed tradeId, address indexed challenger, uint256 timestamp)",
  "event CancelProposed(uint256 indexed tradeId, address indexed proposer)",
  "event EscrowCanceled(uint256 indexed tradeId, uint256 makerRefund, uint256 takerRefund)",
  "event MakerPinged(uint256 indexed tradeId, address indexed pinger, uint256 timestamp)",
  "event ReputationUpdated(address indexed wallet, uint256 successful, uint256 failed, uint256 bannedUntil, uint8 effectiveTier)",
  "event BleedingDecayed(uint256 indexed tradeId, uint256 decayedAmount, uint256 timestamp)",
  "event EscrowBurned(uint256 indexed tradeId, uint256 burnedAmount)",
  "event TreasuryUpdated(address indexed newTreasury)",
  "event TokenSupportUpdated(address indexed token, bool supported)",
  "event OrderCreated(uint256 indexed orderId, address indexed owner, uint8 side, address token, uint256 totalAmount, uint256 minFillAmount, uint8 tier, bytes32 orderRef)",
  "event OrderFilled(uint256 indexed orderId, uint256 indexed tradeId, address indexed filler, uint256 fillAmount, uint256 remainingAmount)",
  "event OrderCanceled(uint256 indexed orderId, uint8 side, uint256 remainingAmount, uint256 makerBondRefund, uint256 takerBondRefund)",
  "event FeeConfigUpdated(uint256 takerFeeBps, uint256 makerFeeBps)",
  "event CooldownConfigUpdated(uint256 tier0TradeCooldown, uint256 tier1TradeCooldown)",
  "event TokenConfigUpdated(address indexed token, bool supported, bool allowSellOrders, bool allowBuyOrders)",
  // [TR] V3 canonical read-model yardımcıları
  // [EN] V3 canonical read-model helpers
  "function getTrade(uint256 tradeId) view returns (tuple(uint256 id, uint256 parentOrderId, address maker, address taker, address tokenAddress, uint256 cryptoAmount, uint256 makerBond, uint256 takerBond, uint16 takerFeeBpsSnapshot, uint16 makerFeeBpsSnapshot, uint8 tier, uint8 state, uint256 lockedAt, uint256 paidAt, uint256 challengedAt, string ipfsReceiptHash, bool cancelProposedByMaker, bool cancelProposedByTaker, uint256 pingedAt, bool pingedByTaker, uint256 challengePingedAt, bool challengePingedByMaker))",
  "function getOrder(uint256 orderId) view returns (tuple(uint256 id, address owner, uint8 side, address tokenAddress, uint256 totalAmount, uint256 remainingAmount, uint256 minFillAmount, uint256 remainingMakerBondReserve, uint256 remainingTakerBondReserve, uint16 takerFeeBpsSnapshot, uint16 makerFeeBpsSnapshot, uint8 tier, uint8 state, bytes32 orderRef))",
  "function getFeeConfig() view returns (uint256 currentTakerFeeBps, uint256 currentMakerFeeBps)",
  "function getCooldownConfig() view returns (uint256 currentTier0TradeCooldown, uint256 currentTier1TradeCooldown)",
  "function tokenConfigs(address token) view returns (bool supported, bool allowSellOrders, bool allowBuyOrders)",
];

const EVENT_ARG_KEYS = {
  WalletRegistered: ["wallet", "timestamp"],
  EscrowCreated: ["tradeId", "maker", "token", "amount", "tier", "listingRef"],
  EscrowLocked: ["tradeId", "taker", "takerBond"],
  PaymentReported: ["tradeId", "ipfsHash", "timestamp"],
  EscrowReleased: ["tradeId", "maker", "taker", "takerFee", "makerFee"],
  DisputeOpened: ["tradeId", "challenger", "timestamp"],
  CancelProposed: ["tradeId", "proposer"],
  EscrowCanceled: ["tradeId", "makerRefund", "takerRefund"],
  MakerPinged: ["tradeId", "pinger", "timestamp"],
  ReputationUpdated: ["wallet", "successful", "failed", "bannedUntil", "effectiveTier"],
  BleedingDecayed: ["tradeId", "decayedAmount", "timestamp"],
  EscrowBurned: ["tradeId", "burnedAmount"],
  TreasuryUpdated: ["newTreasury"],
  TokenSupportUpdated: ["token", "supported"],
  OrderCreated: ["orderId", "owner", "side", "token", "totalAmount", "minFillAmount", "tier", "orderRef"],
  OrderFilled: ["orderId", "tradeId", "filler", "fillAmount", "remainingAmount"],
  OrderCanceled: ["orderId", "side", "remainingAmount", "makerBondRefund", "takerBondRefund"],
  FeeConfigUpdated: ["takerFeeBps", "makerFeeBps"],
  CooldownConfigUpdated: ["tier0TradeCooldown", "tier1TradeCooldown"],
  TokenConfigUpdated: ["token", "supported", "allowSellOrders", "allowBuyOrders"],
};

class EventWorker {
  constructor() {
    this.provider = null;
    this.contract = null;
    this.isRunning = false;
    this._lastCheckpointBlock = 0;
    this._state = "booting";
    this._reconnectPromise = null;
    this._listenersAttached = false;
    this._retrySuccessCount = 0;
    this._retryFailureCount = 0;
    this._blockAcks = new Map();
    this._lastSeenBlock = 0;
    this._lastSafeCheckpointBlock = 0;
    this._replayInProgress = false;

    // [TR] Live path artık contract.on(...) yerine block-range polling kullanır.
    // [EN] Live path now uses block-range polling instead of contract.on(...).
    this._livePollInProgress = false;
    this._lastLivePolledBlock = 0;
  }

  async start() {
    logger.info("[Worker] Event listener başlatılıyor...");
    this.isRunning = true;
    await this._connect();
    await this._warmMutableConfigMirror();
    await this._replayMissedEvents();

    // [TR] Replay tamamlandıktan sonra live polling başlangıç referansı güncel block olur.
    // [EN] After replay finishes, current block becomes the live polling baseline.
    if (this.provider) {
      this._lastLivePolledBlock = await this.provider.getBlockNumber();
    }

    this._attachLiveListeners();
    logger.info("[Worker] Event listener aktif.");
  }

  async stop() {
    this.isRunning = false;
    if (this.provider) {
      this.provider.removeAllListeners();
    }
    this._listenersAttached = false;
    this._livePollInProgress = false;
    this._setState("stopped", "worker stop çağrıldı");
    logger.info("[Worker] Event listener durduruldu.");
  }

  _setState(nextState, reason) {
    if (this._state === nextState) return;
    logger.info(`[Worker][StateMachine] ${this._state} -> ${nextState}${reason ? ` | ${reason}` : ""}`);
    this._state = nextState;
  }

  async _connect() {
    const isProduction = process.env.NODE_ENV === "production";
    const rpcUrl = process.env.BASE_RPC_URL || (!isProduction ? "https://mainnet.base.org" : null);
    const contractAddress = process.env.ARAF_ESCROW_ADDRESS;

    if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
      if (isProduction) {
        logger.error("[Worker] KRİTİK: ARAF_ESCROW_ADDRESS tanımlı değil. Durduruluyor.");
        process.exit(1);
      }
      logger.warn("[Worker] Kontrat adresi yok — Worker kuru çalışma modunda (development).");
      return;
    }

    if (!rpcUrl) {
      throw new Error("[Worker] KRİTİK: BASE_RPC_URL production'da zorunludur.");
    }

    const wsRpcUrl = process.env.BASE_WS_RPC_URL;

    if (wsRpcUrl && wsRpcUrl.startsWith("wss://")) {
      try {
        this.provider = new ethers.WebSocketProvider(wsRpcUrl);
        logger.info("[Worker] WebSocket RPC bağlandı.");
      } catch (wsErr) {
        logger.warn(`[Worker] WebSocket başarısız, HTTP fallback: ${wsErr.message}`);
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
      }
    } else {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      if (isProduction) {
        logger.warn("[Worker] HTTP RPC kullanılıyor. Gerçek zamanlı event için BASE_WS_RPC_URL önerilir.");
      }
    }

    this.contract = new ethers.Contract(contractAddress, ARAF_ABI, this.provider);
    logger.info(`[Worker] Kontrat izleniyor: ${contractAddress}`);
    this._setState("connected", "provider + kontrat hazır");
  }

  async _warmMutableConfigMirror() {
    if (!this.contract) return;

    try {
      const [feeConfig, cooldownConfig] = await Promise.all([
        this.contract.getFeeConfig(),
        this.contract.getCooldownConfig(),
      ]);

      await this._writeRedisJson(FEE_CONFIG_KEY, {
        takerFeeBps: feeConfig.currentTakerFeeBps?.toString?.() ?? feeConfig[0]?.toString?.() ?? String(feeConfig[0]),
        makerFeeBps: feeConfig.currentMakerFeeBps?.toString?.() ?? feeConfig[1]?.toString?.() ?? String(feeConfig[1]),
        updated_at: new Date().toISOString(),
        source: "startup_read",
      });

      await this._writeRedisJson(COOLDOWN_CONFIG_KEY, {
        tier0TradeCooldown: cooldownConfig.currentTier0TradeCooldown?.toString?.() ?? cooldownConfig[0]?.toString?.() ?? String(cooldownConfig[0]),
        tier1TradeCooldown: cooldownConfig.currentTier1TradeCooldown?.toString?.() ?? cooldownConfig[1]?.toString?.() ?? String(cooldownConfig[1]),
        updated_at: new Date().toISOString(),
        source: "startup_read",
      });
    } catch (err) {
      logger.warn(`[Worker] Mutable config warm-up başarısız: ${err.message}`);
    }
  }

  async _writeRedisJson(key, value) {
    const redis = getRedisClient();
    await redis.set(key, JSON.stringify(value));
  }

  _safeNumber(value, fallback = 0) {
    try {
      if (typeof value === "number") return value;
      if (typeof value === "bigint") return Number(value);
      if (value === undefined || value === null) return fallback;
      return Number(value);
    } catch (_) {
      return fallback;
    }
  }

  _safeString(value, fallback = null) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "string") return value;
    if (typeof value?.toString === "function") return value.toString();
    return String(value);
  }

  _normalizeAddress(value) {
    if (!value) return null;
    try {
      return String(value).toLowerCase();
    } catch (_) {
      return null;
    }
  }

  _normalizeBytes32(value) {
    if (!value) return null;
    return this._safeString(value, null)?.toLowerCase?.() || null;
  }

  _normalizeOrderSide(sideValue) {
    const sideNum = this._safeNumber(sideValue, 0);
    return {
      code: sideNum,
      label: ORDER_SIDE_LABELS[sideNum] || `UNKNOWN_${sideNum}`,
    };
  }

  _normalizeOrderState(stateValue) {
    const stateNum = this._safeNumber(stateValue, 0);
    return {
      code: stateNum,
      label: ORDER_STATE_LABELS[stateNum] || `UNKNOWN_${stateNum}`,
    };
  }

  async _readTradeFromChain(tradeId) {
    if (!this.contract) throw new Error("Contract bağlantısı yok.");
    const trade = await this.contract.getTrade(tradeId);
    return {
      id: this._safeNumber(trade.id),
      parentOrderId: this._safeNumber(trade.parentOrderId),
      maker: this._normalizeAddress(trade.maker),
      taker: this._normalizeAddress(trade.taker),
      tokenAddress: this._normalizeAddress(trade.tokenAddress),
      cryptoAmount: this._safeString(trade.cryptoAmount, "0"),
      makerBond: this._safeString(trade.makerBond, "0"),
      takerBond: this._safeString(trade.takerBond, "0"),
      takerFeeBpsSnapshot: this._safeNumber(trade.takerFeeBpsSnapshot),
      makerFeeBpsSnapshot: this._safeNumber(trade.makerFeeBpsSnapshot),
      tier: this._safeNumber(trade.tier),
      state: this._safeNumber(trade.state),
      lockedAt: this._safeString(trade.lockedAt, "0"),
      paidAt: this._safeString(trade.paidAt, "0"),
      challengedAt: this._safeString(trade.challengedAt, "0"),
      ipfsReceiptHash: this._safeString(trade.ipfsReceiptHash, ""),
      cancelProposedByMaker: Boolean(trade.cancelProposedByMaker),
      cancelProposedByTaker: Boolean(trade.cancelProposedByTaker),
      pingedAt: this._safeString(trade.pingedAt, "0"),
      pingedByTaker: Boolean(trade.pingedByTaker),
      challengePingedAt: this._safeString(trade.challengePingedAt, "0"),
      challengePingedByMaker: Boolean(trade.challengePingedByMaker),
    };
  }

  async _readOrderFromChain(orderId) {
    if (!this.contract) throw new Error("Contract bağlantısı yok.");
    const order = await this.contract.getOrder(orderId);
    return {
      id: this._safeNumber(order.id),
      owner: this._normalizeAddress(order.owner),
      side: this._safeNumber(order.side),
      tokenAddress: this._normalizeAddress(order.tokenAddress),
      totalAmount: this._safeString(order.totalAmount, "0"),
      remainingAmount: this._safeString(order.remainingAmount, "0"),
      minFillAmount: this._safeString(order.minFillAmount, "0"),
      remainingMakerBondReserve: this._safeString(order.remainingMakerBondReserve, "0"),
      remainingTakerBondReserve: this._safeString(order.remainingTakerBondReserve, "0"),
      takerFeeBpsSnapshot: this._safeNumber(order.takerFeeBpsSnapshot),
      makerFeeBpsSnapshot: this._safeNumber(order.makerFeeBpsSnapshot),
      tier: this._safeNumber(order.tier),
      state: this._safeNumber(order.state),
      orderRef: this._normalizeBytes32(order.orderRef),
    };
  }

  async _syncOrderMirrorFromChain(orderId, extraSet = {}) {
    const orderIdNum = this._safeNumber(orderId);
    if (!orderIdNum) return null;

    const onchainOrder = await this._readOrderFromChain(orderIdNum);
    const side = this._normalizeOrderSide(onchainOrder.side);
    const state = this._normalizeOrderState(onchainOrder.state);
    const existingOrder = await Order.findOne({ onchain_order_id: orderIdNum }).lean();

    await Order.findOneAndUpdate(
      { onchain_order_id: orderIdNum },
      {
        $set: {
          owner_address: onchainOrder.owner,
          side: side.label,
          status: state.label,
          tier: onchainOrder.tier,
          token_address: onchainOrder.tokenAddress,

          // [TR] Market alanları on-chain authoritative değildir.
          //      Bu yüzden mevcut zenginleştirme varsa korunur; event sync bunları sıfırlamaz.
          // [EN] Market fields are not on-chain authoritative.
          //      Existing enrichment is preserved; event sync does not null them out.
          market: {
            crypto_asset: extraSet.market?.crypto_asset ?? existingOrder?.market?.crypto_asset ?? null,
            fiat_currency: extraSet.market?.fiat_currency ?? existingOrder?.market?.fiat_currency ?? null,
            exchange_rate: extraSet.market?.exchange_rate ?? existingOrder?.market?.exchange_rate ?? null,
          },

          amounts: {
            total_amount: onchainOrder.totalAmount,
            total_amount_num: this._safeNumber(onchainOrder.totalAmount, 0),
            remaining_amount: onchainOrder.remainingAmount,
            remaining_amount_num: this._safeNumber(onchainOrder.remainingAmount, 0),
            min_fill_amount: onchainOrder.minFillAmount,
            min_fill_amount_num: this._safeNumber(onchainOrder.minFillAmount, 0),
            executed_amount: this._safeString(
              BigInt(onchainOrder.totalAmount || '0') - BigInt(onchainOrder.remainingAmount || '0'),
              '0'
            ),
            executed_amount_num: this._safeNumber(
              BigInt(onchainOrder.totalAmount || '0') - BigInt(onchainOrder.remainingAmount || '0'),
              0
            ),
          },

          reserves: {
            remaining_maker_bond_reserve: onchainOrder.remainingMakerBondReserve,
            remaining_maker_bond_reserve_num: this._safeNumber(onchainOrder.remainingMakerBondReserve, 0),
            remaining_taker_bond_reserve: onchainOrder.remainingTakerBondReserve,
            remaining_taker_bond_reserve_num: this._safeNumber(onchainOrder.remainingTakerBondReserve, 0),
          },

          fee_snapshot: {
            taker_fee_bps_snapshot: onchainOrder.takerFeeBpsSnapshot,
            maker_fee_bps_snapshot: onchainOrder.makerFeeBpsSnapshot,
          },

          refs: {
            order_ref: onchainOrder.orderRef,
          },

          stats: {
            child_trade_count: existingOrder?.stats?.child_trade_count || 0,
            last_fill_tx_hash: extraSet?.stats?.last_fill_tx_hash ?? existingOrder?.stats?.last_fill_tx_hash ?? null,
          },

          timers: {
            created_onchain_at: existingOrder?.timers?.created_onchain_at || extraSet?.timers?.created_onchain_at || new Date(),
            last_fill_at: extraSet?.timers?.last_fill_at ?? existingOrder?.timers?.last_fill_at ?? null,
            filled_at: state.label === 'FILLED'
              ? (extraSet?.timers?.filled_at ?? existingOrder?.timers?.filled_at ?? new Date())
              : (existingOrder?.timers?.filled_at ?? null),
            canceled_at: state.label === 'CANCELED'
              ? (extraSet?.timers?.canceled_at ?? existingOrder?.timers?.canceled_at ?? new Date())
              : (existingOrder?.timers?.canceled_at ?? null),
          },

          ...extraSet,
        },
        $setOnInsert: {
          onchain_order_id: orderIdNum,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    return onchainOrder;
  }
  async _upsertTradeMirrorRaw(filter, update, options = {}) {
    return Trade.collection.updateOne(filter, update, options);
  }

  async _upsertChildTradeFromChain(tradeId, extraSet = {}) {
    const tradeIdNum = this._safeNumber(tradeId);
    if (!tradeIdNum) return null;

    const onchainTrade = await this._readTradeFromChain(tradeIdNum);
    let onchainOrder = null;
    let orderDoc = null;

    if (onchainTrade.parentOrderId > 0) {
      onchainOrder = await this._syncOrderMirrorFromChain(onchainTrade.parentOrderId);
      orderDoc = await Order.findOne({ onchain_order_id: onchainTrade.parentOrderId }).lean();
    }

    const orderSide = onchainOrder ? this._normalizeOrderSide(onchainOrder.side) : null;
    const existingTrade = await Trade.findOne({ onchain_escrow_id: tradeIdNum }).lean();

    const marketCryptoAsset = orderDoc?.market?.crypto_asset ?? existingTrade?.financials?.crypto_asset ?? null;
    const marketFiatCurrency = orderDoc?.market?.fiat_currency ?? existingTrade?.financials?.fiat_currency ?? null;
    const marketExchangeRate = orderDoc?.market?.exchange_rate ?? existingTrade?.financials?.exchange_rate ?? null;

    // [TR] Order child trade mirror'u raw update ile yazılır.
    //      Böylece market enrichment henüz yoksa worker order/child linkage'i yine de kaybetmez.
    //      Fiat/rate alanları kontratın canonical verisi olmadığından, mevcut zenginleştirme varsa korunur.
    // [EN] Order child trade mirrors are written via raw updates.
    //      This preserves order/child linkage even when market enrichment is not available yet.
    //      Fiat/rate are not canonical on-chain values, so any existing enrichment is preserved.
    await this._upsertTradeMirrorRaw(
      { onchain_escrow_id: tradeIdNum },
      {
        $set: {
          parent_order_id: onchainTrade.parentOrderId || null,
          trade_origin: 'ORDER_CHILD',
          parent_order_side: orderSide?.label || null,
          token_address: onchainTrade.tokenAddress,
          maker_address: onchainTrade.maker,
          taker_address: onchainTrade.taker || null,
          tier: onchainTrade.tier,
          status: onchainTrade.state === 1 ? 'LOCKED' : 'OPEN',
          listing_id: null,
          'canonical_refs.child_listing_ref': extraSet.child_listing_ref || existingTrade?.canonical_refs?.child_listing_ref || null,
          'financials.crypto_amount': onchainTrade.cryptoAmount,
          'financials.crypto_amount_num': this._safeNumber(onchainTrade.cryptoAmount, 0),
          'financials.taker_fee_bps_snapshot': onchainTrade.takerFeeBpsSnapshot,
          'financials.maker_fee_bps_snapshot': onchainTrade.makerFeeBpsSnapshot,
          'financials.total_decayed': existingTrade?.financials?.total_decayed || '0',
          'financials.total_decayed_num': existingTrade?.financials?.total_decayed_num || 0,
          'financials.decay_tx_hashes': existingTrade?.financials?.decay_tx_hashes || [],
          'financials.decayed_amounts': existingTrade?.financials?.decayed_amounts || [],
          'fill_metadata.is_exact_size_child': true,
          'fill_metadata.fill_tx_hash': extraSet.fill_tx_hash || existingTrade?.fill_metadata?.fill_tx_hash || null,
          updated_at: new Date(),
          ...extraSet,
        },
        $setOnInsert: {
          onchain_escrow_id: tradeIdNum,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    const optionalSet = {};
    if (marketCryptoAsset) optionalSet['financials.crypto_asset'] = marketCryptoAsset;
    if (marketFiatCurrency) optionalSet['financials.fiat_currency'] = marketFiatCurrency;
    if (marketExchangeRate !== null && marketExchangeRate !== undefined) optionalSet['financials.exchange_rate'] = marketExchangeRate;
    if (Object.keys(optionalSet).length) {
      await this._upsertTradeMirrorRaw(
        { onchain_escrow_id: tradeIdNum },
        { $set: optionalSet }
      );
    }

    return { onchainTrade, orderSnapshot: orderDoc || null };
  }
  async _replayMissedEvents() {
    if (!this.contract) return;

    const redis = getRedisClient();
    const savedBlock = await redis.get(LAST_SAFE_BLOCK_KEY) ?? await redis.get(CHECKPOINT_KEY);
    const toBlock = await this.provider.getBlockNumber();
    const fromBlock = this._resolveReplayStartBlock(savedBlock, toBlock);

    if (fromBlock > toBlock) {
      logger.info("[Worker] Kaçırılan event yok. Checkpoint güncel.");
      return;
    }

    this._setState("replaying", `replay aralığı: ${fromBlock}-${toBlock}`);
    logger.info(`[Worker] ${fromBlock} - ${toBlock} blok aralığı tekrar işleniyor...`);

    for (let from = fromBlock; from <= toBlock; from += BLOCK_BATCH_SIZE) {
      const to = Math.min(from + BLOCK_BATCH_SIZE - 1, toBlock);

      const allEvents = [];
      for (const eventName of EVENT_NAMES) {
        try {
          const filtered = await this.contract.queryFilter(eventName, from, to);
          if (Array.isArray(filtered)) allEvents.push(...filtered);
        } catch (err) {
          logger.warn(`[Worker] Replay: ${eventName} sorgusu başarısız (${from}-${to}): ${err.message}`);
        }
      }

      allEvents.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

      let batchSuccess = true;
      for (const event of allEvents) {
        try {
          await this._processEvent(event);
        } catch (err) {
          logger.error(`[Worker] Replay event işleme hatası: ${event.eventName} - ${err.message}`);
          await this._addToDLQ(event, err.message);
          batchSuccess = false;
        }
      }

      // Replay sırasında safe checkpoint yalnız tamamen başarılı batch sonunda ilerler.
      if (batchSuccess) {
        await this._updateSafeCheckpointIfHigher(to);
      } else {
        logger.warn(`[Worker] Batch ${from}-${to} kısmen başarısız — checkpoint ilerletilmedi.`);
      }

      logger.debug(`[Worker] Replay: ${from}-${to} (${allEvents.length} event)`);
    }

    logger.info("[Worker] Replay tamamlandı.");
  }

  _attachLiveListeners() {
    if (!this.contract || this._listenersAttached) return;

    // [TR] Canlı dinleme artık contract.on(...) ile tek tek event abonesi açmaz.
    //      Bunun yerine yeni block sinyalini tetik olarak kullanır ve son işlenen
    //      bloktan güncel bloğa kadar olan aralığı queryFilter(...) ile tarar.
    //
    // [EN] Live mode no longer opens per-event contract.on(...) subscriptions.
    //      Instead, each new block is treated as a trigger and the worker scans
    //      the full block range from the last processed block to the current block
    //      via queryFilter(...).
    //
    // Bu yaklaşım:
    // - replay ve live path'i aynı veri toplama mantığına yaklaştırır
    // - missed event riskini azaltır
    // - provider subscriber/filter-id kaynaklı kırılganlığı düşürür
    this.provider.on("block", async (blockNumber) => {
      if (this._livePollInProgress) {
        logger.debug(`[Worker] Live poll zaten çalışıyor — block=${blockNumber} için yeni tetik atlandı.`);
        return;
      }

      this._livePollInProgress = true;

      try {
        await this._updateSeenBlockIfHigher(blockNumber);

        const fromBlock = this._lastLivePolledBlock + 1;
        const toBlock = blockNumber;

        if (fromBlock <= toBlock) {
          await this._pollLiveRange(fromBlock, toBlock);

          // [TR] Range başarıyla sorgulanıp işlendiği anda live cursor ilerletilir.
          //      Kısmi event hataları _markBlockUnsafe ile checkpoint'i durdurur;
          //      ama aynı range'i her block'ta tekrar sorgulamak duplicate baskısı yaratır.
          this._lastLivePolledBlock = toBlock;
        }

        logger.debug(
          `[Worker][Metrics] queue_depth=${this._blockAcks.size} last_seen_block=${this._lastSeenBlock} last_safe_block=${this._lastSafeCheckpointBlock}`
        );

        const finalizedUpTo = blockNumber - 1;
        await this._advanceSafeCheckpointFromAcks(finalizedUpTo);

        if (!this._replayInProgress && (blockNumber - this._lastSafeCheckpointBlock >= CHECKPOINT_INTERVAL_BLOCKS)) {
          this._replayInProgress = true;
          try {
            await this._replayMissedEvents();
          } finally {
            this._replayInProgress = false;
          }
        }
      } catch (err) {
        logger.error(`[Worker] Live block-range poll hatası: ${err.message}`);
      } finally {
        this._livePollInProgress = false;
      }
    });

    this.provider.on("error", async (err) => {
      logger.error(`[Worker] Provider hatası: ${err.message}. Yeniden bağlanılıyor...`);
      await this._reconnect();
    });

    this._listenersAttached = true;
    this._setState("live", "canlı block-range listener bağlandı");
  }

  // [TR] Belirli block aralığındaki event'leri canlı modda toplar ve işler.
  //      Replay ile aynı queryFilter mantığını kullanır, ancak canlı akış için
  //      block ack/state bookkeeping de yapar.
  //
  // [EN] Collects and processes events for a given block range in live mode.
  //      Uses the same queryFilter model as replay, but additionally updates
  //      block ack/state bookkeeping required by safe checkpoint advancement.
  async _pollLiveRange(fromBlock, toBlock) {
    if (!this.contract || fromBlock > toBlock) return;

    for (let from = fromBlock; from <= toBlock; from += BLOCK_BATCH_SIZE) {
      const to = Math.min(from + BLOCK_BATCH_SIZE - 1, toBlock);

      try {
        const allEvents = [];
        for (const eventName of EVENT_NAMES) {
          const filtered = await this.contract.queryFilter(eventName, from, to);
          if (Array.isArray(filtered)) allEvents.push(...filtered);
        }

        allEvents.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

        // [TR] Boş bloklar checkpoint akışını kilitlemesin diye aralıktaki her blok için
        //      ack state önceden oluşturulur. Eğer bir blokta event yoksa seen=0/acked=0
        //      olarak güvenli şekilde ilerlenebilir.
        this._seedAckStateForRange(from, to);

        for (const event of allEvents) {
          const eventId = this._getEventId(event);
          this._trackLiveEventSeen(event);

          const success = await this._processEventWithRetry(event);
          if (success) {
            this._trackLiveEventAck(event);
            logger.debug(`[Worker][Metrics] retry_success_rate=${this._getRetrySuccessRate()}% event_id=${eventId}`);
          } else {
            this._markBlockUnsafe(event.blockNumber);
          }
        }

        logger.debug(`[Worker] Live poll: ${from}-${to} (${allEvents.length} event)`);
      } catch (err) {
        // [TR] Range sorgusu veya toplama katmanı patlarsa bu aralık checkpoint açısından
        //      güvenli kabul edilmez. Aynı range daha sonra replay/live akışında yeniden ele alınır.
        this._seedAckStateForRange(from, to);
        this._markRangeUnsafe(from, to);
        throw err;
      }
    }
  }

  // [TR] Bir bloğun ack bookkeeping state'ini garanti eder.
  // [EN] Ensures a block has an ack bookkeeping state.
  _ensureBlockAckState(blockNumber) {
    const existing = this._blockAcks.get(blockNumber);
    if (existing) return existing;

    const state = { seen: new Set(), acked: new Set(), unsafe: false };
    this._blockAcks.set(blockNumber, state);
    return state;
  }

  // [TR] Boş blokların safe checkpoint ilerlemesini durdurmaması için aralıktaki
  //      tüm bloklara başlangıç ack state'i eklenir.
  // [EN] Seeds ack state for every block in a range so empty blocks do not block
  //      safe checkpoint advancement.
  _seedAckStateForRange(fromBlock, toBlock) {
    for (let block = fromBlock; block <= toBlock; block += 1) {
      this._ensureBlockAckState(block);
    }
  }

  // [TR] Belirli block aralığını unsafe olarak işaretler.
  // [EN] Marks a block range as unsafe.
  _markRangeUnsafe(fromBlock, toBlock) {
    for (let block = fromBlock; block <= toBlock; block += 1) {
      this._markBlockUnsafe(block);
    }
  }

  async _updateSafeCheckpointIfHigher(blockNumber) {
    const redis = getRedisClient();
    const current = parseInt(await redis.get(LAST_SAFE_BLOCK_KEY) || await redis.get(CHECKPOINT_KEY) || "0", 10);
    if (blockNumber > current) {
      await redis.set(LAST_SAFE_BLOCK_KEY, blockNumber.toString());
      await redis.set(CHECKPOINT_KEY, blockNumber.toString());
      this._lastSafeCheckpointBlock = blockNumber;
    }
  }

  async _updateSeenBlockIfHigher(blockNumber) {
    if (blockNumber > this._lastSeenBlock) this._lastSeenBlock = blockNumber;
  }

  _resolveReplayStartBlock(savedBlock, currentBlock) {
    if (savedBlock !== null && savedBlock !== undefined) {
      const checkpoint = Number(savedBlock);
      if (!Number.isInteger(checkpoint) || checkpoint < 0) {
        throw new Error(`[Worker] Geçersiz checkpoint değeri: ${savedBlock}`);
      }
      if (checkpoint > currentBlock) {
        throw new Error(`[Worker] Checkpoint current block'u aşıyor: checkpoint=${checkpoint} current=${currentBlock}`);
      }
      return checkpoint + 1;
    }

    const configuredStartRaw = process.env.ARAF_DEPLOYMENT_BLOCK ?? process.env.WORKER_START_BLOCK;

    if (configuredStartRaw === undefined || configuredStartRaw === null || configuredStartRaw === "") {
      if (process.env.NODE_ENV === "production") {
        throw new Error("[Worker] Production için checkpoint veya ARAF_DEPLOYMENT_BLOCK/WORKER_START_BLOCK zorunludur.");
      }
      logger.warn("[Worker] Checkpoint bulunamadı ve başlangıç bloğu tanımlı değil. Varsayılan başlangıç: 0.");
      return 0;
    }

    const configuredStart = Number(configuredStartRaw);
    if (!Number.isInteger(configuredStart) || configuredStart < 0) {
      throw new Error(`[Worker] Geçersiz başlangıç bloğu: ${configuredStartRaw}.`);
    }
    if (configuredStart > currentBlock) {
      throw new Error(`[Worker] Başlangıç bloğu current block'tan büyük olamaz: start=${configuredStart} current=${currentBlock}`);
    }

    logger.info(`[Worker] Checkpoint bulunamadı. Başlangıç bloğu env'den alındı: ${configuredStart}`);
    return configuredStart;
  }

  _getEventId(event) {
    const txHash = event?.transactionHash || "unknown_tx";
    const logIndex = Number.isInteger(event?.logIndex) ? event.logIndex : -1;
    return `${txHash}:${logIndex}`;
  }

  _trackLiveEventSeen(event) {
    if (!event || !Number.isInteger(event.blockNumber)) return;
    const eventId = this._getEventId(event);
    const state = this._ensureBlockAckState(event.blockNumber);
    state.seen.add(eventId);
    this._blockAcks.set(event.blockNumber, state);
  }

  _trackLiveEventAck(event) {
    if (!event || !Number.isInteger(event.blockNumber)) return;
    const eventId = this._getEventId(event);
    const state = this._ensureBlockAckState(event.blockNumber);
    state.acked.add(eventId);
    this._blockAcks.set(event.blockNumber, state);
  }

  _markBlockUnsafe(blockNumber) {
    if (!Number.isInteger(blockNumber)) return;
    const state = this._ensureBlockAckState(blockNumber);
    state.unsafe = true;
    this._blockAcks.set(blockNumber, state);
  }

  async _advanceSafeCheckpointFromAcks(finalizedUpTo) {
    if (!Number.isInteger(finalizedUpTo) || finalizedUpTo <= this._lastSafeCheckpointBlock) return;

    let nextSafe = this._lastSafeCheckpointBlock;
    for (let block = this._lastSafeCheckpointBlock + 1; block <= finalizedUpTo; block += 1) {
      const state = this._blockAcks.get(block);
      if (!state) break;
      if (state.unsafe || state.acked.size < state.seen.size) break;
      nextSafe = block;
    }

    if (nextSafe > this._lastSafeCheckpointBlock) {
      await this._updateSafeCheckpointIfHigher(nextSafe);
      for (const block of [...this._blockAcks.keys()]) {
        if (block <= nextSafe) this._blockAcks.delete(block);
      }
    }
  }

  _getRetrySuccessRate() {
    const total = this._retrySuccessCount + this._retryFailureCount;
    if (total === 0) return 100;
    return Math.round((this._retrySuccessCount / total) * 100);
  }

  async _reconnect() {
    if (this._reconnectPromise) {
      logger.warn("[Worker] Reconnect zaten devam ediyor, mevcut işlem bekleniyor.");
      return this._reconnectPromise;
    }

    this._reconnectPromise = (async () => {
      this._setState("reconnecting", "provider error sonrası yeniden bağlanma");

      // Reconnect öncesi eski provider mutlaka temizlenir.
      // Bu, zombi WebSocket birikmesini engeller.
      if (this.provider) {
        try {
          this.provider.removeAllListeners();
          if (this.provider.destroy) {
            await this.provider.destroy();
          }
        } catch (err) {
          logger.warn(`[Worker] Provider temizleme hatası: ${err.message}`);
        }
        this.provider = null;
        this.contract = null;
        this._listenersAttached = false;
        this._livePollInProgress = false;
      }

      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      await this._connect();
      await this._warmMutableConfigMirror();
      await this._replayMissedEvents();

      if (this.provider) {
        this._lastLivePolledBlock = await this.provider.getBlockNumber();
      }

      if (this.contract) {
        this._attachLiveListeners();
      }
    })();

    try {
      await this._reconnectPromise;
    } finally {
      this._reconnectPromise = null;
    }
  }

  async _processEventWithRetry(event, attempt = 1) {
    try {
      await this._processEvent(event);
      this._retrySuccessCount += 1;
      return true;
    } catch (err) {
      logger.error(`[Worker] ${event.eventName} başarısız (deneme ${attempt}): ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        return this._processEventWithRetry(event, attempt + 1);
      }
      this._retryFailureCount += 1;
      await this._addToDLQ(event, err.message);
      return false;
    }
  }

  async _processEventWithRetryNoDLQ(event, attempt = 1) {
    try {
      await this._processEvent(event);
      this._retrySuccessCount += 1;
      return { success: true };
    } catch (err) {
      logger.error(`[Worker] Re-drive ${event.eventName} başarısız (deneme ${attempt}): ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        return this._processEventWithRetryNoDLQ(event, attempt + 1);
      }
      this._retryFailureCount += 1;
      return { success: false, error: err.message };
    }
  }

  async _addToDLQ(event, errorMsg) {
    const redis = getRedisClient();
    const nowIso = new Date().toISOString();
    const namedArgs = {};

    const argKeys = EVENT_ARG_KEYS[event.eventName] || [];
    if (Array.isArray(event.args) && argKeys.length) {
      argKeys.forEach((key, i) => {
        if (event.args[i] !== undefined) {
          namedArgs[key] = event.args[i]?.toString?.() ?? String(event.args[i]);
        }
      });
    } else if (event.args && typeof event.args === "object") {
      Object.entries(event.args).forEach(([k, v]) => {
        if (!Number.isNaN(Number(k))) return;
        namedArgs[k] = v?.toString?.() ?? String(v);
      });
    }

    const entry = JSON.stringify({
      eventName: event.eventName,
      txHash: event.transactionHash,
      logIndex: event.logIndex ?? null,
      idempotencyKey: this._getEventId(event),
      blockNumber: event.blockNumber,
      args: Array.isArray(event.args)
        ? event.args.map((a) => a?.toString?.() ?? String(a))
        : Object.values(event.args || {}).map((a) => a?.toString?.() ?? String(a)),
      namedArgs,
      attempt: 0,
      next_retry_at: nowIso,
      first_seen_at: nowIso,
      last_error: errorMsg,
    });

    await redis.rPush(DLQ_KEY, entry);
    logger.error(
      `[Worker] Event DLQ'ya eklendi: ${event.eventName} key=${this._getEventId(event)} tx=${event.transactionHash}`
    );
  }

  async reDriveEvent(entry) {
    const event = {
      eventName: entry.eventName,
      transactionHash: entry.txHash,
      logIndex: entry.logIndex ?? -1,
      blockNumber: entry.blockNumber,
      args: entry.namedArgs || entry.args || [],
    };

    const result = await this._processEventWithRetryNoDLQ(event);
    if (!result.success) {
      this._markBlockUnsafe(event.blockNumber);
    }
    return result;
  }

  async _processEvent(event) {
    const handlers = {
      WalletRegistered: this._onWalletRegistered.bind(this),
      EscrowCreated: this._onEscrowCreated.bind(this),
      EscrowLocked: this._onEscrowLocked.bind(this),
      PaymentReported: this._onPaymentReported.bind(this),
      EscrowReleased: this._onEscrowReleased.bind(this),
      DisputeOpened: this._onDisputeOpened.bind(this),
      CancelProposed: this._onCancelProposed.bind(this),
      EscrowCanceled: this._onEscrowCanceled.bind(this),
      MakerPinged: this._onMakerPinged.bind(this),
      ReputationUpdated: this._onReputationUpdated.bind(this),
      BleedingDecayed: this._onBleedingDecayed.bind(this),
      EscrowBurned: this._onEscrowBurned.bind(this),
      TreasuryUpdated: this._onTreasuryUpdated.bind(this),
      TokenSupportUpdated: this._onTokenSupportUpdated.bind(this),
      OrderCreated: this._onOrderCreated.bind(this),
      OrderFilled: this._onOrderFilled.bind(this),
      OrderCanceled: this._onOrderCanceled.bind(this),
      FeeConfigUpdated: this._onFeeConfigUpdated.bind(this),
      CooldownConfigUpdated: this._onCooldownConfigUpdated.bind(this),
      TokenConfigUpdated: this._onTokenConfigUpdated.bind(this),
    };

    const handler = handlers[event.eventName];
    if (handler) {
      await handler(event);
      logger.debug(`[Worker] İşlendi: ${event.eventName} tx=${event.transactionHash}`);
    }
  }

  async _onWalletRegistered(event) {
    const { wallet } = event.args;
    await User.findOneAndUpdate(
      { wallet_address: wallet.toLowerCase() },
      { $setOnInsert: { wallet_address: wallet.toLowerCase() } },
      { upsert: true }
    );
  }

  async _onOrderCreated(event) {
    const { orderId, owner, side, token, totalAmount, minFillAmount, tier, orderRef } = event.args;
    const orderIdNum = this._safeNumber(orderId);
    const sideInfo = this._normalizeOrderSide(side);

    await this._syncOrderMirrorFromChain(orderIdNum, {
      owner_address: this._normalizeAddress(owner),
      side: sideInfo.label,
      token_address: this._normalizeAddress(token),
      tier: this._safeNumber(tier),
      refs: {
        order_ref: this._normalizeBytes32(orderRef),
      },
      amounts: {
        total_amount: this._safeString(totalAmount, '0'),
        total_amount_num: this._safeNumber(totalAmount, 0),
        remaining_amount: this._safeString(totalAmount, '0'),
        remaining_amount_num: this._safeNumber(totalAmount, 0),
        min_fill_amount: this._safeString(minFillAmount, '0'),
        min_fill_amount_num: this._safeNumber(minFillAmount, 0),
        executed_amount: '0',
        executed_amount_num: 0,
      },
      timers: {
        created_onchain_at: new Date(),
      },
    });
  }
  async _onOrderFilled(event) {
    const { orderId, tradeId, filler, fillAmount, remainingAmount } = event.args;
    const orderIdNum = this._safeNumber(orderId);
    const tradeIdNum = this._safeNumber(tradeId);

    const existingOrder = await Order.findOne({ onchain_order_id: orderIdNum }).lean();
    const existingTrade = await Trade.findOne({ onchain_escrow_id: tradeIdNum }).lean();

    await this._syncOrderMirrorFromChain(orderIdNum, {
      amounts: {
        total_amount: existingOrder?.amounts?.total_amount || '0',
        total_amount_num: existingOrder?.amounts?.total_amount_num || 0,
        remaining_amount: this._safeString(remainingAmount, '0'),
        remaining_amount_num: this._safeNumber(remainingAmount, 0),
        min_fill_amount: existingOrder?.amounts?.min_fill_amount || '0',
        min_fill_amount_num: existingOrder?.amounts?.min_fill_amount_num || 0,
        executed_amount: existingOrder?.amounts?.total_amount
          ? this._safeString(BigInt(existingOrder.amounts.total_amount || '0') - BigInt(remainingAmount || '0'), '0')
          : (existingOrder?.amounts?.executed_amount || '0'),
        executed_amount_num: existingOrder?.amounts?.total_amount
          ? this._safeNumber(BigInt(existingOrder.amounts.total_amount || '0') - BigInt(remainingAmount || '0'), 0)
          : (existingOrder?.amounts?.executed_amount_num || 0),
      },
      stats: {
        child_trade_count: (existingOrder?.stats?.child_trade_count || 0) + (existingTrade ? 0 : 1),
        last_fill_tx_hash: event.transactionHash || existingOrder?.stats?.last_fill_tx_hash || null,
      },
      timers: {
        created_onchain_at: existingOrder?.timers?.created_onchain_at || new Date(),
        last_fill_at: new Date(),
        filled_at: this._safeNumber(remainingAmount, 0) === 0 ? new Date() : (existingOrder?.timers?.filled_at || null),
        canceled_at: existingOrder?.timers?.canceled_at || null,
      },
    });

    // [TR] Same-tx create + lock zincirinde trade kaydı OrderFilled aşamasında önceden tohumlanır.
    //      Böylece EscrowCreated / EscrowLocked mirror'u eksik trade yüzünden sessizce düşmez.
    // [EN] In the same-tx create + lock chain, we pre-seed the trade mirror at OrderFilled time
    //      so EscrowCreated / EscrowLocked cannot silently fail because the trade row is missing.
    await this._upsertChildTradeFromChain(tradeIdNum, {
      parent_order_id: orderIdNum,
      'fill_metadata.fill_tx_hash': event.transactionHash || null,
    });
  }
  async _onOrderCanceled(event) {
    const { orderId, side, remainingAmount, makerBondRefund, takerBondRefund } = event.args;
    const orderIdNum = this._safeNumber(orderId);
    const sideInfo = this._normalizeOrderSide(side);
    const existingOrder = await Order.findOne({ onchain_order_id: orderIdNum }).lean();

    await this._syncOrderMirrorFromChain(orderIdNum, {
      side: sideInfo.label,
      amounts: {
        total_amount: existingOrder?.amounts?.total_amount || '0',
        total_amount_num: existingOrder?.amounts?.total_amount_num || 0,
        remaining_amount: this._safeString(remainingAmount, '0'),
        remaining_amount_num: this._safeNumber(remainingAmount, 0),
        min_fill_amount: existingOrder?.amounts?.min_fill_amount || '0',
        min_fill_amount_num: existingOrder?.amounts?.min_fill_amount_num || 0,
        executed_amount: existingOrder?.amounts?.executed_amount || '0',
        executed_amount_num: existingOrder?.amounts?.executed_amount_num || 0,
      },
      reserves: {
        remaining_maker_bond_reserve: this._safeString(makerBondRefund, '0'),
        remaining_maker_bond_reserve_num: this._safeNumber(makerBondRefund, 0),
        remaining_taker_bond_reserve: this._safeString(takerBondRefund, '0'),
        remaining_taker_bond_reserve_num: this._safeNumber(takerBondRefund, 0),
      },
      timers: {
        created_onchain_at: existingOrder?.timers?.created_onchain_at || new Date(),
        last_fill_at: existingOrder?.timers?.last_fill_at || null,
        filled_at: existingOrder?.timers?.filled_at || null,
        canceled_at: new Date(),
      },
    });
  }
  async _onEscrowCreated(event) {
    const { tradeId, maker, amount, tier } = event.args;
    const tradeIdNum = this._safeNumber(tradeId);
    const onchainToken = this._normalizeAddress(event.args.token);
    const listingRef = this._normalizeBytes32(event.args.listingRef);
    const isZeroRef = !listingRef || /^0x0{64}$/.test(listingRef);

    const onchainTrade = await this._readTradeFromChain(tradeIdNum);

    // [TR] Child trade ise canonical bağ artık listing değil parentOrderId'dir.
    //      Bu nedenle zero-ref kontrolü legacy direct-escrow yoluna uygulanır; V3 child trade
    //      yolu ise order katmanından doğrulanır.
    // [EN] If this is a child trade, canonical linkage is parentOrderId rather than listingRef.
    //      Zero-ref remains a critical error for legacy direct escrow, while V3 child trades are
    //      validated through the parent order layer.
    if (onchainTrade.parentOrderId > 0) {
      const { orderSnapshot } = await this._upsertChildTradeFromChain(tradeIdNum, {
        'canonical_refs.child_listing_ref': listingRef,
      });

      if (orderSnapshot) {
        await this._syncOrderMirrorFromChain(onchainTrade.parentOrderId, {
          stats: {
            child_trade_count: orderSnapshot?.stats?.child_trade_count || 0,
            last_fill_tx_hash: orderSnapshot?.stats?.last_fill_tx_hash || null,
          },
        });
      }

      logger.info(
        `[Worker] V3 child trade mirrored: trade=#${tradeIdNum} parentOrder=#${onchainTrade.parentOrderId} ref=${listingRef}`
      );
      return;
    }

    // Zero listingRef artık recoverable lag gibi yorumlanmıyor.
    // Bu durum, kontrat veya frontend çağrı disiplininde kritik linkage ihlali kabul edilir.
    if (isZeroRef) {
      logger.error(
        `[Worker] CRITICAL: EscrowCreated event'i zero listingRef ile geldi! ` +
        `trade=#${tradeIdNum} tx=${event.transactionHash} — ` +
        `Bu kontrat seviyesinde engellenmiş olmalı. Manuel inceleme gerekiyor.`
      );
      await this._addToDLQ(event, 'CRITICAL: zero listingRef — kontrat fix öncesi oluştu');
      return;
    }

    const listing = await Listing.findOne({ listing_ref: listingRef }).lean();
    if (!listing) {
      logger.warn(`[Worker] EscrowCreated: listing_ref bulunamadı trade=#${tradeIdNum} ref=${listingRef}`);
      await this._addToDLQ(event, `listing_ref bulunamadı: ${listingRef}`);
      return;
    }

    const makerMatches = listing.maker_address === this._normalizeAddress(maker);
    const tierMatches = Number(listing.tier_rules?.required_tier) === this._safeNumber(tier);
    const tokenMatches = (listing.token_address || '').toLowerCase() === (onchainToken || '');

    if (!makerMatches || !tierMatches || !tokenMatches) {
      logger.warn(`[Worker] EscrowCreated authoritative ref mismatch trade=#${tradeIdNum} ref=${listingRef}`);
      await this._addToDLQ(event, 'listing_ref bulundu fakat on-chain maker/tier/token doğrulaması başarısız.');
      return;
    }

    if (listing.onchain_escrow_id !== null && listing.onchain_escrow_id !== tradeIdNum) {
      await this._addToDLQ(event, `listing_ref başka escrow'a bağlı: ${listing.onchain_escrow_id}`);
      return;
    }

    if (listing.onchain_escrow_id === null) {
      const linkResult = await Listing.updateOne(
        { _id: listing._id, listing_ref: listingRef, onchain_escrow_id: null },
        { $set: { onchain_escrow_id: tradeIdNum, status: 'OPEN' } }
      );

      if (!linkResult.modifiedCount) {
        logger.warn(
          `[Worker] EscrowCreated: authoritative listing link race trade=#${tradeIdNum} listing=${listing._id}`
        );
        await this._addToDLQ(event, 'Authoritative listing link race — onchain_escrow_id atomik bağlanamadı.');
        return;
      }
    }

    // Büyük sayılar Mongo mirror'da string olarak saklanır.
    // Sayısal alanlar yalnız analitik / approx görüntüleme içindir.
    const financials = {
      crypto_amount: amount.toString(),
      crypto_amount_num: this._safeNumber(amount, 0),
      exchange_rate: listing.exchange_rate,
      crypto_asset: listing.crypto_asset,
      fiat_currency: listing.fiat_currency,
      taker_fee_bps_snapshot: onchainTrade.takerFeeBpsSnapshot,
      maker_fee_bps_snapshot: onchainTrade.makerFeeBpsSnapshot,
      total_decayed: '0',
      total_decayed_num: 0,
      decay_tx_hashes: [],
      decayed_amounts: [],
    };

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: tradeIdNum },
      {
        $setOnInsert: {
          onchain_escrow_id: tradeIdNum,
          listing_id: listing._id,
          parent_order_id: null,
          trade_origin: 'LEGACY_DIRECT',
          token_address: onchainToken,
          maker_address: this._normalizeAddress(maker),
          status: 'OPEN',
          tier: this._safeNumber(tier),
          financials,
          canonical_refs: {
            listing_ref: listingRef,
            child_listing_ref: null,
          },
        },
        $set: {
          token_address: onchainToken,
          'canonical_refs.listing_ref': listingRef,
          'financials.taker_fee_bps_snapshot': onchainTrade.takerFeeBpsSnapshot,
          'financials.maker_fee_bps_snapshot': onchainTrade.makerFeeBpsSnapshot,
        },
      },
      { upsert: true }
    );
  }
  async _onEscrowLocked(event) {
    const { tradeId, taker } = event.args;
    const tradeIdNum = this._safeNumber(tradeId);
    const takerAddress = this._normalizeAddress(taker);

    // LOCKED anında maker/taker şifreli alanları trade içine snapshot alınır.
    // Böylece kullanıcı profilini sonra değiştirirse geçmiş trade referansı kaymaz.
    const trade = await Trade.findOne({ onchain_escrow_id: tradeIdNum })
      .select('maker_address parent_order_id')
      .lean();

    // [TR] Trade kaydı henüz oluşmadıysa bunu sessizce yutmayız.
    //      Özellikle V3 same-tx create + lock zincirinde bu durum retry edilmelidir.
    // [EN] If the trade mirror is not present yet, we do not swallow it silently.
    //      In V3 same-tx create + lock chains, this must be retried rather than guessed.
    if (!trade) {
      throw new Error(`EscrowLocked geldi ama trade mirror henüz yok: tradeId=${tradeIdNum}`);
    }

    let makerBankOwnerEnc = null;
    let makerIbanEnc = null;
    let takerBankOwnerEnc = null;

    if (trade?.maker_address) {
      const [makerUser, takerUser] = await Promise.all([
        User.findOne({ wallet_address: trade.maker_address })
          .select('pii_data.bankOwner_enc pii_data.iban_enc')
          .lean(),
        User.findOne({ wallet_address: takerAddress })
          .select('pii_data.bankOwner_enc')
          .lean(),
      ]);

      makerBankOwnerEnc = makerUser?.pii_data?.bankOwner_enc || null;
      makerIbanEnc = makerUser?.pii_data?.iban_enc || null;
      takerBankOwnerEnc = takerUser?.pii_data?.bankOwner_enc || null;
    }

    await this._upsertTradeMirrorRaw(
      { onchain_escrow_id: tradeIdNum },
      {
        $set: {
          status: 'LOCKED',
          taker_address: takerAddress,
          updated_at: new Date(),
          'timers.locked_at': new Date(),
          'pii_snapshot.maker_bankOwner_enc': makerBankOwnerEnc,
          'pii_snapshot.maker_iban_enc': makerIbanEnc,
          'pii_snapshot.taker_bankOwner_enc': takerBankOwnerEnc,
          'pii_snapshot.captured_at': new Date(),
          'pii_snapshot.snapshot_delete_at': new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      }
    );
  }
  async _onPaymentReported(event) {
    const { tradeId, ipfsHash } = event.args;

    const safeHash = CID_PATTERN.test(ipfsHash) ? ipfsHash : null;
    if (!safeHash) {
      logger.warn(`[Worker] Geçersiz IPFS hash formatı: trade=#${tradeId} hash=${ipfsHash?.slice?.(0, 20) || ""}...`);
    }

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: this._safeNumber(tradeId) },
      {
        $set: {
          status: "PAID",
          "evidence.ipfs_receipt_hash": safeHash,
          "evidence.receipt_timestamp": new Date(),
          "timers.paid_at": new Date(),
        },
      }
    );
  }

  async _onEscrowReleased(event) {
    const { tradeId } = event.args;
    const tradeIdNum = this._safeNumber(tradeId);

    const existingTrade = await Trade.findOne({ onchain_escrow_id: tradeIdNum }).lean();
    const wasDisputed = existingTrade?.status === "CHALLENGED";

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const trade = await Trade.findOneAndUpdate(
        { onchain_escrow_id: tradeIdNum },
        { $set: { status: "RESOLVED", "timers.resolved_at": new Date() } },
        { new: true, session }
      );

      if (!trade) {
        await session.abortTransaction();
        logger.warn(`[Worker] EscrowReleased: Trade #${tradeId} bulunamadı.`);
        return;
      }

      await Trade.findOneAndUpdate(
        { onchain_escrow_id: tradeIdNum },
        { $set: { "evidence.receipt_delete_at": new Date(Date.now() + 24 * 3600 * 1000) } },
        { session }
      );

      // CHALLENGED -> RESOLVED akışı, maker'ın itiraz açıp daha sonra release yaptığı ve
      // itirazın haksız kaldığı durumdur. Bu nedenle ceza mirror'u maker tarafına yazılır.
      if (wasDisputed && trade.maker_address) {
        const scoreType = "unjust_challenge";
        const score = FAILURE_SCORE_WEIGHTS[scoreType];

        await User.findOneAndUpdate(
          { wallet_address: trade.maker_address },
          {
            $inc: { "reputation_cache.failure_score": score },
            $push: {
              reputation_history: {
                $each: [{ type: scoreType, score, date: new Date(), tradeId: tradeIdNum }],
                $slice: -MAX_REPUTATION_HISTORY,
              },
            },
          },
          { session }
        );

        logger.info(`[Worker] Haksız itiraz cezası: maker=${trade.maker_address} +${score}`);
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async _onDisputeOpened(event) {
    const { tradeId } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: this._safeNumber(tradeId) },
      { $set: { status: "CHALLENGED", "timers.challenged_at": new Date() } }
    );
  }

  async _onEscrowCanceled(event) {
    const { tradeId } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: this._safeNumber(tradeId) },
      {
        $set: {
          status: "CANCELED",
          "timers.resolved_at": new Date(),
          "evidence.receipt_delete_at": new Date(Date.now() + 24 * 3600 * 1000),
        },
      }
    );
  }

  async _onEscrowBurned(event) {
    const { tradeId } = event.args;
    const tradeIdNum = this._safeNumber(tradeId);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const trade = await Trade.findOneAndUpdate(
        { onchain_escrow_id: tradeIdNum },
        {
          $set: {
            status: "BURNED",
            "timers.resolved_at": new Date(),
            "evidence.receipt_delete_at": new Date(Date.now() + 30 * 24 * 3600 * 1000),
          },
        },
        { new: true, session }
      );

      if (trade) {
        const scoreType = "burned";
        const score = FAILURE_SCORE_WEIGHTS[scoreType];
        const addresses = [trade.maker_address, trade.taker_address].filter(Boolean);

        for (const addr of addresses) {
          const existing = await User.findOne(
            {
              wallet_address: addr,
              reputation_history: { $elemMatch: { type: scoreType, tradeId: tradeIdNum } },
            },
            null,
            { session }
          ).lean();

          if (existing) {
            logger.debug(`[Worker] Duplicate failure_score atlandı: ${addr} trade #${tradeId}`);
            continue;
          }

          await User.findOneAndUpdate(
            { wallet_address: addr },
            {
              $inc: { "reputation_cache.failure_score": score },
              $push: {
                reputation_history: {
                  $each: [{ type: scoreType, score, date: new Date(), tradeId: tradeIdNum }],
                  $slice: -MAX_REPUTATION_HISTORY,
                },
              },
            },
            { session }
          );
        }

        logger.info(`[Worker] Burn cezası: +${score} to ${addresses.length} taraf, trade #${tradeId}`);
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async _onBleedingDecayed(event) {
    const { tradeId, decayedAmount } = event.args;
    const tradeIdNum = this._safeNumber(tradeId);
    const eventId = this._getEventId(event);
    const decayedAmountStr = this._safeString(decayedAmount, "0");
    const decayedAmountNum = this._safeNumber(decayedAmount, 0);

    // Idempotency anahtarı txHash:logIndex kullanır.
    // Aynı decay event'i tekrar işlense bile aynı eventId ikinci kez yazılmaz.
    const updateResult = await Trade.updateOne(
      {
        onchain_escrow_id: tradeIdNum,
        "financials.decay_tx_hashes": { $ne: eventId },
      },
      [
        {
          $set: {
            "timers.last_decay_at": new Date(),
            "financials.total_decayed": {
              $toString: {
                $add: [
                  { $toDecimal: { $ifNull: ["$financials.total_decayed", "0"] } },
                  { $toDecimal: decayedAmountStr },
                ],
              },
            },
            "financials.total_decayed_num": {
              $add: [{ $ifNull: ["$financials.total_decayed_num", 0] }, decayedAmountNum],
            },
            "financials.decay_tx_hashes": {
              $concatArrays: [{ $ifNull: ["$financials.decay_tx_hashes", []] }, [eventId]],
            },
            "financials.decayed_amounts": {
              $concatArrays: [{ $ifNull: ["$financials.decayed_amounts", []] }, [decayedAmountStr]],
            },
          },
        },
      ]
    );

    if (updateResult.matchedCount === 0) return;
    if (updateResult.modifiedCount === 0) {
      logger.debug(`[Worker] BleedingDecayed tekrar işleme atlandı: key=${eventId}`);
    }
  }

  async _onCancelProposed(event) {
    const { tradeId, proposer } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: this._safeNumber(tradeId) },
      {
        $set: {
          "cancel_proposal.proposed_by": this._normalizeAddress(proposer),
          "cancel_proposal.proposed_at": new Date(),
        },
      }
    );
  }

  async _onMakerPinged(event) {
    const { tradeId, pinger } = event.args;
    const tradeIdNum = this._safeNumber(tradeId);

    const trade = await Trade.findOne({ onchain_escrow_id: tradeIdNum }).lean();
    if (!trade) return;

    // taker_address henüz yoksa kontrattan tekrar tahmin üretmek yerine event sırasını bekleriz.
    if (!trade.taker_address) {
      logger.warn(`[Worker] MakerPinged: Trade #${tradeId} taker_address henüz null — DLQ'ya alınıyor.`);
      throw new Error("taker_address henüz DB'de yok — EscrowLocked gecikmiş olabilir.");
    }

    const isTakerPing = this._normalizeAddress(pinger) === trade.taker_address.toLowerCase();
    const updateFields = isTakerPing
      ? { "timers.pinged_at": new Date(), pinged_by_taker: true }
      : { "timers.challenge_pinged_at": new Date(), challenge_pinged_by_maker: true };

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: tradeIdNum },
      { $set: updateFields }
    );
  }

  async _onReputationUpdated(event) {
    const { wallet, successful, failed, bannedUntil, effectiveTier } = event.args;

    const totalTrades = this._safeNumber(successful, 0) + this._safeNumber(failed, 0);
    const successRate = totalTrades > 0
      ? Math.round((this._safeNumber(successful, 0) / totalTrades) * 100)
      : 100;

    const banTimestamp = this._safeNumber(bannedUntil, 0);
    const isBanned = banTimestamp > Math.floor(Date.now() / 1000);

    await User.findOneAndUpdate(
      { wallet_address: this._normalizeAddress(wallet) },
      {
        $set: {
          "reputation_cache.success_rate": successRate,
          "reputation_cache.total_trades": totalTrades,
          "reputation_cache.failed_disputes": this._safeNumber(failed, 0),
          "reputation_cache.effective_tier": this._safeNumber(effectiveTier, 0),
          is_banned: isBanned,
          banned_until: isBanned ? new Date(banTimestamp * 1000) : null,
        },
      },
      { upsert: true }
    );
  }

  async _onTreasuryUpdated(event) {
    const { newTreasury } = event.args;
    await this._writeRedisJson(TREASURY_CONFIG_KEY, {
      treasury: this._normalizeAddress(newTreasury),
      updated_at: new Date().toISOString(),
      source: "event:TreasuryUpdated",
    });
  }

  async _onTokenSupportUpdated(event) {
    const { token, supported } = event.args;
    const tokenAddress = this._normalizeAddress(token);
    const redisKey = `${TOKEN_CONFIG_PREFIX}${tokenAddress}`;

    // [TR] TokenSupportUpdated tek başına direction bilgisi taşımaz.
    //      Bu yüzden mevcut mirror'u koruyup supported alanını güncelliyoruz.
    // [EN] TokenSupportUpdated does not include direction details by itself.
    //      We preserve any existing direction mirror and only update `supported` here.
    const redis = getRedisClient();
    const existingRaw = await redis.get(redisKey);
    const existing = existingRaw ? JSON.parse(existingRaw) : {};

    await this._writeRedisJson(redisKey, {
      ...existing,
      token: tokenAddress,
      supported: Boolean(supported),
      updated_at: new Date().toISOString(),
      source: "event:TokenSupportUpdated",
    });
  }

  async _onFeeConfigUpdated(event) {
    const { takerFeeBps, makerFeeBps } = event.args;
    await this._writeRedisJson(FEE_CONFIG_KEY, {
      takerFeeBps: this._safeString(takerFeeBps, "0"),
      makerFeeBps: this._safeString(makerFeeBps, "0"),
      updated_at: new Date().toISOString(),
      source: "event:FeeConfigUpdated",
    });
  }

  async _onCooldownConfigUpdated(event) {
    const { tier0TradeCooldown, tier1TradeCooldown } = event.args;
    await this._writeRedisJson(COOLDOWN_CONFIG_KEY, {
      tier0TradeCooldown: this._safeString(tier0TradeCooldown, "0"),
      tier1TradeCooldown: this._safeString(tier1TradeCooldown, "0"),
      updated_at: new Date().toISOString(),
      source: "event:CooldownConfigUpdated",
    });
  }

  async _onTokenConfigUpdated(event) {
    const { token, supported, allowSellOrders, allowBuyOrders } = event.args;
    const tokenAddress = this._normalizeAddress(token);

    await this._writeRedisJson(`${TOKEN_CONFIG_PREFIX}${tokenAddress}`, {
      token: tokenAddress,
      supported: Boolean(supported),
      allowSellOrders: Boolean(allowSellOrders),
      allowBuyOrders: Boolean(allowBuyOrders),
      updated_at: new Date().toISOString(),
      source: "event:TokenConfigUpdated",
    });
  }
}

const worker = new EventWorker();

worker.buildSyntheticEventFromDLQEntry = function buildSyntheticEventFromDLQEntry(entry) {
  const mappedArgs = { ...(entry.namedArgs || {}) };

  if (!Object.keys(mappedArgs).length && Array.isArray(entry.args)) {
    const keys = EVENT_ARG_KEYS[entry.eventName] || [];
    keys.forEach((key, i) => {
      if (entry.args[i] !== undefined) mappedArgs[key] = entry.args[i];
    });
  }

  return {
    eventName: entry.eventName,
    transactionHash: entry.txHash,
    logIndex: entry.logIndex ?? -1,
    blockNumber: entry.blockNumber,
    args: mappedArgs,
  };
};

worker.reprocessDLQEntry = async function reprocessDLQEntry(entry) {
  if (!entry?.eventName) return false;

  try {
    const syntheticEvent = worker.buildSyntheticEventFromDLQEntry(entry);
    await worker._processEvent(syntheticEvent);
    return true;
  } catch (err) {
    logger.error(`[Worker] DLQ re-drive başarısız: ${entry.eventName} tx=${entry.txHash} err=${err.message}`);
    return false;
  }
};

module.exports = worker;
