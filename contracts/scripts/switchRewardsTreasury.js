const hre = require('hardhat');
const { ethers, network } = hre;
const fs = require('fs');
const path = require('path');

const ZERO = '0x0000000000000000000000000000000000000000';
// [TR] Bu script hassastır: yalnız explicit onay ile treasury handoff yapar.
// [EN] This script is sensitive: treasury handoff is allowed only with explicit confirmation.
const addr = (v, n) => {
  if (!v || !ethers.isAddress(v)) throw new Error(`${n} missing/invalid`);
  const normalized = ethers.getAddress(v);
  if (normalized === ZERO) throw new Error(`${n} zero address`);
  return normalized;
};

function loadManifest() {
  const p = path.resolve(__dirname, `../deployments/${network.name}-rewards.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

function resolveSwitchInputs(env, manifest) {
  return {
    escrowAddr: addr(env.ARAF_ESCROW_ADDRESS || manifest.escrow, 'ARAF_ESCROW_ADDRESS'),
    vaultAddr: addr(env.ARAF_REVENUE_VAULT_ADDRESS || manifest.vault, 'ARAF_REVENUE_VAULT_ADDRESS'),
    rewardsAddr: addr(env.ARAF_REWARDS_ADDRESS || manifest.rewards, 'ARAF_REWARDS_ADDRESS'),
    usdt: addr(env.USDT_ADDRESS || manifest.usdt, 'USDT_ADDRESS'),
    usdc: addr(env.USDC_ADDRESS || manifest.usdc, 'USDC_ADDRESS')
  };
}

async function main() {
  // [TR] Varsayılan davranış fail-closed: onay yoksa işlem yok.
  // [EN] Default behavior is fail-closed: no confirmation, no action.
  if (process.env.CONFIRM_TREASURY_SWITCH !== 'true') throw new Error('Refusing treasury switch. Set CONFIRM_TREASURY_SWITCH=true');
  const m = loadManifest();
  const { escrowAddr, vaultAddr, rewardsAddr, usdt, usdc } = resolveSwitchInputs(process.env, m);
  const vault = await ethers.getContractAt('ArafRevenueVault', vaultAddr);
  const rewards = await ethers.getContractAt('ArafRewards', rewardsAddr);
  const escrow = await ethers.getContractAt('ArafEscrow', escrowAddr);

  if ((await vault.escrow()) !== escrowAddr) throw new Error('vault.escrow mismatch');
  if ((await vault.rewards()) !== rewardsAddr) throw new Error('vault.rewards mismatch');
  if ((await rewards.escrow()) !== escrowAddr) throw new Error('rewards.escrow mismatch');
  if ((await rewards.revenueVault()) !== vaultAddr) throw new Error('rewards.revenueVault mismatch');

  const rewardBps = await vault.rewardBps();
  if (rewardBps !== 4000n && process.env.ALLOW_NON_4000_REWARD_BPS !== 'true') {
    throw new Error(`rewardBps must be 4000 for go-live. got=${rewardBps}`);
  }
  if (!(await vault.supportedToken(usdt))) throw new Error('USDT not supported');
  if (!(await vault.supportedToken(usdc))) throw new Error('USDC not supported');

  const current = await escrow.treasury();
  const expectedCurrent = addr(process.env.EXPECTED_CURRENT_TREASURY_ADDRESS, 'EXPECTED_CURRENT_TREASURY_ADDRESS');
  if (ethers.getAddress(current) !== expectedCurrent) throw new Error(`Escrow treasury mismatch. expected=${expectedCurrent} current=${current}`);

  console.warn('WARNING: switching escrow treasury to revenue vault.');
  await (await escrow.setTreasury(vaultAddr)).wait();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { loadManifest, resolveSwitchInputs };
