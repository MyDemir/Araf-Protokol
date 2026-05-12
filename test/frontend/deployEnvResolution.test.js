import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getSupportedChainIds, BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, HARDHAT_CHAIN_ID } from '../../frontend/src/app/chainPolicy';
import { resolveApiBaseUrl } from '../../frontend/src/app/apiConfig';

const require = createRequire(import.meta.url);
const { assertDeployAlignment } = require('../../shared/deployAlignment');

const read = (p) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

describe('frontend production env/api resolution guards', () => {
  it('App.jsx uses canonical API resolver + explicit prod warning gate', () => {
    const appSrc = read('src/App.jsx');
    const sessionProviderSrc = read('src/app/providers/SessionProvider.jsx');
    expect(appSrc).toContain("import { buildApiUrl, resolveApiPolicyDiagnostics } from './app/apiConfig';");
    expect(sessionProviderSrc).toContain("fetch(buildApiUrl(`auth/nonce?wallet=${address}`)");
    expect(appSrc).toContain('resolveApiPolicyDiagnostics(import.meta.env)');
    expect(appSrc).toContain('ENV_ERRORS.push(...API_POLICY_ERRORS)');
    expect(appSrc).not.toContain('VITE_API_URL tanımlı değil');
  });

  it('useAppSessionData uses canonical buildApiUrl instead of raw API_URL', () => {
    const sessionSrc = read('src/app/useAppSessionData.jsx');
    expect(sessionSrc).toContain("import { buildApiUrl } from './apiConfig';");
    expect(sessionSrc).toContain("fetch(buildApiUrl('orders/config')");
    expect(sessionSrc).not.toContain('const API_URL');
  });

  it('production deploy alignment requires matching escrow addresses and Base Mainnet chain policy', () => {
    const escrow = '0x1111111111111111111111111111111111111111';

    expect(getSupportedChainIds(true)).toEqual([BASE_MAINNET_CHAIN_ID]);
    expect(assertDeployAlignment({
      label: 'frontend-mainnet',
      frontendEnv: { VITE_ESCROW_ADDRESS: escrow, PROD: true },
      backendEnv: { ARAF_ESCROW_ADDRESS: escrow.toUpperCase(), EXPECTED_CHAIN_ID: '8453' },
      frontendSupportedChainIds: getSupportedChainIds(true),
    })).toMatchObject({
      expectedChainId: BASE_MAINNET_CHAIN_ID,
      frontendEscrowAddress: escrow,
      backendEscrowAddress: escrow,
      isFrontendMainnetOnly: true,
    });
  });

  it('deploy alignment fails on escrow address or EXPECTED_CHAIN_ID mismatch', () => {
    const escrow = '0x1111111111111111111111111111111111111111';

    expect(() => assertDeployAlignment({
      label: 'address-drift',
      frontendEnv: { VITE_ESCROW_ADDRESS: escrow },
      backendEnv: { ARAF_ESCROW_ADDRESS: '0x2222222222222222222222222222222222222222', EXPECTED_CHAIN_ID: '8453' },
      frontendSupportedChainIds: getSupportedChainIds(true),
    })).toThrow(/VITE_ESCROW_ADDRESS and ARAF_ESCROW_ADDRESS must match/);

    expect(() => assertDeployAlignment({
      label: 'chain-drift',
      frontendEnv: { VITE_ESCROW_ADDRESS: escrow },
      backendEnv: { ARAF_ESCROW_ADDRESS: escrow, EXPECTED_CHAIN_ID: '84532' },
      frontendSupportedChainIds: getSupportedChainIds(true),
    })).toThrow(/requires EXPECTED_CHAIN_ID=8453/);
  });

  it('allows explicit Base Sepolia and Hardhat deploy fixtures without relaxing production API policy', () => {
    const escrow = '0x1111111111111111111111111111111111111111';
    const devSupportedChains = getSupportedChainIds(false);

    expect(devSupportedChains).toEqual([HARDHAT_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, BASE_MAINNET_CHAIN_ID]);
    expect(resolveApiBaseUrl({ PROD: true, VITE_API_URL: '' })).toBe('/api');

    [BASE_SEPOLIA_CHAIN_ID, HARDHAT_CHAIN_ID].forEach((chainId) => {
      expect(assertDeployAlignment({
        label: `dev-${chainId}`,
        frontendEnv: { VITE_ESCROW_ADDRESS: escrow, PROD: false },
        backendEnv: { ARAF_ESCROW_ADDRESS: escrow, EXPECTED_CHAIN_ID: String(chainId) },
        frontendSupportedChainIds: devSupportedChains,
      })).toMatchObject({ expectedChainId: chainId, isFrontendMainnetOnly: false });
    });
  });

});
