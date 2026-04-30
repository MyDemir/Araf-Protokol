const hre = require("hardhat");
const { ethers } = hre;

function reqAddr(name) {
  const v = process.env[name];
  if (!v || !ethers.isAddress(v)) throw new Error(`Missing/invalid ${name}`);
  return ethers.getAddress(v);
}

async function main() {
  const escrow = reqAddr("ARAF_ESCROW_ADDRESS");
  const vaultAddr = reqAddr("ARAF_REVENUE_VAULT_ADDRESS");
  const rewardsAddr = reqAddr("ARAF_REWARDS_ADDRESS");
  const usdt = reqAddr("BASE_MAINNET_USDT_ADDRESS");
  const usdc = reqAddr("BASE_MAINNET_USDC_ADDRESS");

  const vault = await ethers.getContractAt("ArafRevenueVault", vaultAddr);
  const rewards = await ethers.getContractAt("ArafRewards", rewardsAddr);

  const checks = {
    treasuryLinked: (await vault.escrow()) === escrow,
    rewardsLinked: (await vault.rewards()) === rewardsAddr,
    rewardsEscrowLinked: (await rewards.escrow()) === escrow,
    rewardsVaultLinked: (await rewards.revenueVault()) === vaultAddr,
    rewardBpsIs4000: Number(await vault.rewardBps()) === 4000,
    usdtSupported: Boolean(await vault.supportedToken(usdt)),
    usdcSupported: Boolean(await vault.supportedToken(usdc)),
    epochDuration7d: Number(await rewards.epochDuration()) === 7 * 24 * 60 * 60,
    claimDelay24h: Number(await rewards.claimDelay()) === 24 * 60 * 60,
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  if (failed.length) throw new Error(`Verification failed: ${failed.map(([k]) => k).join(", ")}`);
  console.log("[verifyRewardsDeployment] all checks passed", checks);
}

main().catch((e) => { console.error(e); process.exit(1); });
