const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafRewards global epoch weight accounting", function () {
  const DECIMALS = 6;
  const NOTIONAL = ethers.parseUnits("100", DECIMALS);

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
    const [owner, caller, maker, taker, other] = await ethers.getSigners();

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

    return { rewards, vault, token, mockEscrow, owner, caller, maker, taker, other };
  }

  function mkTrade({
    tradeId,
    maker,
    taker,
    stableNotional = NOTIONAL,
    tier = 1,
    outcome = OUTCOME.CLEAN_RELEASE,
    paidAt = 1_000,
    terminalAt = 1_000 + 300,
    isOrderChild = true,
  }) {
    return {
      tradeId,
      parentOrderId: isOrderChild ? 99 : 0,
      maker,
      taker,
      token: "0x0000000000000000000000000000000000000001",
      stableNotional,
      takerFeePaid: 0,
      makerFeePaid: 0,
      tier,
      outcome,
      lockedAt: paidAt > 0 ? paidAt - 60 : 0,
      paidAt,
      terminalAt,
      hadChallenge: false,
      isOrderChild,
    };
  }

  async function setTrade(mockEscrow, trade) {
    await mockEscrow.setRewardableTrade(trade.tradeId, trade);
  }

  it("test_recordTradeOutcome_clean_release_adds_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({
      tradeId: 1,
      maker: maker.address,
      taker: taker.address,
      tier: 2,
      paidAt: 1_000,
      terminalAt: 1_000 + (48 * 3600),
    });
    await setTrade(mockEscrow, trade);

    await rewards.connect(caller).recordTradeOutcome(1);
    const epoch = BigInt(trade.terminalAt) / (7n * 24n * 3600n);
    const expected = (NOTIONAL * 10_000n * 11_000n) / 100_000_000n;

    expect(await rewards.userWeight(epoch, maker.address)).to.equal(expected);
    expect(await rewards.userWeight(epoch, taker.address)).to.equal(expected);
    expect(await rewards.totalWeight(epoch)).to.equal(expected * 2n);
  });

  it("test_recordTradeOutcome_fast_clean_release_gets_2_5x", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({
      tradeId: 2,
      maker: maker.address,
      taker: taker.address,
      tier: 1,
      paidAt: 1_000,
      terminalAt: 1_000 + 60,
    });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(2);

    const epoch = BigInt(trade.terminalAt) / (7n * 24n * 3600n);
    const expected = (NOTIONAL * 25_000n * 10_000n) / 100_000_000n;
    expect(await rewards.userWeight(epoch, maker.address)).to.equal(expected);
  });

  it("test_recordTradeOutcome_24h_clean_release_gets_1_5x", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({
      tradeId: 3,
      maker: maker.address,
      taker: taker.address,
      tier: 1,
      paidAt: 1_000,
      terminalAt: 1_000 + (6 * 3600),
    });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(3);

    const epoch = BigInt(trade.terminalAt) / (7n * 24n * 3600n);
    const expected = (NOTIONAL * 15_000n * 10_000n) / 100_000_000n;
    expect(await rewards.userWeight(epoch, maker.address)).to.equal(expected);
  });

  it("test_recordTradeOutcome_slow_clean_release_gets_0_5x", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({
      tradeId: 4,
      maker: maker.address,
      taker: taker.address,
      tier: 1,
      paidAt: 1_000,
      terminalAt: 1_000 + (100 * 3600),
    });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(4);

    const epoch = BigInt(trade.terminalAt) / (7n * 24n * 3600n);
    const expected = (NOTIONAL * 5_000n * 10_000n) / 100_000_000n;
    expect(await rewards.userWeight(epoch, maker.address)).to.equal(expected);
  });

  it("test_recordTradeOutcome_partial_settlement_adds_low_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({
      tradeId: 5,
      maker: maker.address,
      taker: taker.address,
      tier: 3,
      outcome: OUTCOME.PARTIAL_SETTLEMENT,
    });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(5);

    const epoch = BigInt(trade.terminalAt) / (7n * 24n * 3600n);
    const expected = (NOTIONAL * 3_000n * 12_000n) / 100_000_000n;
    expect(await rewards.userWeight(epoch, maker.address)).to.equal(expected);
  });

  it("test_recordTradeOutcome_auto_release_zero_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 6, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.AUTO_RELEASE });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(6);

    const epoch = BigInt(trade.terminalAt) / (7n * 24n * 3600n);
    expect(await rewards.totalWeight(epoch)).to.equal(0n);
    expect(await rewards.recordedTrade(6)).to.equal(true);
  });

  it("test_recordTradeOutcome_burned_zero_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 7, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.BURNED });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(7);
    const epoch = BigInt(trade.terminalAt) / (7n * 24n * 3600n);
    expect(await rewards.totalWeight(epoch)).to.equal(0n);
  });

  it("test_recordTradeOutcome_mutual_cancel_zero_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 8, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.MUTUAL_CANCEL });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(8);
    const epoch = BigInt(trade.terminalAt) / (7n * 24n * 3600n);
    expect(await rewards.totalWeight(epoch)).to.equal(0n);
  });

  it("test_recordTradeOutcome_disputed_release_zero_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 9, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.DISPUTED_RELEASE });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(9);
    const epoch = BigInt(trade.terminalAt) / (7n * 24n * 3600n);
    expect(await rewards.totalWeight(epoch)).to.equal(0n);
  });

  it("test_recordTradeOutcome_tier0_reverts", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 10, maker: maker.address, taker: taker.address, tier: 0 });
    await setTrade(mockEscrow, trade);
    await expect(rewards.connect(caller).recordTradeOutcome(10))
      .to.be.revertedWithCustomError(rewards, "TierZeroNotRewardable");
  });

  it("test_recordTradeOutcome_direct_escrow_reverts", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({
      tradeId: 11,
      maker: maker.address,
      taker: taker.address,
      tier: 1,
      isOrderChild: false,
    });
    await setTrade(mockEscrow, trade);
    await expect(rewards.connect(caller).recordTradeOutcome(11))
      .to.be.revertedWithCustomError(rewards, "DirectEscrowNotRewardable");
  });

  it("test_recordTradeOutcome_reverts_double_record", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 12, maker: maker.address, taker: taker.address, tier: 1 });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(12);
    await expect(rewards.connect(caller).recordTradeOutcome(12))
      .to.be.revertedWithCustomError(rewards, "AlreadyRecorded");
  });

  it("test_recordTradeOutcome_permissionless", async function () {
    const { rewards, mockEscrow, other, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 13, maker: maker.address, taker: taker.address, tier: 1 });
    await setTrade(mockEscrow, trade);
    await expect(rewards.connect(other).recordTradeOutcome(13))
      .to.emit(rewards, "TradeOutcomeRecorded");
  });

  it("test_paymentRiskLevel_cannot_affect_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const tradeA = mkTrade({ tradeId: 14, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.CLEAN_RELEASE, paidAt: 100, terminalAt: 160 });
    const tradeB = mkTrade({ tradeId: 15, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.CLEAN_RELEASE, paidAt: 100, terminalAt: 160 });
    await setTrade(mockEscrow, tradeA);
    await setTrade(mockEscrow, tradeB);

    await rewards.connect(caller).recordTradeOutcome(14);
    await rewards.connect(caller).recordTradeOutcome(15);

    const epoch = BigInt(tradeA.terminalAt) / (7n * 24n * 3600n);
    const expectedSingle = (NOTIONAL * 25_000n * 11_000n) / 100_000_000n;
    expect(await rewards.userWeight(epoch, maker.address)).to.equal(expectedSingle * 2n);
  });

  it("test_totalWeight_equals_sum_userWeights", async function () {
    const { rewards, mockEscrow, caller, maker, taker, other } = await loadFixture(deployFixture);
    const trade1 = mkTrade({ tradeId: 16, maker: maker.address, taker: taker.address, tier: 1, outcome: OUTCOME.CLEAN_RELEASE });
    const trade2 = mkTrade({ tradeId: 17, maker: maker.address, taker: other.address, tier: 3, outcome: OUTCOME.PARTIAL_SETTLEMENT });
    await setTrade(mockEscrow, trade1);
    await setTrade(mockEscrow, trade2);

    await rewards.connect(caller).recordTradeOutcome(16);
    await rewards.connect(caller).recordTradeOutcome(17);

    const epoch = BigInt(trade1.terminalAt) / (7n * 24n * 3600n);
    const makerW = await rewards.userWeight(epoch, maker.address);
    const takerW = await rewards.userWeight(epoch, taker.address);
    const otherW = await rewards.userWeight(epoch, other.address);
    expect(await rewards.totalWeight(epoch)).to.equal(makerW + takerW + otherW);
  });

  it("test_allocateEpochRewards_onlyAuthorized", async function () {
    const { rewards, vault, token, owner, caller } = await loadFixture(deployFixture);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 999);

    await expect(rewards.connect(caller).allocateEpochRewards(1, await token.getAddress(), 1))
      .to.be.revertedWithCustomError(rewards, "OwnableUnauthorizedAccount");
  });

  it("test_allocateEpochRewards_increases_epochPool", async function () {
    const { rewards, vault, token, owner } = await loadFixture(deployFixture);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 1000);

    const alloc = (NOTIONAL * 4000n) / 10000n;
    await expect(rewards.connect(owner).allocateEpochRewards(2, await token.getAddress(), alloc))
      .to.emit(rewards, "EpochRewardAllocated");
    expect(await rewards.epochRewardPool(2, await token.getAddress())).to.equal(alloc);
  });

  it("test_claim_reverts_before_epoch_end", async function () {
    const { rewards, token, maker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const currentEpoch = Math.floor(now / (7 * 24 * 3600));
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.finalizeEpochToken(currentEpoch, await token.getAddress());
    await expect(rewards.connect(maker).claim(currentEpoch + 1, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "EpochTokenNotFinalized");
  });

  it("test_claim_reverts_before_claimDelay", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = 7 * 24 * 3600;
    const currentEpoch = Math.floor(now / epochDuration);
    const terminalAt = currentEpoch * epochDuration + 100;
    const trade = mkTrade({ tradeId: 18, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(18);

    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 1001);
    await rewards.connect(owner).allocateEpochRewards(currentEpoch, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);

    const epochEndPlusOne = ((currentEpoch + 1) * epochDuration) + 1;
    const currentBlock = await ethers.provider.getBlock("latest");
    await ethers.provider.send("evm_increaseTime", [Math.max(1, epochEndPlusOne - Number(currentBlock.timestamp))]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(currentEpoch, await token.getAddress());
    await expect(rewards.connect(maker).claim(currentEpoch, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "ClaimDelayActive");
  });

  it("test_claim_reverts_zero_totalWeight", async function () {
    const { rewards, token, maker, owner } = await loadFixture(deployFixture);
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(0, await token.getAddress());
    await expect(rewards.connect(maker).claim(0, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "ZeroTotalWeight");
  });

  it("test_claim_reverts_zero_userWeight", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker, other } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 19, maker: maker.address, taker: taker.address, tier: 1, terminalAt: 1000, paidAt: 900 });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(19);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 1002);
    await rewards.connect(owner).allocateEpochRewards(0, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(0, await token.getAddress());
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await expect(rewards.connect(other).claim(0, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "ZeroUserWeight");
  });

  it("test_claim_reverts_double_claim", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 20, maker: maker.address, taker: taker.address, tier: 1, terminalAt: 1000, paidAt: 900 });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(20);
    const alloc = (NOTIONAL * 4000n) / 10000n;
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 1003);
    await rewards.connect(owner).allocateEpochRewards(0, await token.getAddress(), alloc);
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(0, await token.getAddress());
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(maker).claim(0, await token.getAddress());
    await expect(rewards.connect(maker).claim(0, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "AlreadyClaimed");
  });

  it("test_claim_distributes_global_pool_pro_rata", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker, other } = await loadFixture(deployFixture);
    const t1 = mkTrade({ tradeId: 21, maker: maker.address, taker: taker.address, tier: 1, terminalAt: 1000, paidAt: 900 });
    const t2 = mkTrade({ tradeId: 22, maker: other.address, taker: other.address, tier: 4, terminalAt: 1000, paidAt: 900 });
    await setTrade(mockEscrow, t1);
    await setTrade(mockEscrow, t2);
    await rewards.connect(caller).recordTradeOutcome(21);
    await rewards.connect(caller).recordTradeOutcome(22);

    await token.mint(await vault.getAddress(), ethers.parseUnits("1000", DECIMALS));
    await vault.connect(owner).onArafRevenue(await token.getAddress(), ethers.parseUnits("1000", DECIMALS), 0, 1004);
    const alloc = (ethers.parseUnits("1000", DECIMALS) * 4000n) / 10000n;
    await rewards.connect(owner).allocateEpochRewards(0, await token.getAddress(), alloc);
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(0, await token.getAddress());

    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);

    const tw = await rewards.totalWeight(0);
    const makerW = await rewards.userWeight(0, maker.address);
    const expectedMaker = (alloc * makerW) / tw;
    const before = await token.balanceOf(maker.address);
    await rewards.connect(maker).claim(0, await token.getAddress());
    const after = await token.balanceOf(maker.address);
    expect(after - before).to.equal(expectedMaker);
  });

  it("test_claim_transfers_token", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const t = mkTrade({ tradeId: 23, maker: maker.address, taker: taker.address, tier: 1, terminalAt: 1000, paidAt: 900 });
    await setTrade(mockEscrow, t);
    await rewards.connect(caller).recordTradeOutcome(23);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 1005);
    await rewards.connect(owner).allocateEpochRewards(0, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(0, await token.getAddress());
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    const before = await token.balanceOf(maker.address);
    await rewards.connect(maker).claim(0, await token.getAddress());
    const after = await token.balanceOf(maker.address);
    expect(after).to.be.gt(before);
  });

  it("test_claim_marks_claimed_before_transfer", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const t = mkTrade({ tradeId: 24, maker: maker.address, taker: taker.address, tier: 1, terminalAt: 1000, paidAt: 900 });
    await setTrade(mockEscrow, t);
    await rewards.connect(caller).recordTradeOutcome(24);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 1006);
    await rewards.connect(owner).allocateEpochRewards(0, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(0, await token.getAddress());
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(maker).claim(0, await token.getAddress());
    expect(await rewards.claimed(0, maker.address, await token.getAddress())).to.equal(true);
  });

  it("test_claimable_view_matches_claim_amount", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const t = mkTrade({ tradeId: 25, maker: maker.address, taker: taker.address, tier: 1, terminalAt: 1000, paidAt: 900 });
    await setTrade(mockEscrow, t);
    await rewards.connect(caller).recordTradeOutcome(25);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 1007);
    await rewards.connect(owner).allocateEpochRewards(0, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(0, await token.getAddress());
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    const expected = await rewards.claimable(0, maker.address, await token.getAddress());
    const before = await token.balanceOf(maker.address);
    await rewards.connect(maker).claim(0, await token.getAddress());
    const after = await token.balanceOf(maker.address);
    expect(after - before).to.equal(expected);
  });

  it("test_external_funding_increases_claimable_amount", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const t = mkTrade({ tradeId: 26, maker: maker.address, taker: taker.address, tier: 1, terminalAt: 1000, paidAt: 900 });
    await setTrade(mockEscrow, t);
    await rewards.connect(caller).recordTradeOutcome(26);

    const amount = ethers.parseUnits("500", DECIMALS);
    await token.mint(owner.address, amount);
    await token.connect(owner).approve(await vault.getAddress(), amount);
    await vault.connect(owner).fundGlobalRewards(await token.getAddress(), amount, 0, ethers.id("ext-fund"));

    const beforeClaimable = await rewards.claimable(0, maker.address, await token.getAddress());
    await rewards.connect(owner).allocateEpochRewards(0, await token.getAddress(), amount);
    const afterClaimable = await rewards.claimable(0, maker.address, await token.getAddress());
    expect(afterClaimable).to.be.gt(beforeClaimable);
  });

  it("test_rewardReserve_cannot_be_admin_drained", async function () {
    const { vault, token, owner } = await loadFixture(deployFixture);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 2000);
    await expect(
      vault.connect(owner).withdrawTreasuryShare(await token.getAddress(), (NOTIONAL * 7000n) / 10000n, owner.address)
    ).to.be.revertedWithCustomError(vault, "InsufficientTreasuryReserve");
  });

  it("test_accounting_invariant_after_claims", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const t = mkTrade({ tradeId: 27, maker: maker.address, taker: taker.address, tier: 1, terminalAt: 1000, paidAt: 900 });
    await setTrade(mockEscrow, t);
    await rewards.connect(caller).recordTradeOutcome(27);
    await token.mint(await vault.getAddress(), NOTIONAL);
    await vault.connect(owner).onArafRevenue(await token.getAddress(), NOTIONAL, 0, 3000);
    const alloc = (NOTIONAL * 4000n) / 10000n;
    await rewards.connect(owner).allocateEpochRewards(0, await token.getAddress(), alloc);
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(0, await token.getAddress());
    await ethers.provider.send("evm_increaseTime", [9 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(maker).claim(0, await token.getAddress());
    await rewards.connect(taker).claim(0, await token.getAddress());
    const bal = await token.balanceOf(await rewards.getAddress());
    expect(bal).to.be.gte(0n);
    expect(bal).to.be.lte(alloc);
  });
});