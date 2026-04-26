"use strict";

const logger = require("../utils/logger");

const warnedLegacyEnvKeys = new Set();
const BASE_MAINNET_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;

function _isProductionRuntime(isProductionHint) {
  if (typeof isProductionHint === "boolean") return isProductionHint;
  return process.env.NODE_ENV === "production";
}

function _warnLegacyEnvOnce(envName, canonicalName, symbol, surface) {
  const key = `${surface}:${envName}`;
  if (warnedLegacyEnvKeys.has(key)) return;
  warnedLegacyEnvKeys.add(key);
  logger.warn(
    `[TokenEnv][${surface}] Legacy env ${envName} kullanılıyor (${symbol}). ` +
    `Tercih edilen kanonik env: ${canonicalName}`
  );
}

function _normalizedAddressOrNull(raw) {
  const value = String(raw || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  return value.toLowerCase();
}

function _resolveActiveChainId({ expectedChainId = null, isProduction = false, surface }) {
  const rawChain = String(
    expectedChainId ?? process.env.EXPECTED_CHAIN_ID ?? ""
  ).trim();
  if (!rawChain) {
    if (isProduction) {
      const err = new Error(
        `[TokenEnv][${surface}] Production'da EXPECTED_CHAIN_ID zorunludur (8453 veya 84532).`
      );
      err.code = "CONFIG_UNAVAILABLE";
      throw err;
    }
    return null;
  }

  const normalized = Number(rawChain);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    if (isProduction) {
      const err = new Error(
        `[TokenEnv][${surface}] EXPECTED_CHAIN_ID geçersiz: ${rawChain}`
      );
      err.code = "CONFIG_UNAVAILABLE";
      throw err;
    }
    return null;
  }
  return normalized;
}

function _resolveSymbolAddress(symbol, { surface, expectedChainId = null, isProduction = false }) {
  const chainId = _resolveActiveChainId({ expectedChainId, isProduction, surface });
  const mainnetCanonical = _normalizedAddressOrNull(process.env[`BASE_MAINNET_${symbol}_ADDRESS`]);
  const sepoliaCanonical = _normalizedAddressOrNull(process.env[`BASE_SEPOLIA_${symbol}_ADDRESS`]);
  const mainnetAlias = _normalizedAddressOrNull(process.env[`MAINNET_${symbol}_ADDRESS`]);
  const legacyFallback = _normalizedAddressOrNull(process.env[`${symbol}_ADDRESS`]);

  // [TR] Base Mainnet: kanonik BASE_MAINNET_* önceliklidir; MAINNET_* sadece alias'tır.
  // [EN] Base Mainnet: BASE_MAINNET_* is canonical; MAINNET_* is legacy alias only.
  if (chainId === BASE_MAINNET_CHAIN_ID) {
    if (mainnetCanonical) return mainnetCanonical;
    if (mainnetAlias) return mainnetAlias;
    if (!isProduction && legacyFallback) {
      _warnLegacyEnvOnce(`${symbol}_ADDRESS`, `BASE_MAINNET_${symbol}_ADDRESS`, symbol, surface);
      return legacyFallback;
    }
    return null;
  }

  // [TR] Base Sepolia: MAINNET_* alias kullanımını production'da fail-fast yap.
  // [EN] Base Sepolia: reject MAINNET_* alias in production (fail-closed).
  if (chainId === BASE_SEPOLIA_CHAIN_ID) {
    if (isProduction && mainnetAlias) {
      const err = new Error(
        `[TokenEnv][${surface}] Base Sepolia için MAINNET_${symbol}_ADDRESS kullanılamaz. ` +
        `BASE_SEPOLIA_${symbol}_ADDRESS tanımlayın.`
      );
      err.code = "CONFIG_UNAVAILABLE";
      throw err;
    }
    if (sepoliaCanonical) return sepoliaCanonical;
    if (!isProduction && mainnetAlias) return mainnetAlias;
    if (!isProduction && legacyFallback) {
      _warnLegacyEnvOnce(`${symbol}_ADDRESS`, `BASE_SEPOLIA_${symbol}_ADDRESS`, symbol, surface);
      return legacyFallback;
    }
    return null;
  }

  if (isProduction) {
    const err = new Error(
      `[TokenEnv][${surface}] Unsupported EXPECTED_CHAIN_ID=${chainId}. 8453 veya 84532 beklenir.`
    );
    err.code = "CONFIG_UNAVAILABLE";
    throw err;
  }

  // Dev/test fallback: eski davranış korunur.
  if (mainnetCanonical) return mainnetCanonical;
  if (sepoliaCanonical) return sepoliaCanonical;
  if (mainnetAlias) return mainnetAlias;
  if (legacyFallback) {
    _warnLegacyEnvOnce(`${symbol}_ADDRESS`, `BASE_MAINNET_${symbol}_ADDRESS`, symbol, surface);
    return legacyFallback;
  }
  return null;
}

function inferCryptoAssetFromTokenAddress(tokenAddress, { surface = "TokenInfer", expectedChainId = null } = {}) {
  const normalizedToken = _normalizedAddressOrNull(tokenAddress);
  if (!normalizedToken) return null;
  // [TR] Production tespiti runtime env'den gelmeli; false sabitlemesi fail-open yaratır.
  // [EN] Production mode must come from runtime env; hardcoding false causes fail-open.
  const isProduction = _isProductionRuntime();

  const usdt = _resolveSymbolAddress("USDT", { surface, expectedChainId, isProduction });
  const usdc = _resolveSymbolAddress("USDC", { surface, expectedChainId, isProduction });

  if (usdt && normalizedToken === usdt) return "USDT";
  if (usdc && normalizedToken === usdc) return "USDC";
  return null;
}

function resolveTrackedTokensOrThrow({ isProduction, surface = "ProtocolConfig", expectedChainId = null }) {
  const rawTracked = String(process.env.ARAF_TRACKED_TOKENS || "");
  const explicit = rawTracked
    .split(",")
    .map((v) => _normalizedAddressOrNull(v))
    .filter(Boolean);

  let tokens = explicit;
  if (tokens.length === 0) {
    const derived = [
      _resolveSymbolAddress("USDT", { surface, expectedChainId, isProduction }),
      _resolveSymbolAddress("USDC", { surface, expectedChainId, isProduction }),
    ].filter(Boolean);
    tokens = derived;
  }

  const deduped = [...new Set(tokens.map((v) => v.toLowerCase()))];

  if (isProduction && deduped.length === 0) {
    const err = new Error(
      `[TokenEnv][${surface}] Production'da tracked token seti boş olamaz. ` +
      `ARAF_TRACKED_TOKENS veya (8453 için BASE_MAINNET_*, 84532 için BASE_SEPOLIA_*) tanımlayın.`
    );
    err.code = "CONFIG_UNAVAILABLE";
    throw err;
  }

  return deduped;
}

module.exports = {
  inferCryptoAssetFromTokenAddress,
  resolveTrackedTokensOrThrow,
};
