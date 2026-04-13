"use strict";

/**
 * Protocol Config Service — V3 On-Chain Parametre Yükleyici
 *
 * Felsefe: "Kod Kanundur"
 *   - Protokolün ekonomik ve giriş kuralı parametreleri backend'de hard-code EDİLMEZ.
 *   - Bu servis, ArafEscrow-yeni.sol kontratından public getter'ları okuyarak
 *     belleğe ve Redis cache'e V3 uyumlu bir config aynası yükler.
 *   - Kontrat authoritative kaynaktır; backend yalnız mirror/read-model katmanıdır.
 *
 * V3 ile yeni gerçek:
 *   - Bond oranları sabit constant'lardan okunur.
 *   - Fee config mutable'dır → getFeeConfig()
 *   - Cooldown config mutable'dır → getCooldownConfig()
 *   - Token yön izinleri mutable'dır → tokenConfigs(token)
 *
 * Kritik not:
 *   - Config okunamıyorsa fallback ekonomi ÜRETİLMEZ.
 *   - getConfig() çağıran route/service CONFIG_UNAVAILABLE almalı ve güvenli şekilde durmalıdır.
 */

const { ethers } = require("ethers");
const logger = require("../utils/logger");
const { getRedisClient } = require("../config/redis");

const CONFIG_CACHE_KEY = "cache:protocol_config:v3";
function _parseCacheTtlSeconds(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return 3600;
}

const CONFIG_CACHE_TTL = _parseCacheTtlSeconds(process.env.CONFIG_CACHE_TTL_SECONDS);

const CONFIG_ABI = [
  "function MAKER_BOND_TIER0_BPS() view returns (uint256)",
  "function MAKER_BOND_TIER1_BPS() view returns (uint256)",
  "function MAKER_BOND_TIER2_BPS() view returns (uint256)",
  "function MAKER_BOND_TIER3_BPS() view returns (uint256)",
  "function MAKER_BOND_TIER4_BPS() view returns (uint256)",
  "function TAKER_BOND_TIER0_BPS() view returns (uint256)",
  "function TAKER_BOND_TIER1_BPS() view returns (uint256)",
  "function TAKER_BOND_TIER2_BPS() view returns (uint256)",
  "function TAKER_BOND_TIER3_BPS() view returns (uint256)",
  "function TAKER_BOND_TIER4_BPS() view returns (uint256)",
  "function getFeeConfig() view returns (uint256 currentTakerFeeBps, uint256 currentMakerFeeBps)",
  "function getCooldownConfig() view returns (uint256 currentTier0TradeCooldown, uint256 currentTier1TradeCooldown)",
  "function supportedTokens(address) view returns (bool)",
  "function tokenConfigs(address) view returns (bool supported, bool allowSellOrders, bool allowBuyOrders)",
];

let protocolConfig = null;

function _getTrackedTokens() {
  const raw = process.env.ARAF_TRACKED_TOKENS || "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => /^0x[a-fA-F0-9]{40}$/.test(v))
    .map((v) => v.toLowerCase());
}

function _bondEntry(makerBps, takerBps) {
  return {
    maker: Number(makerBps) / 100,
    taker: Number(takerBps) / 100,
    makerBps: Number(makerBps),
    takerBps: Number(takerBps),
  };
}

async function _writeCache(redis, value) {
  try {
    await redis.setEx(CONFIG_CACHE_KEY, CONFIG_CACHE_TTL, JSON.stringify(value));
  } catch (err) {
    logger.warn(`[Config] Redis yazma hatası: ${err.message}`);
  }
}

async function loadProtocolConfig() {
  const redis = getRedisClient();

  try {
    const cached = await redis.get(CONFIG_CACHE_KEY);
    if (cached) {
      protocolConfig = JSON.parse(cached);
      logger.info("[Config] V3 protokol parametreleri Redis önbelleğinden yüklendi.");
      return protocolConfig;
    }
  } catch (err) {
    logger.warn(`[Config] Redis önbellek okuma hatası, on-chain load devam ediyor: ${err.message}`);
  }

  const rpcUrl = process.env.BASE_RPC_URL;
  const contractAddress = process.env.ARAF_ESCROW_ADDRESS;

  if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
    logger.warn("[Config] ARAF_ESCROW_ADDRESS tanımsız — CONFIG_UNAVAILABLE.");
    protocolConfig = null;
    return null;
  }

  if (!rpcUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[Config] CRITICAL: BASE_RPC_URL production'da zorunludur.");
    }
    logger.warn("[Config] BASE_RPC_URL tanımsız — CONFIG_UNAVAILABLE.");
    protocolConfig = null;
    return null;
  }

  logger.info("[Config] V3 protokol parametreleri on-chain'den yükleniyor...");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, CONFIG_ABI, provider);

  const [
    makerT0, makerT1, makerT2, makerT3, makerT4,
    takerT0, takerT1, takerT2, takerT3, takerT4,
    feeConfig,
    cooldownConfig,
  ] = await Promise.all([
    contract.MAKER_BOND_TIER0_BPS(), contract.MAKER_BOND_TIER1_BPS(), contract.MAKER_BOND_TIER2_BPS(),
    contract.MAKER_BOND_TIER3_BPS(), contract.MAKER_BOND_TIER4_BPS(),
    contract.TAKER_BOND_TIER0_BPS(), contract.TAKER_BOND_TIER1_BPS(), contract.TAKER_BOND_TIER2_BPS(),
    contract.TAKER_BOND_TIER3_BPS(), contract.TAKER_BOND_TIER4_BPS(),
    contract.getFeeConfig(),
    contract.getCooldownConfig(),
  ]);

  const trackedTokens = _getTrackedTokens();
  const tokenMap = {};

  for (const token of trackedTokens) {
    try {
      const [supportedByMap, cfg] = await Promise.all([
        contract.supportedTokens(token),
        contract.tokenConfigs(token),
      ]);

      tokenMap[token] = {
        supported: Boolean(cfg.supported ?? supportedByMap),
        allowSellOrders: Boolean(cfg.allowSellOrders),
        allowBuyOrders: Boolean(cfg.allowBuyOrders),
      };
    } catch (err) {
      logger.warn(`[Config] tokenConfig load başarısız: token=${token} err=${err.message}`);
      tokenMap[token] = {
        supported: false,
        allowSellOrders: false,
        allowBuyOrders: false,
      };
    }
  }

  protocolConfig = {
    loaded_at: new Date().toISOString(),
    bondMap: {
      0: _bondEntry(makerT0, takerT0),
      1: _bondEntry(makerT1, takerT1),
      2: _bondEntry(makerT2, takerT2),
      3: _bondEntry(makerT3, takerT3),
      4: _bondEntry(makerT4, takerT4),
    },
    feeConfig: {
      takerFeeBps: Number(feeConfig.currentTakerFeeBps ?? feeConfig[0]),
      makerFeeBps: Number(feeConfig.currentMakerFeeBps ?? feeConfig[1]),
    },
    cooldownConfig: {
      tier0TradeCooldown: Number(cooldownConfig.currentTier0TradeCooldown ?? cooldownConfig[0]),
      tier1TradeCooldown: Number(cooldownConfig.currentTier1TradeCooldown ?? cooldownConfig[1]),
    },
    tokenMap,
  };

  await _writeCache(redis, protocolConfig);
  logger.info(`[Config] V3 on-chain parametreler yüklendi ve cache'lendi (TTL=${CONFIG_CACHE_TTL}s).`);
  return protocolConfig;
}

async function refreshProtocolConfig() {
  protocolConfig = null;
  const redis = getRedisClient();
  try {
    await redis.del(CONFIG_CACHE_KEY);
  } catch (_) {
    // cache silme hatası refresh akışını durdurmaz
  }
  return loadProtocolConfig();
}

async function _patchAndPersist(mutator) {
  const redis = getRedisClient();
  if (!protocolConfig) protocolConfig = {};
  mutator(protocolConfig);
  protocolConfig.loaded_at = new Date().toISOString();
  await _writeCache(redis, protocolConfig);
  return protocolConfig;
}

async function updateCachedFeeConfig(takerFeeBps, makerFeeBps) {
  return _patchAndPersist((cfg) => {
    cfg.feeConfig = {
      takerFeeBps: Number(takerFeeBps),
      makerFeeBps: Number(makerFeeBps),
    };
  });
}

async function updateCachedCooldownConfig(tier0TradeCooldown, tier1TradeCooldown) {
  return _patchAndPersist((cfg) => {
    cfg.cooldownConfig = {
      tier0TradeCooldown: Number(tier0TradeCooldown),
      tier1TradeCooldown: Number(tier1TradeCooldown),
    };
  });
}

async function updateCachedTokenConfig(tokenAddress, tokenConfig) {
  return _patchAndPersist((cfg) => {
    if (!cfg.tokenMap) cfg.tokenMap = {};
    cfg.tokenMap[tokenAddress.toLowerCase()] = {
      supported: Boolean(tokenConfig.supported),
      allowSellOrders: Boolean(tokenConfig.allowSellOrders),
      allowBuyOrders: Boolean(tokenConfig.allowBuyOrders),
    };
  });
}

function getConfig() {
  if (!protocolConfig) {
    const err = new Error(
      "Protocol config not loaded. Ensure ARAF_ESCROW_ADDRESS and BASE_RPC_URL are set, then restart the server."
    );
    err.code = "CONFIG_UNAVAILABLE";
    throw err;
  }
  return protocolConfig;
}

module.exports = {
  loadProtocolConfig,
  refreshProtocolConfig,
  getConfig,
  updateCachedFeeConfig,
  updateCachedCooldownConfig,
  updateCachedTokenConfig,
  __testables: {
    _parseCacheTtlSeconds,
    CONFIG_CACHE_TTL,
  },
};
