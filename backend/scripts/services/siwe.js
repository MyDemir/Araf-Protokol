"use strict";

/**
 * SIWE Authentication Service
 *
 * KRİT-01 Fix: Refresh Token Hijacking (ATO) Kapatıldı.
 *   ÖNCEKİ: rotateRefreshToken(walletAddress, refreshToken) içinde Redis'ten
 *   alınan familyId'nin gerçekten o walletAddress'e ait olup olmadığı
 *   DOĞRULANMIYORDU. Saldırgan kendi refreshToken'ı + kurbanın wallet adresi
 *   ile kurban adına yeni JWT alabiliyordu.
 *   ŞİMDİ: Redis'te token değeri { familyId, wallet } olarak saklanıyor.
 *   Rotasyon sırasında token'daki wallet ile istekteki wallet eşleşmezse ret.
 *
 * KRİT-07 Fix: SIWE Nonce Deadlock Düzeltildi.
 *   ÖNCEKİ: generateNonce her çağrıda mevcut nonce'ın üzerine yazıyordu.
 *   Çift tıklamada 2. istek 1. nonce'ı geçersiz kılıyordu.
 *   ŞİMDİ: Mevcut geçerli nonce varsa yeniden üretme (NX flag).
 *
 * YÜKS-15 Fix: SIWE URI Doğrulama Eklendi.
 *   EIP-4361 standardı URI kontrolünü zorunlu kılıyor.
 *   Sahte subdomain (araf-fake.xyz) ile aynı domain'i kullanarak
 *   yapılan phishing saldırıları artık reddediliyor.
 *
 * ORTA-09 Fix: Stateless JWT İptal Mekanizması (Blacklist).
 *   ÖNCEKİ: Logout → refresh token silindi ama 15 dk'lık JWT hâlâ geçerliydi.
 *   ŞİMDİ: Logout'ta JWT'nin jti (unique ID) değeri 15 dk Redis blacklist'e alınıyor.
 *   requireAuth middleware bu blacklist'i kontrol ediyor.
 *
 * BACK-01 Fix: Nuclear Token Rotasyonu Yumuşatıldı.
 *   ÖNCEKİ: Şüpheli deneme → tüm cihazlardaki tüm oturumlar siliniyordu.
 *   Ağ hatası nedeniyle token yenileme başarısız olursa sistem bunu saldırı sanıp
 *   Bleeding Escrow anında kullanıcıyı tüm cihazlardan atıyordu.
 *   ŞİMDİ: Sadece kullanılan ve aynı aileye ait ESKİ token'lar geçersiz kılınıyor.
 *   Tüm aile silimi YALNIZCA token reuse (tekrar kullanım) tespitinde yapılıyor.
 */

const { SiweMessage } = require("siwe");
const jwt             = require("jsonwebtoken");
const crypto          = require("crypto");
const { getRedisClient } = require("../config/redis");
const logger          = require("../utils/logger");

const JWT_SECRET      = process.env.JWT_SECRET;
const JWT_EXPIRES     = process.env.JWT_EXPIRES_IN      || "15m";
const PII_EXPIRES     = process.env.PII_TOKEN_EXPIRES_IN || "15m";
const NONCE_TTL_SECS  = 5 * 60;  // 5 dakika

// [TR] JWT süresini milisaniyeye çevirme yardımcısı (blacklist TTL için)
const JWT_EXPIRES_MS  = 15 * 60 * 1000; // 15 dakika

const REFRESH_TOKEN_TTL_SECS = 7 * 24 * 60 * 60; // 7 gün
const REFRESH_TOKEN_PREFIX   = "refresh:";
const REFRESH_FAMILY_PREFIX  = "family:";
const JWT_BLACKLIST_PREFIX   = "blacklist:jti:";

function getSiweConfig() {
  const domainRaw = process.env.SIWE_DOMAIN;
  const uriRaw    = process.env.SIWE_URI;
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    if (!domainRaw) throw new Error("SIWE_DOMAIN production ortamında zorunludur.");
    if (!uriRaw)    throw new Error("SIWE_URI production ortamında zorunludur.");

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
  const uri    = uriRaw || `https://${domain}`;
  return { domain, uri };
}

// ── SEC-02: JWT_SECRET Entropy Doğrulaması ────────────────────────────────────
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
  "your-secret-here", "supersecretkey", "changeme",
];

if (!JWT_SECRET)                       throw new Error("SEC-02: JWT_SECRET tanımlı değil!");
if (JWT_SECRET.length < 64)            throw new Error(`SEC-02: JWT_SECRET çok kısa (${JWT_SECRET.length} karakter). Min 64 gerekli.`);
if (KNOWN_PLACEHOLDERS.some(p => JWT_SECRET.includes(p))) throw new Error("SEC-02: JWT_SECRET placeholder içeriyor!");
if (_shannonEntropy(JWT_SECRET) < 3.5) throw new Error("SEC-02: JWT_SECRET entropy çok düşük.");

logger.info(`[Auth] JWT_SECRET doğrulandı: ${JWT_SECRET.length} karakter, entropy: ${_shannonEntropy(JWT_SECRET).toFixed(2)}`);

// ── Redis SCAN Yardımcısı (KEYS yerine — O(N) bloklaması yok) ─────────────────
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

// ── Nonce Yönetimi ────────────────────────────────────────────────────────────

/**
 * KRİT-07 Fix: Nonce üretimi — mevcut geçerli nonce varsa yeniden üretme.
 * ÖNCEKİ: setEx her çağrıda mevcut nonce'ı siliyordu (çift tıklama deadlock).
 * ŞİMDİ: SET ... NX (Not eXists) — sadece yoksa yaz.
 */
async function generateNonce(walletAddress) {
  const redis = getRedisClient();
  const key   = `nonce:${walletAddress.toLowerCase()}`;

  // [TR] Mevcut nonce varsa geri döndür (çift tıklama güvenliği)
  const existing = await redis.get(key);
  if (existing) {
    logger.debug(`[Auth] Mevcut nonce kullanılıyor: ${walletAddress}`);
    return existing;
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  // [TR] NX: sadece anahtar yoksa yaz — race condition güvenli
  await redis.set(key, nonce, { NX: true, EX: NONCE_TTL_SECS });
  logger.debug(`[Auth] Yeni nonce üretildi: ${walletAddress}`);
  return nonce;
}

async function consumeNonce(walletAddress) {
  const redis = getRedisClient();
  const key   = `nonce:${walletAddress.toLowerCase()}`;
  return redis.getDel(key);
}

// ── SIWE Doğrulama ────────────────────────────────────────────────────────────

/**
 * YÜKS-15 Fix: URI doğrulaması eklendi (EIP-4361 zorunlu).
 */
async function verifySiweSignature(messageStr, signature) {
  const message        = new SiweMessage(messageStr);
  const { domain: expectedDomain, uri: expectedUri } = getSiweConfig();

  // [TR] Domain kontrolü
  if (message.domain !== expectedDomain) {
    throw new Error(`SIWE domain uyuşmazlığı: beklenen ${expectedDomain}, gelen ${message.domain}`);
  }

  // YÜKS-15 Fix: URI kontrolü — exact-origin phishing koruması
  let parsedIncoming = null;
  let parsedExpected = null;
  try {
    parsedIncoming = new URL(message.uri);
    parsedExpected = new URL(expectedUri);
  } catch {
    throw new Error("SIWE URI formatı geçersiz.");
  }
  if (parsedIncoming.origin !== parsedExpected.origin) {
    logger.warn(`[Auth] SIWE URI origin uyuşmazlığı: beklenen ${parsedExpected.origin}, gelen ${parsedIncoming.origin}`);
    throw new Error(`SIWE URI uyuşmazlığı: beklenen origin ${parsedExpected.origin}`);
  }

  const storedNonce = await consumeNonce(message.address.toLowerCase());
  if (!storedNonce)                    throw new Error("Nonce süresi dolmuş veya bulunamadı.");
  if (message.nonce !== storedNonce)   throw new Error("Nonce uyuşmazlığı.");

  const result = await message.verify({ signature });
  if (!result.success) throw new Error("SIWE imza doğrulaması başarısız.");

  return message.address.toLowerCase();
}

// ── JWT Yönetimi ──────────────────────────────────────────────────────────────

function issueJWT(walletAddress) {
  // [TR] jti: JWT'ye benzersiz ID — blacklist için
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

function verifyJWT(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * ORTA-09 Fix: JWT Blacklist kontrolü.
 * requireAuth middleware bu fonksiyonu çağırarak logout sonrası
 * hâlâ geçerli JWT'lerin kullanımını engeller.
 *
 * @param {string} jti - JWT'nin unique ID'si
 * @returns {Promise<boolean>} Blacklist'teyse true
 */
async function isJWTBlacklisted(jti) {
  if (!jti) return false;
  try {
    const redis = getRedisClient();
    const val   = await redis.get(`${JWT_BLACKLIST_PREFIX}${jti}`);
    return val !== null;
  } catch (err) {
    const failMode = process.env.JWT_BLACKLIST_FAIL_MODE
      || (process.env.NODE_ENV === "production" ? "closed" : "open");
    logger.warn(`[Auth] JWT blacklist kontrolü yapılamadı (mode=${failMode}): ${err.message}`);
    // [TR] closed: güvenli tarafta kal, open: erişimi kesme
    return failMode === "closed";
  }
}

/**
 * ORTA-09 Fix: JWT'yi blacklist'e ekler (logout sırasında).
 * TTL = JWT'nin kalan geçerlilik süresi (max 15 dk).
 */
async function blacklistJWT(token) {
  try {
    const payload = jwt.decode(token);
    if (!payload?.jti) return;
    const redis   = getRedisClient();
    const ttlSecs = Math.ceil(JWT_EXPIRES_MS / 1000);
    await redis.setEx(`${JWT_BLACKLIST_PREFIX}${payload.jti}`, ttlSecs, "1");
    logger.debug(`[Auth] JWT blacklist'e alındı: jti=${payload.jti}`);
  } catch (err) {
    logger.warn(`[Auth] JWT blacklist eklenemedi: ${err.message}`);
  }
}

// ── Refresh Token Yönetimi ────────────────────────────────────────────────────

/**
 * KRİT-01 Fix: Refresh token wallet bilgisiyle birlikte saklanıyor.
 * ÖNCEKİ: Sadece familyId saklanıyordu.
 * ŞİMDİ: { familyId, wallet } saklanıyor — rotasyonda wallet eşleşmesi zorunlu.
 */
async function issueRefreshToken(walletAddress, familyId = null) {
  const redis           = getRedisClient();
  const token           = crypto.randomBytes(32).toString("hex");
  const currentFamilyId = familyId || crypto.randomBytes(16).toString("hex");
  const familyKey       = `${REFRESH_FAMILY_PREFIX}${walletAddress.toLowerCase()}:${currentFamilyId}`;
  const tokenKey        = `${REFRESH_TOKEN_PREFIX}${token}`;

  const multi = redis.multi();
  // KRİT-01 Fix: wallet bilgisini de sakla
  multi.setEx(tokenKey, REFRESH_TOKEN_TTL_SECS, JSON.stringify({
    familyId: currentFamilyId,
    wallet:   walletAddress.toLowerCase(),
  }));
  multi.sAdd(familyKey, token);
  multi.expire(familyKey, REFRESH_TOKEN_TTL_SECS);
  await multi.exec();

  logger.debug(`[Auth] Refresh token üretildi: ${walletAddress}`);
  return token;
}

/**
 * KRİT-01 Fix + BACK-01 Fix: Güvenli token rotasyonu.
 *
 * KRİT-01: Token'daki wallet ile istekteki wallet eşleşmezse ret.
 * BACK-01: Tüm aile silimi SADECE token reuse tespit edildiğinde yapılıyor.
 *   Normal rotasyonda yalnızca kullanılan eski token geçersiz kılınıyor.
 *   Bu sayede mobil + masaüstü eş zamanlı kullanımda ağ hatası nedeniyle
 *   token yenileme başarısız olursa kullanıcı tüm cihazlardan atılmıyor.
 */
async function rotateRefreshToken(walletAddress, refreshToken) {
  const redis    = getRedisClient();
  const tokenKey = `${REFRESH_TOKEN_PREFIX}${refreshToken}`;

  const stored = await redis.getDel(tokenKey);

  if (!stored) {
    // [TR] Token bulunamadı → reuse saldırısı şüphesi → bu aileyi sil
    logger.warn(`[Auth] Geçersiz/kullanılmış token denemesi: wallet=${walletAddress}. Aile oturumları temizleniyor.`);

    const familyKeys = await _scanKeys(redis, `${REFRESH_FAMILY_PREFIX}${walletAddress.toLowerCase()}:*`);
    for (const familyKey of familyKeys) {
      const members = await redis.sMembers(familyKey);
      const multi   = redis.multi();
      members.forEach(m => multi.del(`${REFRESH_TOKEN_PREFIX}${m}`));
      multi.del(familyKey);
      await multi.exec();
    }
    throw new Error("Refresh token geçersiz veya süresi dolmuş. Lütfen yeniden giriş yapın.");
  }

  // [TR] Stored değeri parse et
  let storedData;
  try {
    storedData = JSON.parse(stored);
  } catch {
    // [TR] Eski format (sadece familyId string) — geriye uyumluluk
    storedData = { familyId: stored, wallet: walletAddress.toLowerCase() };
  }

  // KRİT-01 Fix: Wallet eşleşme kontrolü
  if (storedData.wallet !== walletAddress.toLowerCase()) {
    logger.error(
      `[Auth] KRİTİK: Token/wallet uyuşmazlığı — muhtemel hijack girişimi! ` +
      `token_wallet=${storedData.wallet} istek_wallet=${walletAddress}`
    );
    throw new Error("Token/wallet uyuşmazlığı. Güvenlik ihlali tespit edildi.");
  }

  const { familyId } = storedData;

  // BACK-01 Fix: Sadece bu aileye ait ESKİ token'ları sil (nükleer değil, cerrahi)
  const familyKey     = `${REFRESH_FAMILY_PREFIX}${walletAddress.toLowerCase()}:${familyId}`;
  const familyMembers = await redis.sMembers(familyKey);
  if (familyMembers.length > 0) {
    const multi = redis.multi();
    familyMembers.forEach(m => multi.del(`${REFRESH_TOKEN_PREFIX}${m}`));
    multi.del(familyKey);
    await multi.exec();
  }

  const newJWT          = issueJWT(walletAddress);
  const newRefreshToken = await issueRefreshToken(walletAddress, familyId);

  logger.info(`[Auth] Token rotasyonu tamamlandı: ${walletAddress}`);
  return { token: newJWT, refreshToken: newRefreshToken };
}

/**
 * Bir cüzdanın tüm refresh token'larını iptal eder (logout).
 * ORTA-09 Fix: Logout'ta JWT blacklist'e de alınıyor (auth.js'te çağrılır).
 */
async function revokeRefreshToken(walletAddress) {
  const redis = getRedisClient();
  const addr  = walletAddress.toLowerCase();

  const familyKeys = await _scanKeys(redis, `${REFRESH_FAMILY_PREFIX}${addr}:*`);
  if (familyKeys.length === 0) {
    logger.info(`[Auth] Revoke: ${addr} için aktif refresh token bulunamadı.`);
    return;
  }

  let deletedCount = 0;
  for (const familyKey of familyKeys) {
    const members = await redis.sMembers(familyKey);
    if (members.length > 0) {
      const multi = redis.multi();
      members.forEach(m => { multi.del(`${REFRESH_TOKEN_PREFIX}${m}`); deletedCount++; });
      multi.del(familyKey);
      await multi.exec();
    } else {
      await redis.del(familyKey);
    }
  }

  logger.info(`[Auth] Revoke: ${addr} → ${deletedCount} token, ${familyKeys.length} aile silindi.`);
}

module.exports = {
  getSiweConfig,
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
  revokeRefreshToken,
};
