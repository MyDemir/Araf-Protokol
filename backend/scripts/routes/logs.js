"use strict";
const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");
const { clientLogLimiter } = require("../middleware/rateLimiter");

function scrubClientErrorText(value) {
  if (!value || typeof value !== "string") return value;
  return value
    .replace(/TR\d{24}/gi, "[REDACTED]")
    .replace(/\b[A-Z]{2}[A-Z0-9]{13,32}\b/g, "[REDACTED]")
    .replace(/\b\d{9}\b/g, "[REDACTED]")
    .replace(/\b\d{4,17}\b/g, "[REDACTED]")
    .replace(/0x[a-fA-F0-9]{40}/g, "[REDACTED]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED]")
    .replace(/(bearer\s+)[a-zA-Z0-9\-\._~\+\/]+=*/gi, "$1[REDACTED]")
    .replace(/\b(eyJ[^\s]+)\b/g, "[REDACTED]");
}

router.post("/client-error", clientLogLimiter, (req, res) => {
  const { message, stack, componentStack, url } = req.body || {};
  if (!message || typeof message !== "string") return res.status(400).json({ error: "message alanı zorunludur." });
  logger.error("[FRONTEND-CRASH]", {
    message: scrubClientErrorText(String(message).slice(0, 500)),
    url: url ? String(url).slice(0, 200) : undefined,
    stack: stack ? scrubClientErrorText(String(stack).slice(0, 2000)) : undefined,
    componentStack: componentStack ? scrubClientErrorText(String(componentStack).slice(0, 1000)) : undefined,
    userAgent: req.headers["user-agent"]?.slice(0, 200),
    ip: req.ip,
  });
  res.status(204).end();
});
module.exports = router;
module.exports.scrubClientErrorText = scrubClientErrorText;
