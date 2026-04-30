const { expect } = require('chai');
const { isLocalNetwork, resolvePublicTokens, assertManifestOverwriteSafety } = require('../scripts/deployRewards');

describe('rewards deployment scripts guards', function () {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
  });

  it('detects local network by name and chainId', function () {
    expect(isLocalNetwork('hardhat', 1n)).to.equal(true);
    expect(isLocalNetwork('base-sepolia', 31337n)).to.equal(true);
    expect(isLocalNetwork('base-sepolia', 84532n)).to.equal(false);
  });

  it('requires base mainnet token envs', function () {
    delete process.env.BASE_MAINNET_USDT_ADDRESS;
    delete process.env.BASE_MAINNET_USDC_ADDRESS;
    expect(() => resolvePublicTokens(8453n)).to.throw(/BASE_MAINNET_USDT_ADDRESS/);
  });

  it('resolves base sepolia token envs', function () {
    process.env.BASE_SEPOLIA_USDT_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.BASE_SEPOLIA_USDC_ADDRESS = '0x2222222222222222222222222222222222222222';
    const t = resolvePublicTokens(84532n);
    expect(t.usdt).to.equal('0x1111111111111111111111111111111111111111');
    expect(t.usdc).to.equal('0x2222222222222222222222222222222222222222');
  });

  it('manifest overwrite allows same critical addresses', function () {
    const m1 = { escrow: '0x1', vault: '0x2', rewards: '0x3', finalTreasury: '0x4' };
    const m2 = { escrow: '0x1', vault: '0x2', rewards: '0x3', finalTreasury: '0x4' };
    expect(() => assertManifestOverwriteSafety(m1, m2, {})).to.not.throw();
  });

  it('manifest overwrite rejects changed critical addresses without explicit confirm', function () {
    const m1 = { escrow: '0x1', vault: '0x2', rewards: '0x3', finalTreasury: '0x4' };
    const m2 = { escrow: '0x9', vault: '0x2', rewards: '0x3', finalTreasury: '0x4' };
    expect(() => assertManifestOverwriteSafety(m1, m2, {})).to.throw(/CONFIRM_OVERWRITE_REWARDS_MANIFEST=yes/);
  });

  it('manifest overwrite proceeds when explicit confirm exists', function () {
    const m1 = { escrow: '0x1', vault: '0x2', rewards: '0x3', finalTreasury: '0x4' };
    const m2 = { escrow: '0x9', vault: '0x2', rewards: '0x3', finalTreasury: '0x4' };
    expect(() => assertManifestOverwriteSafety(m1, m2, { CONFIRM_OVERWRITE_REWARDS_MANIFEST: 'yes' })).to.not.throw();
  });
});
