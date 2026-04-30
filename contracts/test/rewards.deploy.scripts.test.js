const { expect } = require('chai');
const { isLocalNetwork, resolvePublicTokens } = require('../scripts/deployRewards');

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
});
