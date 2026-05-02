"use strict";

const REDACTED = "[REDACTED]";
const WALLET_REDACTED = "[WALLET]";

const SAFE_ID_KEYS = new Set(["tradeId", "orderId", "txHash", "blockNumber", "logIndex"]);

const SENSITIVE_KEY_RX = /authorization|cookie|set-cookie|x-api-key|refresh.?token|private.?key|secret|password|master_encryption_key|aws_encrypted_data_key|aws_access_key|aws_secret_access_key|vault_token|iban|account|routing|payout|telegram|receipt|ipfsreceipt|contact|name|email|phone/i;
const JWT_RX = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g;
const ETH_PK_RX = /0x[a-fA-F0-9]{64}\b/g;
const WALLET_RX = /\b0x[a-fA-F0-9]{40}\b/g;
const URL_QUERY_RX = /(https?:\/\/[^\s?]+)\?[^\s]*/gi;

function redactString(value) {
  let v = String(value);
  v = v.replace(URL_QUERY_RX, "$1?[REDACTED_QUERY]");
  v = v.replace(JWT_RX, REDACTED);
  v = v.replace(ETH_PK_RX, REDACTED);
  v = v.replace(WALLET_RX, WALLET_REDACTED);
  return v;
}

function redactValue(value, keyHint = "") {
  if (value == null) return value;

  if (typeof value === "string") {
    if (SENSITIVE_KEY_RX.test(keyHint)) return REDACTED;
    return redactString(value);
  }

  if (typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map((item) => redactValue(item, keyHint));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SAFE_ID_KEYS.has(key)) {
      out[key] = val;
      continue;
    }
    if (SENSITIVE_KEY_RX.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactValue(val, key);
  }
  return out;
}

module.exports = {
  redactLogMeta: redactValue,
  redactLogString: redactString,
};
