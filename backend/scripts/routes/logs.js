"use strict";
const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");
const rateLimit = require("express-rate-limit");
const logRateLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, keyGenerator: (req) => req.ip, standardHeaders: true, legacyHeaders: false });
router.post("/client-error", logRateLimiter, (req, res) => {
  const { message, stack, componentStack, url } = req.body || {};
  if (!message || typeof message !== "string") return res.status(400).json({ error: "message alanı zorunludur." });
  logger.error("[FRONTEND-CRASH]", { message: String(message).slice(0, 500), url: url ? String(url).slice(0, 200) : undefined, stack: stack ? String(stack).slice(0, 2000) : undefined, componentStack: componentStack ? String(componentStack).slice(0, 1000) : undefined, userAgent: req.headers["user-agent"]?.slice(0, 200), ip: req.ip });
  res.status(204).end();
});
module.exports = router;
