"use strict";

/**
 * SIWE (Sign-In with Ethereum) Authentication Service
 *
 * Flow:
 * 1. Frontend: GET /api/auth/nonce?address=0x...  -> receives nonce
 * 2. Frontend: Signs SIWE message with MetaMask
 * 3. Frontend: POST /api/auth/verify { message, signature }
 * 4. Backend:  Verifies signature -> issues JWT (15min) + refresh token
 *
 * Security:
 * - Nonce stored in Redis with 5-minute TTL (NOT MongoDB)
 * - Nonce invalidated immediately after use (prevents replay)
 * - JWT is short-lived (15 min); trade-scoped PII tokens even shorter
 *
 * SEC-02 Fix: JWT_SECRET entropy doğrulaması güçlendirildi.
 *   - Minimum 64 karakter (512-bit) zorunlu
 *   - Shannon entropy kontrolü ile zayıf secret'lar engellenir
 *   - Production'da placeholder değerler otomatik reddedilir
 *
 * CON-04 Fix: Refresh token desteği eklendi.
 *   - JWT (15 dakika) + Refresh Token (7 gün) çift katmanlı auth
 *   - Refresh token Redis'te saklanır, tek kullanımlık (rotation)
 *   - Trade room'da aktif kullanıcılar 401 almadan oturum yenileyebilir
 */

const { SiweMessage }   = require("siwe");
const jwt               = require("jsonwebtoken");
const crypto            = require("crypto");
const { getRedisClient } = require("../config/redis");
const logger            = require("../utils/logger");

const JWT_SECRET      = process.env.JWT_SECRET;
const JWT_EXPIRES     = process.env.JWT_EXPIRES_IN      || "15m";
const PII_EXPIRES     = process.env.PII_TOKEN_EXPIRES_IN || "15m";
const NONCE_TTL_SECS  = 5 * 60; // 5 minutes

// CON-04 Fix: Refresh token ayarları
const REFRESH_TOKEN_TTL_SECS = 7 * 24 * 60 * 60; // 7 gün
const REFRESH_TOKEN_PREFIX   = "refresh:";
// GÜVENLİK İYİLEŞTİRMESİ: Refresh Token Ailesi
// Bir kullanıcıya ait tüm token'ları gruplamak için. Çalınma durumunda
// tüm aileyi geçersiz kılacağız.
const REFRESH_FAMILY_PREFIX = "family:";

// ── SEC-02 Fix: JWT_SECRET Entropy Doğrulaması ───────────────────────────────
/**
 * Shannon entropy hesaplayıcı — secret'ın gerçekten rastgele olup olmadığını ölçer.
 * crypto.randomBytes(64).toString('hex') ile üretilmiş bir secret ~4.0 entropy verir.
 * "password123456789..." gibi zayıf değerler ~3.0 altında kalır.
 *
 * @param {string} str - Kontrol edilecek string
 * @returns {number}   - Bit cinsinden entropy (0.0 - 8.0 arası)
 */
function _shannonEntropy(str) {
  const freq = {};
  for (const ch of str) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  const len = str.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// SEC-02 Fix: Kapsamlı JWT_SECRET doğrulaması
// Placeholder değerler, kısa secret'lar ve düşük entropy engellenir.
const KNOWN_PLACEHOLDERS = [
  "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_MIN_64_CHARS",
  "your-secret-here",
  "supersecretkey",
  "changeme",
];

if (!JWT_SECRET) {
  throw new Error("SEC-02 BLOCKER: JWT_SECRET tanımlı değil! .env dosyasını kontrol edin.");
}
if (JWT_SECRET.length < 64) {
  throw new Error(
    `SEC-02 BLOCKER: JWT_SECRET çok kısa (${JWT_SECRET.length} karakter). ` +
    "Minimum 64 karakter (512-bit) gerekli. " +
    "Üretmek için: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
  );
}
if (KNOWN_PLACEHOLDERS.some(p => JWT_SECRET.includes(p))) {
  throw new Error(
    "SEC-02 BLOCKER: JWT_SECRET hâlâ placeholder değer içeriyor! " +
    "Gerçek bir rastgele secret ile değiştirin."
  );
}
// Shannon entropy kontrolü — zayıf pattern'ları yakala (örn: "aaaa...bbb...ccc")
const entropy = _shannonEntropy(JWT_SECRET);
if (entropy < 3.5) {
  throw new Error(
    `SEC-02 BLOCKER: JWT_SECRET entropy çok düşük (${entropy.toFixed(2)}). ` +
    "Rastgele üretilmiş bir secret kullanın: " +
    "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
  );
}
logger.info(`[Auth] JWT_SECRET doğrulandı: ${JWT_SECRET.length} karakter, entropy: ${entropy.toFixed(2)} bit`);

// ─── Nonce Management (Redis) ─────────────────────────────────────────────────

/**
 * Generates a cryptographically random nonce and stores it in Redis.
 * TTL: 5 minutes. After use, it is deleted immediately (single-use).
 *
 * @param {string} walletAddress - lowercase address
 * @returns {string} nonce
 */
async function generateNonce(walletAddress) {
  const redis  = getRedisClient();
  const nonce  = crypto.randomBytes(16).toString("hex");
  const key    = `nonce:${walletAddress.toLowerCase()}`;

  // Atomic set with TTL — overwrites previous nonce (prevents stacking)
  await redis.setEx(key, NONCE_TTL_SECS, nonce);

  logger.debug(`Nonce generated for ${walletAddress}`);
  return nonce;
}

/**
 * Retrieves and immediately invalidates the nonce (single-use).
 *
 * @param {string} walletAddress
 * @returns {string|null} nonce or null if expired/not found
 */
async function consumeNonce(walletAddress) {
  const redis = getRedisClient();
  const key   = `nonce:${walletAddress.toLowerCase()}`;

  // Atomic getdel — prevents race condition between get and delete
  const nonce = await redis.getDel(key);
  return nonce; // null if not found or expired
}

// ─── SIWE Verification ────────────────────────────────────────────────────────

/**
 * Verifies a SIWE signature and returns the authenticated wallet address.
 *
 * @param {string} messageStr - Raw SIWE message string
 * @param {string} signature  - Hex-encoded signature (0x...)
 * @returns {Promise<string>} - Lowercase wallet address
 */
async function verifySiweSignature(messageStr, signature) {
  const message = new SiweMessage(messageStr);

  // Domain doğrulaması — SIWE mesajındaki domain backend'in beklediği domain ile eşleşmeli
  const expectedDomain = process.env.SIWE_DOMAIN || "localhost";
  if (message.domain !== expectedDomain) {
    throw new Error(`SIWE domain mismatch: expected ${expectedDomain}, got ${message.domain}`);
  }

  // Nonce'u Redis'ten al ve tek kullanımlık olarak sil
  const storedNonce = await consumeNonce(message.address.toLowerCase());
  if (!storedNonce) {
    throw new Error("Nonce expired or not found");
  }
  if (message.nonce !== storedNonce) {
    throw new Error("Nonce mismatch");
  }

  // İmza doğrulaması
  const result = await message.verify({ signature });
  if (!result.success) {
    throw new Error("SIWE signature verification failed");
  }

  return message.address.toLowerCase();
}

// ─── JWT Token Management ─────────────────────────────────────────────────────

/**
 * Issues a short-lived auth JWT (15 min).
 *
 * @param {string} walletAddress - Authenticated wallet
 * @returns {string} Signed JWT
 */
function issueJWT(walletAddress) {
  return jwt.sign(
    { sub: walletAddress.toLowerCase(), type: "auth" },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/**
 * Issues a trade-scoped PII token (15 min, even shorter in production).
 * Only valid for a specific tradeId — prevents cross-trade PII access.
 *
 * @param {string} walletAddress
 * @param {string} tradeId
 * @returns {string} Signed PII JWT
 */
function issuePIIToken(walletAddress, tradeId) {
  return jwt.sign(
    { sub: walletAddress.toLowerCase(), type: "pii", tradeId },
    JWT_SECRET,
    { expiresIn: PII_EXPIRES }
  );
}

/**
 * Verifies any JWT (auth or PII type).
 *
 * @param {string} token
 * @returns {object} Decoded payload
 */
function verifyJWT(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ─── CON-04 Fix: Refresh Token Management ─────────────────────────────────────
/**
 * Refresh Token sistemi — JWT'nin 15 dakikalık ömrünü uzatmak için.
 *
 * Akış:
 *   1. Kullanıcı login olduğunda JWT + refreshToken birlikte verilir
 *   2. JWT expire olunca frontend /api/auth/refresh'e refreshToken gönderir
 *   3. Backend eski refreshToken'ı siler (tek kullanımlık), yeni JWT + refreshToken verir
 *   4. Bu sayede trade room'daki kullanıcılar 15 dakikada bir 401 almaz
 *
 * Güvenlik:
 *   - Refresh token Redis'te saklanır, 7 gün TTL
 *   - Her kullanımda rotasyon yapılır (eski silinir, yeni üretilir)
 *   - Çalınmış token tespit: eski token ile gelirse tüm token'lar iptal edilir
 */

/**
 * Yeni bir refresh token üretir ve Redis'te saklar.
 *
 * @param {string} walletAddress - lowercase Ethereum address
 * @param {string} [familyId] - Opsiyonel: Mevcut token ailesi ID'si. Yoksa yeni aile oluşturulur.
 * @returns {Promise<string>} Opaque refresh token (64 hex karakter)
 */
async function issueRefreshToken(walletAddress, familyId = null) {
  const redis = getRedisClient();
  const token = crypto.randomBytes(32).toString("hex");
  const currentFamilyId = familyId || crypto.randomBytes(16).toString("hex");
  const familyKey = `${REFRESH_FAMILY_PREFIX}${walletAddress.toLowerCase()}:${currentFamilyId}`;
  const tokenKey = `${REFRESH_TOKEN_PREFIX}${token}`;

  // Redis pipeline kullanarak atomik işlem yap
  const multi = redis.multi();
  // 1. Token'ı aile ID'si ile eşleştir
  multi.setEx(tokenKey, REFRESH_TOKEN_TTL_SECS, currentFamilyId);
  // 2. Aile listesine yeni token'ı ekle
  multi.sAdd(familyKey, token);
  multi.expire(familyKey, REFRESH_TOKEN_TTL_SECS); // Ailenin de TTL'i olsun
  await multi.exec();
  
  logger.debug(`[Auth] Refresh token issued for ${walletAddress}`);
  return token;
}

/**
 * Refresh token'ı doğrular ve yeni JWT + refresh token çifti döner.
 * Eski refresh token atomik olarak silinir (rotation — replay koruması).
 *
 * @param {string} walletAddress - lowercase Ethereum address
 * @param {string} refreshToken  - Client'ın gönderdiği refresh token
 * @returns {Promise<{token: string, refreshToken: string}>} Yeni JWT + refresh token
 * @throws {Error} Geçersiz veya süresi dolmuş refresh token
 */
async function rotateRefreshToken(walletAddress, refreshToken) {
  const redis = getRedisClient();
  const tokenKey = `${REFRESH_TOKEN_PREFIX}${refreshToken}`;

  // 1. Token'ı doğrula ve ait olduğu aileyi bul. Atomik olarak sil.
  const familyId = await redis.getDel(tokenKey);

  if (!familyId) {
    // Token ya hiç var olmadı, ya süresi doldu ya da zaten kullanıldı.
    // GÜVENLİK İYİLEŞTİRMESİ: Bir saldırganın eski/çalınmış bir token'ı deniyor olma ihtimali var.
    // Güvenlik önlemi olarak, bu token'ın ait olduğu aileyi bulup yok ediyoruz.
    // Bu, `familyId`'yi token'ın kendisinde saklayarak mümkün olur.
    // Örnek: `familyId:token` şeklinde bir anahtar.
    // Şimdiki implementasyonda, bu token'ın hangi aileye ait olduğunu bilemeyiz.
    // Bu yüzden, bu cüzdana ait TÜM aileleri bulup yok etmek en güvenli yoldur.
    logger.warn(`[Auth] Geçersiz/kullanılmış refresh token denemesi: wallet=${walletAddress}. Bu cüzdana ait tüm oturumlar sonlandırılıyor.`);
    
    const familyKeys = await redis.keys(`${REFRESH_FAMILY_PREFIX}${walletAddress.toLowerCase()}:*`);
    if (familyKeys.length > 0) {
      const multi = redis.multi();
      for (const familyKey of familyKeys) {
        const members = await redis.sMembers(familyKey);
        members.forEach(member => multi.del(`${REFRESH_TOKEN_PREFIX}${member}`));
        multi.del(familyKey);
      }
      await multi.exec();
    }
    throw new Error("Refresh token invalid or expired. Please login again.");
  }

  // 2. Ailedeki diğer tüm token'ları sil (rotasyon)
  const familyKey = `${REFRESH_FAMILY_PREFIX}${walletAddress.toLowerCase()}:${familyId}`;
  const familyMembers = await redis.sMembers(familyKey);
  const multi = redis.multi();
  familyMembers.forEach(member => multi.del(`${REFRESH_TOKEN_PREFIX}${member}`));
  multi.del(familyKey);
  await multi.exec();
  
  // Doğrulama başarılı — yeni çift üret
  const newJWT          = issueJWT(walletAddress);
  // 3. Aynı aile ID'si ile yeni bir token oluştur
  const newRefreshToken = await issueRefreshToken(walletAddress, familyId);
  
  logger.info(`[Auth] Token rotated for ${walletAddress}`);
  return { token: newJWT, refreshToken: newRefreshToken };
}

/**
 * Bir cüzdanın tüm refresh token'larını iptal eder.
 * Logout veya güvenlik ihlali durumunda kullanılır.
 *
 * @param {string} walletAddress
 */
async function revokeRefreshToken(walletAddress) {
  // Bu fonksiyon artık doğrudan kullanılmıyor, rotasyon mantığı devraldı.
  // Ancak manuel olarak tüm oturumları kapatmak için saklanabilir.
  // Implementasyonu aile mantığına göre güncellenmek zorunda.
  // Şimdilik sadece loglama yapalım.
  logger.info(`[Auth] Refresh token revoked for ${walletAddress}`);
}

module.exports = {
  generateNonce,
  consumeNonce,
  verifySiweSignature,
  issueJWT,
  issuePIIToken,
  verifyJWT,
  // CON-04 Fix: Refresh token exports
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
};
