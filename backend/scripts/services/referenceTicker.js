"use strict";

const { getRedisClient, isReady: isRedisReady } = require("../config/redis");
const logger = require("../utils/logger");

const COINBASE_BASE_URL = "https://api.coinbase.com/api/v3/brokerage";
const FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rates?base=USD&quotes=TRY,EUR,GBP";

const CACHE_KEYS = {
  crypto: "reference:ticker:crypto:v1",
  fiat: "reference:ticker:fiat:v1",
  lastGood: "reference:ticker:last-good:v1",
};

const CRYPTO_TTL_SECONDS = Number(process.env.REFERENCE_TICKER_CRYPTO_TTL_SECONDS || 120);
const FIAT_TTL_SECONDS = Number(process.env.REFERENCE_TICKER_FIAT_TTL_SECONDS || 21600);
const LAST_GOOD_TTL_SECONDS = Number(process.env.REFERENCE_TICKER_LAST_GOOD_TTL_SECONDS || 604800);

const PAIRS = Object.freeze([
  "BTC/USDT",
  "BTC/USDC",
  "ETH/USDT",
  "ETH/USDC",
  "USDT/TRY",
  "USDC/TRY",
  "USD/TRY",
  "EUR/TRY",
  "GBP/TRY",
]);

const SOURCE_KIND = {
  CRYPTO: "CRYPTO_EXCHANGE_REFERENCE",
  STABLE_TRY: "STABLECOIN_TRY_REFERENCE",
  FIAT: "FIAT_OFFICIAL_REFERENCE",
};

let memoryCache = {
  [CACHE_KEYS.crypto]: null,
  [CACHE_KEYS.fiat]: null,
  [CACHE_KEYS.lastGood]: null,
};

function nowIso() {
  return new Date().toISOString();
}

function isValidPositiveRate(value) {
  return Number.isFinite(value) && value > 0;
}

function parsePositiveRate(value) {
  const num = Number(value);
  return isValidPositiveRate(num) ? num : null;
}

function splitSymbol(symbol) {
  const [base, quote] = symbol.split("/");
  return { base, quote };
}

async function fetchJsonWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      throw err;
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseCoinbaseTickerPrice(payload) {
  const tradePrice = parsePositiveRate(payload?.trades?.[0]?.price);
  if (tradePrice) return tradePrice;

  const bestBid = parsePositiveRate(payload?.best_bid);
  const bestAsk = parsePositiveRate(payload?.best_ask);
  if (bestBid && bestAsk) {
    const midpoint = (bestBid + bestAsk) / 2;
    return parsePositiveRate(midpoint);
  }

  return null;
}

async function fetchCoinbaseProductPrice(productId) {
  const url = `${COINBASE_BASE_URL}/market/products/${encodeURIComponent(productId)}/ticker`;
  try {
    const payload = await fetchJsonWithTimeout(url, 5000);
    const price = parseCoinbaseTickerPrice(payload);
    if (!price) {
      logger.warn(`[ReferenceTicker] Coinbase price parse failed: ${productId}`);
      return null;
    }
    return price;
  } catch (err) {
    if (err?.status === 400 || err?.status === 404) {
      return null;
    }
    logger.warn(`[ReferenceTicker] Coinbase fetch failed (${productId}): ${err.message}`);
    return null;
  }
}

async function fetchCoinbaseRates() {
  const allowlist = [
    "BTC-USDT",
    "BTC-USDC",
    "ETH-USDT",
    "ETH-USDC",
    "BTC-USD",
    "ETH-USD",
    "USDT-USD",
    "USDC-USD",
  ];

  const settled = await Promise.allSettled(
    allowlist.map(async (productId) => ({ productId, price: await fetchCoinbaseProductPrice(productId) }))
  );

  const rates = {};
  settled.forEach((result) => {
    if (result.status !== "fulfilled") return;
    const { productId, price } = result.value;
    if (isValidPositiveRate(price)) {
      rates[productId] = price;
    }
  });

  return rates;
}

async function fetchFiatRates() {
  const payload = await fetchJsonWithTimeout(FRANKFURTER_URL, 5000);
  const rates = Array.isArray(payload) ? payload?.[0]?.rates : payload?.rates;

  const usdTry = parsePositiveRate(rates?.TRY);
  const usdEur = parsePositiveRate(rates?.EUR);
  const usdGbp = parsePositiveRate(rates?.GBP);

  if (!usdTry || !usdEur || !usdGbp) {
    throw new Error("Invalid Frankfurter payload for TRY/EUR/GBP");
  }

  const eurTry = parsePositiveRate(usdTry / usdEur);
  const gbpTry = parsePositiveRate(usdTry / usdGbp);

  if (!eurTry || !gbpTry) {
    throw new Error("Frankfurter derived FX values are invalid");
  }

  return {
    usdTry,
    eurTry,
    gbpTry,
  };
}

function createItem({ symbol, rate, source, sourceKind, derived = false, stale = false, updatedAt = nowIso() }) {
  const parsedRate = parsePositiveRate(rate);
  if (!parsedRate) return null;

  const { base, quote } = splitSymbol(symbol);
  return {
    symbol,
    base,
    quote,
    rate: Number(parsedRate.toFixed(8)),
    source,
    sourceKind,
    derived,
    updatedAt,
    stale,
  };
}

function buildCryptoItems(coinbaseRates, updatedAt) {
  const items = [];

  const tryDirect = (symbol, productId) => {
    const direct = parsePositiveRate(coinbaseRates[productId]);
    if (!direct) return null;
    return createItem({ symbol, rate: direct, source: "coinbase", sourceKind: SOURCE_KIND.CRYPTO, derived: false, updatedAt });
  };

  const tryDerived = (symbol, numeratorProductId, denominatorProductId) => {
    const numerator = parsePositiveRate(coinbaseRates[numeratorProductId]);
    const denominator = parsePositiveRate(coinbaseRates[denominatorProductId]);
    if (!numerator || !denominator) return null;
    return createItem({
      symbol,
      rate: numerator / denominator,
      source: "derived:coinbase",
      sourceKind: SOURCE_KIND.CRYPTO,
      derived: true,
      updatedAt,
    });
  };

  items.push(
    tryDirect("BTC/USDC", "BTC-USDC") || tryDerived("BTC/USDC", "BTC-USD", "USDC-USD"),
    tryDirect("ETH/USDC", "ETH-USDC") || tryDerived("ETH/USDC", "ETH-USD", "USDC-USD"),
    tryDirect("BTC/USDT", "BTC-USDT") || tryDerived("BTC/USDT", "BTC-USD", "USDT-USD"),
    tryDirect("ETH/USDT", "ETH-USDT") || tryDerived("ETH/USDT", "ETH-USD", "USDT-USD")
  );

  return items.filter(Boolean);
}

function buildFiatAndStableItems({ fiatRates, coinbaseRates, updatedAt }) {
  const items = [];
  const usdTry = parsePositiveRate(fiatRates?.usdTry);
  const eurTry = parsePositiveRate(fiatRates?.eurTry);
  const gbpTry = parsePositiveRate(fiatRates?.gbpTry);

  const usdtUsd = parsePositiveRate(coinbaseRates?.["USDT-USD"]);
  const usdcUsd = parsePositiveRate(coinbaseRates?.["USDC-USD"]);

  if (usdTry) {
    items.push(createItem({ symbol: "USD/TRY", rate: usdTry, source: "frankfurter", sourceKind: SOURCE_KIND.FIAT, derived: false, updatedAt }));
  }
  if (eurTry) {
    items.push(createItem({ symbol: "EUR/TRY", rate: eurTry, source: "derived:frankfurter", sourceKind: SOURCE_KIND.FIAT, derived: true, updatedAt }));
  }
  if (gbpTry) {
    items.push(createItem({ symbol: "GBP/TRY", rate: gbpTry, source: "derived:frankfurter", sourceKind: SOURCE_KIND.FIAT, derived: true, updatedAt }));
  }

  if (usdTry && usdtUsd) {
    items.push(createItem({
      symbol: "USDT/TRY",
      rate: usdtUsd * usdTry,
      source: "derived:coinbase+frankfurter",
      sourceKind: SOURCE_KIND.STABLE_TRY,
      derived: true,
      updatedAt,
    }));
  }

  if (usdTry && usdcUsd) {
    items.push(createItem({
      symbol: "USDC/TRY",
      rate: usdcUsd * usdTry,
      source: "derived:coinbase+frankfurter",
      sourceKind: SOURCE_KIND.STABLE_TRY,
      derived: true,
      updatedAt,
    }));
  }

  return items.filter(Boolean);
}

function normalizeAndOrderItems(items) {
  const map = new Map();
  items.forEach((item) => {
    if (!item || !PAIRS.includes(item.symbol)) return;
    map.set(item.symbol, item);
  });
  return PAIRS.map((symbol) => map.get(symbol)).filter(Boolean);
}

function toTickerPayload(items, generatedAt = nowIso()) {
  return {
    items: normalizeAndOrderItems(items),
    generatedAt,
    informationalOnly: true,
    nonAuthoritative: true,
    canAffectSettlement: false,
  };
}

function markStale(payload) {
  const generatedAt = nowIso();
  return toTickerPayload(
    (payload?.items || []).map((item) => ({ ...item, stale: true, updatedAt: item.updatedAt || generatedAt })),
    generatedAt
  );
}

function getRedisHandleSafe() {
  try {
    if (!isRedisReady()) return null;
    return getRedisClient();
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds) {
  memoryCache[key] = {
    value,
    expiresAt: Date.now() + (ttlSeconds * 1000),
  };

  const redis = getRedisHandleSafe();
  if (!redis) return;

  try {
    await redis.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    logger.warn(`[ReferenceTicker] Redis setEx failed for ${key}: ${err.message}`);
  }
}

async function cacheGet(key) {
  const redis = getRedisHandleSafe();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      memoryCache[key] = { value: parsed, expiresAt: Date.now() + 1_000 };
      return parsed;
    } catch (err) {
      logger.warn(`[ReferenceTicker] Redis get failed for ${key}: ${err.message}`);
    }
  }

  const memory = memoryCache[key];
  if (memory?.value && memory.expiresAt > Date.now()) {
    return memory.value;
  }

  return null;
}

async function refreshReferenceTicker() {
  const generatedAt = nowIso();

  let cachedFiat = await cacheGet(CACHE_KEYS.fiat);
  let fiatRates = null;

  if (cachedFiat?.fiatRates?.usdTry && cachedFiat?.generatedAt) {
    fiatRates = cachedFiat.fiatRates;
  } else {
    try {
      fiatRates = await fetchFiatRates();
      cachedFiat = { fiatRates, generatedAt };
      await cacheSet(CACHE_KEYS.fiat, cachedFiat, FIAT_TTL_SECONDS);
    } catch (err) {
      logger.warn(`[ReferenceTicker] Fiat refresh failed: ${err.message}`);
    }
  }

  let coinbaseRates = {};
  try {
    coinbaseRates = await fetchCoinbaseRates();
    await cacheSet(CACHE_KEYS.crypto, { coinbaseRates, generatedAt }, CRYPTO_TTL_SECONDS);
  } catch (err) {
    logger.warn(`[ReferenceTicker] Crypto refresh failed: ${err.message}`);
  }

  const items = [
    ...buildCryptoItems(coinbaseRates, generatedAt),
    ...buildFiatAndStableItems({ fiatRates, coinbaseRates, updatedAt: generatedAt }),
  ];

  const payload = toTickerPayload(items, generatedAt);

  if (payload.items.length > 0) {
    await cacheSet(CACHE_KEYS.lastGood, payload, LAST_GOOD_TTL_SECONDS);
    return payload;
  }

  const lastGood = await cacheGet(CACHE_KEYS.lastGood);
  if (lastGood?.items?.length) {
    return markStale(lastGood);
  }

  return toTickerPayload([], generatedAt);
}

async function getReferenceTickerPayload() {
  const cryptoCache = await cacheGet(CACHE_KEYS.crypto);
  const fiatCache = await cacheGet(CACHE_KEYS.fiat);

  if (cryptoCache?.coinbaseRates || fiatCache?.fiatRates) {
    const generatedAt = nowIso();
    const payload = toTickerPayload([
      ...buildCryptoItems(cryptoCache?.coinbaseRates || {}, generatedAt),
      ...buildFiatAndStableItems({
        fiatRates: fiatCache?.fiatRates || null,
        coinbaseRates: cryptoCache?.coinbaseRates || {},
        updatedAt: generatedAt,
      }),
    ], generatedAt);

    if (payload.items.length > 0) {
      return payload;
    }
  }

  return refreshReferenceTicker();
}

module.exports = {
  CACHE_KEYS,
  refreshReferenceTicker,
  getReferenceTickerPayload,
  _private: {
    parseCoinbaseTickerPrice,
    buildCryptoItems,
    buildFiatAndStableItems,
    fetchFiatRates,
    toTickerPayload,
    markStale,
    parsePositiveRate,
    __setMemoryCache(nextCache) {
      memoryCache = nextCache;
    },
  },
};
