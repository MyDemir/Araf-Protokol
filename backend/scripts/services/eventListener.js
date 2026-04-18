"use strict";
/*
 * eventListener.js — V3 Native Event Worker
 *
 * Tasarım hedefi:
 *   - ArafEscrow.sol authoritative kaynaktır.
 *   - Backend order/trade state üretmez; yalnız mirror eder.
 *   - Parent order ve child trade explicit bağlarla tutulur.
 *   - V3 order fill path'inde child trade authority, OrderFilled + getTrade() ile mirror edilir.
 *
 * V3 ilkeleri:
 *   - Parent order canonical katmandır.
 *   - Child trade gerçek escrow lifecycle'ıdır.
 *   - remainingAmount, reserve ve fee snapshot kontrattan gelir.
 *   - Heuristik linkage YOK; explicit orderId / tradeId / orderRef kullanılır.
 *
 * Bu sürüm, güncel V3 yüzeye göre hizalanmıştır:
 *   - OrderCreated / OrderFilled / OrderCanceled event'leri
 *   - FeeConfigUpdated / CooldownConfigUpdated / TokenConfigUpdated event'leri
 *   - getTrade(), getOrder(), getReputation() getter'ları
 *   - Trade.parentOrderId alanı
 *   - User.js ve Trade.js içindeki banka profil riski snapshot alanları
 */
const { ethers } = require("ethers");
const mongoose = require("mongoose");
const { getRedisClient } = require("../config/redis");
const Trade = require("../models/Trade");
const Order = require("../models/Order");
const User = require("../models/User");
const logger = require("../utils/logger");
const {
  updateCachedFeeConfig,
  updateCachedCooldownConfig,
  updateCachedTokenConfig,
} = require("./protocolConfig");

const CHECKPOINT_KEY = "worker:last_block";
const LAST_SAFE_BLOCK_KEY = "worker:last_safe_block";
const DLQ_KEY = "worker:dlq";
const RETRY_DELAY_MS = 2_000;
const MAX_RETRIES = 5;
const BLOCK_BATCH_SIZE = 1_000;
const CHECKPOINT_INTERVAL_BLOCKS = 50;
const MAX_REPUTATION_HISTORY = 100;
const BLOCK_TIMESTAMP_CACHE_LIMIT = 2_048;

const FAILURE_SCORE_WEIGHTS = {
  burned: 50,
  unjust_challenge: 20,
  passive_maker: 20,
  failed_dispute: 20,
};

const EVENT_NAMES = [
  "WalletRegistered",
  "EscrowCreated", "EscrowLocked", "PaymentReported",
  "EscrowReleased", "DisputeOpened",
  "CancelProposed", "EscrowCanceled",
  "MakerPinged", "ReputationUpdated",
  "BleedingDecayed", "EscrowBurned",
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
  "event OrderCreated(uint256 indexed orderId, address indexed owner, uint8 side, address token, uint256 totalAmount, uint256 minFillAmount, uint8 tier, bytes32 orderRef)",
  "event OrderFilled(uint256 indexed orderId, uint256 indexed tradeId, address indexed filler, uint256 fillAmount, uint256 remainingAmount, bytes32 childListingRef)",
  "event OrderCanceled(uint256 indexed orderId, uint8 side, uint256 remainingAmount, uint256 makerBondRefund, uint256 takerBondRefund)",
  "event FeeConfigUpdated(uint256 takerFeeBps, uint256 makerFeeBps)",
  "event CooldownConfigUpdated(uint256 tier0TradeCooldown, uint256 tier1TradeCooldown)",
  "event TokenConfigUpdated(address indexed token, bool supported, bool allowSellOrders, bool allowBuyOrders)",
  "function getTrade(uint256 _tradeId) view returns ((uint256 id,uint256 parentOrderId,address maker,address taker,address tokenAddress,uint256 cryptoAmount,uint256 makerBond,uint256 takerBond,uint16 takerFeeBpsSnapshot,uint16 makerFeeBpsSnapshot,uint8 tier,uint8 state,uint256 lockedAt,uint256 paidAt,uint256 challengedAt,string ipfsReceiptHash,bool cancelProposedByMaker,bool cancelProposedByTaker,uint256 pingedAt,bool pingedByTaker,uint256 challengePingedAt,bool challengePingedByMaker))",
  "function getOrder(uint256 _orderId) view returns ((uint256 id,address owner,uint8 side,address tokenAddress,uint256 totalAmount,uint256 remainingAmount,uint256 minFillAmount,uint256 remainingMakerBondReserve,uint256 remainingTakerBondReserve,uint16 takerFeeBpsSnapshot,uint16 makerFeeBpsSnapshot,uint8 tier,uint8 state,bytes32 orderRef))",
  "function getReputation(address _wallet) view returns (uint256 successful,uint256 failed,uint256 bannedUntil,uint256 consecutiveBans,uint8 effectiveTier)",
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
  OrderCreated: ["orderId", "owner", "side", "token", "totalAmount", "minFillAmount", "tier", "orderRef"],
  OrderFilled: ["orderId", "tradeId", "filler", "fillAmount", "remainingAmount", "childListingRef"],
  OrderCanceled: ["orderId", "side", "remainingAmount", "makerBondRefund", "takerBondRefund"],
  FeeConfigUpdated: ["takerFeeBps", "makerFeeBps"],
  CooldownConfigUpdated: ["tier0TradeCooldown", "tier1TradeCooldown"],
  TokenConfigUpdated: ["token", "supported", "allowSellOrders", "allowBuyOrders"],
};

function _toNum(v) {
  return Number(v ?? 0);
}
function _toStr(v) { return v?.toString?.() ?? String(v); }

/**
 * [TR] Yalnızca *_num cache alanları için güvenli Number dönüşümü.
 *      Kimlik alanları (orderId/tradeId) bu helper'ı kullanmaz; null kimlik drift'i önlenir.
 * [EN] Safe Number conversion only for *_num cache fields.
 *      Identity fields (orderId/tradeId) must not use this helper to avoid null-id drift.
 */
function _toSafeNum(v) {
  const normalized = v ?? 0;
  const asBigInt = typeof normalized === "bigint"
    ? normalized
    : BigInt(normalized.toString ? normalized.toString() : String(normalized));

  if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER) || asBigInt < BigInt(Number.MIN_SAFE_INTEGER)) {
    return null;
  }

  return Number(asBigInt);
}

function _normalizeSide(sideValue) {
  const sideNum = Number(sideValue);
  return sideNum === 1 ? "BUY_CRYPTO" : "SELL_CRYPTO";
}

function _normalizeOrderState(stateValue) {
  const n = Number(stateValue);
  if (n === 1) return "PARTIALLY_FILLED";
  if (n === 2) return "FILLED";
  if (n === 3) return "CANCELED";
  return "OPEN";
}

function _normalizeTradeState(stateValue) {
  const n = Number(stateValue);
  if (n === 1) return "LOCKED";
  if (n === 2) return "PAID";
  if (n === 3) return "CHALLENGED";
  if (n === 4) return "RESOLVED";
  if (n === 5) return "CANCELED";
  if (n === 6) return "BURNED";
  return "OPEN";
}

function _toDateOrNull(unixSeconds) {
  const n = Number(unixSeconds || 0);
  return n > 0 ? new Date(n * 1000) : null;
}

function _inferCryptoAssetFromToken(tokenAddress) {
  const addr = (tokenAddress || "").toLowerCase();
  if (!addr) return null;

  const usdt = (process.env.USDT_ADDRESS || "").toLowerCase();
  const usdc = (process.env.USDC_ADDRESS || "").toLowerCase();

  if (usdt && addr === usdt) return "USDT";
  if (usdc && addr === usdc) return "USDC";
  return null;
}

const TRADE_STATE_ORDER = {
  OPEN: 0,
  LOCKED: 1,
  PAID: 2,
  CHALLENGED: 3,
  RESOLVED: 4,
  CANCELED: 5,
  BURNED: 6,
};

const TERMINAL_TRADE_STATES = new Set(["RESOLVED", "CANCELED", "BURNED"]);
const LOCKABLE_TRADE_STATES = new Set(["OPEN", "LOCKED"]);

function _getTradeStateOrder(state) {
  return TRADE_STATE_ORDER[state] ?? -1;
}

function _isTradeStateRegression(currentState, nextState) {
  if (!currentState || !nextState) return false;
  return _getTradeStateOrder(nextState) < _getTradeStateOrder(currentState);
}

/**
 * [TR] Timer alanlarını yalnız gerçekten yeni değer geldiyse set ederiz.
 *      Böylece replay / partial mirror update sırasında null-reset oluşmaz.
 * [EN] Only set timer fields when a real new value exists, preventing null-reset.
 */
function _setIfDefined(target, key, value) {
  if (value !== undefined) {
    target[key] = value;
  }
}

function _hasRequiredPayoutSnapshot(profile) {
  return Boolean(
    profile?.rail &&
    profile?.country &&
    profile?.payout_details_enc
  );
}

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
    this._livePollInProgress = false;
    this._lastLivePolledBlock = 0;
    this._blockTimestampCache = new Map();
  }

  async start() {
    logger.info("[Worker] V3 event listener başlatılıyor...");
    this.isRunning = true;
    await this._connect();
    await this._replayMissedEvents();
    if (this.provider) this._lastLivePolledBlock = await this.provider.getBlockNumber();
    this._attachLiveListeners();
    logger.info("[Worker] V3 event listener aktif.");
  }

  async stop() {
    this.isRunning = false;
    if (this.provider) this.provider.removeAllListeners();
    this._listenersAttached = false;
    this._livePollInProgress = false;
    this._blockTimestampCache.clear();
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
      } catch (err) {
        logger.warn(`[Worker] WebSocket başarısız, HTTP fallback: ${err.message}`);
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
      }
    } else {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      if (isProduction) logger.warn("[Worker] HTTP RPC kullanılıyor. BASE_WS_RPC_URL önerilir.");
    }

    this.contract = new ethers.Contract(contractAddress, ARAF_ABI, this.provider);
    logger.info(`[Worker] Kontrat izleniyor: ${contractAddress}`);
    this._setState("connected", "provider + kontrat hazır");
  }

  async _getBlockTimestampDate(blockNumber) {
    if (!this.provider || !Number.isInteger(blockNumber) || blockNumber < 0) {
      return null;
    }

    const cached = this._blockTimestampCache.get(blockNumber);
    if (cached) {
      return new Date(cached.getTime());
    }

    const block = await this.provider.getBlock(blockNumber);
    if (!block || block.timestamp === undefined || block.timestamp === null) {
      return null;
    }

    const blockDate = new Date(Number(block.timestamp) * 1000);
    this._blockTimestampCache.set(blockNumber, blockDate);

    if (this._blockTimestampCache.size > BLOCK_TIMESTAMP_CACHE_LIMIT) {
      const oldestKey = this._blockTimestampCache.keys().next().value;
      if (oldestKey !== undefined) {
        this._blockTimestampCache.delete(oldestKey);
      }
    }

    return new Date(blockDate.getTime());
  }

  async _getEventDate(event, explicitUnixSeconds = null) {
    const explicitDate = _toDateOrNull(explicitUnixSeconds);
    if (explicitDate) {
      return explicitDate;
    }

    const blockNumber = event?.blockNumber;
    const blockDate = await this._getBlockTimestampDate(blockNumber);

    if (!blockDate) {
      throw new Error(
        `[Worker] BLOCK_TIMESTAMP_UNAVAILABLE: event=${event?.eventName || "unknown"} block=${blockNumber}`
      );
    }

    return blockDate;
  }

  async _replayMissedEvents() {
    if (!this.contract) return;

    const redis = getRedisClient();
    const savedBlock = await redis.get(LAST_SAFE_BLOCK_KEY) ?? await redis.get(CHECKPOINT_KEY);
    const toBlock = await this.provider.getBlockNumber();
    const fromBlock = this._resolveReplayStartBlock(savedBlock, toBlock);

    if (fromBlock > toBlock) return;

    this._setState("replaying", `replay aralığı: ${fromBlock}-${toBlock}`);

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

      if (batchSuccess) {
        await this._updateSafeCheckpointIfHigher(to);
      }
    }

    logger.info("[Worker] Replay tamamlandı.");
  }

  _attachLiveListeners() {
    if (!this.contract || this._listenersAttached) return;

    this.provider.on("block", async (blockNumber) => {
      if (this._livePollInProgress) return;

      this._livePollInProgress = true;
      try {
        await this._updateSeenBlockIfHigher(blockNumber);

        const fromBlock = this._lastLivePolledBlock + 1;
        const toBlock = blockNumber;

        if (fromBlock <= toBlock) {
          await this._pollLiveRange(fromBlock, toBlock);
          this._lastLivePolledBlock = toBlock;
        }

        const finalizedUpTo = blockNumber - 1;
        await this._advanceSafeCheckpointFromAcks(finalizedUpTo);

        if (
          !this._replayInProgress &&
          (blockNumber - this._lastSafeCheckpointBlock >= CHECKPOINT_INTERVAL_BLOCKS)
        ) {
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
        this._seedAckStateForRange(from, to);

        for (const event of allEvents) {
          this._trackLiveEventSeen(event);
          const success = await this._processEventWithRetry(event);
          if (success) this._trackLiveEventAck(event);
          else this._markBlockUnsafe(event.blockNumber);
        }
      } catch (err) {
        this._seedAckStateForRange(from, to);
        this._markRangeUnsafe(from, to);
        throw err;
      }
    }
  }

  _ensureBlockAckState(blockNumber) {
    const existing = this._blockAcks.get(blockNumber);
    if (existing) return existing;

    const state = { seen: new Set(), acked: new Set(), unsafe: false };
    this._blockAcks.set(blockNumber, state);
    return state;
  }

  _seedAckStateForRange(fromBlock, toBlock) {
    for (let b = fromBlock; b <= toBlock; b += 1) {
      this._ensureBlockAckState(b);
    }
  }

  _markRangeUnsafe(fromBlock, toBlock) {
    for (let b = fromBlock; b <= toBlock; b += 1) {
      this._markBlockUnsafe(b);
    }
  }

  async _updateSafeCheckpointIfHigher(blockNumber) {
    const redis = getRedisClient();
    const current = parseInt(await redis.get(LAST_SAFE_BLOCK_KEY) || await redis.get(CHECKPOINT_KEY) || "0");

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
        throw new Error(
          `[Worker] Checkpoint current block'u aşıyor: checkpoint=${checkpoint} current=${currentBlock}`
        );
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
      throw new Error(
        `[Worker] Başlangıç bloğu current block'tan büyük olamaz: start=${configuredStart} current=${currentBlock}`
      );
    }

    return configuredStart;
  }

  _getEventId(event) {
    return `${event?.transactionHash || "unknown_tx"}:${Number.isInteger(event?.logIndex) ? event.logIndex : -1}`;
  }

  _trackLiveEventSeen(event) {
    const state = this._ensureBlockAckState(event.blockNumber);
    state.seen.add(this._getEventId(event));
  }

  _trackLiveEventAck(event) {
    const state = this._ensureBlockAckState(event.blockNumber);
    state.acked.add(this._getEventId(event));
  }

  _markBlockUnsafe(blockNumber) {
    const state = this._ensureBlockAckState(blockNumber);
    state.unsafe = true;
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

  async _reconnect() {
    if (this._reconnectPromise) return this._reconnectPromise;

    this._reconnectPromise = (async () => {
      this._setState("reconnecting", "provider error sonrası yeniden bağlanma");

      if (this.provider) {
        try {
          this.provider.removeAllListeners();
          if (this.provider.destroy) await this.provider.destroy();
        } catch (_) {}
        this.provider = null;
        this.contract = null;
        this._listenersAttached = false;
        this._livePollInProgress = false;
        this._blockTimestampCache.clear();
      }

      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      await this._connect();
      await this._replayMissedEvents();

      if (this.provider) this._lastLivePolledBlock = await this.provider.getBlockNumber();
      if (this.contract) this._attachLiveListeners();
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
      return { success: true };
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        return this._processEventWithRetryNoDLQ(event, attempt + 1);
      }
      return { success: false, error: err.message };
    }
  }

  async _addToDLQ(event, errorMsg) {
    const redis = getRedisClient();
    const nowIso = new Date().toISOString();

    const entry = JSON.stringify({
      eventName: event.eventName,
      txHash: event.transactionHash,
      logIndex: event.logIndex ?? null,
      idempotencyKey: this._getEventId(event),
      blockNumber: event.blockNumber,
      namedArgs: Object.fromEntries(
        Object.entries(event.args || {}).filter(([k]) => Number.isNaN(Number(k)))
      ),
      args: Array.isArray(event.args)
        ? event.args.map((a) => _toStr(a))
        : Object.values(event.args || {}).map((a) => _toStr(a)),
      attempt: 0,
      next_retry_at: nowIso,
      first_seen_at: nowIso,
      last_error: errorMsg,
    });

    await redis.rPush(DLQ_KEY, entry);
  }

  async reDriveEvent(entry) {
    const event = {
      eventName: entry.eventName,
      transactionHash: entry.txHash,
      logIndex: entry.logIndex ?? -1,
      blockNumber: entry.blockNumber,
      args: entry.namedArgs || {},
    };

    const result = await this._processEventWithRetryNoDLQ(event);
    if (!result.success) this._markBlockUnsafe(event.blockNumber);
    return result;
  }

  async _fetchTradeFromChain(tradeId) {
    return this.contract.getTrade(tradeId);
  }

  async _fetchOrderFromChain(orderId) {
    return this.contract.getOrder(orderId);
  }

  async _fetchReputationFromChain(wallet) {
    return this.contract.getReputation(wallet);
  }

  async _upsertOrderMirror(orderData, opts = {}) {
    const orderId = _toNum(orderData.id);
    const payload = {
      onchain_order_id: orderId,
      owner_address: orderData.owner.toLowerCase(),
      side: _normalizeSide(orderData.side),
      status: _normalizeOrderState(orderData.state),
      tier: _toNum(orderData.tier),
      token_address: orderData.tokenAddress.toLowerCase(),
      market: {
        crypto_asset: _inferCryptoAssetFromToken(orderData.tokenAddress),
      },
      amounts: {
        total_amount: _toStr(orderData.totalAmount),
        total_amount_num: _toSafeNum(orderData.totalAmount),
        remaining_amount: _toStr(orderData.remainingAmount),
        remaining_amount_num: _toSafeNum(orderData.remainingAmount),
        min_fill_amount: _toStr(orderData.minFillAmount),
        min_fill_amount_num: _toSafeNum(orderData.minFillAmount),
      },
      reserves: {
        remaining_maker_bond_reserve: _toStr(orderData.remainingMakerBondReserve),
        remaining_maker_bond_reserve_num: _toSafeNum(orderData.remainingMakerBondReserve),
        remaining_taker_bond_reserve: _toStr(orderData.remainingTakerBondReserve),
        remaining_taker_bond_reserve_num: _toSafeNum(orderData.remainingTakerBondReserve),
      },
      fee_snapshot: {
        taker_fee_bps: _toNum(orderData.takerFeeBpsSnapshot),
        maker_fee_bps: _toNum(orderData.makerFeeBpsSnapshot),
      },
      refs: {
        order_ref: (_toStr(orderData.orderRef) || "").toLowerCase(),
      },
      "timers.created_at_onchain": opts.createdAt || undefined,
      "timers.last_filled_at": opts.lastFilledAt || undefined,
      "timers.canceled_at": opts.canceledAt || undefined,
    };

    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

    await Order.findOneAndUpdate(
      { onchain_order_id: orderId },
      {
        $set: payload,
        $setOnInsert: {
          stats: {
            child_trade_count: 0,
            active_child_trade_count: 0,
            resolved_child_trade_count: 0,
            canceled_child_trade_count: 0,
            burned_child_trade_count: 0,
            total_filled_amount: "0",
            total_filled_amount_num: 0,
          },
        },
      },
      {
        upsert: true,
        session: opts.session,
        setDefaultsOnInsert: true,
      }
    );
  }

  async _upsertTradeMirror(tradeData, opts = {}) {
    const tradeId = _toNum(tradeData.id);
    const parentOrderId = _toNum(tradeData.parentOrderId);
    const parentOrder =
      opts.parentOrder || (parentOrderId > 0 ? await this._fetchOrderFromChain(parentOrderId) : null);

    const tradeOrigin = parentOrderId > 0 ? "ORDER_CHILD" : "DIRECT_ESCROW";
    const parentOrderSide = parentOrder ? _normalizeSide(parentOrder.side) : null;
    const orderRef = parentOrder ? _toStr(parentOrder.orderRef).toLowerCase() : null;

    const setPayload = {
      onchain_escrow_id: tradeId,
      parent_order_id: parentOrderId || null,
      trade_origin: tradeOrigin,
      parent_order_side: parentOrderSide,
      maker_address: tradeData.maker.toLowerCase(),
      taker_address:
        tradeData.taker && tradeData.taker !== ethers.ZeroAddress
          ? tradeData.taker.toLowerCase()
          : null,
      token_address: tradeData.tokenAddress.toLowerCase(),
      canonical_refs: {
        listing_ref: opts.listingRef || null,
        order_ref: orderRef,
      },
      fee_snapshot: {
        taker_fee_bps: _toNum(tradeData.takerFeeBpsSnapshot),
        maker_fee_bps: _toNum(tradeData.makerFeeBpsSnapshot),
      },
      financials: {
        crypto_amount: _toStr(tradeData.cryptoAmount),
        crypto_amount_num: _toSafeNum(tradeData.cryptoAmount),
        maker_bond: _toStr(tradeData.makerBond),
        maker_bond_num: _toSafeNum(tradeData.makerBond),
        taker_bond: _toStr(tradeData.takerBond),
        taker_bond_num: _toSafeNum(tradeData.takerBond),
        crypto_asset: _inferCryptoAssetFromToken(tradeData.tokenAddress),
      },
      tier: _toNum(tradeData.tier),
      status: _normalizeTradeState(tradeData.state),
      pinged_by_taker: Boolean(tradeData.pingedByTaker),
      challenge_pinged_by_maker: Boolean(tradeData.challengePingedByMaker),
      evidence: {
        ipfs_receipt_hash: tradeData.ipfsReceiptHash || null,
      },
    };

    _setIfDefined(setPayload, "timers.created_at_onchain", opts.createdAt);
    _setIfDefined(setPayload, "timers.resolved_at", opts.resolvedAt);

    const lockedAt = _toDateOrNull(tradeData.lockedAt);
    const paidAt = _toDateOrNull(tradeData.paidAt);
    const challengedAt = _toDateOrNull(tradeData.challengedAt);
    const pingedAt = _toDateOrNull(tradeData.pingedAt);
    const challengePingedAt = _toDateOrNull(tradeData.challengePingedAt);

    if (lockedAt) setPayload["timers.locked_at"] = lockedAt;
    if (paidAt) setPayload["timers.paid_at"] = paidAt;
    if (challengedAt) setPayload["timers.challenged_at"] = challengedAt;
    if (pingedAt) setPayload["timers.pinged_at"] = pingedAt;
    if (challengePingedAt) setPayload["timers.challenge_pinged_at"] = challengePingedAt;

    if (opts.fillAmount !== undefined) {
      setPayload.fill_metadata = {
        fill_amount: _toStr(opts.fillAmount),
        fill_amount_num: _toSafeNum(opts.fillAmount),
        filler_address: opts.filler?.toLowerCase() || null,
        remaining_amount_after_fill: _toStr(opts.remainingAmountAfterFill ?? 0),
        remaining_amount_after_fill_num: _toSafeNum(opts.remainingAmountAfterFill ?? 0),
      };
    }

    const result = await Trade.findOneAndUpdate(
      { onchain_escrow_id: tradeId },
      { $set: setPayload },
      {
        upsert: true,
        new: true,
        includeResultMetadata: true,
        session: opts.session,
        setDefaultsOnInsert: true,
      }
    );

    const inserted =
      result?.lastErrorObject?.upserted !== undefined ||
      result?.lastErrorObject?.updatedExisting === false;

    return {
      inserted,
      doc: result?.value || null,
    };
  }

  async _incrementOrderFillStatsAtomically(orderId, fillAmount, session) {
    if (!orderId) return;

    const fillAmountStr = _toStr(fillAmount);
    const fillAmountNum = _toSafeNum(fillAmount);

    await Order.updateOne(
      { onchain_order_id: orderId },
      [
        {
          $set: {
            "stats.child_trade_count": {
              $add: [{ $ifNull: ["$stats.child_trade_count", 0] }, 1],
            },
            "stats.active_child_trade_count": {
              $add: [{ $ifNull: ["$stats.active_child_trade_count", 0] }, 1],
            },
            "stats.resolved_child_trade_count": {
              $ifNull: ["$stats.resolved_child_trade_count", 0],
            },
            "stats.canceled_child_trade_count": {
              $ifNull: ["$stats.canceled_child_trade_count", 0],
            },
            "stats.burned_child_trade_count": {
              $ifNull: ["$stats.burned_child_trade_count", 0],
            },
            "stats.total_filled_amount": {
              $toString: {
                $add: [
                  { $toDecimal: { $ifNull: ["$stats.total_filled_amount", "0"] } },
                  { $toDecimal: fillAmountStr },
                ],
              },
            },
            "stats.total_filled_amount_num": fillAmountNum === null
              ? { $ifNull: ["$stats.total_filled_amount_num", null] }
              : { $add: [{ $ifNull: ["$stats.total_filled_amount_num", 0] }, fillAmountNum] },
          },
        },
      ],
      { session }
    );
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
      OrderCreated: this._onOrderCreated.bind(this),
      OrderFilled: this._onOrderFilled.bind(this),
      OrderCanceled: this._onOrderCanceled.bind(this),
      FeeConfigUpdated: this._onFeeConfigUpdated.bind(this),
      CooldownConfigUpdated: this._onCooldownConfigUpdated.bind(this),
      TokenConfigUpdated: this._onTokenConfigUpdated.bind(this),
    };

    const handler = handlers[event.eventName];
    if (handler) await handler(event);
  }

  async _onWalletRegistered(event) {
    const { wallet } = event.args;
    const registeredAt = await this._getEventDate(event, event.args?.timestamp);

    await User.findOneAndUpdate(
      { wallet_address: wallet.toLowerCase() },
      {
        $setOnInsert: { wallet_address: wallet.toLowerCase() },
        $set: { last_onchain_sync_at: registeredAt },
      },
      { upsert: true }
    );
  }

  async _onOrderCreated(event) {
    const { orderId } = event.args;
    const createdAt = await this._getEventDate(event);
    const orderData = await this._fetchOrderFromChain(orderId);
    await this._upsertOrderMirror(orderData, { createdAt });
  }

  async _onOrderFilled(event) {
    const { orderId, tradeId, filler, fillAmount, remainingAmount, childListingRef } = event.args;
    const fillEventAt = await this._getEventDate(event);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const [orderData, tradeData] = await Promise.all([
        this._fetchOrderFromChain(orderId),
        this._fetchTradeFromChain(tradeId),
      ]);

      await this._upsertOrderMirror(orderData, {
        lastFilledAt: fillEventAt,
        session,
      });

      const tradeUpsert = await this._upsertTradeMirror(tradeData, {
        parentOrder: orderData,
        createdAt: fillEventAt,
        listingRef: childListingRef ? _toStr(childListingRef).toLowerCase() : null,
        fillAmount,
        filler,
        remainingAmountAfterFill: remainingAmount,
        session,
      });

      // [TR] V3 child trade LOCKED snapshot'i artık OrderFilled akışında da capture edilir.
      //      Böylece EscrowLocked event'i gelmese bile mirror LOCKED + payout snapshot
      //      alanları eksiksiz oluşur.
      // [EN] Capture LOCKED snapshot directly in OrderFilled flow for V3-native child trades.
      await this._captureLockedTradeSnapshot({
        tradeId: _toNum(tradeId),
        lockedAt: _toDateOrNull(tradeData.lockedAt) || fillEventAt,
        makerAddress: tradeUpsert?.doc?.maker_address || tradeData.maker?.toLowerCase?.() || null,
        takerAddress:
          tradeUpsert?.doc?.taker_address ||
          (tradeData.taker && tradeData.taker !== ethers.ZeroAddress
            ? tradeData.taker.toLowerCase()
            : null),
        session,
      });

      if (tradeUpsert.inserted) {
        await this._incrementOrderFillStatsAtomically(
          _toNum(orderId),
          fillAmount,
          session
        );
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async _onOrderCanceled(event) {
    const { orderId } = event.args;
    const canceledAt = await this._getEventDate(event);
    const orderData = await this._fetchOrderFromChain(orderId);
    await this._upsertOrderMirror(orderData, { canceledAt });
  }

  async _onEscrowCreated(event) {
    const { tradeId, listingRef } = event.args;
    const createdAt = await this._getEventDate(event);
    const tradeData = await this._fetchTradeFromChain(tradeId);
    const parentOrderId = _toNum(tradeData.parentOrderId);
    const parentOrder = parentOrderId > 0 ? await this._fetchOrderFromChain(parentOrderId) : null;
    const normalizedListingRef = listingRef ? _toStr(listingRef).toLowerCase() : null;

    await this._upsertTradeMirror(tradeData, {
      parentOrder,
      createdAt,
      listingRef: normalizedListingRef,
    });
  }

  async _onEscrowLocked(event, attempt = 1) {
    const { tradeId, taker } = event.args;
    const lockedAt = await this._getEventDate(event);
    const tradeIdNum = _toNum(tradeId);

    const trade = await Trade.findOne({ onchain_escrow_id: tradeIdNum })
      .select("maker_address taker_address status")
      .lean();

    if (!trade) {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        return this._onEscrowLocked(event, attempt + 1);
      }
      await this._addToDLQ(event, "EscrowLocked geldi ama trade mirror bulunamadı.");
      throw new Error("EscrowLocked geldi ama trade mirror bulunamadı.");
    }

    if (!LOCKABLE_TRADE_STATES.has(trade.status)) {
      logger.warn(
        `[Worker] EscrowLocked monotonic-skip: trade=${tradeIdNum} current_status=${trade.status}`
      );
      return;
    }
    await this._captureLockedTradeSnapshot({
      tradeId: tradeIdNum,
      lockedAt,
      makerAddress: trade.maker_address,
      takerAddress: taker.toLowerCase(),
    });
  }

  async _captureLockedTradeSnapshot({
    tradeId,
    lockedAt,
    makerAddress,
    takerAddress,
    session,
  }) {
    const tradeIdNum = _toNum(tradeId);
    if (!tradeIdNum) return;

    const normalizedMaker = makerAddress?.toLowerCase?.() || null;
    const normalizedTaker = takerAddress?.toLowerCase?.() || null;

    const [makerUser, takerUser] = await Promise.all([
      normalizedMaker
        ? User.findOne({ wallet_address: normalizedMaker })
            .select("payout_profile bankChangeCount7d bankChangeCount30d lastBankChangeAt")
            .lean()
        : null,
      normalizedTaker
        ? User.findOne({ wallet_address: normalizedTaker })
            .select("payout_profile bankChangeCount7d bankChangeCount30d lastBankChangeAt")
            .lean()
        : null,
    ]);

    const makerProfile = makerUser?.payout_profile || null;
    const takerProfile = takerUser?.payout_profile || null;

    const snapshotComplete =
      _hasRequiredPayoutSnapshot(makerProfile) && _hasRequiredPayoutSnapshot(takerProfile);
    const incompleteReasons = [];
    if (!_hasRequiredPayoutSnapshot(makerProfile)) incompleteReasons.push("maker_payout_profile_missing");
    if (!_hasRequiredPayoutSnapshot(takerProfile)) incompleteReasons.push("taker_payout_profile_missing");
    const incompleteReason = incompleteReasons.length > 0 ? incompleteReasons.join(",") : null;

    const updateSet = {
      status: "LOCKED",
      "timers.locked_at": lockedAt,
      "payout_snapshot.maker.rail": makerProfile?.rail || null,
      "payout_snapshot.maker.country": makerProfile?.country || null,
      "payout_snapshot.maker.contact_channel": makerProfile?.contact?.channel || null,
      "payout_snapshot.maker.contact_value_enc": makerProfile?.contact?.value_enc || null,
      "payout_snapshot.maker.payout_details_enc": makerProfile?.payout_details_enc || null,
      "payout_snapshot.maker.fingerprint_hash_at_lock": makerProfile?.fingerprint?.hash || null,
      "payout_snapshot.maker.profile_version_at_lock": makerProfile?.fingerprint?.version ?? 0,
      "payout_snapshot.maker.bank_change_count_7d_at_lock": makerUser?.bankChangeCount7d ?? null,
      "payout_snapshot.maker.bank_change_count_30d_at_lock": makerUser?.bankChangeCount30d ?? null,
      "payout_snapshot.maker.last_bank_change_at_at_lock": makerUser?.lastBankChangeAt ?? null,

      "payout_snapshot.taker.rail": takerProfile?.rail || null,
      "payout_snapshot.taker.country": takerProfile?.country || null,
      "payout_snapshot.taker.contact_channel": takerProfile?.contact?.channel || null,
      "payout_snapshot.taker.contact_value_enc": takerProfile?.contact?.value_enc || null,
      "payout_snapshot.taker.payout_details_enc": takerProfile?.payout_details_enc || null,
      "payout_snapshot.taker.fingerprint_hash_at_lock": takerProfile?.fingerprint?.hash || null,
      "payout_snapshot.taker.profile_version_at_lock": takerProfile?.fingerprint?.version ?? 0,
      "payout_snapshot.taker.bank_change_count_7d_at_lock": takerUser?.bankChangeCount7d ?? null,
      "payout_snapshot.taker.bank_change_count_30d_at_lock": takerUser?.bankChangeCount30d ?? null,
      "payout_snapshot.taker.last_bank_change_at_at_lock": takerUser?.lastBankChangeAt ?? null,
      "payout_snapshot.captured_at": lockedAt,
      "payout_snapshot.snapshot_delete_at": new Date(lockedAt.getTime() + 30 * 24 * 3600 * 1000),
      "payout_snapshot.is_complete": snapshotComplete,
      "payout_snapshot.incomplete_reason": incompleteReason,
    };

    if (normalizedTaker) {
      updateSet.taker_address = normalizedTaker;
    }

    await Trade.findOneAndUpdate(
      {
        onchain_escrow_id: tradeIdNum,
        // [TR] Monotonic state kuralı:
        //      EscrowLocked yalnız OPEN/LOCKED trade'i etkileyebilir.
        //      PAID/CHALLENGED vb. ileri state'leri geriye sarmayız.
        // [EN] Enforce monotonicity for delayed/replayed EscrowLocked events.
        status: { $in: ["OPEN", "LOCKED"] },
      },
      { $set: updateSet },
      { session }
    );

    if (!snapshotComplete) {
      logger.error(`[Worker] LOCKED snapshot incomplete: trade=${tradeIdNum} reason=${incompleteReason}`);
    }
  }

  async _onPaymentReported(event) {
    const { tradeId, ipfsHash, timestamp } = event.args;
    const reportedAt = await this._getEventDate(event, timestamp);
    const canonicalHash = _toStr(ipfsHash);

    await Trade.findOneAndUpdate(
      {
        onchain_escrow_id: _toNum(tradeId),
        status: { $in: ["LOCKED", "PAID"] },
      },
      {
        $set: {
          status: "PAID",
          "evidence.ipfs_receipt_hash": canonicalHash,
          "evidence.receipt_timestamp": reportedAt,
          "timers.paid_at": reportedAt,
        },
      }
    );
  }

  async _onEscrowReleased(event) {
    const { tradeId } = event.args;
    const resolvedAt = await this._getEventDate(event);
    const tradeIdNum = _toNum(tradeId);
    const tradeData = await this._fetchTradeFromChain(tradeId);
    const wasDisputed = _toNum(tradeData.challengedAt) > 0;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const trade = await Trade.findOneAndUpdate(
        {
          onchain_escrow_id: tradeIdNum,
          status: { $in: ["LOCKED", "PAID", "CHALLENGED"] },
        },
        {
          $set: {
            status: "RESOLVED",
            "timers.resolved_at": resolvedAt,
            "evidence.receipt_delete_at": new Date(resolvedAt.getTime() + 24 * 3600 * 1000),
          },
        },
        { new: true, session }
      );

      if (!trade) {
        await session.abortTransaction();
        return;
      }

      if (wasDisputed && trade.maker_address) {
        const scoreType = "unjust_challenge";
        const score = FAILURE_SCORE_WEIGHTS[scoreType];

        await User.findOneAndUpdate(
          { wallet_address: trade.maker_address },
          {
            $inc: { "reputation_cache.failure_score": score },
            $push: {
              reputation_history: {
                $each: [{ type: scoreType, score, date: resolvedAt, tradeId: tradeIdNum }],
                $slice: -MAX_REPUTATION_HISTORY,
              },
            },
            $set: { last_onchain_sync_at: resolvedAt },
          },
          { session }
        );
      }

      if (trade.parent_order_id) {
        await Order.findOneAndUpdate(
          { onchain_order_id: trade.parent_order_id },
          {
            $inc: {
              "stats.active_child_trade_count": -1,
              "stats.resolved_child_trade_count": 1,
            },
          },
          { session }
        );
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
    const { tradeId, timestamp } = event.args;
    const challengedAt = await this._getEventDate(event, timestamp);

    await Trade.findOneAndUpdate(
      {
        onchain_escrow_id: _toNum(tradeId),
        status: { $in: ["LOCKED", "PAID", "CHALLENGED"] },
      },
      {
        $set: {
          status: "CHALLENGED",
          "timers.challenged_at": challengedAt,
        },
      }
    );
  }

  async _onEscrowCanceled(event) {
    const { tradeId } = event.args;
    const canceledAt = await this._getEventDate(event);

    const trade = await Trade.findOneAndUpdate(
      {
        onchain_escrow_id: _toNum(tradeId),
        status: { $in: ["OPEN", "LOCKED", "PAID", "CHALLENGED"] },
      },
      {
        $set: {
          status: "CANCELED",
          "timers.resolved_at": canceledAt,
          "evidence.receipt_delete_at": new Date(canceledAt.getTime() + 24 * 3600 * 1000),
        },
      },
      { new: true }
    ).lean();

    if (trade?.parent_order_id) {
      await Order.findOneAndUpdate(
        { onchain_order_id: trade.parent_order_id },
        { $inc: { "stats.active_child_trade_count": -1, "stats.canceled_child_trade_count": 1 } }
      );
    }
  }

  async _onEscrowBurned(event) {
    const { tradeId } = event.args;
    const burnedAt = await this._getEventDate(event);
    const tradeIdNum = _toNum(tradeId);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const trade = await Trade.findOneAndUpdate(
        {
          onchain_escrow_id: tradeIdNum,
          status: { $in: ["LOCKED", "PAID", "CHALLENGED"] },
        },
        {
          $set: {
            status: "BURNED",
            "timers.resolved_at": burnedAt,
            "evidence.receipt_delete_at": new Date(burnedAt.getTime() + 30 * 24 * 3600 * 1000),
          },
        },
        { new: true, session }
      );

      if (trade) {
        const scoreType = "burned";
        const score = FAILURE_SCORE_WEIGHTS[scoreType];
        const addresses = [trade.maker_address, trade.taker_address].filter(Boolean);

        for (const addr of addresses) {
          await User.findOneAndUpdate(
            { wallet_address: addr },
            {
              $inc: { "reputation_cache.failure_score": score },
              $push: {
                reputation_history: {
                  $each: [{ type: scoreType, score, date: burnedAt, tradeId: tradeIdNum }],
                  $slice: -MAX_REPUTATION_HISTORY,
                },
              },
              $set: { last_onchain_sync_at: burnedAt },
            },
            { session }
          );
        }
      }

      if (trade?.parent_order_id) {
        await Order.findOneAndUpdate(
          { onchain_order_id: trade.parent_order_id },
          { $inc: { "stats.active_child_trade_count": -1, "stats.burned_child_trade_count": 1 } },
          { session }
        );
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
    const { tradeId, decayedAmount, timestamp } = event.args;
    const lastDecayAt = await this._getEventDate(event, timestamp);
    const tradeIdNum = _toNum(tradeId);
    const eventId = this._getEventId(event);
    const decayedAmountStr = _toStr(decayedAmount);
    const decayedAmountNum = _toSafeNum(decayedAmount);

    await Trade.updateOne(
      { onchain_escrow_id: tradeIdNum, "financials.decay_tx_hashes": { $ne: eventId } },
      [
        {
          $set: {
            "timers.last_decay_at": lastDecayAt,
            "financials.total_decayed": {
              $toString: {
                $add: [
                  { $toDecimal: { $ifNull: ["$financials.total_decayed", "0"] } },
                  { $toDecimal: decayedAmountStr },
                ],
              },
            },
            "financials.total_decayed_num": decayedAmountNum === null
              ? { $ifNull: ["$financials.total_decayed_num", null] }
              : { $add: [{ $ifNull: ["$financials.total_decayed_num", 0] }, decayedAmountNum] },
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
  }

  async _onCancelProposed(event) {
    const { tradeId, proposer } = event.args;
    const proposedAt = await this._getEventDate(event);
    const tradeData = await this._fetchTradeFromChain(tradeId);

    const proposerAddress = proposer.toLowerCase();
    const makerAddress = tradeData.maker.toLowerCase();
    const takerAddress =
      tradeData.taker && tradeData.taker !== ethers.ZeroAddress
        ? tradeData.taker.toLowerCase()
        : null;

    const update = {
      "cancel_proposal.proposed_by": proposerAddress,
      "cancel_proposal.proposed_at": proposedAt,
      "cancel_proposal.maker_signed": Boolean(tradeData.cancelProposedByMaker),
      "cancel_proposal.taker_signed": Boolean(tradeData.cancelProposedByTaker),
    };

    if (tradeData.cancelProposedByMaker && tradeData.cancelProposedByTaker) {
      update["cancel_proposal.approved_by"] = proposerAddress;
    } else if (proposerAddress !== makerAddress && proposerAddress === takerAddress) {
      update["cancel_proposal.approved_by"] = proposerAddress;
    }

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: _toNum(tradeId) },
      { $set: update }
    );
  }

  async _onMakerPinged(event) {
    const { tradeId, pinger, timestamp } = event.args;
    const pingAt = await this._getEventDate(event, timestamp);

    const trade = await Trade.findOne({ onchain_escrow_id: _toNum(tradeId) }).lean();
    if (!trade) {
      throw new Error("MakerPinged geldi ama trade mirror bulunamadı.");
    }
    if (!trade.taker_address) {
      throw new Error("taker_address henüz DB'de yok — EscrowLocked gecikmiş olabilir.");
    }

    const isTakerPing = pinger.toLowerCase() === trade.taker_address.toLowerCase();
    const updateFields = isTakerPing
      ? { "timers.pinged_at": pingAt, "pinged_by_taker": true }
      : { "timers.challenge_pinged_at": pingAt, "challenge_pinged_by_maker": true };

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: _toNum(tradeId) },
      { $set: updateFields }
    );
  }

  async _onReputationUpdated(event) {
    const { wallet, successful, failed, bannedUntil, effectiveTier } = event.args;
    const syncAt = await this._getEventDate(event);

    const totalTrades = _toNum(successful) + _toNum(failed);
    const successRate =
      totalTrades > 0 ? Math.round((_toNum(successful) / totalTrades) * 100) : 100;

    const banTimestamp = _toNum(bannedUntil);
    const isBanned = banTimestamp > Math.floor(Date.now() / 1000);

    let consecutiveBans = 0;
    try {
      const rep = await this._fetchReputationFromChain(wallet);
      if (rep && rep.consecutiveBans !== undefined) {
        consecutiveBans = _toNum(rep.consecutiveBans);
      }
    } catch (err) {
      logger.warn(`[Worker] getReputation backfill başarısız: wallet=${wallet} err=${err.message}`);
    }

    await User.findOneAndUpdate(
      { wallet_address: wallet.toLowerCase() },
      {
        $set: {
          "reputation_cache.success_rate": successRate,
          "reputation_cache.total_trades": totalTrades,
          "reputation_cache.successful_trades": _toNum(successful),
          "reputation_cache.failed_disputes": _toNum(failed),
          "reputation_cache.effective_tier": _toNum(effectiveTier),
          "is_banned": isBanned,
          "banned_until": isBanned ? new Date(banTimestamp * 1000) : null,
          "consecutive_bans": consecutiveBans,
          "last_onchain_sync_at": syncAt,
        },
      },
      { upsert: true }
    );
  }

  async _onFeeConfigUpdated(event) {
    const { takerFeeBps, makerFeeBps } = event.args;
    await updateCachedFeeConfig(takerFeeBps, makerFeeBps);
  }

  async _onCooldownConfigUpdated(event) {
    const { tier0TradeCooldown, tier1TradeCooldown } = event.args;
    await updateCachedCooldownConfig(tier0TradeCooldown, tier1TradeCooldown);
  }

  async _onTokenConfigUpdated(event) {
    const { token, supported, allowSellOrders, allowBuyOrders } = event.args;
    await updateCachedTokenConfig(token, { supported, allowSellOrders, allowBuyOrders });
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
