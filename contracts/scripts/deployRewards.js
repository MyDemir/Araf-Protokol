const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const ZERO = "0x0000000000000000000000000000000000000000";
const REWARD_BPS_DEFAULT = 4000;
const EPOCH_DURATION = 7 * 24 * 60 * 60;
const CLAIM_DELAY = 24 * 60 * 60;

function reqAddr(name) {
  const v = process.env[name];
  if (!v || !ethers.isAddress(v) || v === ZERO) throw new Error(`Missing/invalid ${name}`);
  return ethers.getAddress(v);
}

async function main() {
  const escrow = reqAddr("ARAF_ESCROW_ADDRESS");
  const finalTreasury = reqAddr("FINAL_TREASURY_ADDRESS");
  const owner = reqAddr("FINAL_OWNER_ADDRESS");
  const usdt = reqAddr("BASE_MAINNET_USDT_ADDRESS");
  const usdc = reqAddr("BASE_MAINNET_USDC_ADDRESS");

  console.log("[deployRewards] Dry-safe script. No treasury switch is executed.");

  const Vault = await ethers.getContractFactory("ArafRevenueVault");
  const vault = await Vault.deploy(escrow, finalTreasury, owner);
  await vault.waitForDeployment();

  const Rewards = await ethers.getContractFactory("ArafRewards");
  const rewards = await Rewards.deploy(escrow, await vault.getAddress(), owner);
  await rewards.waitForDeployment();

  await (await vault.setRewards(await rewards.getAddress())).wait();
  await (await vault.setSupportedToken(usdt, true)).wait();
  await (await vault.setSupportedToken(usdc, true)).wait();

  const rewardBps = Number(await vault.rewardBps());
  if (rewardBps !== REWARD_BPS_DEFAULT) throw new Error(`rewardBps mismatch: ${rewardBps}`);

  const out = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    escrow,
    revenueVault: await vault.getAddress(),
    rewards: await rewards.getAddress(),
    finalTreasury,
    owner,
    rewardBps,
    expectedEpochDuration: EPOCH_DURATION,
    expectedClaimDelay: CLAIM_DELAY,
    supportedTokens: { usdt, usdc },
    rolloutReminder: "Set ArafEscrow.treasury = revenueVault only after verify/configure passes.",
  };
  const target = path.resolve(__dirname, "../deployments/rewards.latest.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
