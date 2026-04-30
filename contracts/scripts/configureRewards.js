const hre = require('hardhat');
const { ethers, network } = hre;
const fs = require('fs');
const path = require('path');

const ZERO = '0x0000000000000000000000000000000000000000';
// [TR] Configure script sadece wiring işlemlerini yapar; treasury switch burada yasaktır.
// [EN] Configure script is wiring-only; treasury switching is forbidden here.
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

function resolveConfigureInputs(env, manifest) {
  return {
    vaultAddr: addr(env.ARAF_REVENUE_VAULT_ADDRESS || manifest.vault, 'ARAF_REVENUE_VAULT_ADDRESS'),
    rewardsAddr: addr(env.ARAF_REWARDS_ADDRESS || manifest.rewards, 'ARAF_REWARDS_ADDRESS'),
    usdt: addr(env.USDT_ADDRESS || manifest.usdt, 'USDT_ADDRESS'),
    usdc: addr(env.USDC_ADDRESS || manifest.usdc, 'USDC_ADDRESS')
  };
}

async function main() {
  // [TR] Operasyonel güvenlik: treasury handoff ayrı explicit script ile yapılmalı.
  // [EN] Operational safety: treasury handoff must run in a separate explicit script.
  if (process.env.CONFIRM_SWITCH_TREASURY_TO_VAULT) {
    throw new Error('Treasury switch is intentionally separated. Use scripts/switchRewardsTreasury.js with CONFIRM_TREASURY_SWITCH=true');
  }
  const m = loadManifest();
  const { vaultAddr, rewardsAddr, usdt, usdc } = resolveConfigureInputs(process.env, m);
  const vault = await ethers.getContractAt('ArafRevenueVault', vaultAddr);
  if ((await vault.rewards()) !== rewardsAddr) await (await vault.setRewards(rewardsAddr)).wait();
  if (!(await vault.supportedToken(usdt))) await (await vault.setSupportedToken(usdt, true)).wait();
  if (!(await vault.supportedToken(usdc))) await (await vault.setSupportedToken(usdc, true)).wait();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { loadManifest, resolveConfigureInputs };
