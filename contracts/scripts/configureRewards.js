const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const vaultAddr = process.env.ARAF_REVENUE_VAULT_ADDRESS;
  const rewardsAddr = process.env.ARAF_REWARDS_ADDRESS;
  if (!vaultAddr || !rewardsAddr) throw new Error("ARAF_REVENUE_VAULT_ADDRESS and ARAF_REWARDS_ADDRESS required");
  const vault = await ethers.getContractAt("ArafRevenueVault", vaultAddr);
  const tx = await vault.setRewards(rewardsAddr);
  await tx.wait();
  console.log("Configured rewards address on vault.");
  console.log("SAFE REMINDER: Do NOT switch escrow treasury before verifyRewardsDeployment.js passes.");
}

main().catch((e) => { console.error(e); process.exit(1); });
