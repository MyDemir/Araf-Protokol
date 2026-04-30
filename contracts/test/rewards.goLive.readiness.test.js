const { expect } = require('chai');
const path = require('path');
const fs = require('fs');

const verify = require('../scripts/verifyRewardsDeployment');
const configure = require('../scripts/configureRewards');
const deploy = require('../scripts/deployRewards');
const sw = require('../scripts/switchRewardsTreasury');

const A = {
  escrow: '0x1111111111111111111111111111111111111111',
  vault: '0x2222222222222222222222222222222222222222',
  rewards: '0x3333333333333333333333333333333333333333',
  usdt: '0x4444444444444444444444444444444444444444',
  usdc: '0x5555555555555555555555555555555555555555'
};

describe('rewards go-live readiness hardening', function () {
  it('verifyRewardsDeployment fails if vault address is missing', function () {
    expect(() => verify.resolveAddressesFromEnvOrManifest({}, { ...A, vault: undefined })).to.throw(/ARAF_REVENUE_VAULT_ADDRESS missing/);
  });
  it('verifyRewardsDeployment fails if rewards address is missing', function () {
    expect(() => verify.resolveAddressesFromEnvOrManifest({}, { ...A, rewards: undefined })).to.throw(/ARAF_REWARDS_ADDRESS missing/);
  });
  it('verifyRewardsDeployment fails if escrow address is missing', function () {
    expect(() => verify.resolveAddressesFromEnvOrManifest({}, { ...A, escrow: undefined })).to.throw(/ARAF_ESCROW_ADDRESS missing/);
  });
  it('verifyRewardsDeployment validates supported token config includes USDT/USDC inputs', function () {
    const out = verify.resolveAddressesFromEnvOrManifest({}, A);
    expect(out.usdt).to.equal(A.usdt);
    expect(out.usdc).to.equal(A.usdc);
  });

  it('configureRewards refuses zero/invalid addresses', function () {
    expect(() => configure.resolveConfigureInputs({ ARAF_REVENUE_VAULT_ADDRESS: '0x0' }, A)).to.throw();
    expect(() => configure.resolveConfigureInputs({ USDT_ADDRESS: 'not-an-address' }, A)).to.throw(/USDT_ADDRESS/);
  });

  it('configureRewards refuses treasury switch in standard configure path (source guard)', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/configureRewards.js'), 'utf8');
    expect(source).to.contain('Treasury switch is intentionally separated');
    expect(source).to.not.contain('setTreasury(');
  });

  it('deployRewards does not switch escrow treasury', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/deployRewards.js'), 'utf8');
    expect(source).to.not.contain('setTreasury(');
  });

  it('deployRewards does not auto deploy mock tokens on public networks', function () {
    expect(() => deploy.resolvePublicTokens(999n)).to.throw(/Unsupported public chainId/);
  });

  it('smokeRewards read-only-by-default guard exists for public networks', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/smokeRewards.js'), 'utf8');
    expect(source).to.contain('CONFIRM_PUBLIC_SMOKE');
  });

  it('manifest validation is deterministic and critical keys are fixed', function () {
    const first = sw.resolveSwitchInputs({}, A);
    const second = sw.resolveSwitchInputs({}, { ...A });
    expect(first).to.deep.equal(second);
  });

  it('switchRewardsTreasury requires explicit confirmation and validates wiring preconditions via source', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/switchRewardsTreasury.js'), 'utf8');
    expect(source).to.contain("CONFIRM_TREASURY_SWITCH !== 'true'");
    expect(source).to.contain('rewardBps must be 4000');
    expect(source).to.contain('USDT not supported');
    expect(source).to.contain('USDC not supported');
  });

  it('ABI exports include ArafEscrow/ArafRevenueVault/ArafRewards', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/deployRewards.js'), 'utf8');
    expect(source).to.contain("exportAbi(['ArafEscrow', 'ArafRevenueVault', 'ArafRewards'])");
  });

  it('verify script enforces rewardBps target 4000 and wiring checks (source)', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/verifyRewardsDeployment.js'), 'utf8');
    expect(source).to.contain('rewardBps=4000');
    expect(source).to.contain('Vault.escrow mismatch');
    expect(source).to.contain('Rewards.revenueVault mismatch');
  });

  it('verify script rejects empty supported token set inputs', function () {
    expect(() => verify.resolveAddressesFromEnvOrManifest({}, { ...A, usdt: undefined })).to.throw(/USDT_ADDRESS missing/);
    expect(() => verify.resolveAddressesFromEnvOrManifest({}, { ...A, usdc: undefined })).to.throw(/USDC_ADDRESS missing/);
  });

  it('contracts env example uses canonical script-consumed variable names', function () {
    const envExample = fs.readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8');
    expect(envExample).to.contain('ARAF_ESCROW_ADDRESS=');
    expect(envExample).to.contain('ARAF_REVENUE_VAULT_ADDRESS=');
    expect(envExample).to.contain('ARAF_REWARDS_ADDRESS=');
    expect(envExample).to.contain('FINAL_TREASURY_ADDRESS=');
    expect(envExample).to.contain('USDT_ADDRESS=');
    expect(envExample).to.contain('USDC_ADDRESS=');
    expect(envExample).to.contain('REWARD_BPS=4000');
    expect(envExample).to.contain('CONFIRM_CONFIGURE_REWARDS=false');
    expect(envExample).to.contain('CONFIRM_TREASURY_SWITCH=false');
    expect(envExample).to.contain('EXPECTED_CURRENT_TREASURY_ADDRESS=');
    expect(envExample).to.contain('BASE_MAINNET_USDT_ADDRESS=');
    expect(envExample).to.contain('BASE_MAINNET_USDC_ADDRESS=');
    expect(envExample).to.contain('BASE_SEPOLIA_USDT_ADDRESS=');
    expect(envExample).to.contain('BASE_SEPOLIA_USDC_ADDRESS=');
    expect(envExample).to.contain('CONFIRM_PUBLIC_SMOKE=');
    expect(envExample).to.contain('CONFIRM_FRESH_ESCROW_DEPLOY=');
  });
});
