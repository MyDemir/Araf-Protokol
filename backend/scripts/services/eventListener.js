"use strict";

/**
 * Event Listener Worker — On-Chain ↔ MongoDB Sync Engine
 *
 * Listens to ArafEscrow contract events on Base and syncs MongoDB.
 *
 * Reliability features:
 * - Checkpoint: last processed block saved in Redis
 * - On restart: replays missed events from checkpoint
 * - Dead Letter Queue: failed events retried 3x before alerting
 * - Reconnect: auto-reconnects on provider failure
 *
 * AFS-018 Fix: _onReputationUpdated artık success_rate hesaplıyor.
 * AFS-025 Fix: Checkpoint yazımı her blokta değil, sadece event işlendiğinde yapılır.
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
const BLOCK_BATCH_SIZE   = 1_000;
// AFS-025 Fix: Checkpoint yazım sıklığı — her N blokta bir (event olmasa bile)
const CHECKPOINT_INTERVAL_BLOCKS = 50;

// Minimal ABI — only the events we care about
const ARAF_ABI = [
  "event WalletRegistered(address indexed wallet, uint256 timestamp)",
  "event EscrowCreated(uint256 indexed tradeId, address indexed maker, address token, uint256 amount, uint8 tier)",
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
];

class EventWorker {
  constructor() {
    this.provider  = null;
    this.contract  = null;
    this.isRunning = false;
    // AFS-025 Fix: Son checkpoint yazılan blok numarası
    this._lastCheckpointBlock = 0;
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
      if (process.env.NODE_ENV === "production") {
        logger.error(
          "[Worker] KRİTİK: ARAF_ESCROW_ADDRESS tanımlı değil veya sıfır adres! " +
          "Production'da event listener olmadan çalışmak güvenli değil. " +
          "Sunucu durduruluyor."
        );
        process.exit(1);
      }
      logger.warn("[Worker] ARAF_ESCROW_ADDRESS not set. Worker in dry-run mode (development only).");
      return;
    }

    const wsRpcUrl = process.env.BASE_WS_RPC_URL;

    if (wsRpcUrl && wsRpcUrl.startsWith("wss://")) {
      try {
        this.provider = new ethers.WebSocketProvider(wsRpcUrl);
        logger.info(`[Worker] WebSocket RPC bağlantısı kuruldu: ${wsRpcUrl.split("/v2/")[0]}`);
      } catch (wsErr) {
        logger.warn(`[Worker] WebSocket bağlantısı başarısız, HTTP fallback kullanılıyor: ${wsErr.message}`);
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
      }
    } else {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      if (process.env.NODE_ENV === "production") {
        logger.warn(
          "[Worker] ⚠ HTTP RPC kullanılıyor. Gerçek zamanlı event dinleme için " +
          "BASE_WS_RPC_URL ortam değişkenine wss:// URL ekleyin."
        );
      }
    }

    this.contract = new ethers.Contract(contractAddress, ARAF_ABI, this.provider);
    logger.info(`[Worker] Connected to Base at ${wsRpcUrl || rpcUrl}`);
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

    for (let from = fromBlock; from <= toBlock; from += BLOCK_BATCH_SIZE) {
      const to = Math.min(from + BLOCK_BATCH_SIZE - 1, toBlock);
      const events = await this.contract.queryFilter("*", from, to);

      for (const event of events) {
        await this._processEvent(event);
      }

      await redis.set(CHECKPOINT_KEY, to.toString());
      logger.debug(`[Worker] Replayed blocks ${from}-${to}`);
    }

    this._lastCheckpointBlock = toBlock;
    logger.info("[Worker] Replay complete.");
  }

  // ─── Live Event Listeners ──────────────────────────────────────────────────
  _attachLiveListeners() {
    if (!this.contract) return;

    const events = [
      "WalletRegistered",
      "EscrowCreated", "EscrowLocked", "PaymentReported",
      "EscrowReleased", "DisputeOpened",
      "CancelProposed",
      "EscrowCanceled",
      "MakerPinged",
      "ReputationUpdated",
      "BleedingDecayed",
      "EscrowBurned",
    ];

    for (const eventName of events) {
      this.contract.on(eventName, async (...args) => {
        const event = args[args.length - 1];
        await this._processEventWithRetry(event);

        // AFS-025 Fix: Event işlendiğinde checkpoint'i güncelle
        const redis = getRedisClient();
        await redis.set(CHECKPOINT_KEY, event.blockNumber.toString());
      });
    }

    // AFS-025 Fix: Checkpoint artık her blokta değil, sadece her N blokta yazılır.
    // Event işlendiğinde zaten checkpoint güncelleniyor (yukarıda).
    // Bu, event olmayan bloklarda gereksiz Redis yazımını önler.
    this.provider.on("block", async (blockNumber) => {
      if (blockNumber - this._lastCheckpointBlock >= CHECKPOINT_INTERVAL_BLOCKS) {
        const redis = getRedisClient();
        await redis.set(CHECKPOINT_KEY, blockNumber.toString());
        this._lastCheckpointBlock = blockNumber;
      }
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
      WalletRegistered: this._onWalletRegistered.bind(this),
      EscrowCreated:    this._onEscrowCreated.bind(this),
      EscrowLocked:     this._onEscrowLocked.bind(this),
      PaymentReported:  this._onPaymentReported.bind(this),
      EscrowReleased:   this._onEscrowReleased.bind(this),
      DisputeOpened:    this._onDisputeOpened.bind(this),
      CancelProposed:   this._onCancelProposed.bind(this),
      EscrowCanceled:   this._onEscrowCanceled.bind(this),
      MakerPinged:      this._onMakerPinged.bind(this),
      ReputationUpdated: this._onReputationUpdated.bind(this),
      BleedingDecayed:  this._onBleedingDecayed.bind(this),
      EscrowBurned:     this._onEscrowBurned.bind(this),
    };

    const handler = handlers[event.eventName];
    if (handler) {
      await handler(event);
      logger.debug(`[Worker] Processed: ${event.eventName} tx=${event.transactionHash}`);
    }
  }

  async _onWalletRegistered(event) {
    const { wallet } = event.args;
    await User.findOneAndUpdate(
      { wallet_address: wallet.toLowerCase() },
      { $setOnInsert: { wallet_address: wallet.toLowerCase() } },
      { upsert: true }
    );
    logger.info(`[Worker] Wallet registered on-chain: ${wallet.toLowerCase()}`);
  }

  async _onEscrowCreated(event) {
    const { tradeId, maker, amount, tier } = event.args;
    const listing = await Listing.findOne({ onchain_escrow_id: Number(tradeId) }).lean();

    if (!listing) {
      logger.warn(`[Worker] EscrowCreated: Trade #${tradeId} için kaynak ilan bulunamadı. Varsayılan değerler kullanılıyor.`);
    }

    const financials = listing
      ? {
          crypto_amount: Number(amount),
          exchange_rate: listing.exchange_rate,
          crypto_asset:  listing.crypto_asset,
          fiat_currency: listing.fiat_currency,
        }
      : { crypto_amount: Number(amount), exchange_rate: 0, crypto_asset: "USDT", fiat_currency: "TRY" };

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      {
        $setOnInsert: {
          onchain_escrow_id: Number(tradeId),
          listing_id:        listing ? listing._id : null,
          maker_address:     maker.toLowerCase(),
          status:            "OPEN",
          tier:              Number(tier),
          financials:        financials,
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
    const { tradeId } = event.args;
    const trade = await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: { status: "RESOLVED", "timers.resolved_at": new Date() } },
      { new: true }
    );

    if (!trade) {
      logger.warn(`[Worker] EscrowReleased: Trade #${tradeId} bulunamadı.`);
      return;
    }
    // İtibar güncellemesi ReputationUpdated eventi ile tetikleniyor.
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
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: { status: "BURNED", "timers.resolved_at": new Date() } },
      { new: true }
    );
  }

  async _onBleedingDecayed(event) {
    const { tradeId, decayedAmount } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      {
        $set:  { "timers.last_decay_at": new Date() },
        $inc:  { "financials.total_decayed": Number(decayedAmount) },
      }
    );
  }

  async _onCancelProposed(event) {
    const { tradeId, proposer } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: { "cancel_proposal.proposed_by": proposer.toLowerCase(), "cancel_proposal.proposed_at": new Date() } }
    );
  }

  async _onMakerPinged(event) {
    const { tradeId } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: {
          "timers.pinged_at": new Date(),
          "pinged_by_taker": true,
        }
      },
    );
  }

  /**
   * AFS-018 Fix: success_rate artık hesaplanıyor.
   * Önceki kod total_trades ve failed_disputes yazıyordu ama success_rate'i
   * hiç hesaplamıyordu. User modeli success_rate'i 100 varsayılan olarak
   * tanımlıyordu — UI'da her zaman %100 gösteriliyordu.
   */
  async _onReputationUpdated(event) {
    const { wallet, successful, failed, bannedUntil, effectiveTier } = event.args;

    const totalTrades    = Number(successful) + Number(failed);
    // AFS-018 Fix: success_rate hesaplaması eklendi
    const successRate    = totalTrades > 0
      ? Math.round((Number(successful) / totalTrades) * 100)
      : 100;

    await User.findOneAndUpdate(
      { wallet_address: wallet.toLowerCase() },
      { $set: { "reputation_cache": {
          success_rate:    successRate,   // AFS-018 Fix
          total_trades:    Number(successful),
          failed_disputes: Number(failed),
          banned_until:    new Date(Number(bannedUntil) * 1000),
          effective_tier:  Number(effectiveTier),
      }}},
      { upsert: true }
    );
  }
}

// Singleton
const worker = new EventWorker();
module.exports = worker;
