"use strict";

const { getRedisClient, isReady: isRedisReady } = require("../config/redis");
const logger = require("../utils/logger");

const COINBASE_BASE_URL = "https://api.coinbase.com/api/v3/brokerage";
// [TR] v2 dizi, v1 nesne döndürür; ikisi de extractFrankfurterUsdRates ile ayrıştırılır. v2 başarısızsa v1 denenir.
// [EN] v2 returns an array, v1 an object; both parse below. v1 is the fallback when v2 fails.
const FRANKFURTER_URLS = [
  "https://api.frankfurter.dev/v2/rates?base=USD&quotes=TRY,EUR,GBP",
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY,EUR,GBP",
];

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
  // [TR] Public ticker uç noktası `limit` parametresi ister; yokken 400 dönüyor ve tüm kripto satırları
  //      sessizce kayboluyordu (şerit boş kalıp hiç görünmüyordu).
  // [EN] The public ticker endpoint requires `limit`; without it every call returned 400 and the ticker went empty.
  const url = `${COINBASE_BASE_URL}/market/products/${encodeURIComponent(productId)}/ticker?limit=1`;
  try {
    const payload = await fetchJsonWithTimeout(url, 5000);
    const price = parseCoinbaseTickerPrice(payload);
    if (!price) {
      logger.warn(`[ReferenceTicker] Coinbase price parse failed: ${productId}`);
      return null;
    }
    return price;
  } catch (err) {
    // 404 = pair not listed (expected; a derived rate is used instead). 400 means a malformed request: log it.
    if (err?.status === 404) {
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


function extractFrankfurterUsdRates(payload) {
  if (Array.isArray(payload)) {
    return payload.reduce((acc, row) => {
      const quote = String(row?.quote || "").toUpperCase();
      const rate = parsePositiveRate(row?.rate);
      if (quote && rate) acc[quote] = rate;
      return acc;
    }, {});
  }

  if (Array.isArray(payload?.data)) {
    return payload.data.reduce((acc, row) => {
      const quote = String(row?.quote || "").toUpperCase();
      const rate = parsePositiveRate(row?.rate);
      if (quote && rate) acc[quote] = rate;
      return acc;
    }, {});
  }

  return payload?.rates || null;
}
async function fetchFrankfurterRates() {
  let lastErr = null;
  for (const url of FRANKFURTER_URLS) {
    try {
      const rates = extractFrankfurterUsdRates(await fetchJsonWithTimeout(url, 5000));
      if (parsePositiveRate(rates?.TRY)) return rates;
      lastErr = new Error(`Frankfurter payload without TRY: ${url}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Frankfurter unavailable");
}

async function fetchFiatRates() {
  const rates = await fetchFrankfurterRates();

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

function _olderIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function buildFiatAndStableItems({ fiatRates, coinbaseRates, updatedAt, fiatUpdatedAt = null }) {
  const items = [];
  // [TR] Fiat satırları fiat verisinin GERÇEK zamanını taşır; stablecoin/TRY satırları iki kaynaktan
  //      türetildiği için ikisinin eskisini taşır (taze görünen eski veri üretmemek için).
  const fiatTime = fiatUpdatedAt || updatedAt;
  const stableTime = _olderIso(fiatUpdatedAt, updatedAt) || updatedAt;
  const usdTry = parsePositiveRate(fiatRates?.usdTry);
  const eurTry = parsePositiveRate(fiatRates?.eurTry);
  const gbpTry = parsePositiveRate(fiatRates?.gbpTry);

  const usdtUsd = parsePositiveRate(coinbaseRates?.["USDT-USD"]);
  const usdcUsd = parsePositiveRate(coinbaseRates?.["USDC-USD"]);

  if (usdTry) {
    items.push(createItem({ symbol: "USD/TRY", rate: usdTry, source: "frankfurter", sourceKind: SOURCE_KIND.FIAT, derived: false, updatedAt: fiatTime }));
  }
  if (eurTry) {
    items.push(createItem({ symbol: "EUR/TRY", rate: eurTry, source: "derived:frankfurter", sourceKind: SOURCE_KIND.FIAT, derived: true, updatedAt: fiatTime }));
  }
  if (gbpTry) {
    items.push(createItem({ symbol: "GBP/TRY", rate: gbpTry, source: "derived:frankfurter", sourceKind: SOURCE_KIND.FIAT, derived: true, updatedAt: fiatTime }));
  }

  if (usdTry && usdtUsd) {
    items.push(createItem({
      symbol: "USDT/TRY",
      rate: usdtUsd * usdTry,
      source: "derived:coinbase+frankfurter",
      sourceKind: SOURCE_KIND.STABLE_TRY,
      derived: true,
      updatedAt: stableTime,
    }));
  }

  if (usdTry && usdcUsd) {
    items.push(createItem({
      symbol: "USDC/TRY",
      rate: usdcUsd * usdTry,
      source: "derived:coinbase+frankfurter",
      sourceKind: SOURCE_KIND.STABLE_TRY,
      derived: true,
      updatedAt: stableTime,
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

/**
 * [TR] Satır bazında last-good: taze olmayan her sembol, son başarılı veriden `stale: true` ve ORİJİNAL
 *      updatedAt ile doldurulur. Böylece bir kaynağın çökmesi yalnız o satırları bayatlatır; geri kalanlar
 *      taze kalır ve bayat veri taze görünmez.
 * [EN] Per-row last-good: any symbol missing from the fresh set is filled from the last good payload,
 *      flagged stale and keeping its original updatedAt.
 */
function mergeWithLastGood(freshItems, lastGood) {
  const fresh = normalizeAndOrderItems(freshItems);
  const have = new Set(fresh.map((item) => item.symbol));
  const fallback = (lastGood?.items || [])
    .filter((item) => item && PAIRS.includes(item.symbol) && !have.has(item.symbol))
    .map((item) => ({ ...item, stale: true, updatedAt: item.updatedAt || lastGood.generatedAt || nowIso() }));
  return { items: normalizeAndOrderItems([...fresh, ...fallback]), freshCount: fresh.length };
}

let refreshInFlight = null;

/** Tekil in-flight: eşzamanlı çağrılar aynı yenilemeyi paylaşır (dış API'lere çoklu istek yok). */
function refreshReferenceTicker() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = _refreshReferenceTicker().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function _refreshReferenceTicker() {
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

  const freshItems = [
    ...buildCryptoItems(coinbaseRates, generatedAt),
    ...buildFiatAndStableItems({
      fiatRates,
      coinbaseRates,
      updatedAt: generatedAt,
      fiatUpdatedAt: fiatRates ? cachedFiat?.generatedAt || generatedAt : null,
    }),
  ];

  const lastGood = await cacheGet(CACHE_KEYS.lastGood);
  const merged = mergeWithLastGood(freshItems, lastGood);
  const payload = toTickerPayload(merged.items, generatedAt);

  // Yalnız en az bir taze satır varsa last-good güncellenir (tamamen bayat veri "taze" sayılmasın).
  if (merged.freshCount > 0) {
    await cacheSet(CACHE_KEYS.lastGood, payload, LAST_GOOD_TTL_SECONDS);
  }

  return payload;
}

async function getReferenceTickerPayload() {
  const cryptoCache = await cacheGet(CACHE_KEYS.crypto);
  const fiatCache = await cacheGet(CACHE_KEYS.fiat);

  if (cryptoCache?.coinbaseRates || fiatCache?.fiatRates) {
    const generatedAt = nowIso();
    const cryptoAt = cryptoCache?.generatedAt || generatedAt;
    const freshItems = [
      ...buildCryptoItems(cryptoCache?.coinbaseRates || {}, cryptoAt),
      ...buildFiatAndStableItems({
        fiatRates: fiatCache?.fiatRates || null,
        coinbaseRates: cryptoCache?.coinbaseRates || {},
        updatedAt: cryptoAt,
        fiatUpdatedAt: fiatCache?.fiatRates ? fiatCache.generatedAt || generatedAt : null,
      }),
    ];

    if (freshItems.length > 0) {
      const lastGood = await cacheGet(CACHE_KEYS.lastGood);
      return toTickerPayload(mergeWithLastGood(freshItems, lastGood).items, generatedAt);
    }
  }

  return refreshReferenceTicker();
}

module.exports = {
  CACHE_KEYS,
  refreshReferenceTicker,
  getReferenceTickerPayload,
};
