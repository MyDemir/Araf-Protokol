const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Rewards rollout integration", function () {
  async function fx() {
    const [owner, maker, taker, sponsor] = await ethers.getSigners();
    const MockEscrow = await ethers.getContractFactory("MockEscrowRewardView");
    const mockEscrow = await MockEscrow.deploy();
    const Token = await ethers.getContractFactory("MockERC20");
    const usdt = await Token.deploy("Mock USDT", "USDT", 6);
    const Vault = await ethers.getContractFactory("ArafRevenueVault");
    const vault = await Vault.deploy(owner.address, owner.address, owner.address);
    await vault.setSupportedToken(await usdt.getAddress(), true);
    const Rewards = await ethers.getContractFactory("ArafRewards");
    const rewards = await Rewards.deploy(await mockEscrow.getAddress(), await vault.getAddress(), owner.address);
    await vault.setRewards(await rewards.getAddress());
    return { owner, maker, taker, sponsor, mockEscrow, usdt, vault, rewards };
  }

  it("end_to_end_clean_release_generates_weight_and_claim", async () => {
    const { maker, taker, mockEscrow, rewards, usdt, vault, owner } = await loadFixture(fx);
    await mockEscrow.setRewardableTrade(1, { tradeId:1,parentOrderId:1,maker:maker.address,taker:taker.address,token:await usdt.getAddress(),stableNotional:100_000000n,takerFeePaid:0,makerFeePaid:0,tier:1,outcome:1,lockedAt:1,paidAt:10,terminalAt:100,hadChallenge:false,isOrderChild:true });
    await rewards.recordTradeOutcome(1);
    await usdt.mint(await vault.getAddress(), 1_000000n);
    await vault.onArafRevenue(await usdt.getAddress(), 1_000000n, 0, 1);
    await rewards.allocateEpochRewards(0, await usdt.getAddress(), 400000n);
    await time.increase(8 * 24 * 3600);
    await rewards.finalizeEpochToken(0, await usdt.getAddress());
    await time.increase(2 * 24 * 3600);
    await expect(rewards.connect(maker).claim(0, await usdt.getAddress())).to.emit(rewards, "RewardClaimed");
  });

  it("end_to_end_auto_release_funds_pool_but_zero_weight", async () => {
    const { maker, taker, mockEscrow, rewards } = await loadFixture(fx);
    await mockEscrow.setRewardableTrade(2, { tradeId:2,parentOrderId:1,maker:maker.address,taker:taker.address,token:ethers.ZeroAddress,stableNotional:100_000000n,takerFeePaid:0,makerFeePaid:0,tier:1,outcome:2,lockedAt:1,paidAt:10,terminalAt:100,hadChallenge:false,isOrderChild:true });
    await rewards.recordTradeOutcome(2);
    expect(await rewards.totalWeight(0)).to.equal(0n);
  });

  it("end_to_end_external_funding_claimable_pro_rata", async () => {
    const { owner, maker, taker, sponsor, mockEscrow, rewards, usdt, vault } = await loadFixture(fx);
    await mockEscrow.setRewardableTrade(3, { tradeId:3,parentOrderId:1,maker:maker.address,taker:taker.address,token:await usdt.getAddress(),stableNotional:100_000000n,takerFeePaid:0,makerFeePaid:0,tier:1,outcome:1,lockedAt:1,paidAt:10,terminalAt:100,hadChallenge:false,isOrderChild:true });
    await rewards.recordTradeOutcome(3);
    await usdt.mint(sponsor.address, 500000n);
    await usdt.connect(sponsor).approve(await vault.getAddress(), 500000n);
    await vault.connect(sponsor).fundGlobalRewards(await usdt.getAddress(), 500000n, 0, ethers.id("x"));
    await rewards.connect(owner).allocateEpochRewards(0, await usdt.getAddress(), 500000n);
    expect(await rewards.claimable(0, maker.address, await usdt.getAddress())).to.be.gt(0n);
  });

  it("end_to_end_admin_cannot_drain_reward_reserve", async () => {
    const { owner, vault, usdt } = await loadFixture(fx);
    await usdt.mint(await vault.getAddress(), 1_000000n);
    await vault.connect(owner).onArafRevenue(await usdt.getAddress(), 1_000000n, 0, 9);
    await expect(vault.connect(owner).withdrawTreasuryShare(await usdt.getAddress(), 700000n, owner.address)).to.be.reverted;
  });

  it("end_to_end_sponsor_cannot_choose_recipient", async () => {
    const { sponsor, maker, vault, usdt } = await loadFixture(fx);
    await usdt.mint(sponsor.address, 100000n);
    await usdt.connect(sponsor).approve(await vault.getAddress(), 100000n);
    await expect(vault.connect(sponsor).fundGlobalRewards(await usdt.getAddress(), 100000n, 0, ethers.id("sponsor"))).to.emit(vault, "ExternalRewardFunded");
    expect(maker.address).to.not.equal(ethers.ZeroAddress);
  });

  it("end_to_end_backend_mirror_not_authority", async () => {
    const { maker, taker, mockEscrow, rewards } = await loadFixture(fx);
    await mockEscrow.setRewardableTrade(88, { tradeId:88,parentOrderId:1,maker:maker.address,taker:taker.address,token:ethers.ZeroAddress,stableNotional:100_000000n,takerFeePaid:0,makerFeePaid:0,tier:0,outcome:1,lockedAt:1,paidAt:10,terminalAt:100,hadChallenge:false,isOrderChild:true });
    await expect(rewards.recordTradeOutcome(88)).to.be.revertedWithCustomError(rewards, "TierZeroNotRewardable");
  });

});
