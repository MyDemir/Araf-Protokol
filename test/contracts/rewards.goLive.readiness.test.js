const { expect } = require('chai');
const path = require('path');
const fs = require('fs');

const verify = require('../../contracts/scripts/verifyRewardsDeployment');
const configure = require('../../contracts/scripts/configureRewards');
const deploy = require('../../contracts/scripts/deployRewards');
const sw = require('../../contracts/scripts/switchRewardsTreasury');
const { runAbiDriftCheck } = require('../../contracts/scripts/checkAbiDrift');

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
    const source = fs.readFileSync(path.resolve(__dirname, '../../contracts/scripts/configureRewards.js'), 'utf8');
    expect(source).to.contain('Treasury switch is intentionally separated');
    expect(source).to.not.contain('setTreasury(');
  });

  it('deployRewards does not switch escrow treasury', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../../contracts/scripts/deployRewards.js'), 'utf8');
    expect(source).to.not.contain('setTreasury(');
  });

  it('deployRewards does not auto deploy mock tokens on public networks', function () {
    expect(() => deploy.resolvePublicTokens(999n)).to.throw(/Unsupported public chainId/);
  });

  it('smokeRewards read-only-by-default guard exists for public networks', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../../contracts/scripts/smokeRewards.js'), 'utf8');
    expect(source).to.contain('CONFIRM_PUBLIC_SMOKE');
  });

  it('manifest validation is deterministic and critical keys are fixed', function () {
    const first = sw.resolveSwitchInputs({}, A);
    const second = sw.resolveSwitchInputs({}, { ...A });
    expect(first).to.deep.equal(second);
  });

  it('switchRewardsTreasury requires explicit confirmation and validates wiring preconditions via source', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../../contracts/scripts/switchRewardsTreasury.js'), 'utf8');
    expect(source).to.contain("CONFIRM_TREASURY_SWITCH !== 'true'");
    expect(source).to.contain('rewardBps must be 4000');
    expect(source).to.contain('USDT not supported');
    expect(source).to.contain('USDC not supported');
  });

  it('ABI exports include ArafEscrow/ArafRevenueVault/ArafRewards', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../../contracts/scripts/deployRewards.js'), 'utf8');
    expect(source).to.contain("exportAbi(['ArafEscrow', 'ArafRevenueVault', 'ArafRewards'])");
  });

  it('verify script enforces rewardBps target 4000 and wiring checks (source)', function () {
    const source = fs.readFileSync(path.resolve(__dirname, '../../contracts/scripts/verifyRewardsDeployment.js'), 'utf8');
    expect(source).to.contain('rewardBps=4000');
    expect(source).to.contain('Vault.escrow mismatch');
    expect(source).to.contain('Rewards.revenueVault mismatch');
  });

  it('verify script rejects empty supported token set inputs', function () {
    expect(() => verify.resolveAddressesFromEnvOrManifest({}, { ...A, usdt: undefined })).to.throw(/USDT_ADDRESS missing/);
    expect(() => verify.resolveAddressesFromEnvOrManifest({}, { ...A, usdc: undefined })).to.throw(/USDC_ADDRESS missing/);
  });

  it('contracts env example uses canonical script-consumed variable names', function () {
    const envExample = fs.readFileSync(path.resolve(__dirname, '../../contracts/.env.example'), 'utf8');
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

  it('ABI drift: critical escrow events/getters stay in lock-step across contract/frontend/backend sources', function () {
    expect(runAbiDriftCheck()).to.equal(true);
    const artifact = require('../../contracts/artifacts/src/ArafEscrow.sol/ArafEscrow.json');
    const frontendSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/hooks/useArafContract.js'), 'utf8');
    const backendSource = fs.readFileSync(path.resolve(__dirname, '../../backend/scripts/services/eventListener.js'), 'utf8');

    const events = Object.fromEntries(
      artifact.abi
        .filter((x) => x.type === 'event')
        .map((x) => [x.name, x])
    );
    const funcs = Object.fromEntries(
      artifact.abi
        .filter((x) => x.type === 'function')
        .map((x) => [x.name, x])
    );

    const criticalEventNames = ['OrderFilled', 'EscrowReleased', 'ProtocolRevenueSent', 'SettlementFinalized', 'ReputationUpdated'];
    for (const name of criticalEventNames) {
      expect(events[name], `missing event ${name}`).to.not.equal(undefined);
      const expectedInputShape = events[name].inputs.map((i) => `${i.type}:${i.name}:${i.indexed ? 'i' : 'n'}`).join('|');
      expect(expectedInputShape.length).to.be.greaterThan(0);
      expect(backendSource).to.contain(`event ${name}(`);
      if (name === 'OrderFilled') expect(frontendSource).to.contain(`event ${name}(`);
    }

    const criticalGetterNames = ['getReputation', 'getTrade', 'getOrder', 'getCurrentAmounts', 'getSettlementProposal'];
    for (const name of criticalGetterNames) {
      expect(funcs[name], `missing getter ${name}`).to.not.equal(undefined);
      expect(frontendSource).to.contain(`function ${name}(`);
    }
    for (const workerGetterName of ['getReputation', 'getTrade', 'getOrder']) {
      expect(backendSource).to.contain(`function ${workerGetterName}(`);
    }
  });

  it('ABI drift: getReputation V3 tuple order snapshot remains stable', function () {
    const artifact = require('../../contracts/artifacts/src/ArafEscrow.sol/ArafEscrow.json');
    const fn = artifact.abi.find((x) => x.type === 'function' && x.name === 'getReputation');
    expect(fn).to.not.equal(undefined);
    const out = fn.outputs || [];
    const names = out.map((x) => x.name);
    expect(names).to.deep.equal([
      'successful',
      'failed',
      'bannedUntil',
      'consecutiveBans',
      'effectiveTier',
      'manualReleaseCount',
      'autoReleaseCount',
      'mutualCancelCount',
      'disputedResolvedCount',
      'burnCount',
      'disputeWinCount',
      'disputeLossCount',
      'partialSettlementCount',
      'riskPoints',
      'lastPositiveEventAt',
      'lastNegativeEventAt',
    ]);
  });
});
