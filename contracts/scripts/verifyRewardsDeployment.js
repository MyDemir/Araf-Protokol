const hre = require('hardhat');
const { ethers, network } = hre;
const fs = require('fs');
const path = require('path');

const fail = (m) => { console.error(`❌ ${m}`); process.exitCode = 1; };
const ok = (m) => console.log(`✅ ${m}`);
const ZERO = '0x0000000000000000000000000000000000000000';
// [TR] Readiness doğrulamasında zero-address kabul edilmez.
// [EN] Zero addresses are rejected during readiness verification.
const addr = (v, n) => {
  if (!v) throw new Error(`${n} missing`);
  const normalized = ethers.getAddress(v);
  if (normalized === ZERO) throw new Error(`${n} zero address`);
  return normalized;
};

function readManifest() {
  const p = path.resolve(__dirname, `../deployments/${network.name}-rewards.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

function resolveAddressesFromEnvOrManifest(env, manifest) {
  return {
    escrowAddress: addr(env.ARAF_ESCROW_ADDRESS || manifest.escrow, 'ARAF_ESCROW_ADDRESS'),
    vaultAddress: addr(env.ARAF_REVENUE_VAULT_ADDRESS || manifest.vault, 'ARAF_REVENUE_VAULT_ADDRESS'),
    rewardsAddress: addr(env.ARAF_REWARDS_ADDRESS || manifest.rewards, 'ARAF_REWARDS_ADDRESS'),
    usdt: addr(env.USDT_ADDRESS || manifest.usdt, 'USDT_ADDRESS'),
    usdc: addr(env.USDC_ADDRESS || manifest.usdc, 'USDC_ADDRESS')
  };
}

async function main() {
  const m = readManifest();
  const { escrowAddress, vaultAddress, rewardsAddress, usdt, usdc } = resolveAddressesFromEnvOrManifest(process.env, m);

  const vault = await ethers.getContractAt('ArafRevenueVault', vaultAddress);
  const rewards = await ethers.getContractAt('ArafRewards', rewardsAddress);
  const escrow = await ethers.getContractAt('ArafEscrow', escrowAddress);

  ((await vault.escrow()) === escrowAddress) ? ok('Vault.escrow') : fail('Vault.escrow mismatch');
  ((await vault.rewards()) === rewardsAddress) ? ok('Vault.rewards') : fail('Vault.rewards mismatch');
  ((await rewards.escrow()) === escrowAddress) ? ok('Rewards.escrow') : fail('Rewards.escrow mismatch');
  ((await rewards.revenueVault()) === vaultAddress) ? ok('Rewards.revenueVault') : fail('Rewards.revenueVault mismatch');
  ((await vault.rewardBps()) === 4000n) ? ok('rewardBps=4000') : fail('rewardBps mismatch');
  ((await vault.supportedToken(usdt)) === true) ? ok('USDT supported') : fail('USDT not supported');
  ((await vault.supportedToken(usdc)) === true) ? ok('USDC supported') : fail('USDC not supported');

  if (process.env.EXPECT_ESCROW_TREASURY_ADDRESS) {
    const t = await escrow.treasury();
    (ethers.getAddress(t) === ethers.getAddress(process.env.EXPECT_ESCROW_TREASURY_ADDRESS))
      ? ok('Escrow treasury matches expected') : fail('Escrow treasury mismatch');
  }

  if (process.exitCode) process.exit(1);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { readManifest, resolveAddressesFromEnvOrManifest };
