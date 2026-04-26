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

    const Rewards = await ethers.getContractFactory("ArafRewards");
    const rewards = await Rewards.deploy(await mockEscrow.getAddress(), await vault.getAddress(), owner.address);

    return { rewards, mockEscrow, owner, caller, maker, taker, other };
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
});
