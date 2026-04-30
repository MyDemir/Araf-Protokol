const hre = require('hardhat');
const { ethers, network } = hre;

async function main() {
  const net = await ethers.provider.getNetwork();
  const isLocal = ['hardhat', 'localhost'].includes(network.name) || net.chainId === 31337n;
  if (!isLocal && process.env.CONFIRM_PUBLIC_SMOKE !== 'yes') {
    throw new Error('Refusing public smoke. Set CONFIRM_PUBLIC_SMOKE=yes');
  }

  const [owner, user] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory('MockERC20');
  const token = await Mock.deploy('Mock USDT', 'USDT', 6);
  await token.waitForDeployment();

  const EscrowView = await ethers.getContractFactory('MockEscrowRewardView');
  const esc = await EscrowView.deploy();
  await esc.waitForDeployment();

  const Vault = await ethers.getContractFactory('ArafRevenueVault');
  const vault = await Vault.deploy(await esc.getAddress(), owner.address, owner.address);
  await vault.waitForDeployment();
  const Rewards = await ethers.getContractFactory('ArafRewards');
  const rewards = await Rewards.deploy(await esc.getAddress(), await vault.getAddress(), owner.address);
  await rewards.waitForDeployment();

  await (await vault.setRewards(await rewards.getAddress())).wait();
  await (await vault.setSupportedToken(await token.getAddress(), true)).wait();

  let rejectedLow = false; let rejectedHigh = false;
  try { await vault.setRewardBps(3999); } catch { rejectedLow = true; }
  try { await vault.setRewardBps(7001); } catch { rejectedHigh = true; }
  if (!rejectedLow || !rejectedHigh) throw new Error('rewardBps bound checks failed');

  await (await token.mint(owner.address, 1_000_000_000)).wait();
  await (await token.approve(await vault.getAddress(), 1_000_000_000)).wait();
  await (await vault.fundGlobalRewards(await token.getAddress(), 100_000_000, 1, ethers.id('smoke'))).wait();

  const reserve = await vault.rewardReserve(await token.getAddress());
  let withdrewReserve = false;
  try { await vault.withdrawTreasuryShare(await token.getAddress(), reserve, user.address); } catch { withdrewReserve = true; }
  if (!withdrewReserve) throw new Error('owner was able to withdraw reward reserve through treasury path');

  console.log('✅ smokeRewards checks passed');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
