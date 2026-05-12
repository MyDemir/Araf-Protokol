"use strict";

const BASE_MAINNET_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;
const HARDHAT_CHAIN_ID = 31337;
const DEV_ALLOWED_CHAIN_IDS = new Set([BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, HARDHAT_CHAIN_ID]);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizeAddressOrThrow(value, envName) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized) || normalized === ZERO_ADDRESS) {
    throw new Error(`[DeployAlignment] ${envName} must be a non-zero EVM address.`);
  }
  return normalized;
}

function parsePositiveChainIdOrThrow(value, envName) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`[DeployAlignment] ${envName} must be a positive integer chain id.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`[DeployAlignment] ${envName} must be a safe positive integer chain id.`);
  }
  return parsed;
}

function assertDeployAlignment({
  frontendEnv = {},
  backendEnv = {},
  frontendSupportedChainIds = [],
  label = "deploy",
} = {}) {
  const frontendEscrowAddress = normalizeAddressOrThrow(frontendEnv.VITE_ESCROW_ADDRESS, "VITE_ESCROW_ADDRESS");
  const backendEscrowAddress = normalizeAddressOrThrow(backendEnv.ARAF_ESCROW_ADDRESS, "ARAF_ESCROW_ADDRESS");

  if (frontendEscrowAddress !== backendEscrowAddress) {
    throw new Error(`[DeployAlignment][${label}] VITE_ESCROW_ADDRESS and ARAF_ESCROW_ADDRESS must match.`);
  }

  const expectedChainId = parsePositiveChainIdOrThrow(backendEnv.EXPECTED_CHAIN_ID, "EXPECTED_CHAIN_ID");
  const supported = frontendSupportedChainIds.map((id) => parsePositiveChainIdOrThrow(id, "frontendSupportedChainIds[]"));
  const isFrontendMainnetOnly = supported.length === 1 && supported[0] === BASE_MAINNET_CHAIN_ID;

  if (isFrontendMainnetOnly && expectedChainId !== BASE_MAINNET_CHAIN_ID) {
    throw new Error(`[DeployAlignment][${label}] frontend production chain policy requires EXPECTED_CHAIN_ID=${BASE_MAINNET_CHAIN_ID}.`);
  }

  if (!isFrontendMainnetOnly && !DEV_ALLOWED_CHAIN_IDS.has(expectedChainId)) {
    throw new Error(`[DeployAlignment][${label}] EXPECTED_CHAIN_ID must be one of ${[...DEV_ALLOWED_CHAIN_IDS].join(",")} for non-production fixtures.`);
  }

  return {
    frontendEscrowAddress,
    backendEscrowAddress,
    expectedChainId,
    frontendSupportedChainIds: supported,
    isFrontendMainnetOnly,
  };
}

module.exports = {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  HARDHAT_CHAIN_ID,
  assertDeployAlignment,
  normalizeAddressOrThrow,
  parsePositiveChainIdOrThrow,
};
