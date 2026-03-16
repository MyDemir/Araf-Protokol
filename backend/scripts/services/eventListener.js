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
 *
 * AUDIT FIX B-01: queryFilter("*") kaldırıldı — event bazlı filtreleme.
 * AUDIT FIX B-03: reputation_cache $set yerine dot notation — failure_score korunur.
 * AUDIT FIX B-03: failure_score ve reputation_history artık aktif olarak yazılıyor.
 * AUDIT FIX B-04: Checkpoint sadece monoton artan şekilde güncellenir.
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

// AUDIT FIX B-03: failure_score ağırlıkları
// Ciddi olaylar daha yüksek puana sahiptir (User.js model yorumlarıyla uyumlu)
const FAILURE_SCORE_WEIGHTS = {
  burned:           50,  // BURNED — en ciddi: her iki taraf cezalanır
  unjust_challenge: 20,  // CHALLENGED → release — haksız itiraz
  passive_maker:    20,  // autoRelease — maker pasif kaldı
  failed_dispute:   20,  // Genel failed dispute (ReputationUpdated'dan tespit)
};

// AUDIT FIX B-01: Dinlenen event isimleri — queryFilter("*") yerine event bazlı filtreleme
const EVENT_NAMES = [
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

      // AUDIT FIX B-01: queryFilter("*") kaldırıldı.
      // ÖNCEKİ: const events = await this.contract.queryFilter("*", from, to);
      //   Sorun: TÜM event'leri çekiyordu — RPC rate limit, memory spike.
      // ŞİMDİ: Her event tipi ayrı ayrı filtrelenir, sonuçlar blok sırasına göre birleştirilir.
      const allEvents = [];
      for (const eventName of EVENT_NAMES) {
        try {
          const filtered = await this.contract.queryFilter(eventName, from, to);
          allEvents.push(...filtered);
        } catch (err) {
          logger.warn(`[Worker] Replay: ${eventName} sorgusu başarısız (blok ${from}-${to}): ${err.message}`);
        }
      }
      // Blok numarası ve log index sırasına göre sırala — event işleme sırası önemli
      allEvents.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

      for (const event of allEvents) {
        await this._processEvent(event);
      }

      // AUDIT FIX B-04: Monoton artan checkpoint — race condition önlemi
      await this._updateCheckpointIfHigher(to);
      logger.debug(`[Worker] Replayed blocks ${from}-${to} (${allEvents.length} events)`);
    }

    this._lastCheckpointBlock = toBlock;
    logger.info("[Worker] Replay complete.");
  }

  // ─── Live Event Listeners ──────────────────────────────────────────────────
  _attachLiveListeners() {
    if (!this.contract) return;

    for (const eventName of EVENT_NAMES) {
      this.contract.on(eventName, async (...args) => {
        const event = args[args.length - 1];
        await this._processEventWithRetry(event);

        // AUDIT FIX B-04: Event işlendiğinde checkpoint'i monoton artan şekilde güncelle
        await this._updateCheckpointIfHigher(event.blockNumber);
      });
    }

    // AFS-025 Fix: Checkpoint artık her blokta değil, sadece her N blokta yazılır.
    // Event işlendiğinde zaten checkpoint güncelleniyor (yukarıda).
    // Bu, event olmayan bloklarda gereksiz Redis yazımını önler.
    this.provider.on("block", async (blockNumber) => {
      if (blockNumber - this._lastCheckpointBlock >= CHECKPOINT_INTERVAL_BLOCKS) {
        // AUDIT FIX B-04: Monoton artan kontrol
        await this._updateCheckpointIfHigher(blockNumber);
      }
    });

    // Reconnect on provider error
    this.provider.on("error", async (err) => {
      logger.error(`[Worker] Provider error: ${err.message}. Reconnecting...`);
      await this._reconnect();
    });
  }

  /**
   * AUDIT FIX B-04: Checkpoint'i sadece mevcut değerden büyükse günceller.
   * ÖNCEKİ: redis.set(CHECKPOINT_KEY, blockNumber) — koşulsuz yazma.
   * Sorun: Geç işlenen event'ler checkpoint'i geri alabiliyordu. Restart sonrası
   * aradaki event'ler tekrar replay edilir (idempotent olmalı ama gereksiz yük).
   * ŞİMDİ: Sadece monoton artan güncelleme — checkpoint asla geri gitmez.
   */
  async _updateCheckpointIfHigher(blockNumber) {
    const redis = getRedisClient();
    const current = parseInt(await redis.get(CHECKPOINT_KEY) || "0");
    if (blockNumber > current) {
      await redis.set(CHECKPOINT_KEY, blockNumber.toString());
      this._lastCheckpointBlock = blockNumber;
    }
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
    let listing = await Listing.findOne({ onchain_escrow_id: Number(tradeId) }).lean();

    if (!listing) {
      // SORUN-08 Fix: Yeni açılan Escrow'u, bu Maker'ın henüz on-chain ID'si atanmamış en son ilanına bağla.
      listing = await Listing.findOne({
        maker_address: maker.toLowerCase(),
        onchain_escrow_id: null
      }).sort({ _id: -1 }).lean();

      if (listing) {
        await Listing.updateOne(
          { _id: listing._id },
          { $set: { onchain_escrow_id: Number(tradeId), status: "OPEN" } }
        );
      } else {
        logger.warn(`[Worker] EscrowCreated: Trade #${tradeId} için kaynak ilan bulunamadı. Varsayılan değerler kullanılıyor.`);
      }
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

    // AUDIT FIX B-03: Status değişiminden ÖNCE mevcut durumu oku —
    // CHALLENGED'dan release, maker'ın haksız challenge açtığını gösterir.
    const existingTrade = await Trade.findOne({ onchain_escrow_id: Number(tradeId) }).lean();
    const wasDisputed = existingTrade?.status === "CHALLENGED";

    const trade = await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: { status: "RESOLVED", "timers.resolved_at": new Date() } },
      { new: true }
    );

    if (!trade) {
      logger.warn(`[Worker] EscrowReleased: Trade #${tradeId} bulunamadı.`);
      return;
    }

    // AUDIT FIX B-03: Haksız challenge → maker failure_score + history
    if (wasDisputed && trade.maker_address) {
      const scoreType = "unjust_challenge";
      const score = FAILURE_SCORE_WEIGHTS[scoreType];
      await User.findOneAndUpdate(
        { wallet_address: trade.maker_address },
        {
          $inc:  { "reputation_cache.failure_score": score },
          $push: {
            reputation_history: {
              type:    scoreType,
              score:   score,
              date:    new Date(),
              tradeId: Number(tradeId),
            },
          },
        }
      );
      logger.info(`[Worker] Failure score updated: ${trade.maker_address} +${score} (${scoreType}) trade #${tradeId}`);
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
    const trade = await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: { status: "BURNED", "timers.resolved_at": new Date() } },
      { new: true }
    );

    // AUDIT FIX B-03: BURNED — her iki tarafa failure_score + history yazılır.
    // BURNED, en ciddi sonuçtur. User.js modelindeki yorum:
    // "'burned' gibi ciddi olaylar daha yüksek puana sahiptir"
    if (trade) {
      const scoreType = "burned";
      const score = FAILURE_SCORE_WEIGHTS[scoreType];
      const addresses = [trade.maker_address, trade.taker_address].filter(Boolean);

      for (const addr of addresses) {
        await User.findOneAndUpdate(
          { wallet_address: addr },
          {
            $inc:  { "reputation_cache.failure_score": score },
            $push: {
              reputation_history: {
                type:    scoreType,
                score:   score,
                date:    new Date(),
                tradeId: Number(tradeId),
              },
            },
          }
        );
      }
      logger.info(`[Worker] Burn failure scores: +${score} to ${addresses.length} parties, trade #${tradeId}`);
    }
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

  // GÖREV 2: _onMakerPinged Düzeltmesi
  async _onMakerPinged(event) {
    const { tradeId, pinger } = event.args;

    const trade = await Trade.findOne({
      onchain_escrow_id: Number(tradeId)
    }).lean();
    if (!trade) return;

    const isTakerPing = pinger.toLowerCase() === trade.taker_address?.toLowerCase();

    const updateFields = isTakerPing
      ? {
          "timers.pinged_at": new Date(),
          "pinged_by_taker": true
        }
      : {
          "timers.challenge_pinged_at": new Date(),
          "challenge_pinged_by_maker": true
        };

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: updateFields }
    );
  }

  /**
   * AFS-018 Fix: success_rate artık hesaplanıyor.
   * Önceki kod total_trades ve failed_disputes yazıyordu ama success_rate'i
   * hiç hesaplamıyordu. User modeli success_rate'i 100 varsayılan olarak
   * tanımlıyordu — UI'da her zaman %100 gösteriliyordu.
   *
   * AUDIT FIX B-03: $set: { "reputation_cache": {...} } kaldırıldı.
   * ÖNCEKİ: Tüm reputation_cache objesini yeni bir obje ile DEĞİŞTİRİYORDU.
   * Sorun: failure_score alanı bu güncellemede yer almadığı için her
   * ReputationUpdated event'inde 0'a sıfırlanıyordu → ölü alan.
   * ŞİMDİ: Dot notation ile sadece değişen alanlar güncellenir.
   * failure_score ve reputation_history korunur.
   */
  async _onReputationUpdated(event) {
    const { wallet, successful, failed, bannedUntil, effectiveTier } = event.args;

    const totalTrades    = Number(successful) + Number(failed);
    // AFS-018 Fix: success_rate hesaplaması eklendi
    const successRate    = totalTrades > 0
      ? Math.round((Number(successful) / totalTrades) * 100)
      : 100;

    // AUDIT FIX B-03: Dot notation — failure_score ve reputation_history korunur
    await User.findOneAndUpdate(
      { wallet_address: wallet.toLowerCase() },
      { $set: {
        "reputation_cache.success_rate":    successRate,
        "reputation_cache.total_trades":    totalTrades, // SORUN-09 FIX
        "reputation_cache.failed_disputes": Number(failed),
      }},
      { upsert: true }
    );
  }
}

// Singleton
const worker = new EventWorker();
module.exports = worker;
