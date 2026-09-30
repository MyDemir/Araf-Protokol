"use strict";
/**
 * SIWE Authentication Service
 *
 ## siwe.js hardening

This PR updates `backend/scripts/services/siwe.js` to make nonce issuance safer and more authoritative under race conditions.

### Previous behavior
`generateNonce()` checked for an existing nonce, but after generating a new nonce it called Redis `SET NX` without verifying whether the write actually succeeded.

That created a race condition:

- two concurrent requests for the same wallet could both generate different nonces
- one request could lose the `NX` write
- but still return its own locally generated nonce
- Redis would contain a different nonce than the one returned to the client

This could break SIWE verification even when the user flow looked valid from the frontend.

### New behavior
`generateNonce()` now treats Redis as the source of truth:

- if a nonce already exists, it is reused
- if no nonce exists, a new nonce is generated and written with `SET NX`
- if `NX` fails, the function no longer returns the local nonce
- instead, it re-reads the actual nonce from Redis and returns that value
- if Redis still does not contain a nonce after the failed `NX`, the function throws a safe retry error

### Effect
This makes nonce issuance authoritative under concurrency and removes nonce drift between the app and Redis.*/
const { SiweMessage } = require("siwe");
const { CURRENT_TERMS_VERSION } = require("../config/terms");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const redisConfig = require("../config/redis");
const { getRedisClient } = redisConfig;
const { resolveExpectedChainIdOrThrow } = require("./expectedChain");
const logger = require("../utils/logger");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || "15m";
const PII_EXPIRES = process.env.PII_TOKEN_EXPIRES_IN || "15m";
const NONCE_TTL_SECS = 5 * 60; // 5 dakika

function _positiveIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const REFRESH_TOKEN_TTL_SECS = 7 * 24 * 60 * 60; // 7 gün (kayan pencere)
// [TR] Mutlak oturum ömrü: rotasyonlar bu süreyi uzatamaz (varsayılan 30 gün).
const REFRESH_ABSOLUTE_TTL_SECS = _positiveIntEnv("REFRESH_ABSOLUTE_TTL_SECS", 30 * 24 * 60 * 60);
// [TR] Aynı refresh token'ın bu süre içinde ikinci kez gelmesi iki sekme yarışı sayılır (varsayılan 10 sn).
const REFRESH_REUSE_GRACE_MS = _positiveIntEnv("REFRESH_REUSE_GRACE_MS", 10_000);
const BLACKLIST_TIMEOUT_MS = _positiveIntEnv("JWT_BLACKLIST_TIMEOUT_MS", 1500);
const REFRESH_TOKEN_PREFIX = "refresh:";
const REFRESH_USED_PREFIX = "refresh-used:";
const REFRESH_FAMILY_PREFIX = "family:";
const SESSIONS_PREFIX = "sessions:";
const JWT_BLACKLIST_PREFIX = "blacklist:jti:";

function getSiweConfig() {
  const domainRaw = process.env.SIWE_DOMAIN;
  const uriRaw = process.env.SIWE_URI;
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    if (!domainRaw) throw new Error("SIWE_DOMAIN production ortamında zorunludur.");
    if (!uriRaw) throw new Error("SIWE_URI production ortamında zorunludur.");

    if (domainRaw === "localhost") {
      throw new Error("SIWE_DOMAIN production'da localhost olamaz.");
    }

    let parsedUri;
    try {
      parsedUri = new URL(uriRaw);
    } catch {
      throw new Error("SIWE_URI geçerli bir URL olmalıdır.");
    }

    if (parsedUri.protocol !== "https:") {
      throw new Error("SIWE_URI production'da https olmalıdır.");
    }
    if (parsedUri.host !== domainRaw) {
      throw new Error(`SIWE config uyuşmazlığı: SIWE_URI host=${parsedUri.host}, SIWE_DOMAIN=${domainRaw}`);
    }
  }

  const domain = domainRaw || "localhost";
  const uri = uriRaw || `https://${domain}`;
  return { domain, uri };
}

// JWT secret kalite kontrolü
function _shannonEntropy(str) {
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  const len = str.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const KNOWN_PLACEHOLDERS = [
  "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_MIN_64_CHARS",
  "your-secret-here",
  "supersecretkey",
  "changeme",
];

if (!JWT_SECRET) throw new Error("SEC-02: JWT_SECRET tanımlı değil!");
if (JWT_SECRET.length < 64) {
  throw new Error(`SEC-02: JWT_SECRET çok kısa (${JWT_SECRET.length} karakter). Min 64 gerekli.`);
}
if (KNOWN_PLACEHOLDERS.some((p) => JWT_SECRET.includes(p))) {
  throw new Error("SEC-02: JWT_SECRET placeholder içeriyor!");
}
if (_shannonEntropy(JWT_SECRET) < 3.5) {
  throw new Error("SEC-02: JWT_SECRET entropy çok düşük.");
}

logger.info(
  `[Auth] JWT_SECRET doğrulandı: ${JWT_SECRET.length} karakter, entropy: ${_shannonEntropy(JWT_SECRET).toFixed(2)}`
);

/**
 * [TR] Beklenen (kullanıcı kaynaklı) kimlik doğrulama hataları. Route katmanı yalnız bu sınıfın
 *      mesajını istemciye açar; diğer (beklenmeyen) hatalar 500 + genel mesaj olarak döner.
 * [EN] Expected, user-caused authentication failures. Anything else is an internal error.
 */
class AuthError extends Error {
  constructor(message, code = "AUTH_FAILED") {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.isAuthError = true;
    this.statusCode = 401;
  }
}

/**
 * [TR] SIWE mesajındaki chainId'nin karşılaştırılacağı beklenen zincir (EXPECTED_CHAIN_ID).
 *      Production'da zorunludur; geliştirmede tanımsızsa null (kontrol atlanır).
 */
function getExpectedSiweChainId() {
  return resolveExpectedChainIdOrThrow({
    isProduction: process.env.NODE_ENV === "production",
    rpcUrl: process.env.BASE_RPC_URL,
    surface: "siwe",
  });
}

// KEYS yerine SCAN kullanılır; Redis'i bloklamaz. (Yalnız legacy revoke fallback'i için.)
async function _scanKeys(redis, pattern) {
  const results = [];
  let cursor = 0;

  do {
    const reply = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = reply.cursor;
    results.push(...reply.keys);
  } while (cursor !== 0);

  return results;
}

function _withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} ${ms}ms içinde yanıt vermedi.`)), ms);
    if (typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Geçerli nonce varsa yeniden üretmeyiz.
// Yarış durumunda Redis'te gerçekten yaşayan nonce authoritative kabul edilir.
async function generateNonce(walletAddress) {
  const redis = getRedisClient();
  const key = `nonce:${walletAddress.toLowerCase()}`;

  const existing = await redis.get(key);
  if (existing) {
    logger.debug(`[Auth] Mevcut nonce kullanılıyor: ${walletAddress}`);
    return existing;
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const setResult = await redis.set(key, nonce, { NX: true, EX: NONCE_TTL_SECS });

  if (setResult === null) {
    const racedNonce = await redis.get(key);

    if (!racedNonce) {
      throw new Error("Nonce üretilemedi. Lütfen tekrar deneyin.");
    }

    logger.debug(`[Auth] Nonce race condition çözüldü, mevcut nonce kullanılıyor: ${walletAddress}`);
    return racedNonce;
  }

  logger.debug(`[Auth] Yeni nonce üretildi: ${walletAddress}`);
  return nonce;
}

async function consumeNonce(walletAddress) {
  const redis = getRedisClient();
  const key = `nonce:${walletAddress.toLowerCase()}`;
  return redis.getDel(key);
}

/**
 * SIWE imzasını doğrular.
 *
 * [TR] Sıra önemlidir: nonce önce YALNIZCA okunur, imza doğrulanır, ancak ondan sonra atomik
 *      (GETDEL) tüketilir. Aksi halde herhangi biri geçersiz imzayla kurbanın nonce'unu yakabilirdi.
 *      Tek kullanımlık garanti korunur: GETDEL yalnız bir çağrıya değer döndürür.
 * [EN] Read nonce → verify signature → atomically consume. Invalid signatures never burn a nonce.
 */
async function verifySiweSignature(messageStr, signature) {
  let message;
  try {
    message = new SiweMessage(messageStr);
  } catch {
    throw new AuthError("SIWE mesajı geçersiz.");
  }
  const { domain: expectedDomain, uri: expectedUri } = getSiweConfig();

  if (message.domain !== expectedDomain) {
    throw new AuthError(`SIWE domain uyuşmazlığı: beklenen ${expectedDomain}, gelen ${message.domain}`);
  }

  let parsedIncoming = null;
  let parsedExpected = null;

  try {
    parsedIncoming = new URL(message.uri);
    parsedExpected = new URL(expectedUri);
  } catch {
    throw new AuthError("SIWE URI formatı geçersiz.");
  }

  if (parsedIncoming.origin !== parsedExpected.origin) {
    logger.warn(
      `[Auth] SIWE URI origin uyuşmazlığı: beklenen ${parsedExpected.origin}, gelen ${parsedIncoming.origin}`
    );
    throw new AuthError(`SIWE URI uyuşmazlığı: beklenen origin ${parsedExpected.origin}`);
  }

  // [TR] chainId doğrulaması: başka bir zincir için imzalanmış mesaj kabul edilmez.
  const expectedChainId = getExpectedSiweChainId();
  if (expectedChainId !== null && Number(message.chainId) !== expectedChainId) {
    throw new AuthError(
      `SIWE chainId uyuşmazlığı: beklenen ${expectedChainId}, gelen ${message.chainId}`,
      "SIWE_CHAIN_MISMATCH"
    );
  }

  const wallet = message.address.toLowerCase();
  const redis = getRedisClient();
  const storedNonce = await redis.get(`nonce:${wallet}`);
  if (!storedNonce) throw new AuthError("Nonce süresi dolmuş veya bulunamadı.");
  if (message.nonce !== storedNonce) throw new AuthError("Nonce uyuşmazlığı.");

  let result;
  try {
    result = await message.verify(
      { signature, domain: expectedDomain, nonce: storedNonce },
      { suppressExceptions: true }
    );
  } catch {
    throw new AuthError("SIWE imza doğrulaması başarısız.");
  }
  if (!result?.success) throw new AuthError("SIWE imza doğrulaması başarısız.");

  // İmza geçerli → nonce'u atomik olarak tüket. Değer dönmüyorsa başka bir istek kazandı.
  const consumed = await consumeNonce(wallet);
  if (consumed !== storedNonce) throw new AuthError("Nonce süresi dolmuş veya bulunamadı.");

  return wallet;
}

function issueJWT(walletAddress) {
  const jti = crypto.randomBytes(16).toString("hex");
  return jwt.sign(
    { sub: walletAddress.toLowerCase(), type: "auth", jti },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function issuePIIToken(walletAddress, tradeId) {
  return jwt.sign(
    { sub: walletAddress.toLowerCase(), type: "pii", tradeId },
    JWT_SECRET,
    { expiresIn: PII_EXPIRES }
  );
}

/**
 * @param {string} token
 * @param {{ ignoreExpiration?: boolean }} [options] logout gibi süresi dolmuş token'ın
 *        imzasının hâlâ geçerli olması yeterli olan akışlar için.
 */
function verifyJWT(token, options = {}) {
  return options.ignoreExpiration
    ? jwt.verify(token, JWT_SECRET, { ignoreExpiration: true })
    : jwt.verify(token, JWT_SECRET);
}

/**
 * [TR] Redis yavaş/erişilemezse (offline queue komutu bekletir) requireAuth asılı kalmasın:
 *      hazır değilse anında, hazırsa da zaman aşımıyla hata → JWT_BLACKLIST_FAIL_MODE'a göre
 *      (production'da varsayılan "closed": istek reddedilir).
 */
async function isJWTBlacklisted(jti) {
  if (!jti) return false;

  try {
    if (typeof redisConfig.isReady === "function" && !redisConfig.isReady()) {
      throw new Error("Redis hazır değil");
    }
    const redis = getRedisClient();
    const val = await _withTimeout(
      redis.get(`${JWT_BLACKLIST_PREFIX}${jti}`),
      BLACKLIST_TIMEOUT_MS,
      "Redis blacklist okuması"
    );
    return val !== null;
  } catch (err) {
    const failMode =
      process.env.JWT_BLACKLIST_FAIL_MODE ||
      (process.env.NODE_ENV === "production" ? "closed" : "open");

    logger.warn(`[Auth] JWT blacklist kontrolü yapılamadı (mode=${failMode}): ${err.message}`);
    return failMode === "closed";
  }
}

async function blacklistJWT(token) {
  try {
    const payload = jwt.decode(token);
    if (!payload?.jti) return;
    if (!payload?.exp) return;

    const redis = getRedisClient();
    const nowSecs = Math.floor(Date.now() / 1000);
    const ttlSecs = Math.max(1, Number(payload.exp) - nowSecs);

    await _withTimeout(
      redis.setEx(`${JWT_BLACKLIST_PREFIX}${payload.jti}`, ttlSecs, "1"),
      BLACKLIST_TIMEOUT_MS,
      "Redis blacklist yazması"
    );
    logger.debug(`[Auth] JWT blacklist'e alındı: jti=${payload.jti}`);
  } catch (err) {
    logger.warn(`[Auth] JWT blacklist eklenemedi: ${err.message}`);
  }
}

function _familyKey(wallet, familyId) {
  return `${REFRESH_FAMILY_PREFIX}${wallet}:${familyId}`;
}

function _sessionsKey(wallet) {
  return `${SESSIONS_PREFIX}${wallet}`;
}

/**
 * Refresh token üretir. Değer familyId, wallet, koşul sürümü ve oturum başlangıcı ile saklanır.
 *
 * @param {string} walletAddress
 * @param {string|null} familyId       rotasyonda mevcut aile; ilk girişte null
 * @param {string|null} termsVersion
 * @param {{ startedAt?: number, replaceTokens?: string[] }} [options]
 *        startedAt: oturumun (ailenin) ilk açılış zamanı (ms) — mutlak ömür bunun üzerinden sayılır.
 *        replaceTokens: aynı MULTI içinde silinecek eski token'lar (aile anahtarı hiç boşalmaz).
 */
async function issueRefreshToken(walletAddress, familyId = null, termsVersion = null, options = {}) {
  const redis = getRedisClient();
  const { startedAt = null, replaceTokens = [] } = options || {};
  const token = crypto.randomBytes(32).toString("hex");
  const currentFamilyId = familyId || crypto.randomBytes(16).toString("hex");
  const normalizedWallet = walletAddress.toLowerCase();
  const familyKey = _familyKey(normalizedWallet, currentFamilyId);
  const tokenKey = `${REFRESH_TOKEN_PREFIX}${token}`;

  const nowMs = Date.now();
  const sessionStartedAt = Number.isFinite(startedAt) ? startedAt : nowMs;
  const remainingSecs = Math.floor((sessionStartedAt + REFRESH_ABSOLUTE_TTL_SECS * 1000 - nowMs) / 1000);
  if (remainingSecs <= 0) {
    throw new AuthError("Oturum azami ömrüne ulaştı. Lütfen yeniden giriş yapın.", "SESSION_EXPIRED");
  }
  const ttlSecs = Math.min(REFRESH_TOKEN_TTL_SECS, remainingSecs);

  const multi = redis.multi();
  multi.setEx(
    tokenKey,
    ttlSecs,
    JSON.stringify({
      familyId: currentFamilyId,
      wallet: normalizedWallet,
      // [TR] Oturumun kabul ettiği koşul sürümü; rotasyonda DB'ye gitmeden kontrol edilir.
      termsVersion: termsVersion || null,
      // [TR] Oturum ailesinin ilk açılış zamanı; rotasyonlar bunu taşır → mutlak oturum ömrü.
      startedAt: sessionStartedAt,
    })
  );
  // Önce yenisini ekle, sonra eskileri çıkar: aile anahtarı hiçbir anda boş (yok) olmaz.
  multi.sAdd(familyKey, token);
  for (const old of replaceTokens) {
    multi.del(`${REFRESH_TOKEN_PREFIX}${old}`);
    multi.sRem(familyKey, old);
  }
  multi.expire(familyKey, ttlSecs);
  // [TR] Cüzdan başına oturum indeksi: logout artık tüm keyspace'i SCAN etmez.
  multi.sAdd(_sessionsKey(normalizedWallet), currentFamilyId);
  multi.expire(_sessionsKey(normalizedWallet), REFRESH_ABSOLUTE_TTL_SECS);
  await multi.exec();

  logger.debug(`[Auth] Refresh token üretildi: ${walletAddress}`);
  return token;
}

async function _revokeFamily(redis, wallet, familyId) {
  const familyKey = _familyKey(wallet, familyId);
  const members = await redis.sMembers(familyKey);
  const multi = redis.multi();
  members.forEach((m) => multi.del(`${REFRESH_TOKEN_PREFIX}${m}`));
  multi.del(familyKey);
  multi.sRem(_sessionsKey(wallet), familyId);
  await multi.exec();
  return members.length;
}

function _parseUsedTombstone(raw) {
  const sep = String(raw).indexOf("|");
  if (sep <= 0) return null;
  const usedAt = Number(raw.slice(0, sep));
  let info;
  try {
    info = JSON.parse(raw.slice(sep + 1));
  } catch {
    return null;
  }
  if (!Number.isFinite(usedAt) || !info || typeof info !== "object") return null;
  return { usedAt, info };
}

function _assertExpectedWallet(expectedWallet, tokenWallet) {
  if (expectedWallet && expectedWallet.toLowerCase() !== tokenWallet) {
    logger.error(
      `[Auth] KRİTİK: Token/wallet uyuşmazlığı — muhtemel hijack girişimi! ` +
      `token_wallet=${tokenWallet} istek_wallet=${expectedWallet}`
    );
    throw new AuthError("Token/wallet uyuşmazlığı. Güvenlik ihlali tespit edildi.", "TOKEN_WALLET_MISMATCH");
  }
}

function _assertCurrentTerms(termsVersion) {
  if (termsVersion !== CURRENT_TERMS_VERSION) {
    const err = new AuthError("Kullanım koşulları güncel değil. Lütfen yeniden giriş yapın.", "TERMS_NOT_ACCEPTED");
    throw err;
  }
}

const INVALID_REFRESH_MESSAGE = "Refresh token geçersiz veya süresi dolmuş. Lütfen yeniden giriş yapın.";

/**
 * [TR] Daha önce döndürülmüş (tüketilmiş) bir refresh token sunuldu.
 *      - Kısa tolerans penceresi içinde (iki sekme yarışı): aile İPTAL EDİLMEZ; yalnız yeni bir JWT
 *        verilir, refresh token döndürülmez (çerez zaten yarışı kazanan sekmenin yeni token'ını taşır).
 *      - Pencere dışında: token çalınmış/tekrar oynatılmış olabilir → ailenin tamamı iptal edilir.
 */
async function _handleConsumedRefreshToken(redis, usedRaw, expectedWallet) {
  const parsed = _parseUsedTombstone(usedRaw);
  const wallet = String(parsed?.info?.wallet || "").toLowerCase();
  if (!parsed || !/^0x[a-f0-9]{40}$/.test(wallet) || !parsed.info.familyId) {
    throw new AuthError(INVALID_REFRESH_MESSAGE, "REFRESH_INVALID");
  }
  _assertExpectedWallet(expectedWallet, wallet);

  const { usedAt, info } = parsed;
  const familyKey = _familyKey(wallet, info.familyId);
  const familyAlive = await redis.exists(familyKey);
  if (!familyAlive) {
    // Aile zaten iptal edilmiş (logout / önceki reuse tespiti) veya süresi dolmuş.
    throw new AuthError(INVALID_REFRESH_MESSAGE, "REFRESH_INVALID");
  }

  if (Date.now() - usedAt <= REFRESH_REUSE_GRACE_MS) {
    _assertCurrentTerms(info.termsVersion);
    logger.warn(`[Auth] Refresh yarışı (tolerans penceresi): ${wallet} — yalnız JWT yenilendi.`);
    return { token: issueJWT(wallet), refreshToken: null, wallet, graceReuse: true };
  }

  logger.error(
    `[Auth] KRİTİK: Refresh token YENİDEN KULLANIM tespit edildi — aile iptal ediliyor. wallet=${wallet}`
  );
  await _revokeFamily(redis, wallet, info.familyId);
  throw new AuthError(
    "Refresh token yeniden kullanımı tespit edildi. Oturum sonlandırıldı, lütfen yeniden giriş yapın.",
    "REFRESH_REUSE_DETECTED"
  );
}

/**
 * Refresh token rotasyonu.
 *
 * Tek kullanım: token, "kullanıldı" tombstone'u SET NX ile yazılarak atomik olarak talep edilir
 * (yalnız bir çağrı kazanır). Tombstone token'ın kalan ömrü boyunca saklanır; tekrar kullanım
 * _handleConsumedRefreshToken ile tespit edilir.
 */
async function rotateRefreshToken(refreshToken, expectedWallet = null) {
  const redis = getRedisClient();
  const tokenKey = `${REFRESH_TOKEN_PREFIX}${refreshToken}`;
  const usedKey = `${REFRESH_USED_PREFIX}${refreshToken}`;

  const stored = await redis.get(tokenKey);

  if (!stored) {
    const usedRaw = await redis.get(usedKey);
    if (usedRaw) return _handleConsumedRefreshToken(redis, usedRaw, expectedWallet);
    logger.warn("[Auth] Geçersiz/süresi dolmuş refresh token denemesi.");
    throw new AuthError(INVALID_REFRESH_MESSAGE, "REFRESH_INVALID");
  }

  let storedData;
  try {
    storedData = JSON.parse(stored);
  } catch {
    storedData = { familyId: stored, wallet: null };
  }

  const normalizedWallet = String(storedData.wallet || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalizedWallet)) {
    logger.error("[Auth] KRİTİK: Refresh token payload wallet alanı geçersiz.");
    throw new AuthError("Refresh token içeriği geçersiz.", "REFRESH_INVALID");
  }

  const nowMs = Date.now();
  const claimed = await redis.set(usedKey, `${nowMs}|${stored}`, { NX: true, EX: REFRESH_TOKEN_TTL_SECS });
  if (claimed === null) {
    // Aynı token'ı eşzamanlı başka bir istek zaten döndürdü.
    const usedRaw = await redis.get(usedKey);
    if (!usedRaw) throw new AuthError(INVALID_REFRESH_MESSAGE, "REFRESH_INVALID");
    return _handleConsumedRefreshToken(redis, usedRaw, expectedWallet);
  }

  _assertExpectedWallet(expectedWallet, normalizedWallet);

  const { familyId } = storedData;

  // [TR] Oturum güncel koşul sürümüyle açılmadıysa (eski oturum veya sürüm yükseltmesi) yenilenmez;
  //      kullanıcı yeniden giriş yapar ve koşulları kabul eder. Kontrol Redis verisinden, DB'siz.
  // [EN] Sessions not opened under the current terms version are not refreshed (no DB read).
  _assertCurrentTerms(storedData.termsVersion);

  // [TR] Mutlak oturum ömrü: yenilemeler sonsuza dek sürmez.
  const startedAt = Number.isFinite(storedData.startedAt) ? storedData.startedAt : nowMs;
  if (nowMs - startedAt >= REFRESH_ABSOLUTE_TTL_SECS * 1000) {
    await _revokeFamily(redis, normalizedWallet, familyId);
    throw new AuthError("Oturum azami ömrüne ulaştı. Lütfen yeniden giriş yapın.", "SESSION_EXPIRED");
  }

  const familyMembers = await redis.sMembers(_familyKey(normalizedWallet, familyId));
  const replaceTokens = [...new Set([refreshToken, ...familyMembers])];

  const newJWT = issueJWT(normalizedWallet);
  const newRefreshToken = await issueRefreshToken(
    normalizedWallet,
    familyId,
    storedData.termsVersion,
    { startedAt, replaceTokens }
  );

  logger.info(`[Auth] Token rotasyonu tamamlandı: ${normalizedWallet}`);
  return { token: newJWT, refreshToken: newRefreshToken, wallet: normalizedWallet };
}

/**
 * Refresh token'ın sahibini (wallet + aile) döndürür; token yaşıyorsa da tüketilmişse de çalışır.
 * Süresi dolmuş JWT ile logout edemeyen kullanıcılar için (refresh çerezinden logout).
 * @returns {Promise<{ wallet: string, familyId: string }|null>}
 */
async function peekRefreshTokenOwner(refreshToken) {
  if (typeof refreshToken !== "string" || !/^[a-f0-9]{64}$/.test(refreshToken)) return null;
  const redis = getRedisClient();

  const stored = await redis.get(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
  if (stored) {
    try {
      const data = JSON.parse(stored);
      const wallet = String(data.wallet || "").toLowerCase();
      if (/^0x[a-f0-9]{40}$/.test(wallet) && data.familyId) return { wallet, familyId: data.familyId };
    } catch {
      return null;
    }
    return null;
  }

  const usedRaw = await redis.get(`${REFRESH_USED_PREFIX}${refreshToken}`);
  const parsed = usedRaw ? _parseUsedTombstone(usedRaw) : null;
  const wallet = String(parsed?.info?.wallet || "").toLowerCase();
  if (parsed && /^0x[a-f0-9]{40}$/.test(wallet) && parsed.info.familyId) {
    return { wallet, familyId: parsed.info.familyId };
  }
  return null;
}

/**
 * Cüzdanın tüm refresh aileleri iptal edilir.
 * [TR] Aileler sessions:<addr> indeksinden okunur (SCAN yok). İndeks öncesi açılmış oturumlar için
 *      indeks boşsa tek seferlik SCAN fallback'i vardır; REFRESH_LEGACY_SCAN=false ile kapatılır
 *      (deploy'dan 7 gün sonra kapatılması önerilir).
 */
async function revokeRefreshToken(walletAddress) {
  const redis = getRedisClient();
  const addr = walletAddress.toLowerCase();

  let familyIds = await redis.sMembers(_sessionsKey(addr));

  if (familyIds.length === 0 && process.env.REFRESH_LEGACY_SCAN !== "false") {
    const prefix = `${REFRESH_FAMILY_PREFIX}${addr}:`;
    const legacyKeys = await _scanKeys(redis, `${prefix}*`);
    familyIds = legacyKeys.map((k) => k.slice(prefix.length));
  }

  if (familyIds.length === 0) {
    logger.info(`[Auth] Revoke: ${addr} için aktif refresh token bulunamadı.`);
    return;
  }

  let deletedCount = 0;
  for (const familyId of familyIds) {
    deletedCount += await _revokeFamily(redis, addr, familyId);
  }
  await redis.del(_sessionsKey(addr));

  logger.info(`[Auth] Revoke: ${addr} → ${deletedCount} token, ${familyIds.length} aile silindi.`);
}

module.exports = {
  AuthError,
  getSiweConfig,
  getExpectedSiweChainId,
  generateNonce,
  consumeNonce,
  verifySiweSignature,
  issueJWT,
  issuePIIToken,
  verifyJWT,
  isJWTBlacklisted,
  blacklistJWT,
  issueRefreshToken,
  rotateRefreshToken,
  peekRefreshTokenOwner,
  revokeRefreshToken,
};
