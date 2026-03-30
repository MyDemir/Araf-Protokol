"use strict";

/**
 * Protocol Config Service — On-Chain Parametre Yükleyici
 *
 * Felsefe: "Kod Kanundur"
 *   - Protokolün temel ekonomik parametreleri (teminatlar, süreler vb.)
 *     backend'de hard-code EDİLMEZ.
 *   - Bu servis, sunucu başlangıcında ArafEscrow kontratına bağlanır,
 *     gerekli public getter / public mapping yüzeylerini okur ve bunları
 *     bir yapılandırma nesnesi olarak belleğe yükler.
 *   - Bu sayede, kontrat her zaman "gerçeğin tek kaynağı" olur.
 *     Kontrat güncellendiğinde, backend otomatik olarak yeni kuralları benimser.
 *
 * V3 notu:
 *   - Bond oranları halen kontratın canonical ve effectively-immutable alanlarıdır.
 *   - Fee ve cooldown artık mutable config yüzeyidir; bu servis güncel değerleri
 *     kontrattan okur ve read-model katmanına taşır.
 *   - Token yön izinleri (sell / buy) de artık kontrattan okunur.
 *   - Backend bu alanları ENFORCEMENT kaynağı olarak değil, yalnız read/query/
 *     projection kolaylaştırıcısı olarak kullanır. Yetkili karar yine kontrattadır.
 *
 * Fix (felsefeye sadık): Kontrat adresi tanımsızsa hard-code fallback YOK.
 *   Config yüklenemezse protocolConfig = null olarak kalır.
 *   getConfig() çağıran endpoint'ler CONFIG_UNAVAILABLE hatası alır ve 503 döner.
 *   Bu, geliştirici hatalarını erkenden yakalar ve "hayalet config" riskini önler.
 *
 * Fix: Redis cache TTL kısaltıldı (zombi cache riskini azaltmak için).
 *   Varsayılan: 1 saat
 *   Override: CONFIG_CACHE_TTL_SECONDS ile ortam bazlı yükseltilebilir.
 */

const { ethers } = require("ethers");
const logger = require("../utils/logger");
const { getRedisClient } = require("../config/redis");

const CONFIG_CACHE_KEY = "cache:protocol_config:v2";

// [TR] Varsayılan 1 saat — zombi cache riskini azaltır.
// [EN] Default 1 hour to reduce zombie-cache risk.
const CONFIG_CACHE_TTL = Number(process.env.CONFIG_CACHE_TTL_SECONDS || 3600);

// [TR] Token mapping'i iterable olmadığı için backend yalnız bildiği token'ları hydrate eder.
//      Bu liste env ile verilir; amaç UI/read-model kolaylığıdır, authority değildir.
// [EN] Since the token mapping is not iterable, backend hydrates only tracked tokens.
//      The list comes from env; it is for UI/read-model convenience, not authority.
const TRACKED_TOKENS = (process.env.ARAF_TRACKED_TOKENS || "")
  .split(",")
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);

// Sadece gerekli public getter / mapping yüzeylerini okumak için minimal ABI
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

function _bpsToPercent(bps) {
  return Number(bps) / 100;
}

function _normalizeAddress(addr) {
  return typeof addr === "string" ? addr.toLowerCase() : addr;
}

async function _readTrackedTokenConfig(contract) {
  const tokenMap = {};

  for (const token of TRACKED_TOKENS) {
    try {
      const [supportedLegacy, cfg] = await Promise.all([
        contract.supportedTokens(token),
        contract.tokenConfigs(token),
      ]);

      tokenMap[token] = {
        address: token,
        supported: Boolean(cfg.supported || supportedLegacy),
        allowSellOrders: Boolean(cfg.allowSellOrders),
        allowBuyOrders: Boolean(cfg.allowBuyOrders),
      };
    } catch (err) {
      logger.warn(`[Config] Token config okunamadı token=${token}: ${err.message}`);
      tokenMap[token] = {
        address: token,
        supported: false,
        allowSellOrders: false,
        allowBuyOrders: false,
        readError: true,
      };
    }
  }

  return tokenMap;
}

async function _writeCache(redis, value) {
  try {
    await redis.setEx(CONFIG_CACHE_KEY, CONFIG_CACHE_TTL, JSON.stringify(value));
    logger.info(
      `[Config] On-chain parametreler başarıyla yüklendi ve Redis'e kaydedildi (TTL: ${CONFIG_CACHE_TTL}s).`
    );
  } catch (err) {
    logger.warn(`[Config] Redis yazma hatası (config yüklendi ama cache'lenemedi): ${err.message}`);
  }
}

async function loadProtocolConfig() {
  // Önce Redis önbelleğini kontrol et
  const redis = getRedisClient();
  try {
    const cachedConfig = await redis.get(CONFIG_CACHE_KEY);
    if (cachedConfig) {
      protocolConfig = JSON.parse(cachedConfig);
      logger.info("[Config] Protokol parametreleri Redis önbelleğinden yüklendi.");
      return protocolConfig;
    }
  } catch (err) {
    logger.warn(`[Config] Redis önbellek okuma hatası, devam ediliyor: ${err.message}`);
  }

  const rpcUrl = process.env.BASE_RPC_URL;
  const contractAddress = process.env.ARAF_ESCROW_ADDRESS;

  // Bu, geliştiriciyi "önce deploy et" adımını atlamaktan korur.
  if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
    logger.warn(
      "[Config] ⚠ ARAF_ESCROW_ADDRESS tanımsız — server CONFIG_UNAVAILABLE modunda başlıyor.\n" +
      "[Config]   Bond / fee / cooldown doğrulaması gerektiren tüm endpoint'ler 503 döner.\n" +
      "[Config]   Çözüm: deploy sonrası .env dosyasına ARAF_ESCROW_ADDRESS adresini ekle."
    );
    protocolConfig = null;
    return null;
  }

  if (!rpcUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[Config] CRITICAL: BASE_RPC_URL production'da zorunludur.");
    }
    logger.warn(
      "[Config] ⚠ BASE_RPC_URL tanımsız — server CONFIG_UNAVAILABLE modunda başlıyor.\n" +
      "[Config]   Çözüm: .env dosyasına BASE_RPC_URL ekle."
    );
    protocolConfig = null;
    return null;
  }

  logger.info("[Config] Protokol parametreleri on-chain'den yükleniyor...");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, CONFIG_ABI, provider);

  const [
    makerT0, makerT1, makerT2, makerT3, makerT4,
    takerT0, takerT1, takerT2, takerT3, takerT4,
    feeCfg,
    cooldownCfg,
    tokenMap,
  ] = await Promise.all([
    contract.MAKER_BOND_TIER0_BPS(), contract.MAKER_BOND_TIER1_BPS(),
    contract.MAKER_BOND_TIER2_BPS(), contract.MAKER_BOND_TIER3_BPS(),
    contract.MAKER_BOND_TIER4_BPS(),
    contract.TAKER_BOND_TIER0_BPS(), contract.TAKER_BOND_TIER1_BPS(),
    contract.TAKER_BOND_TIER2_BPS(), contract.TAKER_BOND_TIER3_BPS(),
    contract.TAKER_BOND_TIER4_BPS(),
    contract.getFeeConfig(),
    contract.getCooldownConfig(),
    _readTrackedTokenConfig(contract),
  ]);

  protocolConfig = {
    loadedAt: new Date().toISOString(),
    source: {
      contractAddress: _normalizeAddress(contractAddress),
      rpcUrl,
      trackedTokenCount: TRACKED_TOKENS.length,
    },

    // [TR] Bond map, kontratın canonical ekonomik tabanını yansıtır.
    //      Backend bunu yalnız projection/query amacıyla kullanır.
    // [EN] Bond map mirrors the contract's canonical economic base.
    //      Backend only uses it for projection/query purposes.
    bondMap: {
      0: { maker: _bpsToPercent(makerT0), taker: _bpsToPercent(takerT0), makerBps: Number(makerT0), takerBps: Number(takerT0) },
      1: { maker: _bpsToPercent(makerT1), taker: _bpsToPercent(takerT1), makerBps: Number(makerT1), takerBps: Number(takerT1) },
      2: { maker: _bpsToPercent(makerT2), taker: _bpsToPercent(takerT2), makerBps: Number(makerT2), takerBps: Number(takerT2) },
      3: { maker: _bpsToPercent(makerT3), taker: _bpsToPercent(takerT3), makerBps: Number(makerT3), takerBps: Number(takerT3) },
      4: { maker: _bpsToPercent(makerT4), taker: _bpsToPercent(takerT4), makerBps: Number(makerT4), takerBps: Number(takerT4) },
    },

    // [TR] Mutable config yüzeyi — aktif trade economics'inin kaynağı değildir.
    //      Aktif trade'ler snapshot ile korunur; bu değerler yalnız yeni girişler için bilgi sağlar.
    // [EN] Mutable config surface — not the source of active trade economics.
    //      Active trades are protected by snapshots; these values describe new entries.
    feeConfig: {
      takerFeeBps: Number(feeCfg.currentTakerFeeBps ?? feeCfg[0]),
      makerFeeBps: Number(feeCfg.currentMakerFeeBps ?? feeCfg[1]),
      takerFeePercent: _bpsToPercent(feeCfg.currentTakerFeeBps ?? feeCfg[0]),
      makerFeePercent: _bpsToPercent(feeCfg.currentMakerFeeBps ?? feeCfg[1]),
    },

    cooldownConfig: {
      tier0TradeCooldown: Number(cooldownCfg.currentTier0TradeCooldown ?? cooldownCfg[0]),
      tier1TradeCooldown: Number(cooldownCfg.currentTier1TradeCooldown ?? cooldownCfg[1]),
    },

    // [TR] Token yön config'i iterable olmadığı için yalnız tracked token set'i hydrate edilir.
    // [EN] Token direction config is hydrated only for the tracked token set.
    tokenMap,
  };

  await _writeCache(redis, protocolConfig);
  return protocolConfig;
}

async function refreshProtocolConfig() {
  const redis = getRedisClient();

  try {
    await redis.del(CONFIG_CACHE_KEY);
  } catch (err) {
    logger.warn(`[Config] Redis cache temizlenemedi, yine de reload deneniyor: ${err.message}`);
  }

  protocolConfig = null;
  return loadProtocolConfig();
}

async function updateCachedFeeConfig(takerFeeBps, makerFeeBps) {
  const redis = getRedisClient();

  if (!protocolConfig) {
    return refreshProtocolConfig();
  }

  protocolConfig = {
    ...protocolConfig,
    loadedAt: new Date().toISOString(),
    feeConfig: {
      takerFeeBps: Number(takerFeeBps),
      makerFeeBps: Number(makerFeeBps),
      takerFeePercent: _bpsToPercent(takerFeeBps),
      makerFeePercent: _bpsToPercent(makerFeeBps),
    },
  };

  await _writeCache(redis, protocolConfig);
  return protocolConfig;
}

async function updateCachedCooldownConfig(tier0TradeCooldown, tier1TradeCooldown) {
  const redis = getRedisClient();

  if (!protocolConfig) {
    return refreshProtocolConfig();
  }

  protocolConfig = {
    ...protocolConfig,
    loadedAt: new Date().toISOString(),
    cooldownConfig: {
      tier0TradeCooldown: Number(tier0TradeCooldown),
      tier1TradeCooldown: Number(tier1TradeCooldown),
    },
  };

  await _writeCache(redis, protocolConfig);
  return protocolConfig;
}

async function updateCachedTokenConfig(token, supported, allowSellOrders, allowBuyOrders) {
  const redis = getRedisClient();
  const normalizedToken = _normalizeAddress(token);

  if (!protocolConfig) {
    return refreshProtocolConfig();
  }

  protocolConfig = {
    ...protocolConfig,
    loadedAt: new Date().toISOString(),
    tokenMap: {
      ...(protocolConfig.tokenMap || {}),
      [normalizedToken]: {
        address: normalizedToken,
        supported: Boolean(supported),
        allowSellOrders: Boolean(allowSellOrders),
        allowBuyOrders: Boolean(allowBuyOrders),
      },
    },
  };

  await _writeCache(redis, protocolConfig);
  return protocolConfig;
}

/**
 * Yüklenmiş config'i döner.
 * Config yoksa CONFIG_UNAVAILABLE hatasıyla fırlatır — çağıran route 503 dönmeli.
 *
 * Kullanım (route'larda):
 *   try {
 *     const config = getConfig();
 *   } catch (err) {
 *     if (err.code === 'CONFIG_UNAVAILABLE') return res.status(503).json({ error: err.message });
 *     throw err;
 *   }
 */
const getConfig = () => {
  if (!protocolConfig) {
    const err = new Error(
      "Protocol config not loaded. " +
      "Ensure ARAF_ESCROW_ADDRESS and BASE_RPC_URL are set, then restart the server."
    );
    err.code = "CONFIG_UNAVAILABLE";
    throw err;
  }
  return protocolConfig;
};

module.exports = {
  loadProtocolConfig,
  refreshProtocolConfig,
  updateCachedFeeConfig,
  updateCachedCooldownConfig,
  updateCachedTokenConfig,
  getConfig,
};
