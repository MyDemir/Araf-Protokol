const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafRewards dust sweep claim window", function () {
  const DECIMALS = 6;
  const OUTCOME = {
    NONE: 0,
    CLEAN_RELEASE: 1,
    AUTO_RELEASE: 2,
    MUTUAL_CANCEL: 3,
    PARTIAL_SETTLEMENT: 4,
    DISPUTED_RELEASE: 5,
    BURNED: 6,
  };

  async function deployFixture() {
    const [owner, maker, taker] = await ethers.getSigners();

    const MockEscrow = await ethers.getContractFactory("MockEscrowRewardView");
    const mockEscrow = await MockEscrow.deploy();

    const Vault = await ethers.getContractFactory("ArafRevenueVault");
    const vault = await Vault.deploy(owner.address, owner.address, owner.address);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock USDT", "USDT", DECIMALS);
    await vault.connect(owner).setSupportedToken(await token.getAddress(), true);

    const Rewards = await ethers.getContractFactory("ArafRewards");
    const rewards = await Rewards.deploy(await mockEscrow.getAddress(), await vault.getAddress(), owner.address);
    await vault.connect(owner).setRewards(await rewards.getAddress());

    return { owner, maker, taker, mockEscrow, vault, token, rewards };
  }

  function mkTrade({ tradeId, maker, taker }) {
    return {
      tradeId,
      parentOrderId: 1,
      maker,
      taker,
      token: "0x0000000000000000000000000000000000000001",
      stableNotional: 1,
      takerFeePaid: 0,
      makerFeePaid: 0,
      tier: 1,
      outcome: OUTCOME.CLEAN_RELEASE,
      lockedAt: 900,
      paidAt: 900,
      terminalAt: 1000,
      hadChallenge: false,
      isOrderChild: true,
    };
  }

  async function fundAndFinalizeEpochZero({ owner, mockEscrow, vault, token, rewards, maker, taker }) {
    await mockEscrow.setRewardableTrade(1, mkTrade({ tradeId: 1, maker: maker.address, taker: taker.address }));
    await rewards.connect(owner).recordTradeOutcome(1);

    await vault.connect(owner).noteEscrowRevenueIntent(await token.getAddress(), 12n, 0, 9001);
    await token.mint(await vault.getAddress(), 12n);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), 12n, 0, 9001);

    await rewards.connect(owner).allocateEpochRewards(0, await token.getAddress(), 3n);
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(0, await token.getAddress());
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
  }

  it("does not let owner sweep at claim start while legitimate claims remain", async function () {
    const ctx = await loadFixture(deployFixture);
    await fundAndFinalizeEpochZero(ctx);

    await expect(
      ctx.rewards.connect(ctx.owner).sweepEpochDust(0, await ctx.token.getAddress(), ctx.owner.address)
    ).to.be.revertedWithCustomError(ctx.rewards, "ClaimWindowActive");

    await ctx.rewards.connect(ctx.maker).claim(0, await ctx.token.getAddress());
    await ctx.rewards.connect(ctx.taker).claim(0, await ctx.token.getAddress());

    const claimedTotal = await ctx.rewards.epochClaimedAmount(0, await ctx.token.getAddress());
    const dust = 3n - claimedTotal;
    expect(dust).to.equal(1n);

    await expect(ctx.rewards.connect(ctx.owner).sweepEpochDust(0, await ctx.token.getAddress(), ctx.owner.address))
      .to.emit(ctx.rewards, "EpochDustSwept")
      .withArgs(0, await ctx.token.getAddress(), ctx.owner.address, dust);
  });
});
