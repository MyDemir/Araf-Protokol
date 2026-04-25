"use strict";

const logger = require("../utils/logger");

const CHAIN_BYPASS_ENV = "ALLOW_UNSAFE_CHAIN_ID_BYPASS";
const EXPECTED_CHAIN_ENV = "EXPECTED_CHAIN_ID";
const RPC_ENV = "BASE_RPC_URL";

function _parseChainIdOrThrow(rawValue, envName) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return null;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[ChainGuard] ${envName} geçersiz. Pozitif tam sayı beklenir. Gelen="${rawValue}"`);
  }
  return parsed;
}

function resolveExpectedChainIdOrThrow({ isProduction, rpcUrl, surface }) {
  const expected = _parseChainIdOrThrow(process.env[EXPECTED_CHAIN_ENV], EXPECTED_CHAIN_ENV);
  const bypass = String(process.env[CHAIN_BYPASS_ENV] || "").toLowerCase() === "true";

  if (expected !== null) return expected;

  if (isProduction) {
    throw new Error(`[ChainGuard][${surface}] ${EXPECTED_CHAIN_ENV} production ortamında zorunludur.`);
  }

  if (rpcUrl) {
    if (bypass) {
      logger.warn(`[ChainGuard][${surface}] ${EXPECTED_CHAIN_ENV} boş ama ${CHAIN_BYPASS_ENV}=true nedeniyle doğrulama bypass edildi.`);
      return null;
    }
    throw new Error(
      `[ChainGuard][${surface}] ${RPC_ENV} tanımlıysa ${EXPECTED_CHAIN_ENV} de zorunludur. ` +
      `Geliştirme amaçlı bypass için ${CHAIN_BYPASS_ENV}=true kullanın.`
    );
  }

  return null;
}

async function assertProviderExpectedChainOrThrow(provider, { rpcUrl, rpcEnvName = RPC_ENV, surface }) {
  const isProduction = process.env.NODE_ENV === "production";
  const expectedChainId = resolveExpectedChainIdOrThrow({ isProduction, rpcUrl, surface });
  if (expectedChainId === null) return { expectedChainId: null, actualChainId: null };

  const network = await provider.getNetwork();
  const actualChainId = Number(network?.chainId);
  if (!Number.isInteger(actualChainId) || actualChainId <= 0) {
    throw new Error(
      `[ChainGuard][${surface}] Provider chain ID okunamadı. expected=${expectedChainId} rpcEnv=${rpcEnvName}`
    );
  }

  if (actualChainId !== expectedChainId) {
    throw new Error(
      `[ChainGuard][${surface}] Chain ID uyuşmazlığı. expected=${expectedChainId} actual=${actualChainId} rpcEnv=${rpcEnvName}`
    );
  }

  return { expectedChainId, actualChainId };
}

module.exports = {
  CHAIN_BYPASS_ENV,
  EXPECTED_CHAIN_ENV,
  RPC_ENV,
  resolveExpectedChainIdOrThrow,
  assertProviderExpectedChainOrThrow,
};

