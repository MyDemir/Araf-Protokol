"use strict";

const {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  HARDHAT_CHAIN_ID,
  assertDeployAlignment,
} = require("../../shared/deployAlignment");

describe("deploy alignment guard", () => {
  const escrow = "0x1111111111111111111111111111111111111111";

  it("passes the production Base mainnet matrix", () => {
    expect(assertDeployAlignment({
      label: "mainnet",
      frontendEnv: { VITE_ESCROW_ADDRESS: escrow },
      backendEnv: { ARAF_ESCROW_ADDRESS: escrow.toUpperCase(), EXPECTED_CHAIN_ID: String(BASE_MAINNET_CHAIN_ID) },
      frontendSupportedChainIds: [BASE_MAINNET_CHAIN_ID],
    })).toMatchObject({
      frontendEscrowAddress: escrow,
      backendEscrowAddress: escrow,
      expectedChainId: BASE_MAINNET_CHAIN_ID,
      isFrontendMainnetOnly: true,
    });
  });

  it.each([
    ["base-sepolia", BASE_SEPOLIA_CHAIN_ID],
    ["hardhat", HARDHAT_CHAIN_ID],
  ])("passes explicit %s non-production fixture", (_label, chainId) => {
    expect(assertDeployAlignment({
      label: _label,
      frontendEnv: { VITE_ESCROW_ADDRESS: escrow },
      backendEnv: { ARAF_ESCROW_ADDRESS: escrow, EXPECTED_CHAIN_ID: String(chainId) },
      frontendSupportedChainIds: [HARDHAT_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, BASE_MAINNET_CHAIN_ID],
    })).toMatchObject({ expectedChainId: chainId, isFrontendMainnetOnly: false });
  });

  it("fails when frontend/backend escrow addresses differ", () => {
    expect(() => assertDeployAlignment({
      label: "mismatch-address",
      frontendEnv: { VITE_ESCROW_ADDRESS: escrow },
      backendEnv: { ARAF_ESCROW_ADDRESS: "0x2222222222222222222222222222222222222222", EXPECTED_CHAIN_ID: String(BASE_MAINNET_CHAIN_ID) },
      frontendSupportedChainIds: [BASE_MAINNET_CHAIN_ID],
    })).toThrow(/VITE_ESCROW_ADDRESS and ARAF_ESCROW_ADDRESS must match/);
  });

  it("fails when frontend production chain policy and backend EXPECTED_CHAIN_ID drift", () => {
    expect(() => assertDeployAlignment({
      label: "mismatch-chain",
      frontendEnv: { VITE_ESCROW_ADDRESS: escrow },
      backendEnv: { ARAF_ESCROW_ADDRESS: escrow, EXPECTED_CHAIN_ID: String(BASE_SEPOLIA_CHAIN_ID) },
      frontendSupportedChainIds: [BASE_MAINNET_CHAIN_ID],
    })).toThrow(/requires EXPECTED_CHAIN_ID=8453/);
  });
});
