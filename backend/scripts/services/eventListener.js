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
const { isConfiguredAddress: _isConfiguredAddress } = require("../utils/onchain");
const mongoose = require("mongoose");
const { getRedisClient } = require("../config/redis");
const Trade = require("../models/Trade");
const Order = require("../models/Order");
const User = require("../models/User");
const RevenueEvent = require("../models/RevenueEvent");
const RewardFunding = require("../models/RewardFunding");
const RewardEpoch = require("../models/RewardEpoch");
const RewardClaim = require("../models/RewardClaim");
const RewardEpochAllocationEvent = require("../models/RewardEpochAllocationEvent");
const logger = require("../utils/logger");
const {
  updateCachedFeeConfig,
  updateCachedCooldownConfig,
  updateCachedReputationPolicy,
  updateCachedTokenConfig,
  refreshProtocolConfig,
} = require("./protocolConfig");
const { assertProviderExpectedChainOrThrow } = require("./expectedChain");
const { inferCryptoAssetFromTokenAddress } = require("./tokenEnv");
const { readPendingMarketMeta } = require("./orderMarketMeta");

const CHECKPOINT_KEY = "worker:last_block";
const LAST_SAFE_BLOCK_KEY = "worker:last_safe_block";
const DLQ_KEY = "worker:dlq";
const APPLIED_ORDER_KEY_PREFIX = "worker:applied_order:";
// [TR] DLQ idempotencyKey indeksleri (Redis SET): canlı DLQ, arşiv (7 gün TTL) ve kalıcı karantina.
//      Dedupe liste taraması yerine bu setlere bakar; dlqProcessor aynı anahtarları kullanır.
// [EN] DLQ idempotencyKey indexes (Redis SETs): live DLQ, archive (7-day TTL) and permanent quarantine.
//      Dedupe checks these sets instead of scanning the list; dlqProcessor uses the same keys.
const DLQ_LIVE_KEYS_SET = "worker:dlq:keys";
const DLQ_ARCHIVE_KEYS_SET = "worker:dlq:archive:keys";
const DLQ_QUARANTINE_KEYS_SET = "worker:dlq:quarantine:keys";
const RETRY_DELAY_MS = 2_000;
const MAX_RETRIES = 5;
/**
 * [TR] Worker env integer parser:
 *      - yalnız pozitif tamsayı kabul eder
 *      - invalid değerlerde sessiz/fail-safe fallback döner
 * [EN] Strict positive-integer env parser with silent fail-safe fallback.
 */
function _getPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed <= 0) return fallback;
  return parsed;
}

const BLOCK_BATCH_SIZE = _getPositiveIntEnv("WORKER_BLOCK_BATCH_SIZE", 1_000);
const CHECKPOINT_INTERVAL_BLOCKS = _getPositiveIntEnv("WORKER_CHECKPOINT_INTERVAL_BLOCKS", 50);
const DEFAULT_WORKER_FINALITY_DEPTH = process.env.NODE_ENV === "production" ? 6 : 1;
const WORKER_FINALITY_DEPTH = _getPositiveIntEnv("WORKER_FINALITY_DEPTH", DEFAULT_WORKER_FINALITY_DEPTH);
const BLOCK_TIMESTAMP_CACHE_LIMIT = 2_048;
const REPLAY_BACKOFF_BASE_MS = _getPositiveIntEnv("WORKER_REPLAY_BACKOFF_BASE_MS", 5_000);
const REPLAY_BACKOFF_MAX_MS = _getPositiveIntEnv("WORKER_REPLAY_BACKOFF_MAX_MS", 5 * 60 * 1000);
// [TR] B6: bu süre boyunca yeni blok görülmezse watchdog reconnect dener; reconnect sonrası da blok yoksa çıkar.
// [EN] B6: when no new block is seen for this long the watchdog reconnects; still nothing afterwards -> exit.
const BLOCK_STALE_MS = _getPositiveIntEnv("WORKER_BLOCK_STALE_MS", 75_000);
const WATCHDOG_INTERVAL_MS = _getPositiveIntEnv("WORKER_WATCHDOG_INTERVAL_MS", 15_000);
// [TR] /health liveness eşiği: watchdog'un iki penceresini kapsar (arka plan güvence).
// [EN] /health liveness threshold: covers two watchdog windows (backstop).
const LIVENESS_STALE_MS = _getPositiveIntEnv("WORKER_LIVENESS_STALE_MS", BLOCK_STALE_MS * 2 + 30_000);

const ESCROW_EVENT_NAMES = [
  "WalletRegistered",
  "PaymentReported",
  "EscrowReleased", "DisputeOpened",
  "CancelProposed", "EscrowCanceled", "PaymentWindowExpired",
  "MakerPinged", "ReputationUpdated",
  "BleedingDecayed", "EscrowBurned",
  "SettlementProposed", "SettlementRejected", "SettlementWithdrawn", "SettlementExpired", "SettlementFinalized",
  "OrderCreated", "OrderFilled", "OrderCanceled",
  "FeeConfigUpdated", "CooldownConfigUpdated", "TokenConfigUpdated",
  "ReputationPolicyUpdated", "ReputationTierThresholdsUpdated",
  "ProtocolRevenueSent",
];
// [TR] Bu event'ler escrow değil ArafRevenueVault / ArafRewards adresinden yayınlanır.
//      Escrow kontratı üzerinden sorgulanırsa hiçbir zaman bulunamazlar.
// [EN] These events are emitted by ArafRevenueVault / ArafRewards, not by the escrow.
//      Querying them on the escrow address would never return anything.
const VAULT_EVENT_NAMES = ["EscrowRevenueReceived", "ExternalRewardFunded", "ProductRewardFunded"];
const REWARDS_EVENT_NAMES = ["EpochRewardAllocated", "TradeOutcomeRecorded", "RewardClaimed"];
const EVENT_NAMES = [...ESCROW_EVENT_NAMES, ...VAULT_EVENT_NAMES, ...REWARDS_EVENT_NAMES];
const EVENT_NAME_SET = new Set(EVENT_NAMES);

// [TR] ethers v6 Log/EventLog nesnelerinde log sırası `index` alanındadır; `logIndex` yoktur. Eskiden
//      `event.logIndex` her zaman undefined olduğu için aynı tx'teki event'lerin idempotency anahtarları
//      çakışıyordu. DLQ kayıtları ve testler `logIndex` taşıyabildiği için ikisi de desteklenir.
// [EN] ethers v6 logs carry their position in `index`, not `logIndex`. `event.logIndex` used to be undefined,
//      so events in the same tx collided on their idempotency keys. Both spellings are accepted.
function _logIndexOf(event) {
  if (Number.isInteger(event?.logIndex)) return event.logIndex;
  if (Number.isInteger(event?.index)) return event.index;
  return undefined;
}

const ARAF_ABI = [
  "event WalletRegistered(address indexed wallet, uint256 timestamp)",
  // [TR] Kanonik V3 child trade'ler OrderFilled + getTrade() ile aynalanır. Kontrat EscrowCreated /
  //      EscrowLocked event'lerini yayınlamaz (B36: ölü handler'lar kaldırıldı).
  // [EN] Canonical V3 child trades are mirrored from OrderFilled + getTrade(). The contract never emits
  //      EscrowCreated / EscrowLocked (B36: dead handlers removed).
  "event PaymentReported(uint256 indexed tradeId, string ipfsHash, uint256 timestamp)",
  "event EscrowReleased(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 takerFee, uint256 makerFee)",
  "event DisputeOpened(uint256 indexed tradeId, address indexed challenger, uint256 timestamp)",
  "event CancelProposed(uint256 indexed tradeId, address indexed proposer)",
  "event EscrowCanceled(uint256 indexed tradeId, uint256 makerRefund, uint256 takerRefund)",
  "event PaymentWindowExpired(uint256 indexed tradeId, uint256 makerRefund, uint256 takerRefund, uint256 takerPenalty)",
  "event MakerPinged(uint256 indexed tradeId, address indexed pinger, uint256 timestamp)",
  // [TR] ReputationUpdated arg sırası kontrat event imzasıyla birebir eşleşmelidir (index kayması mirror bozar).
  // [EN] ReputationUpdated arg order must exactly match contract event signature (index drift breaks mirroring).
  "event ReputationUpdated(address indexed wallet, uint256 successful, uint256 failed, uint256 bannedUntil, uint8 effectiveTier, uint256 manualReleaseCount, uint256 autoReleaseCount, uint256 mutualCancelCount, uint256 disputedResolvedCount, uint256 burnCount, uint256 disputeWinCount, uint256 disputeLossCount, uint256 partialSettlementCount, uint256 riskPoints, uint256 lastPositiveEventAt, uint256 lastNegativeEventAt)",
  "event BleedingDecayed(uint256 indexed tradeId, uint256 decayedAmount, uint256 timestamp)",
  "event EscrowBurned(uint256 indexed tradeId, uint256 burnedAmount)",
  "event SettlementProposed(uint256 indexed tradeId, uint256 indexed proposalId, address indexed proposer, uint16 makerShareBps, uint16 takerShareBps, uint256 expiresAt)",
  "event SettlementRejected(uint256 indexed tradeId, uint256 indexed proposalId, address indexed rejecter)",
  "event SettlementWithdrawn(uint256 indexed tradeId, uint256 indexed proposalId, address indexed proposer)",
  "event SettlementExpired(uint256 indexed tradeId, uint256 indexed proposalId)",
  "event SettlementFinalized(uint256 indexed tradeId, uint256 indexed proposalId, uint256 makerPayout, uint256 takerPayout, uint256 takerFee, uint256 makerFee)",
  "event OrderCreated(uint256 indexed orderId, address indexed owner, uint8 side, address token, uint256 totalAmount, uint256 minFillAmount, uint8 tier, uint8 paymentRiskLevel, bytes32 orderRef)",
  "event OrderFilled(uint256 indexed orderId, uint256 indexed tradeId, address indexed filler, uint256 fillAmount, uint256 remainingAmount, uint8 paymentRiskLevelSnapshot, bytes32 childListingRef)",
  "event OrderCanceled(uint256 indexed orderId, uint8 side, uint256 remainingAmount, uint256 makerBondRefund, uint256 takerBondRefund)",
  "event FeeConfigUpdated(uint256 takerFeeBps, uint256 makerFeeBps)",
  "event CooldownConfigUpdated(uint256 tier0TradeCooldown, uint256 tier1TradeCooldown)",
  "event TokenConfigUpdated(address indexed token, bool supported, bool allowSellOrders, bool allowBuyOrders)",
  "event ReputationPolicyUpdated(uint256 cleanPeriod, uint256 manualReleaseRewardPts, uint256 autoReleasePenaltyPts, uint256 disputeWinRewardPts, uint256 disputeLossPenaltyPts, uint256 burnPenaltyPts, uint256 mutualCancelPenaltyPts, uint256 baseBanDuration, uint256 banRiskPointsThreshold)",
  "event ReputationTierThresholdsUpdated(uint32[5] minSuccessfulTrades, uint32[5] maxRiskPoints)",
  "event ProtocolRevenueSent(address indexed token, uint256 amount, uint8 indexed kind, uint256 indexed tradeId, address treasury)",
  "event EscrowRevenueReceived(address indexed token, uint256 amount, uint256 rewardShare, uint256 treasuryShare, uint8 kind, uint256 tradeId)",
  "event ExternalRewardFunded(address indexed funder, address indexed token, uint256 amount, uint256 indexed targetEpoch, bytes32 fundingRef)",
  "event ProductRewardFunded(address indexed funder, bytes32 indexed productId, address indexed token, uint256 amount, uint256 targetEpoch, bytes32 fundingRef)",
  "event EpochRewardAllocated(uint256 indexed epoch, address indexed token, uint256 amount)",
  "event TradeOutcomeRecorded(uint256 indexed tradeId, uint256 indexed epoch, address indexed maker, address taker, uint256 makerWeight, uint256 takerWeight, uint8 outcome)",
  "event RewardClaimed(uint256 indexed epoch, address indexed user, address indexed token, uint256 amount, uint256 userWeight, uint256 totalWeight)",
  "function getTrade(uint256 _tradeId) view returns ((uint64 id,uint64 parentOrderId,address maker,address taker,address tokenAddress,uint256 cryptoAmount,uint256 makerBond,uint256 takerBond,uint16 takerFeeBpsSnapshot,uint16 makerFeeBpsSnapshot,uint8 tier,uint8 paymentRiskLevelSnapshot,uint8 state,uint64 lockedAt,uint64 paidAt,uint64 challengedAt,bool cancelProposedByMaker,bool cancelProposedByTaker,uint64 pingedAt,bool pingedByTaker,uint64 challengePingedAt,bool challengePingedByMaker))",
  "function getOrder(uint256 _orderId) view returns ((uint64 id,address owner,uint8 side,address tokenAddress,uint256 totalAmount,uint256 remainingAmount,uint256 minFillAmount,uint256 remainingMakerBondReserve,uint256 remainingTakerBondReserve,uint16 takerFeeBpsSnapshot,uint16 makerFeeBpsSnapshot,uint8 tier,uint8 paymentRiskLevel,uint8 state,bytes32 orderRef))",
  // [TR] getReputation getter tuple sırası frontend + contract ile lock-step kalmalıdır.
  // [EN] Keep getReputation tuple order in lock-step with frontend + contract.
  "function getReputation(address _wallet) view returns (uint256 successful,uint256 failed,uint256 bannedUntil,uint256 consecutiveBans,uint8 effectiveTier,uint256 manualReleaseCount,uint256 autoReleaseCount,uint256 mutualCancelCount,uint256 disputedResolvedCount,uint256 burnCount,uint256 disputeWinCount,uint256 disputeLossCount,uint256 partialSettlementCount,uint256 riskPoints,uint256 lastPositiveEventAt,uint256 lastNegativeEventAt)",
  "function getRewardableTrade(uint256 _tradeId) view returns ((uint256 tradeId,uint256 parentOrderId,address maker,address taker,address token,uint256 stableNotional,uint256 takerFeePaid,uint256 makerFeePaid,uint8 tier,uint8 outcome,uint256 lockedAt,uint256 paidAt,uint256 terminalAt,bool hadChallenge,bool isOrderChild))",
];

// [TR] Kontratın TerminalOutcome enum'u → read-model resolution_type eşlemesi.
// [EN] Contract TerminalOutcome enum → read-model resolution_type mapping.
const TERMINAL_OUTCOME_TO_RESOLUTION = {
  1: "MANUAL_RELEASE",
  2: "AUTO_RELEASE",
  3: "MUTUAL_CANCEL",
  4: "PARTIAL_SETTLEMENT",
  5: "DISPUTED_RESOLUTION",
  6: "BURNED",
  7: "PAYMENT_WINDOW_EXPIRED",
};

// [TR] reportPayment / challengeTrade sonrası kontrattaki iptal onayı bayraklarının mirror karşılığı.
// [EN] Mirror equivalent of the contract clearing cancel-consent flags on reportPayment / challengeTrade.
const CLEARED_CANCEL_PROPOSAL = Object.freeze({
  "cancel_proposal.proposed_by": null,
  "cancel_proposal.proposed_at": null,
  "cancel_proposal.approved_by": null,
  "cancel_proposal.maker_signed": false,
  "cancel_proposal.taker_signed": false,
});


const EVENT_ARG_KEYS = {
  WalletRegistered: ["wallet", "timestamp"],
  PaymentReported: ["tradeId", "ipfsHash", "timestamp"],
  // [TR] EscrowReleased payload sırası kontrat ABI ile birebir eşleşmelidir:
  //      4. argüman takerFee/takerPenalty, 5. argüman makerFee/makerPenalty.
  // [EN] EscrowReleased payload order must stay ABI-aligned:
  //      4th arg is takerFee/takerPenalty, 5th arg is makerFee/makerPenalty.
  EscrowReleased: ["tradeId", "maker", "taker", "takerFee", "makerFee"],
  DisputeOpened: ["tradeId", "challenger", "timestamp"],
  CancelProposed: ["tradeId", "proposer"],
  EscrowCanceled: ["tradeId", "makerRefund", "takerRefund"],
  PaymentWindowExpired: ["tradeId", "makerRefund", "takerRefund", "takerPenalty"],
  MakerPinged: ["tradeId", "pinger", "timestamp"],
  ReputationUpdated: [
    "wallet",
    "successful",
    "failed",
    "bannedUntil",
    "effectiveTier",
    "manualReleaseCount",
    "autoReleaseCount",
    "mutualCancelCount",
    "disputedResolvedCount",
    "burnCount",
    "disputeWinCount",
    "disputeLossCount",
    "partialSettlementCount",
    "riskPoints",
    "lastPositiveEventAt",
    "lastNegativeEventAt",
  ],
  BleedingDecayed: ["tradeId", "decayedAmount", "timestamp"],
  EscrowBurned: ["tradeId", "burnedAmount"],
  SettlementProposed: ["tradeId", "proposalId", "proposer", "makerShareBps", "takerShareBps", "expiresAt"],
  SettlementRejected: ["tradeId", "proposalId", "rejecter"],
  SettlementWithdrawn: ["tradeId", "proposalId", "proposer"],
  SettlementExpired: ["tradeId", "proposalId"],
  SettlementFinalized: ["tradeId", "proposalId", "makerPayout", "takerPayout", "takerFee", "makerFee"],
  OrderCreated: ["orderId", "owner", "side", "token", "totalAmount", "minFillAmount", "tier", "paymentRiskLevel", "orderRef"],
  OrderFilled: ["orderId", "tradeId", "filler", "fillAmount", "remainingAmount", "paymentRiskLevelSnapshot", "childListingRef"],
  OrderCanceled: ["orderId", "side", "remainingAmount", "makerBondRefund", "takerBondRefund"],
  FeeConfigUpdated: ["takerFeeBps", "makerFeeBps"],
  CooldownConfigUpdated: ["tier0TradeCooldown", "tier1TradeCooldown"],
  TokenConfigUpdated: ["token", "supported", "allowSellOrders", "allowBuyOrders"],
  ReputationPolicyUpdated: ["cleanPeriod", "manualReleaseRewardPts", "autoReleasePenaltyPts", "disputeWinRewardPts", "disputeLossPenaltyPts", "burnPenaltyPts", "mutualCancelPenaltyPts", "baseBanDuration", "banRiskPointsThreshold"],
  ReputationTierThresholdsUpdated: ["minSuccessfulTrades", "maxRiskPoints"],
  ProtocolRevenueSent: ["token", "amount", "kind", "tradeId", "treasury"],
  EscrowRevenueReceived: ["token", "amount", "rewardShare", "treasuryShare", "kind", "tradeId"],
  ExternalRewardFunded: ["funder", "token", "amount", "targetEpoch", "fundingRef"],
  ProductRewardFunded: ["funder", "productId", "token", "amount", "targetEpoch", "fundingRef"],
  EpochRewardAllocated: ["epoch", "token", "amount"],
  TradeOutcomeRecorded: ["tradeId", "epoch", "maker", "taker", "makerWeight", "takerWeight", "outcome"],
  RewardClaimed: ["epoch", "user", "token", "amount", "userWeight", "totalWeight"],
};

function _toNum(v) {
  return Number(v ?? 0);
}
function _toStr(v) { return v?.toString?.() ?? String(v); }

/**
 * [TR] DLQ/JSON için event argümanı serileştirici: bigint -> string, dizi -> dizi (uint32[5] vb.),
 *      bool/string/number aynen. Handler'lar string biçimini (BigInt/Number/toString) zaten kabul eder.
 * [EN] Event-arg serializer for DLQ/JSON: bigint -> string, arrays stay arrays, primitives unchanged.
 */
function _serializeArgValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean" || typeof v === "string" || typeof v === "number") return v;
  if (Array.isArray(v)) return Array.from(v, _serializeArgValue);
  return _toStr(v);
}

/**
 * [TR] Event'in isimli argümanlarını güvenilir kurar. ethers v6 Result'ta isimli alanlar own property
 *      değildir (Object.entries yalnız indeks döner); bu yüzden önce event.fragment.inputs kullanılır.
 *      Düz nesne args (sentetik event) ve konumsal EVENT_ARG_KEYS eşlemesi yedek yoldur.
 * [EN] Reliably builds named event args. Named fields of an ethers v6 Result are not own properties
 *      (Object.entries only yields indices), so event.fragment.inputs is used first. Plain-object args
 *      and the positional EVENT_ARG_KEYS map are fallbacks.
 */
function _namedArgsFromEvent(event) {
  const args = event?.args;
  if (!args || typeof args !== "object") return {};
  const out = {};

  const inputs = event?.fragment?.inputs;
  if (Array.isArray(inputs)) {
    inputs.forEach((input, i) => {
      if (input?.name && args[i] !== undefined) out[input.name] = _serializeArgValue(args[i]);
    });
    if (Object.keys(out).length) return out;
  }

  for (const [key, value] of Object.entries(args)) {
    if (Number.isNaN(Number(key))) out[key] = _serializeArgValue(value);
  }
  if (Object.keys(out).length) return out;

  const keys = EVENT_ARG_KEYS[event?.eventName] || [];
  keys.forEach((key, i) => {
    if (args[i] !== undefined) out[key] = _serializeArgValue(args[i]);
  });
  return out;
}

function _positionalArgsFromEvent(event) {
  const args = event?.args;
  if (!args || typeof args !== "object") return [];
  return Array.isArray(args) ? Array.from(args, _serializeArgValue) : Object.values(args).map(_serializeArgValue);
}

/**
 * [TR] Zorunlu sayısal event alanı: undefined/null/boş ya da NaN ise throw eder (sessiz NaN yazımı yok).
 * [EN] Required numeric event field: throws on undefined/null/empty or NaN (no silent NaN writes).
 */
function _requireFiniteNumber(value, fieldName, eventName) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`[Worker] ${eventName}: '${fieldName}' alanı eksik.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`[Worker] ${eventName}: '${fieldName}' geçerli bir sayı değil (${String(value)}).`);
  }
  return n;
}

function _toIdentityString(v, { allowZero = false } = {}) {
  const normalized = _toStr(v).trim();
  const pattern = allowZero ? /^(0|[1-9]\d*)$/ : /^[1-9]\d*$/;
  if (!pattern.test(normalized)) {
    throw new Error(`[Worker] Geçersiz zincir kimliği: ${normalized || "empty"}`);
  }
  return normalized;
}

function _buildIdentityLookup(field, rawId) {
  const idString = _toIdentityString(rawId);
  return { [field]: idString };
}

/**
 * [TR] Lock anındaki reputation/ban aynası (read-model only, non-authoritative).
 * [EN] Lock-time reputation/ban mirror (read-model only, non-authoritative).
 */
function _buildReputationContextAtLock(user) {
  return {
    success_rate: user?.reputation_cache?.success_rate ?? null,
    failed_disputes: user?.reputation_cache?.failed_disputes ?? null,
    effective_tier: user?.reputation_cache?.effective_tier ?? null,
    consecutive_bans: user?.consecutive_bans ?? null,
    is_banned: user?.is_banned ?? null,
    banned_until: user?.banned_until ?? null,
    manual_release_count: user?.reputation_breakdown?.manual_release_count ?? null,
    burn_count: user?.reputation_breakdown?.burn_count ?? null,
    auto_release_count: user?.reputation_breakdown?.auto_release_count ?? null,
    mutual_cancel_count: user?.reputation_breakdown?.mutual_cancel_count ?? null,
    disputed_resolved_count: user?.reputation_breakdown?.disputed_resolved_count ?? null,
    dispute_win_count: user?.reputation_breakdown?.dispute_win_count ?? null,
    dispute_loss_count: user?.reputation_breakdown?.dispute_loss_count ?? null,
    partial_settlement_count: user?.reputation_breakdown?.partial_settlement_count ?? null,
    risk_points: user?.reputation_breakdown?.risk_points ?? null,
  };
}

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

function _normalizePaymentRiskLevel(levelValue) {
  const n = Number(levelValue);
  if (n === 0) return "LOW";
  if (n === 2) return "HIGH";
  if (n === 3) return "RESTRICTED";
  return "MEDIUM";
}

function _toDateOrNull(unixSeconds) {
  const n = Number(unixSeconds || 0);
  return n > 0 ? new Date(n * 1000) : null;
}

function _inferCryptoAssetFromToken(tokenAddress) {
  return inferCryptoAssetFromTokenAddress(tokenAddress, { surface: "EventWorker" });
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

// [TR] Terminal geçiş uygulandı mı? (terminal status + timers.resolved_at dolu). resolved_at boşsa
//      mirror status'u getTrade ile terminale çekilmiş olsa bile geçiş (alanlar + sayaç) henüz uygulanmamıştır.
// [EN] Was the terminal transition applied? (terminal status + timers.resolved_at set). With resolved_at empty
//      the transition (fields + counters) is still pending even if the getTrade backfill already set the status.
function _isTerminalApplied(tradeDoc) {
  return TERMINAL_TRADE_STATES.has(tradeDoc?.status) && Boolean(tradeDoc?.timers?.resolved_at);
}

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
    this.vaultContract = null;
    this.rewardsContract = null;
    this.isRunning = false;
    this._lastCheckpointBlock = 0;
    this._state = "booting";
    this._reconnectPromise = null;
    this._listenersAttached = false;
    this._retrySuccessCount = 0;
    this._retryFailureCount = 0;
    this._blockAcks = new Map();
    this._lastSeenBlock = 0;
    this._lastBlockSeenAt = 0;
    this._stopRequested = false;
    this._quarantinedCount = 0;
    this._watchdogTimer = null;
    this._staleReconnects = 0;
    this._exitProcess = (code) => process.exit(code);
    this._lastSafeCheckpointBlock = 0;
    this._replayInProgress = false;
    this._replayFailureCount = 0;
    this._replayNextAttemptAt = 0;
    this._livePollInProgress = false;
    this._lastLivePolledBlock = 0;
    this._blockTimestampCache = new Map();
    this._ignoredEventsByReason = {};
    this._reconciliation = { lastRunAt: null, lastReport: null };
  }

  async start() {
    logger.info(`[Worker] V3 event listener başlatılıyor... (finalityDepth=${WORKER_FINALITY_DEPTH})`);

    const connectResult = await this._connect();
    if (connectResult?.disabled) {
      this.isRunning = false;
      return;
    }

    if (!this.contract) {
      this.isRunning = false;
      this._setState("dry-run", "provider/contract hazır değil");
      return;
    }

    this.isRunning = true;
    this._stopRequested = false;
    await this._replayMissedEvents();
    if (this._stopRequested) return; // stop() replay sırasında çağrıldı: canlı dinleyici bağlanmaz.
    this._lastLivePolledBlock = this._lastSafeCheckpointBlock;
    this._attachLiveListeners();
    logger.info("[Worker] V3 event listener aktif.");
  }

  /**
   * [TR] B19: start() (bağlan + replay) HTTP dinlemesini bloklamasın diye arka planda çalıştırılır. Replay
   *      sürerken /ready state="replaying" raporlar. Başlatma hatası onFatal'a iletilir.
   * [EN] B19: runs start() (connect + replay) in the background so it cannot block the HTTP listener. While the
   *      replay runs /ready reports state="replaying". A start failure is handed to onFatal.
   */
  startInBackground({ onFatal } = {}) {
    this._startPromise = this.start().catch((err) => {
      logger.error(`[Worker] Arka plan başlatma hatası: ${err.message}`);
      if (typeof onFatal === "function") onFatal(err);
    });
    return this._startPromise;
  }

  async stop() {
    this.isRunning = false;
    this._stopRequested = true;
    this._stopWatchdog();
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

  _resetConnectionState() {
    if (this.provider?.removeAllListeners) {
      try {
        this.provider.removeAllListeners();
      } catch (err) {
        logger.warn(`[Worker] removeAllListeners cleanup başarısız: ${err.message}`);
      }
    }

    this.provider = null;
    this.contract = null;
    this.vaultContract = null;
    this.rewardsContract = null;
    this._listenersAttached = false;
  }

  /**
   * [TR] Event adına göre doğru kaynak kontratı döndürür (escrow / vault / rewards).
   *      Vault/rewards adresi tanımlı değilse null döner ve o event'ler atlanır.
   * [EN] Returns the emitting contract for an event name (escrow / vault / rewards).
   *      Returns null when vault/rewards is not configured so those events are skipped.
   */
  _contractForEvent(eventName) {
    if (VAULT_EVENT_NAMES.includes(eventName)) return this.vaultContract;
    if (REWARDS_EVENT_NAMES.includes(eventName)) return this.rewardsContract;
    return this.contract;
  }

  async _connect() {
    const isProduction = process.env.NODE_ENV === "production";
    const rpcUrl = process.env.BASE_RPC_URL || null;
    const contractAddress = process.env.ARAF_ESCROW_ADDRESS;
    const isWorkerDisabled = String(process.env.WORKER_DISABLED || "").toLowerCase() === "true";

    // [TR] Worker explicit olarak devre dışıysa bağlantı kurma.
    // [EN] Do not establish provider/contract when worker is explicitly disabled.
    if (isWorkerDisabled) {
      this._resetConnectionState();
      this.isRunning = false;
      this._setState("disabled", "WORKER_DISABLED=true");
      logger.warn("[Worker] WORKER_DISABLED=true — event worker başlatılmadı.");
      return { disabled: true };
    }

    if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
      if (isProduction) {
        logger.error("[Worker] KRİTİK: ARAF_ESCROW_ADDRESS tanımlı değil. Durduruluyor.");
        process.exit(1);
      }
      this._resetConnectionState();
      this.isRunning = false;
      this._setState("dry-run", "kontrat adresi tanımlı değil");
      logger.warn("[Worker] Kontrat adresi yok — Worker kuru çalışma modunda (development).");
      return;
    }

    if (!rpcUrl) {
      throw new Error("[Worker] KRİTİK: BASE_RPC_URL zorunludur (public mainnet fallback kapalı).");
    }

    const wsRpcUrl = process.env.BASE_WS_RPC_URL;

    if (wsRpcUrl && wsRpcUrl.startsWith("wss://")) {
      try {
        this.provider = new ethers.WebSocketProvider(wsRpcUrl);
        this._watchWebSocketClose(this.provider);
        logger.info("[Worker] WebSocket RPC bağlandı.");
      } catch (err) {
        logger.warn(`[Worker] WebSocket başarısız, HTTP fallback: ${err.message}`);
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
      }
    } else {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      if (isProduction) logger.warn("[Worker] HTTP RPC kullanılıyor. BASE_WS_RPC_URL önerilir.");
    }

    await assertProviderExpectedChainOrThrow(this.provider, {
      rpcUrl,
      rpcEnvName: "BASE_RPC_URL",
      surface: "EventWorker",
    });

    this.contract = new ethers.Contract(contractAddress, ARAF_ABI, this.provider);
    logger.info(`[Worker] Kontrat izleniyor: ${contractAddress}`);

    const vaultAddress = process.env.ARAF_REVENUE_VAULT_ADDRESS;
    const rewardsAddress = process.env.ARAF_REWARDS_ADDRESS;
    this.vaultContract = _isConfiguredAddress(vaultAddress)
      ? new ethers.Contract(vaultAddress, ARAF_ABI, this.provider)
      : null;
    this.rewardsContract = _isConfiguredAddress(rewardsAddress)
      ? new ethers.Contract(rewardsAddress, ARAF_ABI, this.provider)
      : null;
    if (!this.vaultContract || !this.rewardsContract) {
      logger.warn("[Worker] ARAF_REVENUE_VAULT_ADDRESS / ARAF_REWARDS_ADDRESS eksik — reward mirror event'leri izlenmiyor.");
    }
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
    const currentHead = await this.provider.getBlockNumber();
    const finalizedToBlock = this._computeFinalizedUpTo(currentHead);

    if (savedBlock !== null && savedBlock !== undefined) {
      const checkpoint = Number(savedBlock);
      if (!Number.isInteger(checkpoint) || checkpoint < 0) {
        throw new Error(`[Worker] Geçersiz checkpoint değeri: ${savedBlock}`);
      }
      if (checkpoint > currentHead) {
        throw new Error(
          `[Worker] Checkpoint current block'u aşıyor: checkpoint=${checkpoint} current=${currentHead}`
        );
      }
      this._lastSafeCheckpointBlock = checkpoint;
    }

    if (finalizedToBlock <= 0) return;

    const fromBlock = this._resolveReplayStartBlock(savedBlock, currentHead);

    if (fromBlock > finalizedToBlock) {
      // [TR] B3: başlangıç bloğu finalized head'in üstündeyse replay ertelenir, ama bellekteki checkpoint
      //      max(başlangıç-1, mevcut) olur. Aksi halde start() canlı poll'u checkpoint 0'dan başlatır ve
      //      blok 1'den itibaren devasa bir aralık taranırdı.
      // [EN] B3: when the start block is above the finalized head the replay is deferred, but the in-memory
      //      checkpoint becomes max(start-1, current). Otherwise start() would begin the live poll from
      //      checkpoint 0 and scan a huge range from block 1.
      this._lastSafeCheckpointBlock = Math.max(this._lastSafeCheckpointBlock, fromBlock - 1);
      return;
    }

    const previousState = this._state;
    this._setState("replaying", `replay aralığı: ${fromBlock}-${finalizedToBlock}`);

    try {
      for (let from = fromBlock; from <= finalizedToBlock; from += BLOCK_BATCH_SIZE) {
        // [TR] stop() süren replay'i durdurur (kapanış sırasında DB/Redis yazımı sürmesin).
        // [EN] stop() halts an in-flight replay so writes do not continue during shutdown.
        if (this._stopRequested) return;
        const to = Math.min(from + BLOCK_BATCH_SIZE - 1, finalizedToBlock);
        let allEvents;
        try {
          allEvents = await this._fetchRangeEvents(from, to);
        } catch (err) {
          // [TR] Aralık okunamadıysa checkpoint ilerletilmez; bir sonraki replay aynı aralığı yeniden dener.
          //      (Eskiden tek bir event sorgusu düşerse o event tipi sessizce atlanıp checkpoint ilerliyordu.)
          // [EN] If the range cannot be read the checkpoint does not move; the next replay retries it.
          logger.warn(`[Worker] Replay: log sorgusu başarısız (${from}-${to}): ${err.message}`);
          this._noteReplayFailure();
          return;
        }

        let failedEvents = 0;
        for (const event of allEvents) {
          if (this._stopRequested) return;
          // [TR] Karantinadaki (acked-poison) event atlanır; checkpoint onun yüzünden takılmaz.
          // [EN] A quarantined (acked-poison) event is skipped so the checkpoint is not stuck on it.
          if (await this._isQuarantined(event)) continue;
          try {
            await this._processEvent(event);
          } catch (err) {
            logger.error(`[Worker] Replay event işleme hatası: ${event.eventName} - ${err.message}`);
            await this._addToDLQ(event, err.message);
            failedEvents += 1;
          }
        }

        if (failedEvents > 0) {
          // [TR] B2: İlk başarısız batch'te DUR. Döngü devam ederse sonraki batch'in checkpoint'i başarısız
          //      batch'i de geçerek ileri taşırdı ve o batch'in event'leri bir daha replay edilmezdi.
          //      Checkpoint, başarısız batch'in başından önce kalır.
          // [EN] B2: stop at the FIRST failed batch. Continuing would let a later batch move the checkpoint
          //      past the failed one so its events would never be replayed. The checkpoint stays before the
          //      start of the failed batch.
          logger.error(
            `[Worker] Replay durduruldu: ${from}-${to} aralığında ${failedEvents} event başarısız. ` +
            `Checkpoint ilerletilmedi (safe=${this._lastSafeCheckpointBlock}).`
          );
          this._noteReplayFailure();
          return;
        }

        await this._updateSafeCheckpointIfHigher(to);
      }

      this._noteReplaySuccess();
      logger.info("[Worker] Replay tamamlandı.");
    } finally {
      // [TR] Replay bittiğinde durum "replaying"de takılı kalmamalı (canlı periyodik replay sonrası /ready
      //      sonsuza dek 503 dönerdi).
      // [EN] The state must not stay stuck at "replaying" (after a periodic live replay /ready would be 503 forever).
      if (this._state === "replaying") {
        this._setState(previousState === "replaying" ? "connected" : previousState, "replay bitti");
      }
    }
  }

  // [TR] Replay başarısızlıklarında üstel geri çekilme (B9): canlı dinleyici her blokta (~2 sn) aynı başarısız
  //      aralığı yeniden replay edip DLQ/RPC'yi doldurmasın.
  // [EN] Exponential backoff on replay failures (B9): the live listener must not re-replay the same failing
  //      range every block (~2s) and hammer the DLQ/RPC.
  _noteReplayFailure() {
    this._replayFailureCount += 1;
    const delay = Math.min(
      REPLAY_BACKOFF_BASE_MS * 2 ** (this._replayFailureCount - 1),
      REPLAY_BACKOFF_MAX_MS
    );
    this._replayNextAttemptAt = Date.now() + delay;
  }

  _noteReplaySuccess() {
    this._replayFailureCount = 0;
    this._replayNextAttemptAt = 0;
  }

  _shouldTriggerLiveReplay(blockNumber) {
    return (
      !this._replayInProgress &&
      blockNumber - this._lastSafeCheckpointBlock >= CHECKPOINT_INTERVAL_BLOCKS &&
      Date.now() >= this._replayNextAttemptAt
    );
  }

  async _runLiveReplay() {
    this._replayInProgress = true;
    try {
      await this._replayMissedEvents();
    } catch (err) {
      this._noteReplayFailure();
      throw err;
    } finally {
      this._replayInProgress = false;
    }
  }

  _attachLiveListeners() {
    if (!this.contract || this._listenersAttached) return;

    this._lastBlockSeenAt = Date.now();
    this._startWatchdog();

    this.provider.on("block", async (blockNumber) => {
      // [TR] B6: watchdog için "son blok görülme" zamanı (poll meşgul olsa bile güncellenir).
      // [EN] B6: "last block seen" time for the watchdog (updated even when a poll is in flight).
      this._lastBlockSeenAt = Date.now();
      this._staleReconnects = 0;
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

        const finalizedUpTo = this._computeFinalizedUpTo(blockNumber);
        if (finalizedUpTo > this._lastSafeCheckpointBlock) {
          await this._advanceSafeCheckpointFromAcks(finalizedUpTo);
        }

        if (this._shouldTriggerLiveReplay(blockNumber)) {
          await this._runLiveReplay();
        }
      } catch (err) {
        logger.error(`[Worker] Live block-range poll hatası: ${err.message}`);
      } finally {
        this._livePollInProgress = false;
      }
    });

    this.provider.on("error", (err) => {
      logger.error(`[Worker] Provider hatası: ${err?.message}. Yeniden bağlanılıyor...`);
      this._recoverOrExit("provider error");
    });

    this._listenersAttached = true;
    this._setState("live", "canlı block-range listener bağlandı");
  }

  /**
   * [TR] B6: ethers v6 WebSocketProvider soket kapanınca "error" yaymaz; worker sessizce dururdu. Ham soketin
   *      close/error olayları dinlenir. Eski (yok edilmiş) provider'ın kapanışı yok sayılır.
   * [EN] B6: ethers v6 WebSocketProvider emits no "error" when the socket closes, so the worker silently stalled.
   *      The raw socket's close/error events are listened to. Closes of a superseded provider are ignored.
   */
  _watchWebSocketClose(provider) {
    const socket = provider?.websocket;
    if (!socket) return;
    const onClose = (reason) => {
      if (this.provider !== provider || !this.isRunning) return;
      logger.error(`[Worker] WebSocket kapandı/hata verdi (${reason?.code ?? reason?.message ?? "unknown"}).`);
      this._recoverOrExit("websocket close");
    };
    if (typeof socket.addEventListener === "function") {
      socket.addEventListener("close", onClose);
      socket.addEventListener("error", onClose);
    } else if (typeof socket.on === "function") {
      socket.on("close", onClose);
      socket.on("error", onClose);
    }
  }

  // [TR] Yeniden bağlanmayı dener; başarısızsa süreç çıkar (Fly yeniden başlatır).
  // [EN] Tries to reconnect; on failure the process exits (Fly restarts it).
  _recoverOrExit(reason) {
    return this._reconnect().catch((err) => {
      logger.error(`[Worker] Yeniden bağlanma başarısız (${reason}): ${err?.message}`);
      this._fatalExit(`reconnect failed after ${reason}`);
    });
  }

  _fatalExit(reason) {
    logger.error(`[Worker] KRİTİK: ${reason}. process.exit(1).`);
    this._exitProcess(1);
  }

  _startWatchdog() {
    if (this._watchdogTimer) return;
    this._watchdogTimer = setInterval(() => {
      this._watchdogTick().catch((err) => logger.error(`[Worker] Watchdog hatası: ${err.message}`));
    }, WATCHDOG_INTERVAL_MS);
    if (typeof this._watchdogTimer.unref === "function") this._watchdogTimer.unref();
  }

  _stopWatchdog() {
    if (this._watchdogTimer) clearInterval(this._watchdogTimer);
    this._watchdogTimer = null;
  }

  /**
   * [TR] B6 "son blok görülme" watchdog'u: BLOCK_STALE_MS boyunca blok yoksa bir kez _reconnect dener; reconnect
   *      sonrası da blok gelmezse (ya da reconnect patlarsa) process.exit(1).
   * [EN] B6 "last block seen" watchdog: with no block for BLOCK_STALE_MS it tries one _reconnect; if still no
   *      block afterwards (or the reconnect fails) it calls process.exit(1).
   */
  async _watchdogTick() {
    if (!this.isRunning || this._state === "stopped" || this._reconnectPromise) return;
    if (!this._lastBlockSeenAt) return;

    const idleMs = Date.now() - this._lastBlockSeenAt;
    if (idleMs < BLOCK_STALE_MS) return;

    if (this._staleReconnects >= 1) {
      this._fatalExit(`yeniden bağlanmaya rağmen ${Math.round(idleMs / 1000)} sn blok görülmedi`);
      return;
    }

    this._staleReconnects += 1;
    logger.error(`[Worker] ${Math.round(idleMs / 1000)} sn'dir yeni blok yok; yeniden bağlanılıyor.`);
    await this._recoverOrExit("block stall");
    this._lastBlockSeenAt = Date.now();
  }

  // [TR] /health için bellek içi canlılık özeti (RPC çağırmaz).
  // [EN] In-memory liveness summary for /health (no RPC calls).
  getLivenessSnapshot() {
    const ageMs = this._lastBlockSeenAt ? Date.now() - this._lastBlockSeenAt : null;
    const watching = this.isRunning && this._state !== "replaying" && ageMs !== null;
    return {
      isRunning: this.isRunning,
      state: this._state,
      lastBlockAgeMs: ageMs,
      stale: Boolean(watching && ageMs > LIVENESS_STALE_MS),
    };
  }

  /**
   * [TR] Bir blok aralığındaki tüm izlenen event'leri TEK eth_getLogs çağrısıyla okur (escrow + vault +
   *      rewards adresleri tek filtrede). Eskiden her event tipi için ayrı sorgu (~33/aralık) atılıyordu ve
   *      canlı dinleyici bunu her blokta yapıyordu. Her log yalnız kendi kaynak kontratının izlenen event'i
   *      ise kabul edilir; sıralama blok + log index'e göredir.
   * [EN] Reads every watched event in a block range with ONE eth_getLogs call (escrow + vault + rewards
   *      addresses in one filter) instead of one query per event type (~33 per range, on every block).
   *      A log is accepted only if it is a watched event of the contract that emitted it.
   */
  async _fetchRangeEvents(fromBlock, toBlock) {
    const sources = new Map();
    for (const source of [this.contract, this.vaultContract, this.rewardsContract]) {
      const address = typeof source?.target === "string" ? source.target.toLowerCase() : null;
      if (address) sources.set(address, source);
    }
    if (sources.size === 0) return [];

    const logs = await this.provider.getLogs({ address: [...sources.keys()], fromBlock, toBlock });
    const events = [];
    for (const log of logs || []) {
      const source = sources.get(String(log.address || "").toLowerCase());
      if (!source || !log.topics?.length) continue;
      let fragment = null;
      try {
        fragment = source.interface.getEvent(log.topics[0]);
      } catch (_) {
        fragment = null;
      }
      if (!fragment || !EVENT_NAME_SET.has(fragment.name)) continue;
      if (this._contractForEvent(fragment.name) !== source) continue;
      events.push(new ethers.EventLog(log, source.interface, fragment));
    }
    events.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    return events;
  }

  async _pollLiveRange(fromBlock, toBlock) {
    if (!this.contract || fromBlock > toBlock) return;

    for (let from = fromBlock; from <= toBlock; from += BLOCK_BATCH_SIZE) {
      const to = Math.min(from + BLOCK_BATCH_SIZE - 1, toBlock);

      try {
        const allEvents = await this._fetchRangeEvents(from, to);
        this._seedAckStateForRange(from, to);

        for (const event of allEvents) {
          this._trackLiveEventSeen(event);
          // [TR] Karantinadaki event işlenmez, ack'lenmiş (acked-poison) sayılır.
          // [EN] A quarantined event is not processed and counts as acked (acked-poison).
          const success = (await this._isQuarantined(event)) || (await this._processEventWithRetry(event));
          if (success) this._trackLiveEventAck(event);
          else this._markBlockUnsafe(event.blockNumber, this._getEventId(event));
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

    // [TR] failed: bu bloktaki başarısız event kimlikleri; rangeUnsafe: log aralığı okunamadı (event'e bağlı değil).
    // [EN] failed: ids of failed events in this block; rangeUnsafe: the log range itself could not be read.
    const state = { seen: new Set(), acked: new Set(), failed: new Set(), unsafe: false, rangeUnsafe: false };
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
      // [TR] Checkpoint geçilen bloklar artık kalıcı; bellekteki ack/unsafe kayıtları da temizlenir.
      // [EN] Blocks behind the checkpoint are durable now; drop their in-memory ack/unsafe records too.
      for (const block of [...this._blockAcks.keys()]) {
        if (block <= blockNumber) this._blockAcks.delete(block);
      }
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
    return `${event?.transactionHash || "unknown_tx"}:${Number.isInteger(_logIndexOf(event)) ? _logIndexOf(event) : -1}`;
  }

  _trackLiveEventSeen(event) {
    const state = this._ensureBlockAckState(event.blockNumber);
    state.seen.add(this._getEventId(event));
  }

  _trackLiveEventAck(event) {
    const state = this._ensureBlockAckState(event.blockNumber);
    state.acked.add(this._getEventId(event));
  }

  _markBlockUnsafe(blockNumber, eventId = null) {
    const state = this._ensureBlockAckState(blockNumber);
    state.unsafe = true;
    if (eventId) {
      if (!state.failed) state.failed = new Set();
      state.failed.add(eventId);
    } else {
      state.rangeUnsafe = true;
    }
  }

  /**
   * [TR] DLQ re-drive başarılı olunca event ack'lenir ve blok, yalnızca bu event yüzünden unsafe ise
   *      tekrar güvenli sayılır (aksi halde checkpoint sonsuza dek o blokta takılırdı).
   * [EN] A successful DLQ re-drive acks the event and clears the block's unsafe flag when this event
   *      was the only reason for it (otherwise the checkpoint would stay stuck on that block forever).
   */
  _clearEventUnsafe(event) {
    const state = this._blockAcks.get(event?.blockNumber);
    if (!state) return;
    const eventId = this._getEventId(event);
    state.seen.add(eventId);
    state.acked.add(eventId);
    if (state.failed) state.failed.delete(eventId);
    if (!state.rangeUnsafe && (!state.failed || state.failed.size === 0)) {
      state.unsafe = false;
    }
  }

  _computeFinalizedUpTo(blockNumber) {
    if (!Number.isInteger(blockNumber)) return 0;
    return blockNumber - WORKER_FINALITY_DEPTH;
  }

  /**
   * [TR] Sıralama koruması (B20): mutable mirror'lar (itibar, fee/cooldown/policy config) için scope başına
   *      son uygulanan (blockNumber, logIndex) Redis'te tutulur; daha eski bir event (replay / DLQ re-drive /
   *      canlı-poll çakışması) yeni değeri ezemez. Model şemasına dokunmadan Redis kullanılır.
   *      Eşit konum (aynı event'in tekrarı) idempotent olarak yeniden uygulanır.
   * [EN] Ordering guard (B20): for mutable mirrors (reputation, fee/cooldown/policy config) the last applied
   *      (blockNumber, logIndex) per scope lives in Redis; an older event (replay / DLQ re-drive / live-poll
   *      overlap) cannot overwrite a newer value. Redis is used so the model schema stays untouched.
   *      An equal position (the same event again) is re-applied idempotently.
   */
  _eventOrderOf(event) {
    const block = Number(event?.blockNumber);
    if (!Number.isInteger(block) || block < 0) return null;
    const index = _logIndexOf(event);
    return { block, index: Number.isInteger(index) && index > 0 ? index : 0 };
  }

  async _isStaleOrderedEvent(scope, event) {
    const order = this._eventOrderOf(event);
    if (!order) return false;

    const raw = await getRedisClient().get(`${APPLIED_ORDER_KEY_PREFIX}${scope}`);
    if (raw === null || raw === undefined || raw === "") return false;

    const [appliedBlock, appliedIndex] = String(raw).split(":").map(Number);
    if (!Number.isInteger(appliedBlock) || !Number.isInteger(appliedIndex)) return false;

    const stale =
      order.block < appliedBlock || (order.block === appliedBlock && order.index < appliedIndex);
    if (stale) {
      logger.info(
        `[Worker] Eski event yok sayıldı (sıralama koruması): scope=${scope} ` +
        `event=${order.block}:${order.index} applied=${appliedBlock}:${appliedIndex}`
      );
    }
    return stale;
  }

  async _markOrderedEventApplied(scope, event) {
    const order = this._eventOrderOf(event);
    if (!order) return;
    await getRedisClient().set(`${APPLIED_ORDER_KEY_PREFIX}${scope}`, `${order.block}:${order.index}`);
  }

  _countIgnoredEvent(reason) {
    const key = String(reason || "unknown_reason");
    this._ignoredEventsByReason[key] = (this._ignoredEventsByReason[key] || 0) + 1;
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

      const oldProvider = this.provider;
      if (oldProvider) {
        // [TR] Önce referansı bırak: yok edilen soketin close olayı yeni reconnect tetiklemesin.
        // [EN] Drop the reference first so the destroyed socket's close event cannot trigger another reconnect.
        this.provider = null;
        try {
          oldProvider.removeAllListeners();
          if (oldProvider.destroy) await oldProvider.destroy();
        } catch (_) {}
        this.contract = null;
        this.vaultContract = null;
        this.rewardsContract = null;
        this._listenersAttached = false;
        this._livePollInProgress = false;
        this._blockTimestampCache.clear();
      }

      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      await this._connect();
      await this._replayMissedEvents();

      this._lastLivePolledBlock = this._lastSafeCheckpointBlock;
      this._lastBlockSeenAt = Date.now();
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

  /**
   * [TR] Başarısız event'i DLQ'ya yazar. Kayıt idempotencyKey (txHash:logIndex) ile tekildir: aynı poison
   *      event her replay'de yeniden eklenmez (eskiden DLQ kopyalarla dolup gerçek girdiler arşive itiliyordu).
   *      namedArgs, ethers v6 Result'ın isimli alanları own property olmadığı için event.fragment.inputs
   *      üzerinden kurulur. Yeni kayıt yazıldıysa true, zaten varsa false döner.
   * [EN] Writes a failed event to the DLQ. Entries are unique per idempotencyKey (txHash:logIndex) so a
   *      poison event is not re-appended on every replay. namedArgs are built from event.fragment.inputs
   *      because named fields of an ethers v6 Result are not own properties. Returns true when a new
   *      entry was written, false when one already existed.
   */
  async _addToDLQ(event, errorMsg) {
    const redis = getRedisClient();
    const nowIso = new Date().toISOString();
    const idempotencyKey = this._getEventId(event);

    // [TR] Tekil kontrol: canlı DLQ + arşiv + karantina indeks setlerine bakılır (liste taraması yok).
    // [EN] Uniqueness check against the live-DLQ + archive + quarantine index sets (no list scan).
    for (const set of [DLQ_LIVE_KEYS_SET, DLQ_ARCHIVE_KEYS_SET, DLQ_QUARANTINE_KEYS_SET]) {
      if (await redis.sIsMember(set, idempotencyKey)) {
        logger.debug(`[Worker] DLQ kaydı zaten var (${set}), tekrar eklenmedi: ${idempotencyKey}`);
        return false;
      }
    }

    const entry = JSON.stringify({
      eventName: event.eventName,
      txHash: event.transactionHash,
      logIndex: _logIndexOf(event) ?? null,
      idempotencyKey,
      blockNumber: event.blockNumber,
      namedArgs: _namedArgsFromEvent(event),
      args: _positionalArgsFromEvent(event),
      attempt: 0,
      next_retry_at: nowIso,
      first_seen_at: nowIso,
      last_error: errorMsg,
    });

    await redis.rPush(DLQ_KEY, entry);
    await redis.sAdd(DLQ_LIVE_KEYS_SET, idempotencyKey);
    return true;
  }

  async _isQuarantined(event) {
    return Boolean(await getRedisClient().sIsMember(DLQ_QUARANTINE_KEYS_SET, this._getEventId(event)));
  }

  /**
   * [TR] MAX_REDRIVE_ATTEMPTS aşılan girdi karantinaya alındığında çağrılır: event "acked-poison" sayılır,
   *      bloğun unsafe bayrağı kalkar ve checkpoint ilerleyebilir. Alarm: logger.error + sayaç (diagnostics).
   * [EN] Called when an entry exceeds MAX_REDRIVE_ATTEMPTS and is quarantined: the event becomes "acked-poison",
   *      the block's unsafe flag clears and the checkpoint may advance. Alarm: logger.error + counter.
   */
  markEventQuarantined(entry) {
    const event = this.buildSyntheticEventFromDLQEntry(entry);
    this._quarantinedCount += 1;
    this._clearEventUnsafe(event);
    logger.error(
      `[Worker][ALARM] Event karantinaya alındı (acked-poison): ${entry.eventName} key=${this._getEventId(event)} ` +
      `block=${entry.blockNumber} toplam_karantina=${this._quarantinedCount}`
    );
  }

  /**
   * [TR] DLQ kaydını sentetik event'e çevirip (buildSyntheticEventFromDLQEntry) işler. Eskiden yalnız
   *      `entry.namedArgs || {}` kullanılıyordu; namedArgs boş olduğu için handler'lar boş args ile çalışıyordu.
   *      Başarıda ack kaydı/unsafe bayrağı temizlenir, başarısızlıkta blok unsafe kalır.
   * [EN] Re-drives a DLQ entry through the synthetic-event builder. Success clears the ack/unsafe record,
   *      failure keeps the block unsafe.
   */
  async reDriveEvent(entry) {
    const event = this.buildSyntheticEventFromDLQEntry(entry);

    const result = await this._processEventWithRetryNoDLQ(event);
    if (result.success) {
      this._clearEventUnsafe(event);
    } else {
      this._markBlockUnsafe(event.blockNumber, this._getEventId(event));
    }
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

  async _fetchTerminalResolutionType(tradeId) {
    if (!this.contract?.getRewardableTrade) return null;
    // [TR] B13: okuma hatası YUTULMAZ. Eskiden null dönüp trade kalıcı "UNKNOWN" yazılıyordu; artık handler
    //      throw eder ve event standart retry/DLQ akışına girer.
    // [EN] B13: read errors are NOT swallowed. Previously null was returned and the trade was permanently
    //      written as "UNKNOWN"; now the handler throws and the event goes through the retry/DLQ flow.
    const view = await this.contract.getRewardableTrade(tradeId);
    return TERMINAL_OUTCOME_TO_RESOLUTION[_toNum(view?.outcome ?? view?.[9])] || null;
  }

  async _upsertOrderMirror(orderData, opts = {}) {
    const orderId = _toIdentityString(orderData.id);
    const payload = {
      onchain_order_id: orderId,
      owner_address: orderData.owner.toLowerCase(),
      side: _normalizeSide(orderData.side),
      status: _normalizeOrderState(orderData.state),
      tier: _toNum(orderData.tier),
      token_address: orderData.tokenAddress.toLowerCase(),
      // [TR] Dotted path: nested obje fiat_currency/exchange_rate enrichment'ını her fill/iptalde silerdi.
      // [EN] Dotted path: a nested object would wipe fiat_currency/exchange_rate on every fill/cancel.
      "market.crypto_asset": _inferCryptoAssetFromToken(orderData.tokenAddress),
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
      payment_risk_level: _normalizePaymentRiskLevel(orderData.paymentRiskLevel),
      refs: {
        order_ref: (_toStr(orderData.orderRef) || "").toLowerCase(),
      },
      "timers.created_at_onchain": opts.createdAt || undefined,
      "timers.last_filled_at": opts.lastFilledAt || undefined,
      "timers.canceled_at": opts.canceledAt || undefined,
    };

    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

    const orderDoc = await Order.findOneAndUpdate(
      _buildIdentityLookup("onchain_order_id", orderId),
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
        new: true,
        session: opts.session,
        setDefaultsOnInsert: true,
      }
    );

    return this._applyPendingMarketMeta(orderDoc, opts.session);
  }

  /**
   * [TR] Maker'ın POST /orders/market-meta ile bıraktığı kur/fiat niyetini, order mirror
   *      oluştuğunda ve sahibi eşleştiğinde uygular (set-once). Güncel market bilgisini döndürür.
   * [EN] Applies the maker's pending fiat/rate intent once the order mirror exists and the
   *      owner matches (set-once). Returns the effective market enrichment.
   */
  async _applyPendingMarketMeta(orderDoc, session) {
    const currentMarket = orderDoc?.market || null;
    if (!orderDoc?.refs?.order_ref || Number(currentMarket?.exchange_rate) > 0) return currentMarket;

    const owner = String(orderDoc.owner_address || "").toLowerCase();
    let intent = null;
    try {
      intent = await readPendingMarketMeta(orderDoc.refs.order_ref, owner);
    } catch (err) {
      logger.warn(`[Worker] market meta niyeti okunamadı: ${err.message}`);
      return currentMarket;
    }
    if (!intent || intent.owner !== owner) return currentMarket;

    await Order.updateOne(
      { onchain_order_id: orderDoc.onchain_order_id, "market.exchange_rate": null },
      { $set: { "market.fiat_currency": intent.fiat_currency, "market.exchange_rate": intent.exchange_rate } },
      { session }
    );
    return { ...(currentMarket || {}), fiat_currency: intent.fiat_currency, exchange_rate: intent.exchange_rate };
  }

  async _upsertTradeMirror(tradeData, opts = {}) {
    const tradeId = _toIdentityString(tradeData.id);
    const parentOrderId = _toIdentityString(tradeData.parentOrderId, { allowZero: true });
    const parentOrder =
      opts.parentOrder || (parentOrderId !== "0" ? await this._fetchOrderFromChain(parentOrderId) : null);

    const tradeOrigin = parentOrderId !== "0" ? "ORDER_CHILD" : "DIRECT_ESCROW";
    const parentOrderSide = parentOrder ? _normalizeSide(parentOrder.side) : null;
    const orderRef = parentOrder ? _toStr(parentOrder.orderRef).toLowerCase() : null;

    // [TR] Tüm nested alanlar dotted path ile set edilir. Nested obje ile $set yapmak;
    //      replay/yeniden işleme sırasında şifreli dekontu (evidence.receipt_*), decay
    //      muhasebesini (financials.total_decayed / decay_tx_hashes) ve fiat/kur
    //      zenginleştirmesini sessizce silerdi.
    // [EN] All nested fields use dotted paths. A nested-object $set would silently wipe the
    //      encrypted receipt, decay accounting and fiat/rate enrichment on replay.
    const setPayload = {
      onchain_escrow_id: tradeId,
      parent_order_id: parentOrderId === "0" ? null : parentOrderId,
      trade_origin: tradeOrigin,
      parent_order_side: parentOrderSide,
      maker_address: tradeData.maker.toLowerCase(),
      taker_address:
        tradeData.taker && tradeData.taker !== ethers.ZeroAddress
          ? tradeData.taker.toLowerCase()
          : null,
      token_address: tradeData.tokenAddress.toLowerCase(),
      "canonical_refs.order_ref": orderRef,
      "fee_snapshot.taker_fee_bps": _toNum(tradeData.takerFeeBpsSnapshot),
      "fee_snapshot.maker_fee_bps": _toNum(tradeData.makerFeeBpsSnapshot),
      payment_risk_level_snapshot: _normalizePaymentRiskLevel(tradeData.paymentRiskLevelSnapshot),
      "financials.crypto_amount": _toStr(tradeData.cryptoAmount),
      "financials.crypto_amount_num": _toSafeNum(tradeData.cryptoAmount),
      "financials.maker_bond": _toStr(tradeData.makerBond),
      "financials.maker_bond_num": _toSafeNum(tradeData.makerBond),
      "financials.taker_bond": _toStr(tradeData.takerBond),
      "financials.taker_bond_num": _toSafeNum(tradeData.takerBond),
      "financials.crypto_asset": _inferCryptoAssetFromToken(tradeData.tokenAddress),
      tier: _toNum(tradeData.tier),
      // [TR] B5: status burada $set EDİLMEZ. Insert'te $setOnInsert, güncellemede geriye gitmeyen koşullu
      //      ilerletme (_advanceTradeStatus) kullanılır; getTrade (head) eski/lag'li bir RPC'den geri kalırsa
      //      mirror'daki daha ileri durum ezilmez.
      // [EN] B5: status is NOT $set here. Insert uses $setOnInsert, updates use a monotonic conditional advance
      //      (_advanceTradeStatus) so a lagging RPC cannot overwrite a further-along mirror state.
      pinged_by_taker: Boolean(tradeData.pingedByTaker),
      challenge_pinged_by_maker: Boolean(tradeData.challengePingedByMaker),
    };

    if (opts.listingRef) setPayload["canonical_refs.listing_ref"] = opts.listingRef;
    // [TR] Dekont hash'i kontrat storage'ında tutulmaz; PaymentReported event'inden aynalanır.
    // [EN] The receipt hash is not in contract storage; it is mirrored from the PaymentReported event.

    // [TR] Parent order'daki maker kur/fiat bilgisi (UI enrichment) child trade'e fill anında kopyalanır.
    // [EN] Copy the maker's fiat/rate enrichment from the parent order into the child trade at fill time.
    const marketMeta = opts.marketMeta || null;
    if (marketMeta?.fiat_currency && Number(marketMeta?.exchange_rate) > 0) {
      setPayload["financials.fiat_currency"] = marketMeta.fiat_currency;
      setPayload["financials.exchange_rate"] = Number(marketMeta.exchange_rate);
    }

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
      setPayload["fill_metadata.fill_amount"] = _toStr(opts.fillAmount);
      setPayload["fill_metadata.fill_amount_num"] = _toSafeNum(opts.fillAmount);
      setPayload["fill_metadata.filler_address"] = opts.filler?.toLowerCase() || null;
      setPayload["fill_metadata.remaining_amount_after_fill"] = _toStr(opts.remainingAmountAfterFill ?? 0);
      setPayload["fill_metadata.remaining_amount_after_fill_num"] = _toSafeNum(opts.remainingAmountAfterFill ?? 0);
    }

    const nextStatus = _normalizeTradeState(tradeData.state);

    const result = await Trade.findOneAndUpdate(
      _buildIdentityLookup("onchain_escrow_id", tradeId),
      { $set: setPayload, $setOnInsert: { status: nextStatus } },
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

    if (!inserted) {
      await this._advanceTradeStatus(tradeId, nextStatus, opts.session);
    }

    return {
      inserted,
      doc: result?.value || null,
    };
  }

  /**
   * [TR] Trade status'unu yalnız ileri (ya da aynı) yönde ve terminal olmayan bir durumdan ilerletir.
   *      Terminal durum (RESOLVED/CANCELED/BURNED) asla değiştirilmez; geriye gidiş (_isTradeStateRegression)
   *      engellenir.
   * [EN] Advances trade status only forward and only from a non-terminal state. Terminal states are never
   *      changed; regressions (_isTradeStateRegression) are blocked.
   */
  async _advanceTradeStatus(tradeId, nextStatus, session) {
    if (!Object.prototype.hasOwnProperty.call(TRADE_STATE_ORDER, nextStatus)) return;
    const advanceFrom = Object.keys(TRADE_STATE_ORDER).filter(
      (state) =>
        state !== nextStatus &&
        !TERMINAL_TRADE_STATES.has(state) &&
        !_isTradeStateRegression(state, nextStatus)
    );
    if (advanceFrom.length === 0) return;

    await Trade.updateOne(
      {
        ..._buildIdentityLookup("onchain_escrow_id", tradeId),
        status: { $in: advanceFrom },
      },
      { $set: { status: nextStatus } },
      { session }
    );
  }

  async _incrementOrderFillStatsAtomically(orderId, fillAmount, session) {
    if (!orderId) return;

    const fillAmountStr = _toStr(fillAmount);
    const fillAmountNum = _toSafeNum(fillAmount);

    await Order.updateOne(
      _buildIdentityLookup("onchain_order_id", orderId),
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
    if (!event || typeof event !== "object") {
      this._countIgnoredEvent("malformed_event_object");
      return;
    }
    if (!event.eventName) {
      this._countIgnoredEvent("missing_event_name");
      return;
    }
    if (!event.args || typeof event.args !== "object") {
      this._countIgnoredEvent("malformed_event_args");
      return;
    }
    const handlers = {
      WalletRegistered: this._onWalletRegistered.bind(this),
      PaymentReported: this._onPaymentReported.bind(this),
      EscrowReleased: this._onEscrowReleased.bind(this),
      DisputeOpened: this._onDisputeOpened.bind(this),
      CancelProposed: this._onCancelProposed.bind(this),
      EscrowCanceled: this._onEscrowCanceled.bind(this),
      PaymentWindowExpired: this._onPaymentWindowExpired.bind(this),
      MakerPinged: this._onMakerPinged.bind(this),
      ReputationUpdated: this._onReputationUpdated.bind(this),
      BleedingDecayed: this._onBleedingDecayed.bind(this),
      EscrowBurned: this._onEscrowBurned.bind(this),
      SettlementProposed: this._onSettlementProposed.bind(this),
      SettlementRejected: this._onSettlementRejected.bind(this),
      SettlementWithdrawn: this._onSettlementWithdrawn.bind(this),
      SettlementExpired: this._onSettlementExpired.bind(this),
      SettlementFinalized: this._onSettlementFinalized.bind(this),
      OrderCreated: this._onOrderCreated.bind(this),
      OrderFilled: this._onOrderFilled.bind(this),
      OrderCanceled: this._onOrderCanceled.bind(this),
      FeeConfigUpdated: this._onFeeConfigUpdated.bind(this),
      CooldownConfigUpdated: this._onCooldownConfigUpdated.bind(this),
      ReputationPolicyUpdated: this._onReputationPolicyUpdated.bind(this),
      ReputationTierThresholdsUpdated: this._onReputationTierThresholdsUpdated.bind(this),
      TokenConfigUpdated: this._onTokenConfigUpdated.bind(this),
      ProtocolRevenueSent: this._onProtocolRevenueSent.bind(this),
      EscrowRevenueReceived: this._onEscrowRevenueReceived.bind(this),
      ExternalRewardFunded: this._onExternalRewardFunded.bind(this),
      ProductRewardFunded: this._onProductRewardFunded.bind(this),
      EpochRewardAllocated: this._onEpochRewardAllocated.bind(this),
      TradeOutcomeRecorded: this._onTradeOutcomeRecorded.bind(this),
      RewardClaimed: this._onRewardClaimed.bind(this),
    };

    const handler = handlers[event.eventName];
    if (handler) {
      await handler(event);
      return;
    }
    this._countIgnoredEvent(`unknown_event:${event.eventName}`);
  }

  async runReconciliationReport({ limit = 100 } = {}) {
    const max = Math.max(1, Number(limit) || 100);
    const terminalStatuses = [...TERMINAL_TRADE_STATES];

    // [TR] B22: resolved_at'i eksik terminal trade'ler DOĞRUDAN sorgulanır. Eskiden sıralamasız limit(100)
    //      terminal trade çekilip yalnız o örneklemde eksik aranıyordu; eski/yeni sorunlu kayıtlar kaçabiliyordu.
    // [EN] B22: terminal trades missing resolved_at are queried DIRECTLY. Previously an unsorted limit(100) sample
    //      of terminal trades was fetched and only that sample was checked, so problem rows could be missed.
    const missingFilter = { status: { $in: terminalStatuses }, "timers.resolved_at": null };
    const missingTerminalTimestamp = await Trade.find(missingFilter)
      .select("onchain_escrow_id status timers.resolved_at")
      .sort({ _id: -1 })
      .limit(max)
      .lean();

    let missingTerminalCount = missingTerminalTimestamp.length;
    try {
      missingTerminalCount = Math.max(missingTerminalCount, Number(await Trade.countDocuments(missingFilter)) || 0);
    } catch (_) {
      // [TR] Sayım başarısızsa örneklem uzunluğu kullanılır.
      // [EN] If counting fails the sample length is used.
    }

    // [TR] Tekrar projeksiyonu kontrolü son terminal trade'lerin en yeni örnekleminde yapılır.
    // [EN] The duplicate-projection check runs on the newest sample of terminal trades.
    const terminalTrades = await Trade.find({ status: { $in: terminalStatuses } })
      .select("onchain_escrow_id status timers.resolved_at")
      .sort({ _id: -1 })
      .limit(max)
      .lean();
    const seenByEscrowId = new Map();
    for (const t of terminalTrades) {
      const key = String(t.onchain_escrow_id || "").trim();
      if (key) seenByEscrowId.set(key, (seenByEscrowId.get(key) || 0) + 1);
    }

    const duplicateProjection = [...seenByEscrowId.entries()]
      .filter(([, count]) => count > 1)
      .map(([onchain_escrow_id, count]) => ({ onchain_escrow_id, count }));

    const unsafeAckBlocks = [...(this._blockAcks?.entries?.() || [])]
      .filter(([, state]) => Boolean(state?.unsafe))
      .map(([block]) => Number(block));

    let dlqPending = null;
    try {
      const redis = getRedisClient();
      dlqPending = Number(await redis.lLen(DLQ_KEY));
      if (!Number.isFinite(dlqPending)) dlqPending = null;
    } catch {
      dlqPending = null;
    }

    const ignoredHistogram = { ...(this._ignoredEventsByReason || {}) };
    const ignoredTotal = Object.values(ignoredHistogram).reduce((a, b) => a + Number(b || 0), 0);

    const categories = {
      terminal_trade_drift: missingTerminalCount,
      duplicate_projection: duplicateProjection.length,
      missing_terminal_timestamp: missingTerminalCount,
      dlq_pending: Number(dlqPending || 0),
      unsafe_ack_block: unsafeAckBlocks.length,
      ignored_event_total: ignoredTotal,
    };

    const report = {
      success: true,
      checkedAt: new Date().toISOString(),
      scanned: terminalTrades.length,
      categories,
      unsafeAckBlocks,
      ignoredEventReasonHistogram: ignoredHistogram,
      duplicateProjectionSample: duplicateProjection.slice(0, 20),
      missingTerminalTimestampSample: missingTerminalTimestamp.slice(0, 20).map((t) => ({
        onchain_escrow_id: t.onchain_escrow_id,
        status: t.status,
      })),
      dlqPending,
      driftCount: categories.terminal_trade_drift + categories.duplicate_projection,
    };

    this._reconciliation = { lastRunAt: report.checkedAt, lastReport: report };
    return report;
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
    // childListingRef is the contract ABI field name; backend treats it as a child-trade trace ref, not a V3 Listing primitive.
    const { orderId, tradeId, filler, fillAmount, remainingAmount, childListingRef } = event.args;
    const fillEventAt = await this._getEventDate(event);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const [orderData, tradeData] = await Promise.all([
        this._fetchOrderFromChain(orderId),
        this._fetchTradeFromChain(tradeId),
      ]);

      const marketMeta = await this._upsertOrderMirror(orderData, {
        lastFilledAt: fillEventAt,
        session,
      });

      const tradeUpsert = await this._upsertTradeMirror(tradeData, {
        parentOrder: orderData,
        marketMeta,
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
        tradeId: _toIdentityString(tradeId),
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
          _toIdentityString(orderId),
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

  async _captureLockedTradeSnapshot({
    tradeId,
    lockedAt,
    makerAddress,
    takerAddress,
    session,
  }) {
    const tradeIdNum = _toIdentityString(tradeId);
    if (!tradeIdNum) return;

    const normalizedMaker = makerAddress?.toLowerCase?.() || null;
    const normalizedTaker = takerAddress?.toLowerCase?.() || null;

    const [makerUser, takerUser] = await Promise.all([
      normalizedMaker
        ? User.findOne({ wallet_address: normalizedMaker })
            .select(
              "payout_profile bankChangeCount7d bankChangeCount30d lastBankChangeAt " +
              "reputation_cache reputation_breakdown is_banned banned_until consecutive_bans"
            )
            .lean()
        : null,
      normalizedTaker
        ? User.findOne({ wallet_address: normalizedTaker })
            .select(
              "payout_profile bankChangeCount7d bankChangeCount30d lastBankChangeAt " +
              "reputation_cache reputation_breakdown is_banned banned_until consecutive_bans"
            )
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
      "payout_snapshot.maker.reputation_context_at_lock": _buildReputationContextAtLock(makerUser),

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
      "payout_snapshot.taker.reputation_context_at_lock": _buildReputationContextAtLock(takerUser),
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
        ..._buildIdentityLookup("onchain_escrow_id", tradeIdNum),
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

  // ── Trade lifecycle handlers (B5 / B13 / B15) ───────────────────────────────

  /**
   * [TR] B15: "trade mirror yok" ile "zaten işlenmiş / durum ileride" ayrımı. Mirror yoksa throw eder
   *      (retry/DLQ akışı); varsa mevcut belgeyi döner ve çağıran idempotent olarak sessizce geçer.
   * [EN] B15: separates "trade mirror missing" from "already processed / state is further along". Throws when
   *      the mirror is missing (retry/DLQ flow); otherwise returns the doc so the caller skips idempotently.
   */
  async _requireTradeMirror(tradeId, eventName) {
    const existing = await Trade.findOne(_buildIdentityLookup("onchain_escrow_id", tradeId))
      .select("status")
      .lean();
    if (!existing) {
      throw new Error(`${eventName} geldi ama trade mirror bulunamadı.`);
    }
    return existing;
  }

  /**
   * [TR] B5: Terminal geçiş, mirror durumu ne olursa olsun (getTrade backfill'i status'u zaten RESOLVED/CANCELED/
   *      BURNED yapmış olabilir) resolved_at / resolution_type / receipt_delete_at alanlarını idempotent yazar.
   *      "Uygulanmış" işareti timers.resolved_at'tir: null ise geçiş henüz uygulanmamıştır. Order sayaçları da
   *      bu işarete bağlı olarak tam bir kez düşülür (insert +1 active ile dengeli).
   * [EN] B5: A terminal transition idempotently writes resolved_at / resolution_type / receipt_delete_at no
   *      matter what the mirror status is (the getTrade backfill may already have set RESOLVED/CANCELED/BURNED).
   *      The "applied" marker is timers.resolved_at: null means not applied yet. Order counters are decremented
   *      exactly once based on that marker (balanced with the insert-time +1 active).
   */
  async _applyTerminalTransition({ tradeIdNum, fromStates, terminalStatus, set, statsField, session }) {
    const trade = await Trade.findOneAndUpdate(
      {
        ..._buildIdentityLookup("onchain_escrow_id", tradeIdNum),
        status: { $in: [...fromStates, terminalStatus] },
        "timers.resolved_at": null,
      },
      { $set: { status: terminalStatus, ...set } },
      { new: true, session }
    );

    if (!trade) return null;

    if (trade.parent_order_id) {
      await Order.findOneAndUpdate(
        _buildIdentityLookup("onchain_order_id", trade.parent_order_id),
        { $inc: { "stats.active_child_trade_count": -1, [statsField]: 1 } },
        { session }
      );
    }
    return trade;
  }

  async _onPaymentReported(event) {
    const { tradeId, ipfsHash, timestamp } = event.args;
    const reportedAt = await this._getEventDate(event, timestamp);
    const canonicalHash = _toStr(ipfsHash);

    const updated = await Trade.findOneAndUpdate(
      {
        ..._buildIdentityLookup("onchain_escrow_id", tradeId),
        status: { $in: ["LOCKED", "PAID"] },
      },
      {
        $set: {
          status: "PAID",
          "evidence.ipfs_receipt_hash": canonicalHash,
          "evidence.receipt_timestamp": reportedAt,
          "timers.paid_at": reportedAt,
          // [TR] Kontrat reportPayment'ta iptal onaylarını sıfırlar; mirror bayat onay göstermemeli.
          // [EN] The contract clears cancel consents on reportPayment; the mirror must not show stale consent.
          ...CLEARED_CANCEL_PROPOSAL,
        },
      }
    );

    if (!updated) {
      const existing = await this._requireTradeMirror(tradeId, "PaymentReported");
      logger.info(`[Worker] PaymentReported idempotent-skip: trade=${_toStr(tradeId)} status=${existing.status}`);
    }
  }

  async _onEscrowReleased(event) {
    const { tradeId } = event.args;
    const resolvedAt = await this._getEventDate(event);
    const tradeIdNum = _toIdentityString(tradeId);
    let releaseResolutionType = "UNKNOWN";

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const existingTrade = await Trade.findOne(_buildIdentityLookup("onchain_escrow_id", tradeIdNum))
        .select("status timers.resolved_at")
        .lean();

      if (!existingTrade) {
        throw new Error("EscrowReleased geldi ama trade mirror bulunamadı.");
      }

      // [TR] Zaten uygulanmış terminal geçiş: idempotent no-op (RPC'ye bile gitmez).
      // [EN] Terminal transition already applied: idempotent no-op (does not even hit the RPC).
      if (_isTerminalApplied(existingTrade)) {
        logger.info(`[Worker] EscrowReleased idempotent-skip: trade=${tradeIdNum} status=${existingTrade.status}`);
        await session.abortTransaction();
        return;
      }

      // [TR] CHALLENGED, zincirde mirror edilen yaşam döngüsü durumudur; EscrowReleased'in CHALLENGED'dan
      //      gelmesi DISPUTED_RESOLUTION sınıflandırmasını deterministik yapar, backend otoritesi oluşturmaz.
      // [EN] CHALLENGED is an on-chain mirrored lifecycle state, so mapping EscrowReleased from CHALLENGED
      //      to DISPUTED_RESOLUTION is deterministic read-model classification, not backend authority.
      if (existingTrade.status === "CHALLENGED") {
        releaseResolutionType = "DISPUTED_RESOLUTION";
      } else {
        // [TR] Manuel/otomatik ayrımı heuristikle değil, kontratın terminal snapshot'ından okunur.
        //      Okuma hatası throw eder (B13): kalıcı "UNKNOWN" yazılmaz, event retry/DLQ'ya gider.
        // [EN] Manual vs auto is read from the contract's terminal snapshot, never inferred. A read error
        //      throws (B13): no permanent "UNKNOWN" is written, the event goes to retry/DLQ.
        releaseResolutionType = await this._fetchTerminalResolutionType(tradeIdNum) || "UNKNOWN";
      }

      const trade = await this._applyTerminalTransition({
        tradeIdNum,
        fromStates: ["LOCKED", "PAID", "CHALLENGED"],
        terminalStatus: "RESOLVED",
        set: {
          // [TR] EscrowReleased event'i release yolunu (manual vs auto) tek başına ayırt etmiyor.
          //      Backend heuristik yapmaz; outcome read-model alanını UNKNOWN olarak mirror eder.
          // [EN] EscrowReleased alone does not safely distinguish manual vs auto release.
          //      We do not infer heuristically; mirror as UNKNOWN.
          resolution_type: releaseResolutionType,
          "timers.resolved_at": resolvedAt,
          "evidence.receipt_delete_at": new Date(resolvedAt.getTime() + 24 * 3600 * 1000),
        },
        statsField: "stats.resolved_child_trade_count",
        session,
      });

      if (!trade) {
        logger.warn(`[Worker] EscrowReleased uygulanmadı (durum çelişkisi): trade=${tradeIdNum} status=${existingTrade.status}`);
        await session.abortTransaction();
        return;
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

    const updated = await Trade.findOneAndUpdate(
      {
        ..._buildIdentityLookup("onchain_escrow_id", tradeId),
        status: { $in: ["LOCKED", "PAID", "CHALLENGED"] },
      },
      {
        $set: {
          status: "CHALLENGED",
          "timers.challenged_at": challengedAt,
          ...CLEARED_CANCEL_PROPOSAL,
        },
      }
    );

    if (!updated) {
      const existing = await this._requireTradeMirror(tradeId, "DisputeOpened");
      logger.info(`[Worker] DisputeOpened idempotent-skip: trade=${_toStr(tradeId)} status=${existing.status}`);
    }
  }

  async _onEscrowCanceled(event) {
    return this._markTradeCanceled(event, "MUTUAL_CANCEL");
  }

  // [TR] LOCKED trade'de ödeme penceresi doldu: kilit maker lehine çözüldü (taker liveness cezası).
  // [EN] Payment window expired on a LOCKED trade: the lock unwound for the maker (taker liveness penalty).
  async _onPaymentWindowExpired(event) {
    return this._markTradeCanceled(event, "PAYMENT_WINDOW_EXPIRED");
  }

  async _markTradeCanceled(event, resolutionType) {
    const { tradeId } = event.args;
    const canceledAt = await this._getEventDate(event);
    const tradeIdNum = _toIdentityString(tradeId);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const trade = await this._applyTerminalTransition({
        tradeIdNum,
        fromStates: ["OPEN", "LOCKED", "PAID", "CHALLENGED"],
        terminalStatus: "CANCELED",
        set: {
          resolution_type: resolutionType,
          "timers.resolved_at": canceledAt,
          "evidence.receipt_delete_at": new Date(canceledAt.getTime() + 24 * 3600 * 1000),
        },
        statsField: "stats.canceled_child_trade_count",
        session,
      });

      if (!trade) {
        const existing = await this._requireTradeMirror(tradeIdNum, event.eventName || "EscrowCanceled");
        logger.info(`[Worker] ${event.eventName || "EscrowCanceled"} idempotent-skip: trade=${tradeIdNum} status=${existing.status}`);
        await session.abortTransaction();
        return;
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async _onEscrowBurned(event) {
    const { tradeId, burnedAmount } = event.args;
    const burnedAt = await this._getEventDate(event);
    const tradeIdNum = _toIdentityString(tradeId);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const trade = await this._applyTerminalTransition({
        tradeIdNum,
        fromStates: ["LOCKED", "PAID", "CHALLENGED"],
        terminalStatus: "BURNED",
        set: {
          resolution_type: "BURNED",
          "timers.resolved_at": burnedAt,
          // [TR] burnExpired BleedingDecayed yaymaz; yakılan toplam yalnız bu event'te gelir.
          // [EN] burnExpired emits no BleedingDecayed; the burned total only arrives here.
          "financials.burned_amount": _toStr(burnedAmount ?? 0),
          "financials.burned_amount_num": _toSafeNum(burnedAmount ?? 0),
          "evidence.receipt_delete_at": new Date(burnedAt.getTime() + 30 * 24 * 3600 * 1000),
        },
        statsField: "stats.burned_child_trade_count",
        session,
      });

      if (!trade) {
        const existing = await this._requireTradeMirror(tradeIdNum, "EscrowBurned");
        logger.info(`[Worker] EscrowBurned idempotent-skip: trade=${tradeIdNum} status=${existing.status}`);
        await session.abortTransaction();
        return;
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
    const tradeIdNum = _toIdentityString(tradeId);
    const eventId = this._getEventId(event);
    const decayedAmountStr = _toStr(decayedAmount);
    const decayedAmountNum = _toSafeNum(decayedAmount);

    const decayResult = await Trade.updateOne(
      { ..._buildIdentityLookup("onchain_escrow_id", tradeIdNum), "financials.decay_tx_hashes": { $ne: eventId } },
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

    // [TR] B15: eşleşme yoksa ya event zaten uygulanmıştır (idempotent) ya da mirror yoktur; ikincisi throw eder.
    // [EN] B15: no match means either the event was already applied (idempotent) or the mirror is missing.
    if (decayResult?.matchedCount === 0) {
      await this._requireTradeMirror(tradeIdNum, "BleedingDecayed");
    }
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

    const updated = await Trade.findOneAndUpdate(
      { ..._buildIdentityLookup("onchain_escrow_id", tradeId) },
      { $set: update }
    );

    // [TR] B15: mirror yoksa sessizce yok sayma; throw et (retry/DLQ).
    // [EN] B15: do not silently ignore a missing mirror; throw (retry/DLQ).
    if (!updated) {
      throw new Error("CancelProposed geldi ama trade mirror bulunamadı.");
    }
  }

  async _onSettlementProposed(event) {
    const { tradeId, proposalId, proposer, makerShareBps, takerShareBps, expiresAt } = event.args;
    const proposedAt = await this._getEventDate(event);
    const proposalState = "PROPOSED";
    const txHash = event?.transactionHash || null;
    const expiresAtDate = _toDateOrNull(expiresAt);
    const tradeLookup = _buildIdentityLookup("onchain_escrow_id", tradeId);

    const mirrored = await Trade.findOneAndUpdate(
      {
        ...tradeLookup,
        "settlement_proposal.state": { $ne: "FINALIZED" },
      },
      {
        $set: {
          "settlement_proposal.proposal_id": _toStr(proposalId),
          "settlement_proposal.state": proposalState,
          "settlement_proposal.proposed_by": proposer?.toLowerCase?.() || null,
          "settlement_proposal.maker_share_bps": _toNum(makerShareBps),
          "settlement_proposal.taker_share_bps": _toNum(takerShareBps),
          "settlement_proposal.proposed_at": proposedAt,
          "settlement_proposal.expires_at": expiresAtDate,
          "settlement_proposal.expired_at": null,
          "settlement_proposal.finalized_at": null,
          "settlement_proposal.tx_hash": txHash,
          "settlement_proposal.last_event_name": "SettlementProposed",
        },
      },
      { new: true }
    );

    if (!mirrored) {
      const existingTrade = await Trade.findOne(tradeLookup).select("settlement_proposal.state").lean();
      if (!existingTrade) {
        // [TR] Trade mirror yoksa worker standart retry/DLQ akışı için throw edilir.
        // [EN] Throw to trigger standard retry/DLQ flow when trade mirror is missing.
        throw new Error("SettlementProposed geldi ama trade mirror bulunamadı.");
      }
      if (existingTrade?.settlement_proposal?.state === "FINALIZED") return;
      throw new Error("SettlementProposed mirror güncellemesi başarısız.");
    }
  }

  // [TR] B15: FINALIZED'a takılan filtre "zaten işlenmiş"tir (idempotent); trade mirror hiç yoksa throw edilir.
  // [EN] B15: being filtered out by FINALIZED means "already processed" (idempotent); a missing trade mirror throws.
  async _updateSettlementProposalMirror(eventName, tradeId, set) {
    const updated = await Trade.findOneAndUpdate(
      {
        ..._buildIdentityLookup("onchain_escrow_id", tradeId),
        "settlement_proposal.state": { $ne: "FINALIZED" },
      },
      { $set: set }
    );
    if (!updated) {
      await this._requireTradeMirror(tradeId, eventName);
    }
  }

  async _onSettlementRejected(event) {
    const { tradeId, proposalId, rejecter } = event.args;
    void rejecter;
    await this._getEventDate(event);
    const txHash = event?.transactionHash || null;

    await this._updateSettlementProposalMirror("SettlementRejected", tradeId, {
      "settlement_proposal.proposal_id": _toStr(proposalId),
      "settlement_proposal.state": "REJECTED",
      "settlement_proposal.tx_hash": txHash,
      "settlement_proposal.last_event_name": "SettlementRejected",
      "settlement_proposal.finalized_at": null,
    });
  }

  async _onSettlementWithdrawn(event) {
    const { tradeId, proposalId, proposer } = event.args;
    void proposer;
    await this._getEventDate(event);
    const txHash = event?.transactionHash || null;

    await this._updateSettlementProposalMirror("SettlementWithdrawn", tradeId, {
      "settlement_proposal.proposal_id": _toStr(proposalId),
      "settlement_proposal.state": "WITHDRAWN",
      "settlement_proposal.tx_hash": txHash,
      "settlement_proposal.last_event_name": "SettlementWithdrawn",
      "settlement_proposal.finalized_at": null,
    });
  }

  async _onSettlementExpired(event) {
    const { tradeId, proposalId } = event.args;
    const expiredAt = await this._getEventDate(event);
    const txHash = event?.transactionHash || null;

    await this._updateSettlementProposalMirror("SettlementExpired", tradeId, {
      "settlement_proposal.proposal_id": _toStr(proposalId),
      "settlement_proposal.state": "EXPIRED",
      // [TR] expires_at deadline alanıdır; event zamanı ayrı expired_at alanına yazılır.
      // [EN] Keep expires_at as proposal deadline; store event time separately at expired_at.
      "settlement_proposal.expired_at": expiredAt,
      "settlement_proposal.finalized_at": null,
      "settlement_proposal.tx_hash": txHash,
      "settlement_proposal.last_event_name": "SettlementExpired",
    });
  }

  async _onSettlementFinalized(event) {
    const { tradeId, proposalId, makerPayout, takerPayout, takerFee, makerFee } = event.args;
    const finalizedAt = await this._getEventDate(event);
    const txHash = event?.transactionHash || null;
    const tradeIdNum = _toIdentityString(tradeId);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const trade = await this._applyTerminalTransition({
        tradeIdNum,
        fromStates: ["OPEN", "LOCKED", "PAID", "CHALLENGED"],
        terminalStatus: "RESOLVED",
        set: {
          resolution_type: "PARTIAL_SETTLEMENT",
          "timers.resolved_at": finalizedAt,
          "settlement_proposal.proposal_id": _toStr(proposalId),
          "settlement_proposal.state": "FINALIZED",
          "settlement_proposal.finalized_at": finalizedAt,
          "settlement_proposal.maker_payout": _toStr(makerPayout),
          "settlement_proposal.taker_payout": _toStr(takerPayout),
          "settlement_proposal.taker_fee": _toStr(takerFee),
          "settlement_proposal.maker_fee": _toStr(makerFee),
          "settlement_proposal.tx_hash": txHash,
          "settlement_proposal.last_event_name": "SettlementFinalized",
          "evidence.receipt_delete_at": new Date(finalizedAt.getTime() + 24 * 3600 * 1000),
        },
        statsField: "stats.resolved_child_trade_count",
        session,
      });

      if (!trade) {
        // [TR] Replay/idempotent durum: geçiş zaten uygulanmış; order stats tekrar düşülmez. Mirror yoksa throw.
        // [EN] Replay/idempotent case: transition already applied; order stats are not decremented again.
        //      A missing mirror throws.
        await this._requireTradeMirror(tradeIdNum, "SettlementFinalized");
        await session.commitTransaction();
        return;
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }
  }


  async _onProtocolRevenueSent(event) {
    const { token, amount, kind, tradeId, treasury } = event.args;

    // [TR] B16: Escrow'un ProtocolRevenueSent'i treasury = ArafRevenueVault olduğunda AYNI transferin vault
    //      tarafındaki EscrowRevenueReceived event'i ile birebir çift kayıttır (ikisi de source ESCROW_REVENUE;
    //      admin toplamı 2x çıkıyordu). Vault izleniyorsa vault event'i birincildir (reward/treasury payı da onda);
    //      escrow event'i vault'a gidiyorsa atlanır. Vault izlenmiyorsa ya da treasury başka bir adresse
    //      (eski/harici treasury) escrow event'i tek kayıt olarak yazılır.
    // [EN] B16: when escrow's ProtocolRevenueSent targets the ArafRevenueVault it is an exact duplicate of the
    //      vault's EscrowRevenueReceived for the same transfer (both source ESCROW_REVENUE; the admin total was
    //      doubled). With the vault watched, the vault event is primary (it also carries the reward/treasury
    //      split) and the escrow event is skipped when it goes to the vault. With no vault watched, or a
    //      different (legacy/external) treasury, the escrow event is written as the single row.
    const vaultAddress =
      typeof this.vaultContract?.target === "string" ? this.vaultContract.target.toLowerCase() : null;
    if (vaultAddress && String(treasury || "").toLowerCase() === vaultAddress) {
      logger.debug(`[Worker] ProtocolRevenueSent vault'a gidiyor; EscrowRevenueReceived birincil kayıt (tx=${event.transactionHash}).`);
      return;
    }

    await RevenueEvent.findOneAndUpdate(
      { tx_hash: event.transactionHash, log_index: Number(_logIndexOf(event)) },
      {
        $setOnInsert: {
          tx_hash: event.transactionHash,
          block_number: Number(event.blockNumber || 0),
          log_index: Number(_logIndexOf(event) || 0),
          token: token?.toLowerCase?.() || null,
          amount: _toStr(amount),
          kind: _toNum(kind),
          trade_id: _toStr(tradeId),
          source: "ESCROW_REVENUE",
          created_at_onchain: await this._getEventDate(event),
        },
      },
      { upsert: true }
    );
  }

  async _onEscrowRevenueReceived(event) {
    const { token, amount, rewardShare, treasuryShare, kind, tradeId } = event.args;
    await RevenueEvent.findOneAndUpdate(
      { tx_hash: event.transactionHash, log_index: Number(_logIndexOf(event)) },
      {
        $setOnInsert: {
          tx_hash: event.transactionHash,
          block_number: Number(event.blockNumber || 0),
          log_index: Number(_logIndexOf(event) || 0),
          token: token?.toLowerCase?.() || null,
          amount: _toStr(amount),
          reward_share: _toStr(rewardShare),
          treasury_share: _toStr(treasuryShare),
          kind: _toNum(kind),
          trade_id: _toStr(tradeId),
          source: "ESCROW_REVENUE",
          created_at_onchain: await this._getEventDate(event),
        },
      },
      { upsert: true }
    );
  }

  async _onExternalRewardFunded(event) {
    const { funder, token, amount, targetEpoch, fundingRef } = event.args;
    await RewardFunding.findOneAndUpdate(
      { tx_hash: event.transactionHash, log_index: Number(_logIndexOf(event)) },
      { $setOnInsert: {
        tx_hash: event.transactionHash,
        block_number: Number(event.blockNumber || 0),
        log_index: Number(_logIndexOf(event) || 0),
        funder: funder?.toLowerCase?.() || null,
        token: token?.toLowerCase?.() || null,
        amount: _toStr(amount),
        target_epoch: _toStr(targetEpoch),
        product_id: null,
        funding_ref: _toStr(fundingRef),
        type: "GLOBAL",
      } },
      { upsert: true }
    );
  }

  async _onProductRewardFunded(event) {
    const { funder, productId, token, amount, targetEpoch, fundingRef } = event.args;
    await RewardFunding.findOneAndUpdate(
      { tx_hash: event.transactionHash, log_index: Number(_logIndexOf(event)) },
      { $setOnInsert: {
        tx_hash: event.transactionHash,
        block_number: Number(event.blockNumber || 0),
        log_index: Number(_logIndexOf(event) || 0),
        funder: funder?.toLowerCase?.() || null,
        token: token?.toLowerCase?.() || null,
        amount: _toStr(amount),
        target_epoch: _toStr(targetEpoch),
        product_id: _toStr(productId),
        funding_ref: _toStr(fundingRef),
        type: "PRODUCT",
      } },
      { upsert: true }
    );
  }

  async _onEpochRewardAllocated(event) {
    const { epoch, token, amount } = event.args;
    const tx_hash = event.transactionHash;
    const log_index = Number(_logIndexOf(event) || 0);
    const insertResult = await RewardEpochAllocationEvent.findOneAndUpdate(
      { tx_hash, log_index },
      { $setOnInsert: { tx_hash, log_index, epoch: _toStr(epoch), token: token?.toLowerCase?.() || null, amount: _toStr(amount) } },
      // [TR] Mongoose 8'de rawResult kaldırıldı; includeResultMetadata olmadan replay'de
      //      updatedExisting okunamaz ve epoch havuzu iki kez sayılırdı.
      // [EN] rawResult was removed in Mongoose 8; without includeResultMetadata the replay
      //      guard never fires and the epoch pool is double counted.
      { upsert: true, new: false, includeResultMetadata: true }
    );
    if (insertResult?.lastErrorObject?.updatedExisting) return;

    const key = { epoch: _toStr(epoch), token: token?.toLowerCase?.() || null };
    const existing = await RewardEpoch.findOne(key).lean();
    const prev = BigInt(existing?.epoch_pool || "0");
    const next = (prev + BigInt(_toStr(amount))).toString();
    await RewardEpoch.findOneAndUpdate(
      key,
      {
        $set: {
          epoch_pool: next,
          indexed_at: await this._getEventDate(event),
        },
        $setOnInsert: {
          status: "OPEN",
          total_weight: null,
        },
      },
      { upsert: true }
    );
  }

  async _onTradeOutcomeRecorded(event) {
    // [TR] Ağırlıklar authority olarak saklanmaz (kanonik değer zincirde); yalnız recorder'ın aynı trade'i
    //      tekrar göndermemesi için kayıt anı işaretlenir.
    // [EN] Weights are not persisted as authority; only the record time is marked so the recorder skips it.
    const { tradeId } = event.args;
    await Trade.updateOne(
      { ..._buildIdentityLookup("onchain_escrow_id", tradeId), "timers.reward_recorded_at": null },
      { $set: { "timers.reward_recorded_at": await this._getEventDate(event) } }
    );
  }

  async _onRewardClaimed(event) {
    const { epoch, user, token, amount, userWeight, totalWeight } = event.args;
    await RewardClaim.findOneAndUpdate(
      { tx_hash: event.transactionHash, log_index: Number(_logIndexOf(event)) },
      { $setOnInsert: {
        tx_hash: event.transactionHash,
        block_number: Number(event.blockNumber || 0),
        log_index: Number(_logIndexOf(event) || 0),
        epoch: _toStr(epoch),
        user: user?.toLowerCase?.() || null,
        token: token?.toLowerCase?.() || null,
        amount: _toStr(amount),
        user_weight: _toStr(userWeight),
        total_weight: _toStr(totalWeight),
      } },
      { upsert: true }
    );
  }

  async _onMakerPinged(event) {
    const { tradeId, pinger, timestamp } = event.args;
    const pingAt = await this._getEventDate(event, timestamp);

    const trade = await Trade.findOne({ ..._buildIdentityLookup("onchain_escrow_id", tradeId) }).lean();
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
      { ..._buildIdentityLookup("onchain_escrow_id", tradeId) },
      { $set: updateFields }
    );
  }

  async _onReputationUpdated(event) {
    const {
      wallet,
      successful,
      failed,
      bannedUntil,
      effectiveTier,
      manualReleaseCount,
      autoReleaseCount,
      mutualCancelCount,
      disputedResolvedCount,
      burnCount,
      disputeWinCount,
      disputeLossCount,
      partialSettlementCount,
      riskPoints,
      lastPositiveEventAt,
      lastNegativeEventAt,
    } = event.args;
    const syncAt = await this._getEventDate(event);

    // [TR] B20: cüzdan başına son uygulanan (blockNumber, logIndex)'ten eski ReputationUpdated yok sayılır.
    // [EN] B20: a ReputationUpdated older than the wallet's last applied (blockNumber, logIndex) is ignored.
    const orderScope = `ReputationUpdated:${String(wallet).toLowerCase()}`;
    if (await this._isStaleOrderedEvent(orderScope, event)) return;

    const totalTrades = _toNum(successful) + _toNum(failed);
    const successRate =
      totalTrades > 0 ? Math.round((_toNum(successful) / totalTrades) * 100) : 100;

    const banTimestamp = _toNum(bannedUntil);
    const isBanned = banTimestamp > Math.floor(Date.now() / 1000);
    // [TR] Fail-soft mirroring: zincir backfill hatasında yalnızca consecutive_bans alanı degrade olur.
    // [EN] Fail-soft mirroring: on chain-backfill failure only consecutive_bans is allowed to degrade.
    const existingUser = await User.findOne({ wallet_address: wallet.toLowerCase() })
      .select("consecutive_bans")
      .lean();
    const storedConsecutiveBans =
      existingUser?.consecutive_bans !== undefined ? _toNum(existingUser.consecutive_bans) : undefined;

    let consecutiveBans = storedConsecutiveBans ?? 0;
    try {
      const rep = await this._fetchReputationFromChain(wallet);
      if (rep?.consecutiveBans !== undefined) {
        consecutiveBans = _toNum(rep.consecutiveBans);
      }
    } catch (error) {
      logger.warn(
        `[eventListener] ReputationUpdated chain backfill failed for ${wallet}; preserving stored consecutive_bans fallback`,
        { wallet, error: error?.message }
      );
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
          // [TR] failure_score artık backend sınıflandırmasından değil, kontrat risk_points aynasından türetilir.
          // [EN] failure_score is now mirrored from contract risk_points, not backend-side classification.
          "reputation_cache.failure_score": _toNum(riskPoints),
          "reputation_breakdown.manual_release_count": _toNum(manualReleaseCount),
          "reputation_breakdown.auto_release_count": _toNum(autoReleaseCount),
          "reputation_breakdown.mutual_cancel_count": _toNum(mutualCancelCount),
          "reputation_breakdown.disputed_resolved_count": _toNum(disputedResolvedCount),
          "reputation_breakdown.burn_count": _toNum(burnCount),
          "reputation_breakdown.dispute_win_count": _toNum(disputeWinCount),
          "reputation_breakdown.dispute_loss_count": _toNum(disputeLossCount),
          "reputation_breakdown.partial_settlement_count": _toNum(partialSettlementCount),
          "reputation_breakdown.risk_points": _toNum(riskPoints),
          "reputation_breakdown.last_positive_event_at":
            _toNum(lastPositiveEventAt) > 0 ? new Date(_toNum(lastPositiveEventAt) * 1000) : null,
          "reputation_breakdown.last_negative_event_at":
            _toNum(lastNegativeEventAt) > 0 ? new Date(_toNum(lastNegativeEventAt) * 1000) : null,
          "is_banned": isBanned,
          "banned_until": isBanned ? new Date(banTimestamp * 1000) : null,
          "consecutive_bans": consecutiveBans,
          "last_onchain_sync_at": syncAt,
        },
      },
      { upsert: true }
    );
    await this._markOrderedEventApplied(orderScope, event);
  }

  // [TR] Config event'lerinde eksik/NaN alan sessizce NaN yazıp "başarılı" dönmemeli; throw edilir
  //      (retry/DLQ'ya gider). Sıralama koruması: son uygulanan (blockNumber, logIndex)'ten eski event yok sayılır.
  // [EN] A missing/NaN field in a config event must not silently write NaN and report success; it throws
  //      (retry/DLQ). Ordering guard: an event older than the last applied (blockNumber, logIndex) is ignored.
  async _onFeeConfigUpdated(event) {
    const takerFeeBps = _requireFiniteNumber(event.args?.takerFeeBps, "takerFeeBps", "FeeConfigUpdated");
    const makerFeeBps = _requireFiniteNumber(event.args?.makerFeeBps, "makerFeeBps", "FeeConfigUpdated");

    if (await this._isStaleOrderedEvent("FeeConfigUpdated", event)) return;
    await updateCachedFeeConfig(takerFeeBps, makerFeeBps);
    await this._markOrderedEventApplied("FeeConfigUpdated", event);
  }

  async _onCooldownConfigUpdated(event) {
    const tier0TradeCooldown = _requireFiniteNumber(event.args?.tier0TradeCooldown, "tier0TradeCooldown", "CooldownConfigUpdated");
    const tier1TradeCooldown = _requireFiniteNumber(event.args?.tier1TradeCooldown, "tier1TradeCooldown", "CooldownConfigUpdated");

    if (await this._isStaleOrderedEvent("CooldownConfigUpdated", event)) return;
    await updateCachedCooldownConfig(tier0TradeCooldown, tier1TradeCooldown);
    await this._markOrderedEventApplied("CooldownConfigUpdated", event);
  }

  async _onReputationPolicyUpdated(event) {
    const a = event.args || {};
    const name = "ReputationPolicyUpdated";
    const patch = {
      cleanPeriodSec: _requireFiniteNumber(a.cleanPeriod, "cleanPeriod", name),
      manualReleaseRewardPts: _requireFiniteNumber(a.manualReleaseRewardPts, "manualReleaseRewardPts", name),
      autoReleasePenaltyPts: _requireFiniteNumber(a.autoReleasePenaltyPts, "autoReleasePenaltyPts", name),
      disputeWinRewardPts: _requireFiniteNumber(a.disputeWinRewardPts, "disputeWinRewardPts", name),
      disputeLossPenaltyPts: _requireFiniteNumber(a.disputeLossPenaltyPts, "disputeLossPenaltyPts", name),
      burnPenaltyPts: _requireFiniteNumber(a.burnPenaltyPts, "burnPenaltyPts", name),
      mutualCancelPenaltyPts: _requireFiniteNumber(a.mutualCancelPenaltyPts, "mutualCancelPenaltyPts", name),
      baseBanDurationSec: _requireFiniteNumber(a.baseBanDuration, "baseBanDuration", name),
      banRiskPointsThreshold: _requireFiniteNumber(a.banRiskPointsThreshold, "banRiskPointsThreshold", name),
    };

    if (await this._isStaleOrderedEvent(name, event)) return;
    await updateCachedReputationPolicy(patch);
    await this._markOrderedEventApplied(name, event);
  }

  async _onReputationTierThresholdsUpdated(event) {
    const name = "ReputationTierThresholdsUpdated";
    const { minSuccessfulTrades, maxRiskPoints } = event.args || {};
    if (!minSuccessfulTrades || !maxRiskPoints) {
      throw new Error(`[Worker] ${name}: eşik dizileri eksik.`);
    }
    const patch = {
      tierMinSuccessfulTrades: Array.from(minSuccessfulTrades).map((v) => _requireFiniteNumber(v, "minSuccessfulTrades", name)),
      tierMaxRiskPoints: Array.from(maxRiskPoints).map((v) => _requireFiniteNumber(v, "maxRiskPoints", name)),
    };

    if (await this._isStaleOrderedEvent(name, event)) return;
    await updateCachedReputationPolicy(patch);
    await this._markOrderedEventApplied(name, event);
  }

  async _onTokenConfigUpdated(event) {
    const { token, supported, allowSellOrders, allowBuyOrders } = event.args;
    // TokenConfigUpdated payload'ında decimals/tier limit alanları yok.
    // Bu nedenle authoritative read-model'i kontrattan tazeleyerek cache drift'i önlüyoruz.
    try {
      await refreshProtocolConfig();
    } catch (err) {
      logger.warn(`[Worker] refreshProtocolConfig başarısız, event payload ile partial patch uygulanıyor: ${err.message}`);
      await updateCachedTokenConfig(token, { supported, allowSellOrders, allowBuyOrders });
    }
  }
}

const worker = new EventWorker();
worker._runtimeConfig = {
  BLOCK_BATCH_SIZE,
  CHECKPOINT_INTERVAL_BLOCKS,
  WORKER_FINALITY_DEPTH,
};
worker._getPositiveIntEnv = _getPositiveIntEnv;
worker._inferCryptoAssetFromToken = _inferCryptoAssetFromToken;

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

worker.getDiagnostics = function getDiagnostics() {
  const ignoredTotal = Object.values(worker._ignoredEventsByReason || {}).reduce((a, b) => a + Number(b || 0), 0);
  const unsafeAckBlocks = [...(worker._blockAcks?.entries?.() || [])]
    .filter(([, state]) => Boolean(state?.unsafe))
    .map(([block]) => block);
  return {
    retry: {
      success: worker._retrySuccessCount || 0,
      failure: worker._retryFailureCount || 0,
    },
    ignoredEventsByReason: { ...(worker._ignoredEventsByReason || {}) },
    ignoredTotal,
    unsafeAckBlocks,
    quarantinedEvents: worker._quarantinedCount || 0,
    reconciliation: worker._reconciliation || { lastRunAt: null, lastReport: null },
    reconciliationNeeded:
      ignoredTotal > 0 ||
      (worker._retryFailureCount || 0) > 0 ||
      unsafeAckBlocks.length > 0 ||
      (worker._quarantinedCount || 0) > 0,
  };
};

worker._ARAF_ABI_FOR_TESTS = ARAF_ABI;

module.exports = worker;
