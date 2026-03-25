"use strict";

/**
 * Event Listener Worker — On-Chain ↔ MongoDB Senkronizasyon Motoru
 *
 * KRİT-02 Fix: Kurbanı Cezalandıran İtibar Algoritması Düzeltildi.
 *   CHALLENGED→RESOLVED = Maker parayı serbest bıraktı = Maker haklıydı.
 *   ÖNCEKİ: Maker'ın failure_score'u artırılıyordu.
 *   ŞİMDİ: Taker'ın (haksız itiraz açanın) failure_score'u artırılıyor.
 *
 * KRİT-08 Fix: Hardcoded USDT/TRY Fallback Kaldırıldı.
 *   ÖNCEKİ: Listing bulunamazsa exchange_rate:0, crypto_asset:"USDT", fiat_currency:"TRY"
 *   sabit yazılıyordu. Multi-token geldiğinde veri bozuluyordu.
 *   ŞİMDİ: Listing bulunamazsa işlem BEKLEMEDE bırakılıyor (retry), fallback hardcode yok.
 *
 * KRİT-09 Fix: LIFO Listing Eşleştirme Race Condition Azaltıldı.
 *   Batch transaction durumunda LIFO eşleştirme hâlâ riski var.
 *   Tam çözüm: on-chain createEscrow'a listing_id parametresi eklenmesi (kontrat değişikliği).
 *   Bu dosyada: Zaman penceresi daraltıldı + status:"OPEN" filtresi eklendi.
 *
 * KRİT-10 Fix: Checkpoint Zehirlenmesi Kapatıldı.
 *   ÖNCEKİ: Hata durumunda da checkpoint ilerletiliyordu — event'ler sessizce kayboluyordu.
 *   ŞİMDİ: Checkpoint YALNIZCA başarılı işlem sonrasında ilerletiliyor.
 *
 * KRİT-16 Fix: Zombi WebSocket Bellek Sızıntısı Kapatıldı.
 *   ÖNCEKİ: _reconnect() yeni provider oluştururken eskisini yok etmiyordu.
 *   ŞİMDİ: Reconnect öncesinde eski provider'ın tüm listener'ları temizleniyor + destroy().
 *
 * YÜKS-04 Fix: Atomik Olmayan DB Güncellemeleri — MongoDB Transactions Eklendi.
 *   EscrowReleased ve EscrowBurned'de Trade + User güncellemeleri artık atomik.
 *
 * YÜKS-05 Fix: Replay İdempotency — $inc Çakışması Kapatıldı.
 *   _onBleedingDecayed'e transactionHash bazlı tekrar işleme kontrolü eklendi.
 *
 * YÜKS-22 Fix: reputation_history Sınırsız Dizi Büyümesi Önlendi.
 *   $push yerine $push + $slice kullanılıyor — maksimum 100 kayıt tutulur.
 *
 * ORTA-06 Fix: IPFS Hash XSS Injection Koruması Eklendi.
 *   ipfsHash değeri CID formatı için doğrulanıyor.
 *
 * BACK-04 Fix: Ping Sınıflandırma Race Condition Azaltıldı.
 *   taker_address null ise pinger kontratdan yeniden okunmak yerine event bekleniliyor.
 *
 * FEL-08 Fix: Finansal Hassasiyet — Number() Yerine String Saklama.
 *   ÖNCEKİ: Number(amount) — JS Number max 2^53-1, büyük değerlerde hassasiyet kaybı.
 *   ŞİMDİ: amount.toString() — MongoDB'de String olarak saklanır, BigInt güvenli.
 */

const { ethers }         = require("ethers");
const mongoose           = require("mongoose");
const { getRedisClient } = require("../config/redis");
const { Trade, Listing } = require("../models/Trade");
const User               = require("../models/User");
const logger             = require("../utils/logger");

const CHECKPOINT_KEY             = "worker:last_block";      // legacy
const LAST_SAFE_BLOCK_KEY        = "worker:last_safe_block"; // canonical safe checkpoint
const DLQ_KEY                    = "worker:dlq";
const RETRY_DELAY_MS             = 5_000;
const MAX_RETRIES                = 3;
const BLOCK_BATCH_SIZE           = 1_000;
const CHECKPOINT_INTERVAL_BLOCKS = 50;
// YÜKS-22 Fix: reputation_history maksimum boyutu
const MAX_REPUTATION_HISTORY     = 100;

const FAILURE_SCORE_WEIGHTS = {
  burned:           50,
  unjust_challenge: 20,
  passive_maker:    20,
  failed_dispute:   20,
};

// ORTA-06 Fix: Geçerli IPFS CID formatları (v0 ve v1)
const CID_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58}|[a-f0-9]{64})$/;

const EVENT_NAMES = [
  "WalletRegistered",
  "EscrowCreated", "EscrowLocked", "PaymentReported",
  "EscrowReleased", "DisputeOpened",
  "CancelProposed", "EscrowCanceled",
  "MakerPinged", "ReputationUpdated",
  "BleedingDecayed", "EscrowBurned",
];

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

const EVENT_ARG_KEYS = {
  WalletRegistered:  ["wallet", "timestamp"],
  EscrowCreated:     ["tradeId", "maker", "token", "amount", "tier"],
  EscrowLocked:      ["tradeId", "taker", "takerBond"],
  PaymentReported:   ["tradeId", "ipfsHash", "timestamp"],
  EscrowReleased:    ["tradeId", "maker", "taker", "takerFee", "makerFee"],
  DisputeOpened:     ["tradeId", "challenger", "timestamp"],
  CancelProposed:    ["tradeId", "proposer"],
  EscrowCanceled:    ["tradeId", "makerRefund", "takerRefund"],
  MakerPinged:       ["tradeId", "pinger", "timestamp"],
  ReputationUpdated: ["wallet", "successful", "failed", "bannedUntil", "effectiveTier"],
  BleedingDecayed:   ["tradeId", "decayedAmount", "timestamp"],
  EscrowBurned:      ["tradeId", "burnedAmount"],
};

class EventWorker {
  constructor() {
    this.provider  = null;
    this.contract  = null;
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
  }

  async start() {
    logger.info("[Worker] Event listener başlatılıyor...");
    this.isRunning = true;
    await this._connect();
    await this._replayMissedEvents();
    this._attachLiveListeners();
    logger.info("[Worker] Event listener aktif.");
  }

  async stop() {
    this.isRunning = false;
    if (this.provider) {
      this.provider.removeAllListeners();
    }
    this._listenersAttached = false;
    this._setState("stopped", "worker stop çağrıldı");
    logger.info("[Worker] Event listener durduruldu.");
  }

  _setState(nextState, reason) {
    if (this._state === nextState) return;
    logger.info(`[Worker][StateMachine] ${this._state} -> ${nextState}${reason ? ` | ${reason}` : ""}`);
    this._state = nextState;
  }

  async _connect() {
    const rpcUrl          = process.env.BASE_RPC_URL || "https://mainnet.base.org";
    const contractAddress = process.env.ARAF_ESCROW_ADDRESS;

    if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
      if (process.env.NODE_ENV === "production") {
        logger.error("[Worker] KRİTİK: ARAF_ESCROW_ADDRESS tanımlı değil. Durduruluyor.");
        process.exit(1);
      }
      logger.warn("[Worker] Kontrat adresi yok — Worker kuru çalışma modunda (development).");
      return;
    }

    const wsRpcUrl = process.env.BASE_WS_RPC_URL;

    if (wsRpcUrl && wsRpcUrl.startsWith("wss://")) {
      try {
        this.provider = new ethers.WebSocketProvider(wsRpcUrl);
        logger.info(`[Worker] WebSocket RPC bağlandı.`);
      } catch (wsErr) {
        logger.warn(`[Worker] WebSocket başarısız, HTTP fallback: ${wsErr.message}`);
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
      }
    } else {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      if (process.env.NODE_ENV === "production") {
        logger.warn("[Worker] ⚠ HTTP RPC kullanılıyor. Gerçek zamanlı event için BASE_WS_RPC_URL ekleyin.");
      }
    }

    this.contract = new ethers.Contract(contractAddress, ARAF_ABI, this.provider);
    logger.info(`[Worker] Kontrat izleniyor: ${contractAddress}`);
    this._setState("connected", "provider + kontrat hazır");
  }

  async _replayMissedEvents() {
    if (!this.contract) return;

    const redis      = getRedisClient();
    const savedBlock = await redis.get(LAST_SAFE_BLOCK_KEY) ?? await redis.get(CHECKPOINT_KEY);
    const toBlock    = await this.provider.getBlockNumber();
    const fromBlock  = this._resolveReplayStartBlock(savedBlock, toBlock);

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
          // [TR] Bir event başarısız olsa da diğerlerini işlemeye devam et
        }
      }

      // [TR] Replay sırasında yalnızca tamamen başarılı batch safe checkpoint'i ilerletir
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

    for (const eventName of EVENT_NAMES) {
      this.contract.on(eventName, async (...args) => {
        const event = args[args.length - 1];
        const eventId = this._getEventId(event);
        this._trackLiveEventSeen(event);
        const success = await this._processEventWithRetry(event);
        if (success) {
          this._trackLiveEventAck(event);
          logger.debug(`[Worker][Metrics] retry_success_rate=${this._getRetrySuccessRate()}% event_id=${eventId}`);
        } else {
          this._markBlockUnsafe(event.blockNumber, eventId);
        }
      });
    }

    // [TR] Block listener artık checkpoint'i doğrudan ilerletmez; yalnızca gözlem/metrik tutar.
    this.provider.on("block", async (blockNumber) => {
      await this._updateSeenBlockIfHigher(blockNumber);
      logger.debug(`[Worker][Metrics] queue_depth=${this._blockAcks.size} last_seen_block=${this._lastSeenBlock} last_safe_block=${this._lastSafeCheckpointBlock}`);

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
    });

    this.provider.on("error", async (err) => {
      logger.error(`[Worker] Provider hatası: ${err.message}. Yeniden bağlanılıyor...`);
      await this._reconnect();
    });

    this._listenersAttached = true;
    this._setState("live", "canlı listener'lar bağlandı");
  }

  async _updateSafeCheckpointIfHigher(blockNumber) {
    const redis   = getRedisClient();
    const current = parseInt(await redis.get(LAST_SAFE_BLOCK_KEY) || await redis.get(CHECKPOINT_KEY) || "0");
    if (blockNumber > current) {
      await redis.set(LAST_SAFE_BLOCK_KEY, blockNumber.toString());
      // [TR] Geri uyumluluk için legacy anahtar da güncellenir.
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
      logger.warn("[Worker] Checkpoint bulunamadı ve ARAF_DEPLOYMENT_BLOCK/WORKER_START_BLOCK tanımlı değil. Varsayılan başlangıç bloğu: 0.");
      return 0;
    }

    const configuredStart = Number(configuredStartRaw);
    if (!Number.isInteger(configuredStart) || configuredStart < 0) {
      throw new Error(`[Worker] Geçersiz başlangıç bloğu: ${configuredStartRaw}. Beklenen: >= 0 tam sayı.`);
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
    const state = this._blockAcks.get(event.blockNumber) || { seen: new Set(), acked: new Set(), unsafe: false };
    state.seen.add(eventId);
    this._blockAcks.set(event.blockNumber, state);
  }

  _trackLiveEventAck(event) {
    if (!event || !Number.isInteger(event.blockNumber)) return;
    const eventId = this._getEventId(event);
    const state = this._blockAcks.get(event.blockNumber) || { seen: new Set(), acked: new Set(), unsafe: false };
    state.acked.add(eventId);
    this._blockAcks.set(event.blockNumber, state);
  }

  _markBlockUnsafe(blockNumber) {
    if (!Number.isInteger(blockNumber)) return;
    const state = this._blockAcks.get(blockNumber) || { seen: new Set(), acked: new Set(), unsafe: false };
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

  /**
   * KRİT-16 Fix: Zombi WebSocket — reconnect öncesinde eski provider'ı temizle.
   * ÖNCEKİ: Eski provider.removeAllListeners() veya destroy() yoktu.
   * Her reconnect'te zombi WebSocket birikiyordu → OOM.
   */
  async _reconnect() {
    if (this._reconnectPromise) {
      logger.warn("[Worker] Reconnect zaten devam ediyor, mevcut işlem bekleniyor.");
      return this._reconnectPromise;
    }

    this._reconnectPromise = (async () => {
      this._setState("reconnecting", "provider error sonrası yeniden bağlanma");

    // [TR] Eski provider'ı tamamen temizle
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
      }

      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      await this._connect();
      // Reconnect sonrası replay zorunlu
      await this._replayMissedEvents();
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

  /**
   * @returns {Promise<boolean>} Başarılıysa true (checkpoint için)
   */
  async _processEventWithRetry(event, attempt = 1) {
    try {
      await this._processEvent(event);
      this._retrySuccessCount += 1;
      return true;
    } catch (err) {
      logger.error(`[Worker] ${event.eventName} başarısız (deneme ${attempt}): ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
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
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        return this._processEventWithRetryNoDLQ(event, attempt + 1);
      }
      this._retryFailureCount += 1;
      return { success: false, error: err.message };
    }
  }

  // [TR] rPush: Yeni entry'ler sona eklenir — dlqProcessor FIFO düzeni için
  async _addToDLQ(event, errorMsg) {
    const redis = getRedisClient();
    const nowIso = new Date().toISOString();
    const entry = JSON.stringify({
      eventName:      event.eventName,
      txHash:         event.transactionHash,
      logIndex:       event.logIndex ?? null,
      idempotencyKey: this._getEventId(event),
      blockNumber:    event.blockNumber,
      args:           Array.isArray(event.args)
        ? event.args.map(a => a?.toString?.() ?? String(a))
        : Object.values(event.args || {}).map(a => a?.toString?.() ?? String(a)),
      attempt:        0,
      next_retry_at:  nowIso,
      first_seen_at:  nowIso,
      last_error:     errorMsg,
    });
    await redis.rPush(DLQ_KEY, entry);
    logger.error(`[Worker] Event DLQ'ya eklendi: ${event.eventName} key=${this._getEventId(event)} tx=${event.transactionHash}`);
  }


  async reDriveEvent(entry) {
    const event = {
      eventName: entry.eventName,
      transactionHash: entry.txHash,
      logIndex: entry.logIndex ?? -1,
      blockNumber: entry.blockNumber,
      args: entry.args || [],
    };

    const result = await this._processEventWithRetryNoDLQ(event);
    if (!result.success) {
      this._markBlockUnsafe(event.blockNumber, this._getEventId(event));
    }
    return result;
  }

  async _processEvent(event) {
    const handlers = {
      WalletRegistered:  this._onWalletRegistered.bind(this),
      EscrowCreated:     this._onEscrowCreated.bind(this),
      EscrowLocked:      this._onEscrowLocked.bind(this),
      PaymentReported:   this._onPaymentReported.bind(this),
      EscrowReleased:    this._onEscrowReleased.bind(this),
      DisputeOpened:     this._onDisputeOpened.bind(this),
      CancelProposed:    this._onCancelProposed.bind(this),
      EscrowCanceled:    this._onEscrowCanceled.bind(this),
      MakerPinged:       this._onMakerPinged.bind(this),
      ReputationUpdated: this._onReputationUpdated.bind(this),
      BleedingDecayed:   this._onBleedingDecayed.bind(this),
      EscrowBurned:      this._onEscrowBurned.bind(this),
    };

    const handler = handlers[event.eventName];
    if (handler) {
      await handler(event);
      logger.debug(`[Worker] İşlendi: ${event.eventName} tx=${event.transactionHash}`);
    }
  }

  // ─── Event Handler'ları ─────────────────────────────────────────────────────

  async _onWalletRegistered(event) {
    const { wallet } = event.args;
    await User.findOneAndUpdate(
      { wallet_address: wallet.toLowerCase() },
      { $setOnInsert: { wallet_address: wallet.toLowerCase() } },
      { upsert: true }
    );
  }

  async _onEscrowCreated(event) {
    const { tradeId, maker, amount, tier } = event.args;
    const tradeIdNum = Number(tradeId);

    // [TR] Token adresini on-chain event'ten al — KRİT-14 (Sahte Token) koruması
    const onchainToken = event.args.token?.toLowerCase();

    let listing = await Listing.findOne({ onchain_escrow_id: tradeIdNum }).lean();

    if (!listing) {
      const baseFilter = {
        maker_address:      maker.toLowerCase(),
        onchain_escrow_id:  null,
        "tier_rules.required_tier": Number(tier),
        ...(onchainToken ? { token_address: onchainToken } : {}),
      };
      const pendingCandidates = await Listing.find({ ...baseFilter, status: "PENDING" })
        .sort({ created_at: -1, _id: -1 })
        .limit(3)
        .lean();
      const openCandidates = pendingCandidates.length === 0
        ? await Listing.find({ ...baseFilter, status: "OPEN" })
          .sort({ created_at: -1, _id: -1 })
          .limit(3)
          .lean()
        : [];
      const candidates = pendingCandidates.length ? pendingCandidates : openCandidates;

      if (candidates.length === 1) {
        listing = candidates[0];
        const linkResult = await Listing.updateOne(
          { _id: listing._id, onchain_escrow_id: null },
          { $set: { onchain_escrow_id: tradeIdNum, status: "OPEN" } }
        );
        if (!linkResult.modifiedCount) {
          logger.warn(`[Worker] EscrowCreated: listing link race trade=#${tradeIdNum} listing=${listing._id}`);
          await this._addToDLQ(event, "Listing link race — onchain_escrow_id atomik bağlanamadı.");
          return;
        }
      } else if (candidates.length > 1) {
        const candidateIds = candidates.map((c) => c._id.toString());
        logger.warn(`[Worker] EscrowCreated ambiguity: trade=#${tradeIdNum} candidates=${candidateIds.join(",")}`);
        await this._addToDLQ(event, `Ambiguous listing match: ${candidateIds.join(",")}`);
        return;
      } else {
        // KRİT-08 Fix: Listing bulunamazsa hardcode fallback yok — DLQ'ya ekle
        logger.warn(`[Worker] EscrowCreated: Trade #${tradeId} için ilan bulunamadı — DLQ'ya alınıyor.`);
        await this._addToDLQ(event, "Kaynak ilan bulunamadı — retry bekleniyor.");
        return; // [TR] İşlemi iptal et, hardcode fallback YOK
      }
    }

    // FEL-08 Fix: Number() yerine toString() — BigInt hassasiyeti korunuyor
    const financials = {
      crypto_amount: amount.toString(), // MongoDB'de String — hassasiyet kaybı yok
      crypto_amount_num: Number(amount),
      exchange_rate: listing.exchange_rate,
      crypto_asset:  listing.crypto_asset,
      fiat_currency: listing.fiat_currency,
      total_decayed: "0",
      total_decayed_num: 0,
      decay_tx_hashes: [],
      decayed_amounts: [],
    };

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: tradeIdNum },
      {
        $setOnInsert: {
          onchain_escrow_id: tradeIdNum,
          listing_id:        listing._id,
          maker_address:     maker.toLowerCase(),
          status:            "OPEN",
          tier:              Number(tier),
          financials,
        },
      },
      { upsert: true }
    );
  }

  async _onEscrowLocked(event) {
    const { tradeId, taker } = event.args;
    const tradeIdNum = Number(tradeId);
    const takerAddress = taker.toLowerCase();

    // [TR] PII snapshot: LOCKED anında maker/taker şifreli alanlarını trade'e kopyala
    //      Amaç: profil sonradan değişse bile işlemdeki referans sabit kalsın.
    // [EN] PII snapshot: copy encrypted maker/taker fields at LOCKED time
    //      so trade references remain stable even if profile changes later.
    const trade = await Trade.findOne({ onchain_escrow_id: tradeIdNum })
      .select("maker_address").lean();

    let makerBankOwnerEnc = null;
    let makerIbanEnc      = null;
    let takerBankOwnerEnc = null;

    if (trade?.maker_address) {
      const [makerUser, takerUser] = await Promise.all([
        User.findOne({ wallet_address: trade.maker_address })
          .select("pii_data.bankOwner_enc pii_data.iban_enc")
          .lean(),
        User.findOne({ wallet_address: takerAddress })
          .select("pii_data.bankOwner_enc")
          .lean(),
      ]);

      makerBankOwnerEnc = makerUser?.pii_data?.bankOwner_enc || null;
      makerIbanEnc      = makerUser?.pii_data?.iban_enc || null;
      takerBankOwnerEnc = takerUser?.pii_data?.bankOwner_enc || null;
    }

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: tradeIdNum },
      {
        $set: {
          status:             "LOCKED",
          taker_address:      takerAddress,
          "timers.locked_at": new Date(),
          "pii_snapshot.maker_bankOwner_enc": makerBankOwnerEnc,
          "pii_snapshot.maker_iban_enc":      makerIbanEnc,
          "pii_snapshot.taker_bankOwner_enc": takerBankOwnerEnc,
          "pii_snapshot.captured_at":         new Date(),
          "pii_snapshot.snapshot_delete_at":  new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
      }
    );
  }

  async _onPaymentReported(event) {
    const { tradeId, ipfsHash } = event.args;

    // ORTA-06 Fix: IPFS Hash format doğrulaması — XSS injection koruması
    const safeHash = CID_PATTERN.test(ipfsHash) ? ipfsHash : null;
    if (!safeHash) {
      logger.warn(`[Worker] Geçersiz IPFS hash formatı: trade=#${tradeId} hash=${ipfsHash?.slice(0, 20)}...`);
      // [TR] Geçersiz hash ile devam etme — trade durumunu güncelle ama hash'i boş bırak
    }

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      {
        $set: {
          status:                       "PAID",
          "evidence.ipfs_receipt_hash": safeHash, // null ise boş kalır
          "evidence.receipt_timestamp": new Date(),
          "timers.paid_at":             new Date(),
        },
      }
    );
  }

  async _onEscrowReleased(event) {
    const { tradeId } = event.args;
    const tradeIdNum  = Number(tradeId);

    const existingTrade = await Trade.findOne({ onchain_escrow_id: tradeIdNum }).lean();
    const wasDisputed   = existingTrade?.status === "CHALLENGED";

    // YÜKS-04 Fix: Atomik MongoDB Transaction
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

      // [TR] Dekont TTL: 24 saat (Unutulma Hakkı)
      await Trade.findOneAndUpdate(
        { onchain_escrow_id: tradeIdNum },
        { $set: { "evidence.receipt_delete_at": new Date(Date.now() + 24 * 3600 * 1000) } },
        { session }
      );

      // KRİT-02 Fix: CHALLENGED→RESOLVED = Taker haksız itiraz açtı → TAKER cezalandırılıyor
      // ÖNCEKİ: trade.maker_address kullanılıyordu — YANLIŞ
      if (wasDisputed && trade.taker_address) {
        const scoreType = "unjust_challenge";
        const score     = FAILURE_SCORE_WEIGHTS[scoreType];
        // YÜKS-22 Fix: $slice ile maksimum 100 kayıt
        await User.findOneAndUpdate(
          { wallet_address: trade.taker_address },
          {
            $inc:  { "reputation_cache.failure_score": score },
            $push: {
              reputation_history: {
                $each:  [{ type: scoreType, score, date: new Date(), tradeId: tradeIdNum }],
                $slice: -MAX_REPUTATION_HISTORY,
              },
            },
          },
          { session }
        );
        logger.info(`[Worker] Haksız itiraz cezası: taker=${trade.taker_address} +${score}`);
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
      { onchain_escrow_id: Number(tradeId) },
      { $set: { status: "CHALLENGED", "timers.challenged_at": new Date() } }
    );
  }

  async _onEscrowCanceled(event) {
    const { tradeId } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      {
        $set: {
          status:                       "CANCELED",
          "timers.resolved_at":         new Date(),
          // [TR] Dekont TTL: 24 saat (Unutulma Hakkı)
          "evidence.receipt_delete_at": new Date(Date.now() + 24 * 3600 * 1000),
        },
      }
    );
  }

  async _onEscrowBurned(event) {
    const { tradeId } = event.args;
    const tradeIdNum  = Number(tradeId);

    // YÜKS-04 Fix: Atomik MongoDB Transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const trade = await Trade.findOneAndUpdate(
        { onchain_escrow_id: tradeIdNum },
        {
          $set: {
            status:                       "BURNED",
            "timers.resolved_at":         new Date(),
            // [TR] Dekont TTL: 30 gün (BURNED/CHALLENGED uzun retention)
            "evidence.receipt_delete_at": new Date(Date.now() + 30 * 24 * 3600 * 1000),
          },
        },
        { new: true, session }
      );

      if (trade) {
        const scoreType = "burned";
        const score     = FAILURE_SCORE_WEIGHTS[scoreType];
        const addresses = [trade.maker_address, trade.taker_address].filter(Boolean);

        for (const addr of addresses) {
          // YÜKS-05 Fix: Idempotency — aynı tradeId+type kombinasyonu zaten varsa atla
          const existing = await User.findOne({
            wallet_address:     addr,
            reputation_history: { $elemMatch: { type: scoreType, tradeId: tradeIdNum } },
          }, null, { session }).lean();

          if (existing) {
            logger.debug(`[Worker] Duplicate failure_score atlandı: ${addr} trade #${tradeId}`);
            continue;
          }

          // YÜKS-22 Fix: $slice ile maksimum 100 kayıt
          await User.findOneAndUpdate(
            { wallet_address: addr },
            {
              $inc:  { "reputation_cache.failure_score": score },
              $push: {
                reputation_history: {
                  $each:  [{ type: scoreType, score, date: new Date(), tradeId: tradeIdNum }],
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
    const tradeIdNum = Number(tradeId);

    // [TR] Model canonical field: financials.decay_tx_hashes.
    // [EN] Canonical idempotency key is tx hash (derived mirror only).
    const eventId = event.transactionHash || this._getEventId(event);
    const existing = await Trade.findOne({
      onchain_escrow_id: tradeIdNum,
      "financials.decay_tx_hashes": eventId,
    }).lean();

    if (existing) {
      logger.debug(`[Worker] BleedingDecayed tekrar işleme atlandı: key=${eventId}`);
      return;
    }

    // FEL-08 Fix: Number() yerine toString()
    const trade = await Trade.findOne({ onchain_escrow_id: tradeIdNum })
      .select("financials.total_decayed")
      .lean();
    if (!trade) return;

    const currentTotal = BigInt(trade.financials?.total_decayed || "0");
    const nextTotalBigInt = currentTotal + BigInt(decayedAmount.toString());
    const nextTotal       = nextTotalBigInt.toString();
    const nextTotalNum    = Number(trade.financials?.total_decayed_num || 0) + Number(decayedAmount);

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: tradeIdNum },
      {
        $set:      { "timers.last_decay_at": new Date(), "financials.total_decayed": nextTotal },
        // [TR] Erimek miktarı String olarak biriktirilir — hassasiyet kaybı yok
        $inc:      { "financials.total_decayed_num": Number(decayedAmount) }, // yaklaşık görüntüleme
        $addToSet: { "financials.decay_tx_hashes": eventId, "financials.decayed_amounts": decayedAmount.toString() },
      }
    );
  }

  async _onCancelProposed(event) {
    const { tradeId, proposer } = event.args;
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      {
        $set: {
          "cancel_proposal.proposed_by":   proposer.toLowerCase(),
          "cancel_proposal.proposed_at":   new Date(),
        },
      }
    );
  }

  async _onMakerPinged(event) {
    const { tradeId, pinger } = event.args;

    const trade = await Trade.findOne({ onchain_escrow_id: Number(tradeId) }).lean();
    if (!trade) return;

    // BACK-04 Fix: taker_address null race condition — mevcut değilse bekle
    if (!trade.taker_address) {
      logger.warn(`[Worker] MakerPinged: Trade #${tradeId} taker_address henüz null — DLQ'ya alınıyor.`);
      await this._addToDLQ(event, "taker_address henüz DB'de yok — EscrowLocked gecikmiş olabilir.");
      return;
    }

    const isTakerPing  = pinger.toLowerCase() === trade.taker_address.toLowerCase();
    const updateFields = isTakerPing
      ? { "timers.pinged_at": new Date(), "pinged_by_taker": true }
      : { "timers.challenge_pinged_at": new Date(), "challenge_pinged_by_maker": true };

    await Trade.findOneAndUpdate(
      { onchain_escrow_id: Number(tradeId) },
      { $set: updateFields }
    );
  }

  async _onReputationUpdated(event) {
    const { wallet, successful, failed, bannedUntil, effectiveTier } = event.args;

    const totalTrades = Number(successful) + Number(failed);
    const successRate = totalTrades > 0
      ? Math.round((Number(successful) / totalTrades) * 100)
      : 100;

    const banTimestamp = Number(bannedUntil);
    const isBanned     = banTimestamp > Math.floor(Date.now() / 1000);

    // [TR] Dot notation — failure_score ve reputation_history korunur
    await User.findOneAndUpdate(
      { wallet_address: wallet.toLowerCase() },
      {
        $set: {
          "reputation_cache.success_rate":    successRate,
          "reputation_cache.total_trades":    totalTrades,
          "reputation_cache.failed_disputes": Number(failed),
          "is_banned":    isBanned,
          "banned_until": isBanned ? new Date(banTimestamp * 1000) : null,
          // [TR] consecutive_bans ve max_allowed_tier bu event'te yok —
          // ayrı on-chain okuma gerektirir. Yanlış değer yazılmasını önlemek için
          // bu alanlar burada güncellenmez.
        },
      },
      { upsert: true }
    );
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
    eventName:       entry.eventName,
    transactionHash: entry.txHash,
    blockNumber:     entry.blockNumber,
    args:            mappedArgs,
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
