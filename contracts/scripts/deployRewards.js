const hre = require('hardhat');
const { ethers, artifacts, network } = hre;
const fs = require('fs');
const path = require('path');

const LOCAL = new Set(['hardhat', 'localhost']);
const ZERO = '0x0000000000000000000000000000000000000000';

const isLocalNetwork = (name, chainId) => LOCAL.has(name) || chainId === 31337n;
const isAddress = (v) => { try { return !!v && ethers.isAddress(v); } catch { return false; } };
const toAddr = (name, v) => { if (!isAddress(v) || v === ZERO) throw new Error(`${name} invalid address`); return ethers.getAddress(v); };
const reqEnv = (name) => toAddr(name, process.env[name]);
const optEnv = (name) => process.env[name] ? toAddr(name, process.env[name]) : null;
const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });

function resolvePublicTokens(chainId) {
  if (Number(chainId) === 8453) return { usdt: reqEnv('BASE_MAINNET_USDT_ADDRESS'), usdc: reqEnv('BASE_MAINNET_USDC_ADDRESS') };
  if (Number(chainId) === 84532) return { usdt: reqEnv('BASE_SEPOLIA_USDT_ADDRESS'), usdc: reqEnv('BASE_SEPOLIA_USDC_ADDRESS') };
  throw new Error(`Unsupported public chainId ${chainId}`);
}

async function maybeDeployMockToken(symbol) {
  const Mock = await ethers.getContractFactory('MockERC20');
  const t = await Mock.deploy(`Mock ${symbol}`, symbol, 6);
  await t.waitForDeployment();
  return await t.getAddress();
}

async function exportAbi(contractNames) {
  const outDir = path.resolve(__dirname, '../abi');
  ensureDir(outDir);
  for (const name of contractNames) {
    const art = await artifacts.readArtifact(name);
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(art.abi, null, 2));
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const local = isLocalNetwork(network.name, net.chainId);
  const owner = optEnv('FINAL_OWNER_ADDRESS') || deployer.address;

  let escrowAddress = optEnv('ARAF_ESCROW_ADDRESS');
  const finalTreasury = local ? (optEnv('FINAL_TREASURY_ADDRESS') || deployer.address) : reqEnv('FINAL_TREASURY_ADDRESS');

  let usdt = null; let usdc = null;
  if (local) {
    usdt = optEnv('BASE_MAINNET_USDT_ADDRESS') || optEnv('BASE_SEPOLIA_USDT_ADDRESS');
    usdc = optEnv('BASE_MAINNET_USDC_ADDRESS') || optEnv('BASE_SEPOLIA_USDC_ADDRESS');
    if (!usdt) usdt = await maybeDeployMockToken('USDT');
    if (!usdc) usdc = await maybeDeployMockToken('USDC');

    if (!escrowAddress) {
      const treasury = reqEnv('TREASURY_ADDRESS');
      const Escrow = await ethers.getContractFactory('ArafEscrow');
      const escrow = await Escrow.deploy(treasury);
      await escrow.waitForDeployment();
      escrowAddress = await escrow.getAddress();
    }
  } else {
    ({ usdt, usdc } = resolvePublicTokens(net.chainId));
    if (!escrowAddress) {
      if (process.env.CONFIRM_FRESH_ESCROW_DEPLOY !== 'yes') {
        throw new Error('ARAF_ESCROW_ADDRESS required for public networks. If migration requires fresh escrow deployment, set CONFIRM_FRESH_ESCROW_DEPLOY=yes and deploy escrow manually first.');
      }
      throw new Error('Fresh escrow deployment on public network must be executed in a dedicated migration script.');
    }
  }

  const Vault = await ethers.getContractFactory('ArafRevenueVault');
  const vault = await Vault.deploy(escrowAddress, finalTreasury, owner);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  const Rewards = await ethers.getContractFactory('ArafRewards');
  const rewards = await Rewards.deploy(escrowAddress, vaultAddress, owner);
  await rewards.waitForDeployment();
  const rewardsAddress = await rewards.getAddress();

  await (await vault.setRewards(rewardsAddress)).wait();
  await (await vault.setSupportedToken(usdt, true)).wait();
  await (await vault.setSupportedToken(usdc, true)).wait();
  const rewardBps = await vault.rewardBps();
  if (rewardBps !== 4000n) throw new Error(`rewardBps mismatch: ${rewardBps}`);

  const manifest = {
    network: network.name,
    chainId: Number(net.chainId),
    escrow: escrowAddress,
    vault: vaultAddress,
    rewards: rewardsAddress,
    usdt,
    usdc,
    owner,
    finalTreasury,
    rewardBps: rewardBps.toString(),
    deployedAt: new Date().toISOString()
  };

  const depDir = path.resolve(__dirname, '../deployments');
  ensureDir(depDir);
  fs.writeFileSync(path.join(depDir, `${network.name}-rewards.json`), JSON.stringify(manifest, null, 2));
  await exportAbi(['ArafEscrow', 'ArafRevenueVault', 'ArafRewards']);
  console.log('Rewards deployment complete', manifest);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { isLocalNetwork, resolvePublicTokens };
