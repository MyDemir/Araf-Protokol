// ─── middleware/errorHandler.js ───────────────────────────────────────────────
"use strict";

const logger = require("../utils/logger");

function globalErrorHandler(err, req, res, next) {
  // Mongoose validation errors
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ error: "Validation failed", details: messages });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    return res.status(409).json({ error: "Duplicate entry" });
  }

  // JWT errors handled in middleware
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Generic server error — never leak internals
  logger.error(`[Error] ${err.message}`, { stack: err.stack, path: req.path });
  return res.status(500).json({ error: "Internal server error" });
}

module.exports = { globalErrorHandler };
