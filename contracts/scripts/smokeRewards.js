const hre = require("hardhat");
const { ethers } = hre;

function req(name) { const v = process.env[name]; if (!v) throw new Error(`Missing ${name}`); return v; }

async function main() {
  const escrowAddr = req("ARAF_ESCROW_ADDRESS");
  const vaultAddr = req("ARAF_REVENUE_VAULT_ADDRESS");
  const rewardsAddr = req("ARAF_REWARDS_ADDRESS");
  const usdt = req("BASE_MAINNET_USDT_ADDRESS");
  const usdc = req("BASE_MAINNET_USDC_ADDRESS");
  const escrow = await ethers.getContractAt("ArafEscrow", escrowAddr);
  const vault = await ethers.getContractAt("ArafRevenueVault", vaultAddr);
  const rewards = await ethers.getContractAt("ArafRewards", rewardsAddr);

  const results = {
    escrowTreasury: await escrow.treasury(),
    expectedTreasury: vaultAddr,
    vaultEscrow: await vault.escrow(),
    vaultRewards: await vault.rewards(),
    rewardsEscrow: await rewards.escrow(),
    rewardsVault: await rewards.revenueVault(),
    rewardBps: Number(await vault.rewardBps()),
    usdtSupported: await vault.supportedToken(usdt),
    usdcSupported: await vault.supportedToken(usdc),
  };
  console.log(results);
}
main().catch((e) => { console.error(e); process.exit(1); });
