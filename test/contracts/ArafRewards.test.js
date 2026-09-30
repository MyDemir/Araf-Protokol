const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployRevenueEscrow, pushRevenue } = require("./helpers/revenue");

describe("ArafRewards global epoch weight accounting", function () {
  const DECIMALS = 6;
  const NOTIONAL = ethers.parseUnits("100", DECIMALS);
  // [TR] Kontrat varsayılanları: 30 günlük dönem, 1 gün kayıt gecikmesi, 7 günlük talep penceresi.
  // [EN] Contract defaults: 30-day epoch, 1-day claim delay, 7-day claim window.
  const DAY = 24 * 3600;
  const EPOCH = 30 * DAY;
  const EPOCH_N = BigInt(EPOCH);
  // Talep penceresinin başına mutlak zamanla gider; göreli atlamalar 7 günlük pencereyi aşabilir.
  const gotoClaimOpen = (epoch) => time.increaseTo((Number(epoch) + 1) * EPOCH + DAY + 60);

  const OUTCOME = {
    NONE: 0,
    CLEAN_RELEASE: 1,
    AUTO_RELEASE: 2,
    MUTUAL_CANCEL: 3,
    PARTIAL_SETTLEMENT: 4,
    DISPUTED_RELEASE: 5,
    BURNED: 6,
    PAYMENT_WINDOW_EXPIRED: 7,
  };

  // [TR] Kayıt penceresi zamana bağlı (epoch sonu + claimDelay). Statik testlerdeki küçük zaman damgaları
  //      fixture anına kaydırılır; böylece "geçmiş epoch" yerine canlı epoch'a kayıt yapılır.
  // [EN] Recording is time-bound (epoch end + claimDelay). Small literal timestamps in static tests are
  //      shifted to the fixture time so records land in a live epoch rather than a long-closed one.
  let T0 = 0;
  const shift = (v) => (v > 0 && v < 1_000_000_000 ? v + T0 : v);

  async function deployFixture() {
    const [owner, caller, maker, taker, other] = await ethers.getSigners();
    T0 = await time.latest();

    const MockEscrow = await ethers.getContractFactory("MockEscrowRewardView");
    const mockEscrow = await MockEscrow.deploy();

    const Vault = await ethers.getContractFactory("ArafRevenueVault");
    const vault = await Vault.deploy(await (await deployRevenueEscrow()).getAddress(), owner.address, owner.address);
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
      lockedAt: paidAt > 0 ? shift(paidAt) - 60 : 0,
      paidAt: shift(paidAt),
      terminalAt: shift(terminalAt),
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
    const epoch = BigInt(trade.terminalAt) / (EPOCH_N);
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

    const epoch = BigInt(trade.terminalAt) / (EPOCH_N);
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

    const epoch = BigInt(trade.terminalAt) / (EPOCH_N);
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

    const epoch = BigInt(trade.terminalAt) / (EPOCH_N);
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

    const epoch = BigInt(trade.terminalAt) / (EPOCH_N);
    const expected = (NOTIONAL * 3_000n * 12_000n) / 100_000_000n;
    expect(await rewards.userWeight(epoch, maker.address)).to.equal(expected);
  });

  it("test_recordTradeOutcome_auto_release_zero_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 6, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.AUTO_RELEASE });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(6);

    const epoch = BigInt(trade.terminalAt) / (EPOCH_N);
    expect(await rewards.totalWeight(epoch)).to.equal(0n);
    expect(await rewards.recordedTrade(6)).to.equal(true);
  });

  it("test_recordTradeOutcome_burned_zero_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 7, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.BURNED });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(7);
    const epoch = BigInt(trade.terminalAt) / (EPOCH_N);
    expect(await rewards.totalWeight(epoch)).to.equal(0n);
  });

  it("test_recordTradeOutcome_mutual_cancel_zero_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 8, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.MUTUAL_CANCEL });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(8);
    const epoch = BigInt(trade.terminalAt) / (EPOCH_N);
    expect(await rewards.totalWeight(epoch)).to.equal(0n);
  });

  it("test_recordTradeOutcome_payment_window_expired_zero_weight_no_revert", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 70, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.PAYMENT_WINDOW_EXPIRED });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(70);
    const epoch = BigInt(trade.terminalAt) / (EPOCH_N);
    expect(await rewards.totalWeight(epoch)).to.equal(0n);
    expect(await rewards.recordedTrade(70)).to.equal(true);
  });

  it("test_recordTradeOutcomes_unknown_future_outcome_does_not_block_batch", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const clean = mkTrade({ tradeId: 71, maker: maker.address, taker: taker.address, tier: 1 });
    const expired = mkTrade({ tradeId: 72, maker: maker.address, taker: taker.address, tier: 1, outcome: OUTCOME.PAYMENT_WINDOW_EXPIRED });
    const unknown = mkTrade({ tradeId: 73, maker: maker.address, taker: taker.address, tier: 1, outcome: 200 });
    for (const t of [clean, expired, unknown]) await setTrade(mockEscrow, t);

    await rewards.connect(caller).recordTradeOutcomes([72, 73, 71]);

    const epoch = BigInt(clean.terminalAt) / (EPOCH_N);
    expect(await rewards.recordedTrade(71)).to.equal(true);
    expect(await rewards.recordedTrade(72)).to.equal(true);
    expect(await rewards.recordedTrade(73)).to.equal(true);
    // [TR] Yalnız temiz release ağırlık üretir. [EN] Only the clean release earns weight.
    expect(await rewards.userWeight(epoch, maker.address)).to.be.gt(0n);
    expect(await rewards.totalWeight(epoch)).to.equal((await rewards.userWeight(epoch, maker.address)) * 2n);
  });

  it("test_recordTradeOutcome_disputed_release_zero_weight", async function () {
    const { rewards, mockEscrow, caller, maker, taker } = await loadFixture(deployFixture);
    const trade = mkTrade({ tradeId: 9, maker: maker.address, taker: taker.address, tier: 2, outcome: OUTCOME.DISPUTED_RELEASE });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(9);
    const epoch = BigInt(trade.terminalAt) / (EPOCH_N);
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

    const epoch = BigInt(tradeA.terminalAt) / (EPOCH_N);
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

    const epoch = BigInt(trade1.terminalAt) / (EPOCH_N);
    const makerW = await rewards.userWeight(epoch, maker.address);
    const takerW = await rewards.userWeight(epoch, taker.address);
    const otherW = await rewards.userWeight(epoch, other.address);
    expect(await rewards.totalWeight(epoch)).to.equal(makerW + takerW + otherW);
  });

  it("test_allocateEpochRewards_onlyAuthorized", async function () {
    const { rewards, vault, token, owner, caller } = await loadFixture(deployFixture);
    await pushRevenue(vault, token, NOTIONAL, 0, 999, NOTIONAL);

    await expect(rewards.connect(caller).allocateEpochRewards(1, await token.getAddress(), 1))
      .to.be.revertedWithCustomError(rewards, "OwnableUnauthorizedAccount");
  });

  it("test_allocateEpochRewards_increases_epochPool", async function () {
    const { rewards, vault, token, owner } = await loadFixture(deployFixture);
    await pushRevenue(vault, token, NOTIONAL, 0, 1000, NOTIONAL);

    const alloc = (NOTIONAL * 4000n) / 10000n;
    await expect(rewards.connect(owner).allocateEpochRewards(2, await token.getAddress(), alloc))
      .to.emit(rewards, "EpochRewardAllocated");
    expect(await rewards.epochRewardPool(2, await token.getAddress())).to.equal(alloc);
  });

  it("test_claim_reverts_before_epoch_end", async function () {
    const { rewards, token, maker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const currentEpoch = Math.floor(now / (EPOCH));
    await gotoClaimOpen(currentEpoch);
    await rewards.finalizeEpochToken(currentEpoch, await token.getAddress());
    await expect(rewards.connect(maker).claim(currentEpoch + 1, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "EpochTokenNotFinalized");
  });

  it("test_claim_reverts_before_claimDelay", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const currentEpoch = Math.floor(now / epochDuration);
    const terminalAt = currentEpoch * epochDuration + 100;
    const trade = mkTrade({ tradeId: 18, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(18);

    await pushRevenue(vault, token, NOTIONAL, 0, 1001, NOTIONAL);
    await rewards.connect(owner).allocateEpochRewards(currentEpoch, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);

    const epochEndPlusOne = ((currentEpoch + 1) * epochDuration) + 1;
    const currentBlock = await ethers.provider.getBlock("latest");
    await ethers.provider.send("evm_increaseTime", [Math.max(1, epochEndPlusOne - Number(currentBlock.timestamp))]);
    await ethers.provider.send("evm_mine", []);
    // [TR] Kayıt penceresi (epoch sonu + claimDelay) kapanmadan finalize/claim açılmaz.
    // [EN] Finalize/claim stay closed until the recording window (epoch end + claimDelay) closes.
    await expect(rewards.connect(owner).finalizeEpochToken(currentEpoch, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "RecordingWindowOpen");
    await expect(rewards.connect(maker).claim(currentEpoch, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "EpochTokenNotFinalized");
  });

  it("test_claim_reverts_zero_totalWeight", async function () {
    const { rewards, token, maker, owner } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const epochEndPlusOne = ((epoch + 1) * epochDuration) + 1;
    await ethers.provider.send("evm_increaseTime", [Math.max(1, epochEndPlusOne - now)]);
    await ethers.provider.send("evm_mine", []);
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());
    await expect(rewards.connect(maker).claim(epoch, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "ZeroTotalWeight");
  });

  it("test_claim_reverts_zero_userWeight", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker, other } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    const trade = mkTrade({ tradeId: 19, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(19);
    await pushRevenue(vault, token, NOTIONAL, 0, 1002, NOTIONAL);
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);
    await gotoClaimOpen(epoch);
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());
    await time.increase(DAY);
    await expect(rewards.connect(other).claim(epoch, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "ZeroUserWeight");
  });

  it("test_claim_reverts_double_claim", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    const trade = mkTrade({ tradeId: 20, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 });
    await setTrade(mockEscrow, trade);
    await rewards.connect(caller).recordTradeOutcome(20);
    const alloc = (NOTIONAL * 4000n) / 10000n;
    await pushRevenue(vault, token, NOTIONAL, 0, 1003, NOTIONAL);
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), alloc);
    await gotoClaimOpen(epoch);
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());
    await time.increase(DAY);
    await rewards.connect(maker).claim(epoch, await token.getAddress());
    await expect(rewards.connect(maker).claim(epoch, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "AlreadyClaimed");
  });

  it("security_recordTradeOutcome_reverts_after_recording_window_closes", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker, other } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    await setTrade(mockEscrow, mkTrade({ tradeId: 40, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 }));
    await rewards.connect(caller).recordTradeOutcome(40);
    const alloc = (NOTIONAL * 4000n) / 10000n;
    await pushRevenue(vault, token, NOTIONAL, 0, 1040, NOTIONAL);
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), alloc);
    await gotoClaimOpen(epoch);
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await rewards.connect(maker).claim(epoch, await token.getAddress());

    // [TR] Kayıt penceresi zamanla kapandığı için claim sonrası aynı epoch'a geç ağırlık eklenemez (havuz aşımı engeli).
    //      Toplu kayıt da kapalı pencereyi sessizce atlar.
    // [EN] The recording window closes by time, so no late weight reaches an epoch once claims run (prevents
    //      pool overdraw). Batch recording silently skips the closed window as well.
    await setTrade(mockEscrow, mkTrade({ tradeId: 41, maker: other.address, taker: caller.address, tier: 1, terminalAt: terminalAt + 1, paidAt: terminalAt - 50 }));
    await expect(rewards.connect(caller).recordTradeOutcome(41))
      .to.be.revertedWithCustomError(rewards, "RecordingWindowClosed");
    await rewards.connect(caller).recordTradeOutcomes([41]);
    expect(await rewards.recordedTrade(41)).to.equal(false);

    await rewards.connect(taker).claim(epoch, await token.getAddress());
    expect(await rewards.epochClaimedAmount(epoch, await token.getAddress())).to.be.lte(alloc);
  });

  it("test_claim_distributes_global_pool_pro_rata", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker, other } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    const t1 = mkTrade({ tradeId: 21, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 });
    const t2 = mkTrade({ tradeId: 22, maker: other.address, taker: other.address, tier: 4, terminalAt, paidAt: terminalAt - 100 });
    await setTrade(mockEscrow, t1);
    await setTrade(mockEscrow, t2);
    await rewards.connect(caller).recordTradeOutcome(21);
    await rewards.connect(caller).recordTradeOutcome(22);

    await pushRevenue(vault, token, ethers.parseUnits("1000", DECIMALS), 0, 1004, ethers.parseUnits("1000", DECIMALS));
    const alloc = (ethers.parseUnits("1000", DECIMALS) * 4000n) / 10000n;
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), alloc);
    await gotoClaimOpen(epoch);
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());

    await time.increase(DAY);

    const tw = await rewards.totalWeight(epoch);
    const makerW = await rewards.userWeight(epoch, maker.address);
    const expectedMaker = (alloc * makerW) / tw;
    const before = await token.balanceOf(maker.address);
    await rewards.connect(maker).claim(epoch, await token.getAddress());
    const after = await token.balanceOf(maker.address);
    expect(after - before).to.equal(expectedMaker);
  });

  it("test_claim_transfers_token", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    const t = mkTrade({ tradeId: 23, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 });
    await setTrade(mockEscrow, t);
    await rewards.connect(caller).recordTradeOutcome(23);
    await pushRevenue(vault, token, NOTIONAL, 0, 1005, NOTIONAL);
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);
    await gotoClaimOpen(epoch);
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());
    await time.increase(DAY);
    const before = await token.balanceOf(maker.address);
    await rewards.connect(maker).claim(epoch, await token.getAddress());
    const after = await token.balanceOf(maker.address);
    expect(after).to.be.gt(before);
  });

  it("test_claim_marks_claimed_before_transfer", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    const t = mkTrade({ tradeId: 24, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 });
    await setTrade(mockEscrow, t);
    await rewards.connect(caller).recordTradeOutcome(24);
    await pushRevenue(vault, token, NOTIONAL, 0, 1006, NOTIONAL);
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);
    await gotoClaimOpen(epoch);
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());
    await time.increase(DAY);
    await rewards.connect(maker).claim(epoch, await token.getAddress());
    expect(await rewards.claimed(epoch, maker.address, await token.getAddress())).to.equal(true);
  });

  it("test_claimable_view_matches_claim_amount", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    const t = mkTrade({ tradeId: 25, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 });
    await setTrade(mockEscrow, t);
    await rewards.connect(caller).recordTradeOutcome(25);
    await pushRevenue(vault, token, NOTIONAL, 0, 1007, NOTIONAL);
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);
    await gotoClaimOpen(epoch);
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());
    await time.increase(DAY);
    const expected = await rewards.claimable(epoch, maker.address, await token.getAddress());
    const before = await token.balanceOf(maker.address);
    await rewards.connect(maker).claim(epoch, await token.getAddress());
    const after = await token.balanceOf(maker.address);
    expect(after - before).to.equal(expected);
  });

  it("test_external_funding_increases_claimable_amount", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    const t = mkTrade({ tradeId: 26, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 });
    await setTrade(mockEscrow, t);
    await rewards.connect(caller).recordTradeOutcome(26);

    const amount = ethers.parseUnits("500", DECIMALS);
    await token.mint(owner.address, amount);
    await token.connect(owner).approve(await vault.getAddress(), amount);
    await vault.connect(owner).fundGlobalRewards(await token.getAddress(), amount, epoch, ethers.id("ext-fund"));

    const beforeClaimable = await rewards.claimable(epoch, maker.address, await token.getAddress());
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), amount);
    const afterClaimable = await rewards.claimable(epoch, maker.address, await token.getAddress());
    expect(afterClaimable).to.be.gt(beforeClaimable);
  });

  it("security_finalize_is_permissionless_and_pulls_sponsor_and_product_funding_into_the_pool", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const tokenAddr = await token.getAddress();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    await setTrade(mockEscrow, mkTrade({ tradeId: 60, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 }));
    await rewards.connect(caller).recordTradeOutcomes([60]);

    const globalAmount = ethers.parseUnits("300", DECIMALS);
    const productAmount = ethers.parseUnits("200", DECIMALS);
    const productId = ethers.id("campaign-A");
    await vault.connect(owner).setProductPool(productId, true, "ipfs://campaign-A");
    await token.mint(owner.address, globalAmount + productAmount);
    await token.connect(owner).approve(await vault.getAddress(), globalAmount + productAmount);
    await vault.connect(owner).fundGlobalRewards(tokenAddr, globalAmount, epoch, ethers.id("sponsor"));
    await vault.connect(owner).fundProductRewards(productId, tokenAddr, productAmount, epoch, ethers.id("product"));

    // [TR] Geçmiş epoch'a fon gönderilemez (fon kimseye ulaşmadan kasada kalırdı).
    // [EN] Funding a past epoch is rejected (it would sit in the vault and reach no one).
    await token.mint(owner.address, 1n);
    await token.connect(owner).approve(await vault.getAddress(), 1n);
    await expect(vault.connect(owner).fundGlobalRewards(tokenAddr, 1n, epoch - 1, ethers.id("stale")))
      .to.be.revertedWithCustomError(vault, "StaleTargetEpoch");

    await gotoClaimOpen(epoch);
    // [TR] Owner olmayan biri finalize eder; epoch'a hedeflenmiş tüm sponsor/ürün fonu havuza girer.
    // [EN] A non-owner finalizes; all sponsor/product funding targeted at the epoch enters the pool.
    await rewards.connect(caller).finalizeEpochToken(epoch, tokenAddr);
    expect(await rewards.epochRewardPool(epoch, tokenAddr)).to.equal(globalAmount + productAmount);
    expect(await vault.externalFundingByEpoch(epoch, tokenAddr)).to.equal(0n);
  });

  it("security_owner_pause_cannot_block_recording_or_claims", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const tokenAddr = await token.getAddress();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    await setTrade(mockEscrow, mkTrade({ tradeId: 61, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 }));

    const amount = ethers.parseUnits("100", DECIMALS);
    await token.mint(owner.address, amount);
    await token.connect(owner).approve(await vault.getAddress(), amount);
    await vault.connect(owner).fundGlobalRewards(tokenAddr, amount, epoch, ethers.id("pause-case"));

    await rewards.connect(owner).pause();
    await vault.connect(owner).pause();
    await rewards.connect(caller).recordTradeOutcome(61);

    await gotoClaimOpen(epoch);
    await rewards.connect(caller).finalizeEpochToken(epoch, tokenAddr);
    await expect(rewards.connect(maker).claim(epoch, tokenAddr)).to.emit(rewards, "RewardClaimed");
    await expect(rewards.connect(taker).claim(epoch, tokenAddr)).to.emit(rewards, "RewardClaimed");
  });

  it("test_rewardReserve_cannot_be_admin_drained", async function () {
    const { vault, token, owner } = await loadFixture(deployFixture);
    await pushRevenue(vault, token, NOTIONAL, 0, 2000, NOTIONAL);
    await expect(
      vault.connect(owner).withdrawTreasuryShare(await token.getAddress(), (NOTIONAL * 7000n) / 10000n, owner.address)
    ).to.be.revertedWithCustomError(vault, "InsufficientTreasuryReserve");
  });

  it("test_accounting_invariant_after_claims", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    const terminalAt = epoch * epochDuration + 100;
    const t = mkTrade({ tradeId: 27, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 });
    await setTrade(mockEscrow, t);
    await rewards.connect(caller).recordTradeOutcome(27);
    await pushRevenue(vault, token, NOTIONAL, 0, 3000, NOTIONAL);
    const alloc = (NOTIONAL * 4000n) / 10000n;
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), alloc);
    await gotoClaimOpen(epoch);
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());
    await time.increase(DAY);
    await rewards.connect(maker).claim(epoch, await token.getAddress());
    await rewards.connect(taker).claim(epoch, await token.getAddress());
    const bal = await token.balanceOf(await rewards.getAddress());
    expect(bal).to.be.gte(0n);
    expect(bal).to.be.lte(alloc);
  });

  it("test_dust_policy_sweep_preserves_epoch_pool_conservation", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker, other } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epochDuration = EPOCH;
    const epoch = Math.floor(now / epochDuration);
    await setTrade(mockEscrow, mkTrade({ tradeId: 31, maker: maker.address, taker: taker.address, tier: 1, stableNotional: ethers.parseUnits("100", DECIMALS), terminalAt: epoch * epochDuration + 100, paidAt: epoch * epochDuration }));
    await setTrade(mockEscrow, mkTrade({ tradeId: 32, maker: maker.address, taker: other.address, tier: 1, stableNotional: ethers.parseUnits("100", DECIMALS), terminalAt: epoch * epochDuration + 100, paidAt: epoch * epochDuration }));
    await rewards.connect(caller).recordTradeOutcome(31);
    await rewards.connect(caller).recordTradeOutcome(32);

    await pushRevenue(vault, token, 20n, 0, 4000, 20n);
    const epochPool = 5n;
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), epochPool);

    await gotoClaimOpen(epoch);
    await rewards.connect(owner).finalizeEpochToken(epoch, await token.getAddress());
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);

    const c1 = await rewards.claimable(epoch, maker.address, await token.getAddress());
    const c2 = await rewards.claimable(epoch, taker.address, await token.getAddress());
    const c3 = await rewards.claimable(epoch, other.address, await token.getAddress());
    expect(c1 + c2 + c3).to.be.lt(epochPool);

    await rewards.connect(maker).claim(epoch, await token.getAddress());
    await rewards.connect(taker).claim(epoch, await token.getAddress());
    await rewards.connect(other).claim(epoch, await token.getAddress());
    await expect(rewards.connect(maker).claim(epoch, await token.getAddress())).to.be.reverted;

    const claimedTotal = await rewards.epochClaimedAmount(epoch, await token.getAddress());
    const dust = epochPool - claimedTotal;
    expect(dust).to.be.gt(0n);
    // [TR] Kalan pay alıcı seçilmeden içinde bulunulan epoch havuzuna devredilir; çağıran kim olursa olsun.
    // [EN] The remainder rolls into the current epoch pool with no recipient choice, whoever calls it.
    const targetEpoch = BigInt(Math.floor((await time.latest() + 1) / epochDuration));
    await expect(rewards.connect(caller).sweepEpochDust(epoch, await token.getAddress()))
      .to.emit(rewards, "EpochDustRolledOver")
      .withArgs(epoch, await token.getAddress(), targetEpoch, dust);
    await expect(rewards.connect(caller).sweepEpochDust(epoch, await token.getAddress())).to.be.reverted;
    expect(await rewards.epochRewardPool(targetEpoch, await token.getAddress())).to.equal(dust);
    expect(claimedTotal + dust).to.equal(epochPool);
  });

  it("policy_monthly_epoch_with_one_week_claim_window", async function () {
    const { rewards } = await loadFixture(deployFixture);
    expect(await rewards.epochDuration()).to.equal(BigInt(EPOCH));
    expect(await rewards.claimDelay()).to.equal(BigInt(DAY));
    expect(await rewards.claimWindow()).to.equal(BigInt(7 * DAY));
    // [TR] Pencere (gecikme + talep) dönemden kısa: bir dönemin talebi, sonraki dönemin talebi açılmadan kapanır.
    // [EN] Delay + window is shorter than an epoch, so at most one epoch is claimable at any time.
    expect(BigInt(DAY) + (await rewards.claimWindow())).to.be.lt(await rewards.epochDuration());
  });

  it("claim_window_closes_after_seven_days", async function () {
    const { rewards, vault, token, mockEscrow, owner, caller, maker, taker } = await loadFixture(deployFixture);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const epoch = Math.floor(now / EPOCH);
    const terminalAt = epoch * EPOCH + 100;
    await setTrade(mockEscrow, mkTrade({ tradeId: 90, maker: maker.address, taker: taker.address, tier: 1, terminalAt, paidAt: terminalAt - 100 }));
    await rewards.connect(caller).recordTradeOutcome(90);
    await pushRevenue(vault, token, NOTIONAL, 0, 9090, NOTIONAL);
    await rewards.connect(owner).allocateEpochRewards(epoch, await token.getAddress(), (NOTIONAL * 4000n) / 10000n);
    await gotoClaimOpen(epoch);
    await rewards.connect(caller).finalizeEpochToken(epoch, await token.getAddress());
    await rewards.connect(maker).claim(epoch, await token.getAddress());
    // Last second of the window still works for the taker; one second later it is closed.
    const windowEnd = (epoch + 1) * EPOCH + DAY + 7 * DAY;
    await time.increaseTo(windowEnd + 1);
    await expect(rewards.connect(taker).claim(epoch, await token.getAddress()))
      .to.be.revertedWithCustomError(rewards, "ClaimWindowClosed");
  });
});
