"use strict";

/**
 * Protocol Config Service — On-Chain Parametre Yükleyici
 *
 * Felsefe: "Kod Kanundur"
 *   - Protokolün temel ekonomik parametreleri (teminatlar, süreler vb.)
 *     backend'de hard-code EDİLMEZ.
 *   - Bu servis, sunucu başlangıcında ArafEscrow kontratına bağlanır,
 *     tüm public constant'ları okur ve bunları bir yapılandırma nesnesi
 *     olarak belleğe yükler.
 *   - Bu sayede, kontrat her zaman "gerçeğin tek kaynağı" olur.
 *     Kontrat güncellendiğinde, backend otomatik olarak yeni kuralları benimser.
 */

const { ethers } = require("ethers");
const logger     = require("../utils/logger");
const { getRedisClient } = require("../config/redis");

const CONFIG_CACHE_KEY = "cache:protocol_config:v1";
const CONFIG_CACHE_TTL = 7 * 24 * 3600; // 7 gün (saniye cinsinden)

// Sadece public constant'ları okumak için minimal ABI
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
];

let protocolConfig = null;

async function loadProtocolConfig() {
  // Optimizasyon: Önce Redis önbelleğini kontrol et
  const redis = getRedisClient();
  try {
    const cachedConfig = await redis.get(CONFIG_CACHE_KEY);
    if (cachedConfig) {
      protocolConfig = JSON.parse(cachedConfig);
      logger.info("[Config] Protokol parametreleri Redis önbelleğinden yüklendi.");
      return protocolConfig;
    }
  } catch (err) {
    logger.warn(`[Config] Redis önbellek okuma hatası, on-chain'den devam ediliyor: ${err.message}`);
  }

  // Önbellek boşsa veya hata varsa, on-chain'den çek
  const rpcUrl = process.env.BASE_RPC_URL;
  const contractAddress = process.env.ARAF_ESCROW_ADDRESS;

  if (!rpcUrl || !contractAddress) {
    logger.error("[Config] RPC URL veya Kontrat Adresi tanımsız. Protokol yapılandırması yüklenemedi.");
    throw new Error("Cannot load protocol config from on-chain.");
  }

  logger.info("[Config] Protokol parametreleri on-chain'den yükleniyor...");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, CONFIG_ABI, provider);

  const bpsToPercent = (bps) => Number(bps) / 100;

  const [
    makerT0, makerT1, makerT2, makerT3, makerT4,
    takerT0, takerT1, takerT2, takerT3, takerT4,
  ] = await Promise.all([
    contract.MAKER_BOND_TIER0_BPS(), contract.MAKER_BOND_TIER1_BPS(), contract.MAKER_BOND_TIER2_BPS(), contract.MAKER_BOND_TIER3_BPS(), contract.MAKER_BOND_TIER4_BPS(),
    contract.TAKER_BOND_TIER0_BPS(), contract.TAKER_BOND_TIER1_BPS(), contract.TAKER_BOND_TIER2_BPS(), contract.TAKER_BOND_TIER3_BPS(), contract.TAKER_BOND_TIER4_BPS(),
  ]);

  protocolConfig = {
    bondMap: {
      0: { maker: bpsToPercent(makerT0), taker: bpsToPercent(takerT0) },
      1: { maker: bpsToPercent(makerT1), taker: bpsToPercent(takerT1) },
      2: { maker: bpsToPercent(makerT2), taker: bpsToPercent(takerT2) },
      3: { maker: bpsToPercent(makerT3), taker: bpsToPercent(takerT3) },
      4: { maker: bpsToPercent(makerT4), taker: bpsToPercent(takerT4) },
    },
    // Gelecekte diğer on-chain parametreler buraya eklenebilir (örn: GRACE_PERIOD)
  };

  // Sonucu hem Redis'e hem de bellek içi önbelleğe yaz
  await redis.setEx(CONFIG_CACHE_KEY, CONFIG_CACHE_TTL, JSON.stringify(protocolConfig));

  logger.info("[Config] On-chain parametreler başarıyla yüklendi ve Redis'e kaydedildi.");
  return protocolConfig;
}

const getConfig = () => {
  if (!protocolConfig) throw new Error("Protocol config not loaded yet.");
  return protocolConfig;
};

module.exports = { loadProtocolConfig, getConfig };