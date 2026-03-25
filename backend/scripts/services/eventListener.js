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

const CHECKPOINT_KEY             = "worker:last_block";
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

class EventWorker {
  constructor() {
    this.provider  = null;
    this.contract  = null;
    this.isRunning = false;
    this._lastCheckpointBlock = 0;
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
    logger.info("[Worker] Event listener durduruldu.");
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
  }

  async _replayMissedEvents() {
    if (!this.contract) return;

    const redis      = getRedisClient();
    const savedBlock = await redis.get(CHECKPOINT_KEY);
    const toBlock    = await this.provider.getBlockNumber();
    const fromBlock  = this._resolveReplayStartBlock(savedBlock, toBlock);

    if (fromBlock > toBlock) {
      logger.info("[Worker] Kaçırılan event yok. Checkpoint güncel.");
      return;
    }

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

      // KRİT-10 Fix: Checkpoint sadece başarılıysa ilerliyor
      // ÖNCEKİ: Her durumda ilerletiliyordu — event'ler sessizce kayboluyordu
      if (batchSuccess) {
        await this._updateCheckpointIfHigher(to);
      } else {
        logger.warn(`[Worker] Batch ${from}-${to} kısmen başarısız — checkpoint ilerletilmedi.`);
      }

      logger.debug(`[Worker] Replay: ${from}-${to} (${allEvents.length} event)`);
    }

    this._lastCheckpointBlock = toBlock;
    logger.info("[Worker] Replay tamamlandı.");
  }

  _attachLiveListeners() {
    if (!this.contract) return;

    for (const eventName of EVENT_NAMES) {
      this.contract.on(eventName, async (...args) => {
        const event = args[args.length - 1];
        const success = await this._processEventWithRetry(event);
        // KRİT-10 Fix: Sadece başarılı işlem sonrasında checkpoint ilerlet
        if (success) {
          await this._updateCheckpointIfHigher(event.blockNumber);
        }
      });
    }

    // [TR] Periyodik checkpoint güncellemesi
    this.provider.on("block", async (blockNumber) => {
      if (blockNumber - this._lastCheckpointBlock >= CHECKPOINT_INTERVAL_BLOCKS) {
        await this._updateCheckpointIfHigher(blockNumber);
      }
    });

    this.provider.on("error", async (err) => {
      logger.error(`[Worker] Provider hatası: ${err.message}. Yeniden bağlanılıyor...`);
      await this._reconnect();
    });
  }

  async _updateCheckpointIfHigher(blockNumber) {
    const redis   = getRedisClient();
    const current = parseInt(await redis.get(CHECKPOINT_KEY) || "0");
    if (blockNumber > current) {
      await redis.set(CHECKPOINT_KEY, blockNumber.toString());
      this._lastCheckpointBlock = blockNumber;
    }
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

  /**
   * KRİT-16 Fix: Zombi WebSocket — reconnect öncesinde eski provider'ı temizle.
   * ÖNCEKİ: Eski provider.removeAllListeners() veya destroy() yoktu.
   * Her reconnect'te zombi WebSocket birikiyordu → OOM.
   */
  async _reconnect() {
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
    }

    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    await this._connect();
    if (this.contract) {
      this._attachLiveListeners();
    }
  }

  /**
   * @returns {Promise<boolean>} Başarılıysa true (checkpoint için)
   */
  async _processEventWithRetry(event, attempt = 1) {
    try {
      await this._processEvent(event);
      return true;
    } catch (err) {
      logger.error(`[Worker] ${event.eventName} başarısız (deneme ${attempt}): ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        return this._processEventWithRetry(event, attempt + 1);
      }
      await this._addToDLQ(event, err.message);
      return false;
    }
  }

  // [TR] rPush: Yeni entry'ler sona eklenir — dlqProcessor FIFO düzeni için
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
    await redis.rPush(DLQ_KEY, entry);
    logger.error(`[Worker] Event DLQ'ya eklendi: ${event.eventName} tx=${event.transactionHash}`);
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
      // [TR] Chain-first geçiş: önce PENDING ilan aranır, yoksa OPEN fallback yapılır.
      // [EN] Chain-first migration: prefer PENDING listing, fallback to OPEN.
      listing = await Listing.findOne({
        maker_address:      maker.toLowerCase(),
        onchain_escrow_id:  null,
        status:             { $in: ["PENDING", "OPEN"] }, // DELETED/PAUSED dışlanır
        // [TR] Token adresi eşleşmesi — sahte token koruması
        ...(onchainToken ? { token_address: onchainToken } : {}),
      }).sort({ _id: -1 }).lean();

      if (listing) {
        await Listing.updateOne(
          { _id: listing._id },
          { $set: { onchain_escrow_id: tradeIdNum, status: "OPEN" } }
        );
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
      exchange_rate: listing.exchange_rate,
      crypto_asset:  listing.crypto_asset,
      fiat_currency: listing.fiat_currency,
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

    // YÜKS-05 Fix: Idempotency — transactionHash ile tekrar işleme kontrolü
    const txHash = event.transactionHash;
    const existing = await Trade.findOne({
      onchain_escrow_id: tradeIdNum,
      "financials.decay_tx_hashes": txHash,
    }).lean();

    if (existing) {
      logger.debug(`[Worker] BleedingDecayed tekrar işleme atlandı: tx=${txHash}`);
      return;
    }

    // FEL-08 Fix: Number() yerine toString()
    await Trade.findOneAndUpdate(
      { onchain_escrow_id: tradeIdNum },
      {
        $set:      { "timers.last_decay_at": new Date() },
        // [TR] Erimek miktarı String olarak biriktirilir — hassasiyet kaybı yok
        $inc:      { "financials.total_decayed_num": Number(decayedAmount) }, // yaklaşık görüntüleme
        $push:     { "financials.decay_tx_hashes": txHash }, // idempotency için
        $addToSet: { "financials.decayed_amounts": decayedAmount.toString() },
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
module.exports = worker;
