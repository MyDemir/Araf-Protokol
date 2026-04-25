"use strict";

const ALLOWED_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "RESTRICTED"]);
const PROFILE_SUPPORTED_RAILS = new Set(["TR_IBAN", "US_ACH", "SEPA_IBAN"]);
const SEPA_COUNTRY_ALLOWLIST = new Set(["DE", "FR", "NL", "BE", "ES", "IT", "AT", "PT", "IE", "LU", "FI", "GR"]);

const PAYMENT_RAIL_RISK_CONFIG = {
  TR: {
    TR_IBAN: {
      riskLevel: "MEDIUM",
      minBondSurchargeBps: 0,
      feeSurchargeBps: 0,
      warningKey: "BANK_TRANSFER_CONFIRMATION_REQUIRED",
      enabled: true,
      description: {
        TR: "Banka transferi onayı kullanıcı sorumluluğundadır. Araf bu yöntemi doğrulamaz.",
        EN: "Bank transfer confirmation is the user's responsibility. Araf does not verify this method.",
      },
    },
  },
  US: {
    US_ACH: {
      riskLevel: "HIGH",
      minBondSurchargeBps: 50,
      feeSurchargeBps: 0,
      warningKey: "ACH_REVERSAL_AND_SETTLEMENT_DELAY_RISK",
      enabled: true,
      description: {
        TR: "ACH işlemleri gecikme veya geri dönüş karmaşıklığı taşıyabilir.",
        EN: "ACH transfers may involve delay or reversal complexity.",
      },
    },
  },
  EU: {
    SEPA_IBAN: {
      riskLevel: "MEDIUM",
      minBondSurchargeBps: 0,
      feeSurchargeBps: 0,
      warningKey: "SEPA_CONFIRMATION_REQUIRED",
      enabled: true,
      description: {
        TR: "SEPA transferlerinde ödeme detaylarını dikkatle kontrol et.",
        EN: "Carefully check payment details for SEPA transfers.",
      },
    },
  },
};

function _isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function validatePaymentRailRiskConfig(config) {
  if (!_isPlainObject(config)) {
    const err = new Error("paymentRiskConfig must be an object.");
    err.code = "PAYMENT_RISK_CONFIG_INVALID";
    throw err;
  }

  for (const [countryBucket, railConfig] of Object.entries(config)) {
    if (!_isPlainObject(railConfig)) {
      const err = new Error(`paymentRiskConfig.${countryBucket} must be an object.`);
      err.code = "PAYMENT_RISK_CONFIG_INVALID";
      throw err;
    }

    for (const [rail, entry] of Object.entries(railConfig)) {
      if (!PROFILE_SUPPORTED_RAILS.has(rail)) {
        const err = new Error(`paymentRiskConfig.${countryBucket}.${rail} rail is unsupported.`);
        err.code = "PAYMENT_RISK_CONFIG_INVALID";
        throw err;
      }
      if (!_isPlainObject(entry)) {
        const err = new Error(`paymentRiskConfig.${countryBucket}.${rail} must be an object.`);
        err.code = "PAYMENT_RISK_CONFIG_INVALID";
        throw err;
      }
      if (!ALLOWED_RISK_LEVELS.has(entry.riskLevel)) {
        const err = new Error(`paymentRiskConfig.${countryBucket}.${rail}.riskLevel invalid.`);
        err.code = "PAYMENT_RISK_CONFIG_INVALID";
        throw err;
      }
      if (!Number.isInteger(entry.minBondSurchargeBps) || entry.minBondSurchargeBps < 0 || entry.minBondSurchargeBps > 10000) {
        const err = new Error(`paymentRiskConfig.${countryBucket}.${rail}.minBondSurchargeBps invalid.`);
        err.code = "PAYMENT_RISK_CONFIG_INVALID";
        throw err;
      }
      if (!Number.isInteger(entry.feeSurchargeBps) || entry.feeSurchargeBps < 0 || entry.feeSurchargeBps > 10000) {
        const err = new Error(`paymentRiskConfig.${countryBucket}.${rail}.feeSurchargeBps invalid.`);
        err.code = "PAYMENT_RISK_CONFIG_INVALID";
        throw err;
      }
      if (typeof entry.warningKey !== "string" || !entry.warningKey.trim()) {
        const err = new Error(`paymentRiskConfig.${countryBucket}.${rail}.warningKey invalid.`);
        err.code = "PAYMENT_RISK_CONFIG_INVALID";
        throw err;
      }
      if (typeof entry.enabled !== "boolean") {
        const err = new Error(`paymentRiskConfig.${countryBucket}.${rail}.enabled must be boolean.`);
        err.code = "PAYMENT_RISK_CONFIG_INVALID";
        throw err;
      }
      if (!_isPlainObject(entry.description) || typeof entry.description.TR !== "string" || typeof entry.description.EN !== "string") {
        const err = new Error(`paymentRiskConfig.${countryBucket}.${rail}.description invalid.`);
        err.code = "PAYMENT_RISK_CONFIG_INVALID";
        throw err;
      }
    }
  }

  return config;
}

function getPaymentRailRiskConfig() {
  return validatePaymentRailRiskConfig(PAYMENT_RAIL_RISK_CONFIG);
}

function resolvePaymentRailRiskEntry(country, rail, config = PAYMENT_RAIL_RISK_CONFIG) {
  const safeCountry = String(country || "").toUpperCase();
  const safeRail = String(rail || "").toUpperCase();
  const safeConfig = validatePaymentRailRiskConfig(config);
  const direct = safeConfig[safeCountry]?.[safeRail];
  if (direct) return direct;

  if (safeRail === "SEPA_IBAN" && SEPA_COUNTRY_ALLOWLIST.has(safeCountry)) {
    return safeConfig.EU?.SEPA_IBAN || null;
  }
  return null;
}

module.exports = {
  PAYMENT_RAIL_RISK_CONFIG,
  ALLOWED_RISK_LEVELS,
  PROFILE_SUPPORTED_RAILS,
  SEPA_COUNTRY_ALLOWLIST,
  validatePaymentRailRiskConfig,
  getPaymentRailRiskConfig,
  resolvePaymentRailRiskEntry,
};
