"use strict";
/**
 * Auth Route — SIWE + JWT
 *
 * V3 notu:
 *   - Order/child-trade mimarisi auth authority sınırını değiştirmez.
 *   - Cookie wallet authoritative olmaya devam eder.
 */
const express = require("express");
const Joi = require("joi");
const router = express.Router();
const { authLimiter } = require("../middleware/rateLimiter");
const { requireAuth, requireSessionWalletMatch } = require("../middleware/auth");
const { generateNonce, verifySiweSignature, getSiweConfig, issueJWT, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, blacklistJWT } = require("../services/siwe");
const { encryptPII } = require("../services/encryption");
const User = require("../models/User");
const logger = require("../utils/logger");
const COOKIE_OPTIONS_BASE = { httpOnly: true, sameSite: "lax", path: "/" };
const _getJwtCookieOptions = () => ({ ...COOKIE_OPTIONS_BASE, secure: process.env.NODE_ENV === "production", maxAge: 15 * 60 * 1000 });
const _getRefreshCookieOptions = () => ({ ...COOKIE_OPTIONS_BASE, secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000, path: "/api/auth" });
router.get("/nonce", authLimiter, async (req, res, next) => { try { const { wallet } = req.query; if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) return res.status(400).json({ error: "Geçerli bir Ethereum adresi gir." }); const nonce = await generateNonce(wallet.toLowerCase()); const { domain: siweDomain, uri: siweUri } = getSiweConfig(); return res.json({ nonce, siweDomain, siweUri }); } catch (err) { next(err); } });
router.post("/verify", authLimiter, async (req, res) => { try { const schema = Joi.object({ message: Joi.string().max(2000).required(), signature: Joi.string().pattern(/^0x[a-fA-F0-9]{130}$/).required() }); const { error, value } = schema.validate(req.body); if (error) return res.status(400).json({ error: error.message }); const wallet = await verifySiweSignature(value.message, value.signature); const user = await User.findOneAndUpdate({ wallet_address: wallet }, { $set: { last_login: new Date() }, $setOnInsert: { wallet_address: wallet } }, { upsert: true, new: true }); await user.checkBanExpiry(); const token = issueJWT(wallet); const refreshToken = await issueRefreshToken(wallet); res.cookie("araf_jwt", token, _getJwtCookieOptions()); res.cookie("araf_refresh", refreshToken, _getRefreshCookieOptions()); return res.json({ wallet, profile: user.toPublicProfile() }); } catch (err) { logger.warn(`[Auth] SIWE başarısız: ${err.message}`); return res.status(401).json({ error: `Kimlik doğrulama başarısız: ${err.message}` }); } });
router.post("/refresh", authLimiter, async (req, res) => { try { const refreshToken = req.cookies?.araf_refresh; if (!refreshToken) return res.status(401).json({ error: "Refresh token bulunamadı." }); let wallet = req.body?.wallet; if (!wallet) return res.status(400).json({ error: "Wallet adresi belirlenemedi." }); const result = await rotateRefreshToken(wallet.toLowerCase(), refreshToken); res.cookie("araf_jwt", result.token, _getJwtCookieOptions()); res.cookie("araf_refresh", result.refreshToken, _getRefreshCookieOptions()); return res.json({ wallet: wallet.toLowerCase() }); } catch (err) { res.clearCookie("araf_jwt", { ...COOKIE_OPTIONS_BASE, path: "/" }); res.clearCookie("araf_refresh", { ...COOKIE_OPTIONS_BASE, path: "/api/auth" }); return res.status(401).json({ error: err.message }); } });
router.post("/logout", requireAuth, async (req, res, next) => { try { const currentJWT = req.cookies?.araf_jwt; if (currentJWT) await blacklistJWT(currentJWT); await revokeRefreshToken(req.wallet); res.clearCookie("araf_jwt", { ...COOKIE_OPTIONS_BASE, path: "/" }); res.clearCookie("araf_refresh", { ...COOKIE_OPTIONS_BASE, path: "/api/auth" }); return res.json({ success: true, message: "Oturum kapatıldı." }); } catch (err) { next(err); } });
router.get("/me", requireAuth, async (req, res) => { const headerWalletRaw = req.headers["x-wallet-address"]; if (headerWalletRaw) { const headerWallet = headerWalletRaw.trim().toLowerCase(); if (/^0x[a-f0-9]{40}$/.test(headerWallet) && headerWallet !== req.wallet) { res.clearCookie("araf_jwt", { ...COOKIE_OPTIONS_BASE, path: "/" }); res.clearCookie("araf_refresh", { ...COOKIE_OPTIONS_BASE, path: "/api/auth" }); try { await revokeRefreshToken(req.wallet); } catch (_) {} return res.status(409).json({ error: "Oturum cüzdanı aktif bağlı cüzdanla eşleşmiyor.", code: "SESSION_WALLET_MISMATCH" }); } } return res.json({ wallet: req.wallet, authenticated: true }); });
router.put("/profile", requireAuth, requireSessionWalletMatch, authLimiter, async (req, res, next) => { try { const encrypted = await encryptPII(req.body || {}, req.wallet); await User.findOneAndUpdate({ wallet_address: req.wallet }, { $set: { "pii_data.bankOwner_enc": encrypted.bankOwner_enc, "pii_data.iban_enc": encrypted.iban_enc, "pii_data.telegram_enc": encrypted.telegram_enc } }); return res.json({ success: true, message: "Profil bilgilerin güncellendi." }); } catch (err) { next(err); } });
module.exports = router;
