"use strict";
/* ## auth middleware hardening

This PR updates `backend/scripts/middleware/auth.js` to preserve the existing cookie-only auth and JWT blacklist protections while making wallet mismatch handling actively invalidate the backend session.

### Existing protections that remain

The following behavior is preserved:

- auth JWT is still accepted only from the httpOnly cookie
- bearer fallback for normal auth remains disabled
- JWT blacklist checks still run during authenticated requests
- `requirePIIToken` still uses Bearer authorization separately for short-lived trade-scoped PII access

### Previous behavior

`requireSessionWalletMatch` already compared the authenticated wallet from the cookie with the connected wallet sent in `x-wallet-address`.

If they did not match, the middleware returned:

- `409 SESSION_WALLET_MISMATCH`

But it did not actively invalidate backend session state.

That meant the request was blocked, but the backend-side session boundary remained softer than intended.

### New behavior

On wallet mismatch, the middleware now treats the event as a session invalidation event.

New behavior:

- log the mismatch
- revoke the refresh token family for the authenticated wallet
- clear `araf_jwt`
- clear `araf_refresh`
- return `409 SESSION_WALLET_MISMATCH`

### Effect

This closes the gap between frontend logout behavior and backend session invalidation.

Instead of only rejecting the mismatched request, the backend now actively terminates the invalid session state as well.

### Scope

Only `backend/scripts/middleware/auth.js` was targeted here.

### V3 note

Bu middleware, V3'e geçişte authority üretmez.
Auth katmanı yalnızca:
- cookie session doğrulaması,
- aktif bağlı cüzdan eşleşmesi,
- trade-scoped kısa ömürlü PII token doğrulaması
sağlar.

Parent order / child trade authority kontratta kalır; middleware bunları yeniden yorumlamaz.
*/

const { verifyJWT, isJWTBlacklisted, revokeRefreshToken, blacklistJWT } = require("../services/siwe");
const logger = require("../utils/logger");

const COOKIE_OPTIONS_BASE = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
};

/**
 * Yalnızca httpOnly auth cookie'den JWT okur.
 */
async function _getTokenPayload(req) {
  const token = req.cookies?.araf_jwt;

  if (!token) {
    const err = new Error("Oturum bulunamadı. Lütfen giriş yapın.");
    err.statusCode = 401;
    throw err;
  }

  const payload = verifyJWT(token);

  if (payload.jti) {
    const blacklisted = await isJWTBlacklisted(payload.jti);
    if (blacklisted) {
      const err = new Error("Oturum geçersiz kılınmış. Lütfen yeniden giriş yapın.");
      err.statusCode = 401;
      throw err;
    }
  }

  return payload;
}

/**
 * PII token'ı Authorization header'dan okur.
 *
 * V3 notu:
 * Bu token parent order için değil, belirli bir child trade belgesi için geçerlidir.
 * Böylece PII erişimi yalnız aktif trade bağlamında kısa ömürlü ve dar kapsamlı kalır.
 */
function _getPIITokenPayload(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    const err = new Error("PII Authorization header eksik.");
    err.statusCode = 401;
    throw err;
  }
  return verifyJWT(authHeader.slice(7));
}

/**
 * Auth korumalı route'lar için JWT doğrulaması.
 * Sadece httpOnly cookie kabul edilir.
 */
async function requireAuth(req, res, next) {
  try {
    const payload = await _getTokenPayload(req);

    if (payload.type !== "auth") {
      return res.status(403).json({ error: "Geçersiz token tipi. 'auth' bekleniyordu." });
    }

    req.wallet = payload.sub.toLowerCase();
    next();
  } catch (err) {
    logger.warn(`[Auth] Token doğrulaması başarısız: ${err.message}`);
    return res
      .status(err.statusCode || 401)
      .json({ error: err.message || "Geçersiz veya süresi dolmuş token." });
  }
}

/**
 * Cookie ile doğrulanan session wallet ile istemcinin aktif bağlı cüzdanını eşleştirir.
 * Header hiçbir zaman tek başına auth kaynağı değildir.
 *
 * V3 notu:
 * Backend'in "order açılabilir mi / fill yapılabilir mi" gibi ekonomik kararlara
 * hükmetmediğini özellikle koruyoruz. Bu middleware yalnız session authority sınırını
 * uygular; order / trade kuralları yine kontrat tarafından belirlenir.
 */
async function requireSessionWalletMatch(req, res, next) {
  const headerWalletRaw = req.headers["x-wallet-address"];

  if (!headerWalletRaw || typeof headerWalletRaw !== "string") {
    return res.status(401).json({
      error: "Aktif cüzdan bilgisi eksik. Güvenlik için yeniden giriş yapın.",
      code: "SESSION_WALLET_HEADER_MISSING",
    });
  }

  const headerWallet = headerWalletRaw.trim().toLowerCase();

  if (!/^0x[a-f0-9]{40}$/.test(headerWallet)) {
    return res.status(400).json({
      error: "Geçersiz cüzdan başlığı formatı.",
      code: "SESSION_WALLET_HEADER_INVALID",
    });
  }

  if (!req.wallet || req.wallet !== headerWallet) {
    logger.warn(
      `[Auth] Session-wallet mismatch: cookie=${req.wallet || "none"} header=${headerWallet}`
    );

    try {
      if (req.wallet) {
        const currentJWT = req.cookies?.araf_jwt;
        if (currentJWT) {
          await blacklistJWT(currentJWT);
        }
        await revokeRefreshToken(req.wallet);
      }
    } catch (revokeErr) {
      logger.warn(`[Auth] Mismatch revoke başarısız: ${revokeErr.message}`);
    }

    res.clearCookie("araf_jwt", { ...COOKIE_OPTIONS_BASE, path: "/" });
    res.clearCookie("araf_refresh", { ...COOKIE_OPTIONS_BASE, path: "/api/auth" });

    return res.status(409).json({
      error: "Oturum cüzdanı aktif bağlı cüzdanla eşleşmiyor. Lütfen yeniden giriş yapın.",
      code: "SESSION_WALLET_MISMATCH",
    });
  }

  next();
}

/**
 * IBAN / PII erişimi için trade-scoped token kontrolü.
 *
 * Bu middleware parent order seviyesinde değil, child trade seviyesinde çalışır.
 * V3'te de PII erişimi order niyetine göre değil, gerçek aktif trade bağlamına göre
 * verilmelidir. Böylece kullanıcıya ait ödeme bilgileri yalnız gerekli dar kapsamda açılır.
 */
function requirePIIToken(req, res, next) {
  try {
    if (!/^[a-fA-F0-9]{24}$/.test(req.params.tradeId || "")) {
      return res.status(400).json({ error: "Geçersiz tradeId formatı." });
    }

    const payload = _getPIITokenPayload(req);

    if (payload.type !== "pii") {
      return res.status(403).json({ error: "Geçersiz token tipi. 'pii' bekleniyordu." });
    }

    if (payload.tradeId !== req.params.tradeId) {
      logger.warn(
        `[GÜVENLİK] PII token manipülasyonu: caller=${payload.sub} ` +
        `token_trade=${payload.tradeId} requested_trade=${req.params.tradeId}`
      );
      return res.status(403).json({ error: "Token bu işlem için geçerli değil." });
    }

    const tokenWallet = payload.sub.toLowerCase();

    // [TR] PII bearer token tek başına session authority üretmez.
    //      Cookie session ile doğrulanan wallet ile birebir eşleşmelidir.
    // [EN] PII bearer token is not session authority by itself.
    //      It must match the cookie-authenticated wallet.
    if (!req.wallet || req.wallet.toLowerCase() !== tokenWallet) {
      logger.warn(
        `[PIIAuth] Session/token wallet mismatch: session=${req.wallet || "none"} token=${tokenWallet}`
      );
      return res.status(403).json({ error: "PII token oturum cüzdanıyla eşleşmiyor." });
    }

    req.piiWallet = tokenWallet;
    next();
  } catch (err) {
    logger.warn(`[PIIAuth] Token doğrulaması başarısız: ${err.message}`);
    return res
      .status(err.statusCode || 401)
      .json({ error: err.message || "Geçersiz PII token." });
  }
}

module.exports = { requireAuth, requirePIIToken, requireSessionWalletMatch };
