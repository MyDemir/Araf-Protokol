const hre = require('hardhat');
const { ethers, network } = hre;
const fs = require('fs');
const path = require('path');

const addr = (v, n) => { if (!v || !ethers.isAddress(v)) throw new Error(`${n} missing/invalid`); return ethers.getAddress(v); };

function loadManifest() {
  const p = path.resolve(__dirname, `../deployments/${network.name}-rewards.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

async function main() {
  const m = loadManifest();
  const vaultAddr = addr(process.env.ARAF_REVENUE_VAULT_ADDRESS || m.vault, 'ARAF_REVENUE_VAULT_ADDRESS');
  const rewardsAddr = addr(process.env.ARAF_REWARDS_ADDRESS || m.rewards, 'ARAF_REWARDS_ADDRESS');
  const escrowAddr = addr(process.env.ARAF_ESCROW_ADDRESS || m.escrow, 'ARAF_ESCROW_ADDRESS');
  const usdt = addr(process.env.USDT_ADDRESS || m.usdt, 'USDT_ADDRESS');
  const usdc = addr(process.env.USDC_ADDRESS || m.usdc, 'USDC_ADDRESS');

  const vault = await ethers.getContractAt('ArafRevenueVault', vaultAddr);
  if ((await vault.rewards()) !== rewardsAddr) await (await vault.setRewards(rewardsAddr)).wait();
  if (!(await vault.supportedToken(usdt))) await (await vault.setSupportedToken(usdt, true)).wait();
  if (!(await vault.supportedToken(usdc))) await (await vault.setSupportedToken(usdc, true)).wait();

  if (process.env.CONFIRM_SWITCH_TREASURY_TO_VAULT === 'yes') {
    const expected = addr(process.env.EXPECTED_CURRENT_TREASURY_ADDRESS, 'EXPECTED_CURRENT_TREASURY_ADDRESS');
    const nextTreasury = addr(process.env.ARAF_REVENUE_VAULT_ADDRESS || vaultAddr, 'ARAF_REVENUE_VAULT_ADDRESS');
    const escrow = await ethers.getContractAt('ArafEscrow', escrowAddr);
    const current = await escrow.treasury();
    if (ethers.getAddress(current) !== expected) throw new Error(`Escrow treasury mismatch. expected=${expected} current=${current}`);
    console.warn('WARNING: switching escrow treasury to revenue vault.');
    await (await escrow.setTreasury(nextTreasury)).wait();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
