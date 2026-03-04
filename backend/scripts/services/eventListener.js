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
const ARAF_ABI = [
  "event WalletRegistered(address indexed wallet, uint256 timestamp)",
  "event EscrowCreated(uint256 indexed tradeId, address indexed maker, address token, uint256 amount, uint8 tier)",
  "event EscrowLocked(uint256 indexed tradeId, address indexed taker, uint256 takerBond)",
  "event PaymentReported(uint256 indexed tradeId, string ipfsHash, uint256 timestamp)",
  "event EscrowReleased(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 fee)",
  "event DisputeOpened(uint256 indexed tradeId, address indexed challenger, uint256 timestamp)",
  "event EscrowCanceled(uint256 indexed tradeId, uint256 makerRefund, uint256 takerRefund)",
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
      "EscrowCreated", "EscrowLocked", "PaymentReported",
      "EscrowReleased", "DisputeOpened", "EscrowCanceled", "EscrowBurned",
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
      EscrowCreated:   this._onEscrowCreated.bind(this),
      EscrowLocked:    this._onEscrowLocked.bind(this),
      PaymentReported: this._onPaymentReported.bind(this),
      EscrowReleased:  this._onEscrowReleased.bind(this),
      DisputeOpened:   this._onDisputeOpened.bind(this),
      EscrowCanceled:  this._onEscrowCanceled.bind(this),
      EscrowBurned:    this._onEscrowBurned.bind(this),
    };

    const handler = handlers[event.eventName];
    if (handler) {
      await handler(event);
      logger.debug(`[Worker] Processed: ${event.eventName} tx=${event.transactionHash}`);
    }
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
          status:            "LOCKED",
          taker_address:     taker.toLowerCase(),
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

  async _incrementReputation(wallet, failed) {
    if (!wallet) return;
    const update = failed
      ? { $inc: { "reputation_cache.failed_disputes": 1 }, $set: { is_banned: true } }
      : { $inc: { "reputation_cache.total_trades": 1 } };
    await User.findOneAndUpdate({ wallet_address: wallet }, update, { upsert: true });
  }
}

// Singleton
const worker = new EventWorker();
module.exports = worker;
