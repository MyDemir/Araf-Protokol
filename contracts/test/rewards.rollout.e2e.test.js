const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');

describe('Proof of Peace Rewards rollout safety e2e', function () {
  const DECIMALS = 6;
  const NOTIONAL = ethers.parseUnits('100', DECIMALS);

  const OUTCOME = { CLEAN_RELEASE: 1, AUTO_RELEASE: 2 };

  async function fixture() {
    const [owner, escrowSigner, maker, taker, sponsor, outsider] = await ethers.getSigners();
    const MockToken = await ethers.getContractFactory('MockERC20');
    const token = await MockToken.deploy('Mock USDT', 'USDT', DECIMALS);

    const MockEscrow = await ethers.getContractFactory('MockEscrowRewardView');
    const mockEscrow = await MockEscrow.deploy();

    const Vault = await ethers.getContractFactory('ArafRevenueVault');
    const vault = await Vault.deploy(escrowSigner.address, owner.address, owner.address);
    await vault.setSupportedToken(await token.getAddress(), true);

    const Rewards = await ethers.getContractFactory('ArafRewards');
    const rewards = await Rewards.deploy(await mockEscrow.getAddress(), await vault.getAddress(), owner.address);
    await vault.setRewards(await rewards.getAddress());

    return { owner, escrowSigner, maker, taker, sponsor, outsider, token, mockEscrow, vault, rewards };
  }

  async function setTrade(mockEscrow, tradeId, maker, taker, outcome, terminalAt) {
    await mockEscrow.setRewardableTrade(tradeId, {
      tradeId,
      parentOrderId: 99,
      maker,
      taker,
      token: '0x0000000000000000000000000000000000000001',
      stableNotional: NOTIONAL,
      takerFeePaid: 0,
      makerFeePaid: 0,
      tier: 1,
      outcome,
      lockedAt: terminalAt - 600,
      paidAt: terminalAt - 300,
      terminalAt,
      hadChallenge: false,
      isOrderChild: true,
    });
  }

  it('end_to_end_clean_release_generates_weight_and_claim', async function () {
    const { owner, escrowSigner, maker, taker, token, mockEscrow, vault, rewards } = await loadFixture(fixture);
    const epochDuration = await rewards.epochDuration();
    const terminalAt = Number(epochDuration / 2n);
    const epoch = BigInt(Math.floor(terminalAt / Number(epochDuration)));

    await setTrade(mockEscrow, 1, maker.address, taker.address, OUTCOME.CLEAN_RELEASE, terminalAt);
    await rewards.recordTradeOutcome(1);

    await vault.connect(escrowSigner).noteEscrowRevenueIntent(await token.getAddress(), NOTIONAL, 0, 1);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(escrowSigner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 1);

    const allocation = (NOTIONAL * 4000n) / 10000n;
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), allocation);

    await time.increase(Number(epochDuration + (await rewards.claimDelay()) + 10n));
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());

    const before = await token.balanceOf(maker.address);
    await rewards.connect(maker).claim(epoch, await token.getAddress());
    const after = await token.balanceOf(maker.address);
    expect(after - before).to.be.gt(0n);
    expect(await rewards.totalWeight(epoch)).to.be.gt(0n);
  });

  it('end_to_end_auto_release_funds_pool_but_zero_weight', async function () {
    const { owner, escrowSigner, maker, taker, token, mockEscrow, vault, rewards } = await loadFixture(fixture);
    const epochDuration = await rewards.epochDuration();
    const terminalAt = Number(epochDuration / 2n);
    const epoch = BigInt(Math.floor(terminalAt / Number(epochDuration)));

    await setTrade(mockEscrow, 2, maker.address, taker.address, OUTCOME.AUTO_RELEASE, terminalAt);
    await rewards.recordTradeOutcome(2);

    await vault.connect(escrowSigner).noteEscrowRevenueIntent(await token.getAddress(), NOTIONAL, 1, 2);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(escrowSigner).onArafRevenue(await token.getAddress(), NOTIONAL, 1, 2);
    const allocation = (NOTIONAL * 4000n) / 10000n;
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), allocation);

    expect(await rewards.totalWeight(epoch)).to.equal(0n);
    expect(await rewards.epochRewardPool(epoch, await token.getAddress())).to.equal(allocation);
  });

  it('end_to_end_external_funding_claimable_pro_rata', async function () {
    const { owner, maker, taker, sponsor, token, mockEscrow, vault, rewards } = await loadFixture(fixture);
    const epochDuration = await rewards.epochDuration();
    const terminalAt = Number(epochDuration / 2n);
    const epoch = BigInt(Math.floor(terminalAt / Number(epochDuration)));

    await setTrade(mockEscrow, 10, maker.address, taker.address, OUTCOME.CLEAN_RELEASE, terminalAt);
    await setTrade(mockEscrow, 11, maker.address, maker.address, OUTCOME.CLEAN_RELEASE, terminalAt);
    await rewards.recordTradeOutcome(10);
    await rewards.recordTradeOutcome(11);

    const fundAmount = ethers.parseUnits('90', DECIMALS);
    await token.mint(sponsor.address, fundAmount);
    await token.connect(sponsor).approve(await vault.getAddress(), fundAmount);
    await vault.connect(sponsor).fundGlobalRewards(await token.getAddress(), fundAmount, epoch, ethers.id('e2e-fund'));

    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), fundAmount);
    await time.increase(Number(epochDuration + (await rewards.claimDelay()) + 10n));
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());

    const makerClaimable = await rewards.claimable(epoch, maker.address, await token.getAddress());
    const takerClaimable = await rewards.claimable(epoch, taker.address, await token.getAddress());
    expect(makerClaimable).to.be.gt(takerClaimable);
    expect(makerClaimable + takerClaimable).to.equal(fundAmount);
  });

  it('end_to_end_admin_cannot_drain_reward_reserve', async function () {
    const { owner, escrowSigner, outsider, token, vault } = await loadFixture(fixture);
    await vault.connect(escrowSigner).noteEscrowRevenueIntent(await token.getAddress(), NOTIONAL, 0, 77);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(escrowSigner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 77);
    const rewardReserve = await vault.rewardReserve(await token.getAddress());
    const treasuryReserve = await vault.treasuryReserve(await token.getAddress());

    await expect(
      vault.connect(owner).withdrawTreasuryShare(await token.getAddress(), rewardReserve + treasuryReserve + 1n, outsider.address)
    ).to.be.revertedWithCustomError(vault, 'InsufficientTreasuryReserve');
  });

  it('end_to_end_sponsor_cannot_choose_recipient', async function () {
    const { sponsor, token, vault, rewards } = await loadFixture(fixture);
    const f = (name) => rewards.interface.getFunction(name);
    expect(f('recordTradeOutcome')).to.not.equal(null);
    expect(f('allocateEpochRewards')).to.not.equal(null);
    expect(rewards.interface.getFunction('setUserWeight')).to.equal(null);
    expect(rewards.interface.getFunction('setRecipient')).to.equal(null);
    expect(rewards.interface.getFunction('setMultiplier')).to.equal(null);

    await token.mint(sponsor.address, NOTIONAL);
    await token.connect(sponsor).approve(await vault.getAddress(), NOTIONAL);
    await expect(
      rewards.connect(sponsor).allocateEpochRewards(0, await token.getAddress(), 1)
    ).to.be.revertedWithCustomError(rewards, 'OwnableUnauthorizedAccount');
  });
});
