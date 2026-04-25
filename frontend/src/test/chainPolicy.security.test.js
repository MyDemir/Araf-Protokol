import { describe, it, expect } from 'vitest';
import {
  getSupportedChainIds,
  isSupportedChainId,
  isMintTokenEnabled,
} from '../app/chainPolicy';

describe('frontend chain policy security', () => {
  it('security_prod_mode_allows_only_base_mainnet_chain_id_8453', () => {
    expect(getSupportedChainIds(true)).toEqual([8453]);
    expect(isSupportedChainId(8453, true)).toBe(true);
    expect(isSupportedChainId(84532, true)).toBe(false);
    expect(isSupportedChainId(31337, true)).toBe(false);
  });

  it('security_dev_mode_allows_hardhat_and_base_sepolia', () => {
    expect(isSupportedChainId(31337, false)).toBe(true);
    expect(isSupportedChainId(84532, false)).toBe(true);
    expect(isSupportedChainId(8453, false)).toBe(true);
  });

  it('security_mint_feature_disabled_in_production_policy', () => {
    expect(isMintTokenEnabled(true)).toBe(false);
    expect(isMintTokenEnabled(false)).toBe(true);
  });
});

