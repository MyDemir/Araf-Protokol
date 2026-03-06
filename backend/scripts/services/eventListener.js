"use strict";

/**
 * Event Listener Worker — On-Chain ↔ MongoDB Sync Engine
 *
 * Listens to ArafEscrow contract events on Base and syncs MongoDB.
 *
 * Reliability features:
 *   - Checkpoint: last processed block saved in Redis
 *   - On restart: replays missed events from checkpoint
 *   - Dead Letter Queue: failed events retried 3x before alerting
 *   - Reconnect: auto-reconnects on provider failure
 */

const { ethers }         = require("ethers");
const { getRedisClient } = require("../config/redis");
const { Trade, Listing } = require("../models/Trade");
const User               = require("../models/User");
const logger             = require("../utils/logger");

const CHECKPOINT_KEY    = "worker:last_block";
const DLQ_KEY           = "worker:dlq";
const RETRY_DELAY_MS    = 5_000;
const MAX_RETRIES        = 3;
const BLOCK_BATCH_SIZE   = 1_000; // Process at most 1000 blocks at a time

// Minimal ABI — only the events we care about
// C-01 Fix: EscrowReleased event imzası düzeltildi — tek 'fee' yerine 'takerFee' + 'makerFee'
// Orijinal hatalı imza: "event EscrowReleased(..., uint256 fee)" → event decode edilemiyordu
// H-04 Fix: BleedingDecayed ve CancelProposed event'leri eklendi — önceden yoktu
const ARAF_ABI = [
  "event WalletRegistered(address indexed wallet, uint256 timestamp)",
  "event EscrowCreated(uint256 indexed tradeId, address indexed maker, address token, uint256 amount, uint8 tier)",
  "event EscrowLocked(uint256 indexed tradeId, address indexed taker, uint256 takerBond)",
  "event PaymentReported(uint256 indexed tradeId, string ipfsHash, uint256 timestamp)",
  "event EscrowReleased(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 takerFee, uint256 makerFee)",
  "event DisputeOpened(uint256 indexed tradeId, address indexed challenger, uint256 timestamp)",
  "event CancelProposed(uint256 indexed tradeId, address indexed proposer)",
  "event EscrowCanceled(uint256 indexed tradeId, uint256 makerRefund, uint256 takerRefund)",
  "event BleedingDecayed(uint256 indexed tradeId, uint256 decayedAmount, uint256 timestamp)",
  "event EscrowBurned(uint256 indexed tradeId, uint256 burnedAmount)",
];

class EventWorker {
  constructor() {
    this.provider  = null;
    this.contract  = null;
    this.isRunning = false;
  }

  async start() {
    logger.info("[Worker] Starting event listener...");
    this.isRunning = true;
    await this._connect();
    await this._replayMissedEvents();
    this._attachLiveListeners();
    logger.info("[Worker] Event listener active.");
  }

  async stop() {
    this.isRunning = false;
    if (this.provider) {
      this.provider.removeAllListeners();
    }
    logger.info("[Worker] Event listener stopped.");
  }

  async _connect() {
    const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
    const contractAddress = process.env.ARAF_ESCROW_ADDRESS;

    if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
      logger.warn("[Worker] ARAF_ESCROW_ADDRESS not set. Worker in dry-run mode.");
      return;
    }

    // Use WebSocketProvider for real-time events, JsonRpcProvider as fallback
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contract = new ethers.Contract(contractAddress, ARAF_ABI, this.provider);

    logger.info(`[Worker] Connected to Base at ${rpcUrl}`);
    logger.info(`[Worker] Watching contract: ${contractAddress}`);
  }

  // ─── Replay Missed Events ──────────────────────────────────────────────────
  async _replayMissedEvents() {
    if (!this.contract) return;

    const redis      = getRedisClient();
    const savedBlock = await redis.get(CHECKPOINT_KEY);
    const fromBlock  = savedBlock ? parseInt(savedBlock) + 1 : 0;
    const toBlock    = await this.provider.getBlockNumber();

    if (fromBlock > toBlock) {
      logger.info("[Worker] No missed events. Checkpoint is current.");
      return;
    }

    logger.info(`[Worker] Replaying events from block ${fromBlock} to ${toBlock}...`);

    // Process in batches to avoid RPC limits
    for (let from = fromBlock; from <= toBlock; from += BLOCK_BATCH_SIZE) {
      const to = Math.min(from + BLOCK_BATCH_SIZE - 1, toBlock);
      const events = await this.contract.queryFilter("*", from, to);

      for (const event of events) {
        await this._processEvent(event);
      }

      await redis.set(CHECKPOINT_KEY, to.toString());
      logger.debug(`[Worker] Replayed blocks ${from}-${to}`);
    }

    logger.info("[Worker] Replay complete.");
  }

  // ─── Live Event Listeners ──────────────────────────────────────────────────
  _attachLiveListeners() {
    if (!this.contract) return;

    const events = [
      "WalletRegistered", // L-04 Fix: WalletRegistered handler eklendi
      "EscrowCreated", "EscrowLocked", "PaymentReported",
      "EscrowReleased", "DisputeOpened",
      "CancelProposed",   // H-04 Fix: önceden dinlenmiyordu
      "EscrowCanceled",
      "BleedingDecayed",  // H-04 Fix: önceden dinlenmiyordu
      "EscrowBurned",
    ];

    for (const eventName of events) {
      this.contract.on(eventName, async (...args) => {
        const event = args[args.length - 1]; // Last arg is the event object
        await this._processEventWithRetry(event);
      });
    }

    // Update checkpoint on each new block
    this.provider.on("block", async (blockNumber) => {
      const redis = getRedisClient();
      await redis.set(CHECKPOINT_KEY, blockNumber.toString());
    });

    // Reconnect on provider error
    this.provider.on("error", async (err) => {
      logger.error(`[Worker] Provider error: ${err.message}. Reconnecting...`);
      await this._reconnect();
    });
  }

  async _reconnect() {
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    await this._connect();
    this._attachLiveListeners();
  }

  // ─── Event Processing with Retry ──────────────────────────────────────────
  async _processEventWithRetry(event, attempt = 1) {
    try {
      await this._processEvent(event);
    } catch (err) {
      logger.error(`[Worker] Failed to process ${event.eventName} (attempt ${attempt}): ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        await this._processEventWithRetry(event, attempt + 1);
      } else {
        // Dead Letter Queue — store for manual review
        await this._addToDLQ(event, err.message);
      }
    }
  }

  async _addToDLQ(event, errorMsg) {
    const redis = getRedisClient();
    const entry = JSON.stringify({
      eventName:   event.eventName,
      txHash:      event.transactionHash,
      blockNumber: event.blockNumber,
      args:        event.args?.map(a => a.toString()),
      error:       errorMsg,
      timestamp:   new Date().toISOString(),
    });
    await redis.lPush(DLQ_KEY, entry);
    logger.error(`[Worker] Event moved to DLQ: ${event.eventName} tx=${event.transactionHash}`);
  }

  // ─── Event Handlers ───────────────────────────────────────────────────────
  async _processEvent(event) {
    const handlers = {
      WalletRegistered: this._onWalletRegistered.bind(this), // L-04 Fix
      EscrowCreated:    this._onEscrowCreated.bind(this),
      EscrowLocked:     this._onEscrowLocked.bind(this),
      PaymentReported:  this._onPaymentReported.bind(this),
      EscrowReleased:   this._onEscrowReleased.bind(this),
      DisputeOpened:    this._onDisputeOpened.bind(this),
      CancelProposed:   this._onCancelProposed.bind(this),  // H-04 Fix
      EscrowCanceled:   this._onEscrowCanceled.bind(this),
      BleedingDecayed:  this._onBleedingDecayed.bind(this), // H-04 Fix
      EscrowBurned:     this._onEscrowBurned.bind(this),
    };

    const handler = handlers[event.eventName];
    if (handler) {
      await handler(event);
      logger.debug(`[Worker] Processed: ${event.eventName} tx=${event.transactionHash}`);
    }
  }

  // L-04 Fix: WalletRegistered event'i işleniyor — önceden handler yoktu
  async _onWalletRegistered(event) {
    const { wallet, timestamp } = event.args;
    await User.findOneAndUpdate(
      { wallet_address: wallet.toLowerCase() },
      { $setOnInsert: { wallet_address: wallet.toLowerCase() } },
      { upsert: true }
    );
    logger.info(`[Worker] Wallet registered on-chain: ${wallet.toLowerCase()}`);
  }

  async _onEscrowCreated(event) {
    const { tradeId, maker, amount, tier } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      {
        $setOnInsert: {
          onchain_escrow_id: Number(tradeId),
          maker_address:     maker.toLowerCase(),
          status:            "OPEN",
          tier:              Number(tier),
          financials: { crypto_amount: Number(amount), exchange_rate: 0, crypto_asset: "USDT", fiat_currency: "TRY" },
        },
      },
      { upsert: true }
    );
  }

  async _onEscrowLocked(event) {
    const { tradeId, taker } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      {
        $set: {
          status:             "LOCKED",
          taker_address:      taker.toLowerCase(),
          "timers.locked_at": new Date(),
        },
      }
    );
  }

  async _onPaymentReported(event) {
    const { tradeId, ipfsHash } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      {
        $set: {
          status:                       "PAID",
          "evidence.ipfs_receipt_hash": ipfsHash,
          "evidence.receipt_timestamp": new Date(),
          "timers.paid_at":             new Date(),
        },
      }
    );
  }

  async _onEscrowReleased(event) {
    // C-01 Fix: takerFee ve makerFee ayrı ayrı alınıyor (önceki: tek 'fee' parametresi vardı)
    const { tradeId, maker, taker } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: { status: "RESOLVED", "timers.resolved_at": new Date() } }
    );
    // Update reputation cache (on-chain is authoritative, this is display cache)
    await this._incrementReputation(maker.toLowerCase(), false);
    await this._incrementReputation(taker.toLowerCase(), false);
  }

  async _onDisputeOpened(event) {
    const { tradeId } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: { status: "CHALLENGED", "timers.challenged_at": new Date() } }
    );
  }

  async _onEscrowCanceled(event) {
    const { tradeId } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: { status: "CANCELED", "timers.resolved_at": new Date() } }
    );
  }

  async _onEscrowBurned(event) {
    const { tradeId } = event.args;
    const trade = await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: { status: "BURNED", "timers.resolved_at": new Date() } },
      { new: true }
    );
    if (trade) {
      await this._incrementReputation(trade.maker_address, true);
      await this._incrementReputation(trade.taker_address, true);
    }
  }

  // H-04 Fix: BleedingDecayed event handler — önceden yoktu.
  // Contract, her decay transferinde bu event'i emit eder.
  // MongoDB'de toplam eriymiş miktarı ve son decay zamanını izliyoruz (display cache).
  async _onBleedingDecayed(event) {
    const { tradeId, decayedAmount } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      {
        $set:  { "timers.last_decay_at": new Date() },
        $inc:  { "financials.total_decayed": Number(decayedAmount) },
      }
    );
    logger.debug(`[Worker] BleedingDecayed: trade=${tradeId} amount=${decayedAmount}`);
  }

  // H-04 Fix: CancelProposed event handler — önceden yoktu.
  // Contract, her cancel proposal imzasında bu event'i emit eder.
  // MongoDB cancel_proposal.proposed_at güncellenirse frontend'e doğru timestamp gösterilir.
  async _onCancelProposed(event) {
    const { tradeId, proposer } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      {
        $set: {
          "cancel_proposal.proposed_by": proposer.toLowerCase(),
          "cancel_proposal.proposed_at": new Date(),
        },
      }
    );
    logger.debug(`[Worker] CancelProposed: trade=${tradeId} proposer=${proposer}`);
  }

  /**
   * Reputation cache'ini günceller.
   * Autoritative değer on-chain'dedir; bu cache sadece hızlı UI render için.
   *
   * H-03 Fix: Escalating ban süresi ve tier demosyon eklendi.
   * Contract mantığı: 2+ failed dispute → ban tetiklenir.
   *   - 1. ban  : 30 gün  (consecutiveBans = 1, tier değişmez)
   *   - 2. ban  : 60 gün  (consecutiveBans = 2, maxAllowedTier -= 1)
   *   - 3. ban  : 120 gün (consecutiveBans = 3, maxAllowedTier -= 1)
   *   - N. ban  : 30 * 2^(N-1) gün, max 365 gün
   *
   * NOT: Gerçek ban süresi on-chain'den okunmalı. Bu sadece display cache.
   */
  async _incrementReputation(wallet, failed) {
    if (!wallet) return;

    if (failed) {
      // Önce mevcut durumu oku — ban hesabı için gerekli
      const user = await User.findOne({ wallet_address: wallet })
        .select("reputation_cache consecutive_bans max_allowed_tier")
        .lean();

      const currentFailed     = (user?.reputation_cache?.failed_disputes || 0) + 1;
      const currentConsec     = (user?.consecutive_bans || 0);
      const currentMaxTier    = (user?.max_allowed_tier ?? 4);

      const update = { $inc: { "reputation_cache.failed_disputes": 1 } };

      // 2+ failed dispute → ban tetiklenir
      if (currentFailed >= 2) {
        const newConsecBans = currentConsec + 1;

        // Artan ban süresi: 30 * 2^(newConsecBans-1) gün, max 365 gün
        const banDays    = Math.min(30 * Math.pow(2, newConsecBans - 1), 365);
        const bannedUntil = new Date(Date.now() + banDays * 24 * 3600 * 1000);

        update.$set = {
          is_banned:         true,
          banned_until:      bannedUntil,
          consecutive_bans:  newConsecBans,
        };

        // 2. ban ve sonrasında maxAllowedTier bir düşer (min 0)
        if (newConsecBans >= 2) {
          update.$set.max_allowed_tier = Math.max(0, currentMaxTier - 1);
        }

        logger.warn(
          `[Worker] Ban uygulandı: wallet=${wallet} consecutive=${newConsecBans} ` +
          `süre=${banDays}g tier_cap=${update.$set.max_allowed_tier ?? currentMaxTier}`
        );
      }

      await User.findOneAndUpdate({ wallet_address: wallet }, update, { upsert: true });

    } else {
      // H-04 Fix: success_rate doğru hesaplanıyor
      // Önceki: sadece total_trades artırılıyordu, success_rate hiç güncellenmiyordu
      const user = await User.findOneAndUpdate(
        { wallet_address: wallet },
        { $inc: { "reputation_cache.total_trades": 1 } },
        { upsert: true, new: true }
      );
      if (user) {
        const total  = user.reputation_cache.total_trades;
        const failed = user.reputation_cache.failed_disputes || 0;
        const rate   = total > 0 ? Math.round(((total - failed) / total) * 100) : 100;
        await User.updateOne(
          { wallet_address: wallet },
          { $set: { "reputation_cache.success_rate": rate } }
        );
      }
    }
  }
}

// Singleton
const worker = new EventWorker();
module.exports = worker;
