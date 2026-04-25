"use strict";

const logger = require("../utils/logger");

const warnedLegacyEnvKeys = new Set();

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

function _resolveSymbolAddress(symbol, { surface }) {
  const canonicalName = `MAINNET_${symbol}_ADDRESS`;
  const legacyName = `${symbol}_ADDRESS`;

  const canonicalAddr = _normalizedAddressOrNull(process.env[canonicalName]);
  const legacyAddr = _normalizedAddressOrNull(process.env[legacyName]);

  if (canonicalAddr && legacyAddr && canonicalAddr !== legacyAddr) {
    logger.warn(
      `[TokenEnv][${surface}] ${symbol} için hem ${canonicalName} hem ${legacyName} tanımlı ama farklı. ` +
      `Kanonik env kullanılacak: ${canonicalAddr}`
    );
    return canonicalAddr;
  }

  if (canonicalAddr) return canonicalAddr;
  if (legacyAddr) {
    _warnLegacyEnvOnce(legacyName, canonicalName, symbol, surface);
    return legacyAddr;
  }
  return null;
}

function inferCryptoAssetFromTokenAddress(tokenAddress, { surface = "TokenInfer" } = {}) {
  const normalizedToken = _normalizedAddressOrNull(tokenAddress);
  if (!normalizedToken) return null;

  const usdt = _resolveSymbolAddress("USDT", { surface });
  const usdc = _resolveSymbolAddress("USDC", { surface });

  if (usdt && normalizedToken === usdt) return "USDT";
  if (usdc && normalizedToken === usdc) return "USDC";
  return null;
}

function resolveTrackedTokensOrThrow({ isProduction, surface = "ProtocolConfig" }) {
  const rawTracked = String(process.env.ARAF_TRACKED_TOKENS || "");
  const explicit = rawTracked
    .split(",")
    .map((v) => _normalizedAddressOrNull(v))
    .filter(Boolean);

  let tokens = explicit;
  if (tokens.length === 0) {
    const derived = [
      _resolveSymbolAddress("USDT", { surface }),
      _resolveSymbolAddress("USDC", { surface }),
    ].filter(Boolean);
    tokens = derived;
  }

  const deduped = [...new Set(tokens.map((v) => v.toLowerCase()))];

  if (isProduction && deduped.length === 0) {
    const err = new Error(
      `[TokenEnv][${surface}] Production'da tracked token seti boş olamaz. ` +
      `ARAF_TRACKED_TOKENS veya MAINNET_USDT_ADDRESS/MAINNET_USDC_ADDRESS tanımlayın.`
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

