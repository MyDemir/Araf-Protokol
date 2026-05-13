const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafEscrow protocol revenue classification", function () {
  const USDT_DECIMALS = 6;
  const TRADE_AMOUNT = ethers.parseUnits("100", USDT_DECIMALS);
  const MIN_FILL = ethers.parseUnits("50", USDT_DECIMALS);
  const INITIAL_BAL = ethers.parseUnits("100000", USDT_DECIMALS);
  const TIER_MAX_AMOUNTS_BASE_UNIT_6 = [
    ethers.parseUnits("150", USDT_DECIMALS),
    ethers.parseUnits("1500", USDT_DECIMALS),
    ethers.parseUnits("7500", USDT_DECIMALS),
    ethers.parseUnits("30000", USDT_DECIMALS),
  ];
  const BPS_DENOMINATOR = 10_000n;

  const REVENUE_KIND = {
    MANUAL_RELEASE_FEE: 0n,
    AUTO_RELEASE_FEE_OR_PENALTY: 1n,
    PARTIAL_SETTLEMENT_FEE: 2n,
    DISPUTED_RELEASE_FEE: 3n,
    BURN_RESIDUAL: 4n,
  };

  function makeRef(label) {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  async function firstEventArgs(receipt, iface, eventName) {
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === eventName) return parsed.args;
      } catch (_) {
        // noop
      }
    }
    throw new Error(`event ${eventName} not found`);
  }

  async function eventsByName(receipt, iface, eventName) {
    const out = [];
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === eventName) out.push(parsed.args);
      } catch (_) {
        // noop
      }
    }
    return out;
  }

  async function deployFixture() {
    const [owner, treasury, maker, taker] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);

    const Escrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await Escrow.deploy(treasury.address);

    const tokenAddress = await token.getAddress();
    await escrow.connect(owner).setTokenConfig(
      tokenAddress,
      true,
      true,
      true,
      USDT_DECIMALS,
      TIER_MAX_AMOUNTS_BASE_UNIT_6
    );

    for (const wallet of [maker, taker]) {
      await token.mint(wallet.address, INITIAL_BAL);
      await token.connect(wallet).approve(await escrow.getAddress(), ethers.MaxUint256);
      await escrow.connect(wallet).registerWallet();
    }

    await time.increase(7 * 24 * 3600 + 1);
    return { escrow, token, owner, treasury, maker, taker };
  }

  async function deployWithRevenueTreasuryFixture() {
    const [owner, maker, taker] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);
    const Receiver = await ethers.getContractFactory("MockRevenueReceiver");
    const receiver = await Receiver.deploy();

    const Escrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await Escrow.deploy(await receiver.getAddress());

    const tokenAddress = await token.getAddress();
    await escrow.connect(owner).setTokenConfig(
      tokenAddress,
      true,
      true,
      true,
      USDT_DECIMALS,
      TIER_MAX_AMOUNTS_BASE_UNIT_6
    );

    for (const wallet of [maker, taker]) {
      await token.mint(wallet.address, INITIAL_BAL);
      await token.connect(wallet).approve(await escrow.getAddress(), ethers.MaxUint256);
      await escrow.connect(wallet).registerWallet();
    }
    await time.increase(7 * 24 * 3600 + 1);
    return { escrow, token, receiver, maker, taker };
  }

  async function deployWithRevertingRevenueTreasuryFixture() {
    const [owner, maker, taker] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);
    const Reverter = await ethers.getContractFactory("MockRevenueReceiverReverter");
    const reverter = await Reverter.deploy();

    const Escrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await Escrow.deploy(await reverter.getAddress());

    const tokenAddress = await token.getAddress();
    await escrow.connect(owner).setTokenConfig(
      tokenAddress,
      true,
      true,
      true,
      USDT_DECIMALS,
      TIER_MAX_AMOUNTS_BASE_UNIT_6
    );

    for (const wallet of [maker, taker]) {
      await token.mint(wallet.address, INITIAL_BAL);
      await token.connect(wallet).approve(await escrow.getAddress(), ethers.MaxUint256);
      await escrow.connect(wallet).registerWallet();
    }
    await time.increase(7 * 24 * 3600 + 1);
    return { escrow, token, maker, taker };
  }

  async function openLockedTrade({ escrow, maker, taker, token, label = "open", tier = 0 }) {
    const createTx = await escrow.connect(maker).createSellOrder(
      await token.getAddress(),
      TRADE_AMOUNT,
      MIN_FILL,
      tier,
      makeRef(`${label}-order`)
    );
    const created = await firstEventArgs(await createTx.wait(), escrow.interface, "OrderCreated");

    const fillTx = await escrow.connect(taker).fillSellOrder(
      created.orderId,
      TRADE_AMOUNT,
      makeRef(`${label}-child`)
    );
    const filled = await firstEventArgs(await fillTx.wait(), escrow.interface, "OrderFilled");
    return filled.tradeId;
  }

  async function moveToChallenged({ escrow, maker, taker, tradeId, receipt = "Qm-receipt" }) {
    await escrow.connect(taker).reportPayment(tradeId, receipt);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).pingTakerForChallenge(tradeId);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).challengeTrade(tradeId);
  }

  async function unlockTierOneForMaker({ escrow, owner, maker, taker, token }) {
    await escrow.connect(owner).setReputationTierThresholds([0, 1, 1, 1, 1], [100, 100, 100, 100, 100]);
    const warmupTradeId = await openLockedTrade({ escrow, maker, taker, token, label: "warmup-tier", tier: 0 });
    await escrow.connect(taker).reportPayment(warmupTradeId, "Qm-warmup-tier");
    await escrow.connect(maker).releaseFunds(warmupTradeId);
    const minActivePeriod = await escrow.MIN_ACTIVE_PERIOD();
    await time.increase(Number(minActivePeriod) + 1);
  }

  it("test_releaseFunds_sends_manual_release_fee_with_revenue_kind", async function () {
    const { escrow, token, treasury, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "manual-release", tier: 0 });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-manual");

    const releaseTx = await escrow.connect(maker).releaseFunds(tradeId);
    const receipt = await releaseTx.wait();
    const revenueEvent = await firstEventArgs(receipt, escrow.interface, "ProtocolRevenueSent");

    expect(revenueEvent.token).to.equal(await token.getAddress());
    expect(revenueEvent.kind).to.equal(REVENUE_KIND.MANUAL_RELEASE_FEE);
    expect(revenueEvent.tradeId).to.equal(tradeId);
    expect(revenueEvent.treasury).to.equal(treasury.address);
  });

  it("test_challenged_release_sends_disputed_release_fee_with_revenue_kind", async function () {
    const { escrow, token, treasury, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "challenged-release", tier: 0 });
    await moveToChallenged({ escrow, maker, taker, tradeId, receipt: "Qm-challenged" });

    const releaseTx = await escrow.connect(maker).releaseFunds(tradeId);
    const receipt = await releaseTx.wait();
    const revenueEvents = await eventsByName(receipt, escrow.interface, "ProtocolRevenueSent");
    expect(revenueEvents.length).to.be.gte(1);
    expect(revenueEvents[revenueEvents.length - 1].kind).to.equal(REVENUE_KIND.DISPUTED_RELEASE_FEE);
    expect(revenueEvents[revenueEvents.length - 1].tradeId).to.equal(tradeId);
    expect(revenueEvents[revenueEvents.length - 1].treasury).to.equal(treasury.address);
  });

  it("test_autoRelease_sends_auto_release_penalty_with_revenue_kind", async function () {
    const { escrow, token, owner, treasury, maker, taker } = await loadFixture(deployFixture);
    await unlockTierOneForMaker({ escrow, owner, maker, taker, token });
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "auto-release", tier: 1 });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-auto");
    await time.increase(48 * 3600 + 1);
    await escrow.connect(taker).pingMaker(tradeId);
    await time.increase(24 * 3600 + 1);

    const tx = await escrow.connect(taker).autoRelease(tradeId);
    const receipt = await tx.wait();
    const revenueEvents = await eventsByName(receipt, escrow.interface, "ProtocolRevenueSent");
    expect(revenueEvents.length).to.equal(1);
    expect(revenueEvents[0].kind).to.equal(REVENUE_KIND.AUTO_RELEASE_FEE_OR_PENALTY);
    expect(revenueEvents[0].tradeId).to.equal(tradeId);
    expect(revenueEvents[0].treasury).to.equal(treasury.address);
  });

  it("test_acceptSettlement_sends_partial_settlement_fee_with_revenue_kind", async function () {
    const { escrow, token, treasury, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "settlement", tier: 0 });
    await moveToChallenged({ escrow, maker, taker, tradeId, receipt: "Qm-settlement" });

    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 3600);
    const tx = await escrow.connect(taker).acceptSettlement(tradeId);
    const receipt = await tx.wait();
    const revenueEvent = await firstEventArgs(receipt, escrow.interface, "ProtocolRevenueSent");
    expect(revenueEvent.kind).to.equal(REVENUE_KIND.PARTIAL_SETTLEMENT_FEE);
    expect(revenueEvent.tradeId).to.equal(tradeId);
    expect(revenueEvent.treasury).to.equal(treasury.address);
  });

  it("test_protocolRevenueSent_not_emitted_for_zero_amount", async function () {
    const { escrow, token, owner, maker, taker } = await loadFixture(deployFixture);
    await escrow.connect(owner).setFeeConfig(0, 0);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "zero-fee", tier: 0 });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-zero");

    const tx = await escrow.connect(maker).releaseFunds(tradeId);
    const receipt = await tx.wait();
    const revenueEvents = await eventsByName(receipt, escrow.interface, "ProtocolRevenueSent");
    expect(revenueEvents.length).to.equal(0);
  });

  it("test_revenue_hook_called_when_treasury_is_contract", async function () {
    const { escrow, token, receiver, maker, taker } = await loadFixture(deployWithRevenueTreasuryFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "hook-called", tier: 0 });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-hook");

    await escrow.connect(maker).releaseFunds(tradeId);

    expect(await receiver.lastToken()).to.equal(await token.getAddress());
    expect(await receiver.lastAmount()).to.be.gt(0n);
    expect(await receiver.lastKind()).to.equal(REVENUE_KIND.MANUAL_RELEASE_FEE);
    expect(await receiver.lastTradeId()).to.equal(tradeId);
    expect(await receiver.callCount()).to.equal(1n);
  });

  it("test_revenue_hook_failure_reverts", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployWithRevertingRevenueTreasuryFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "hook-reverts", tier: 0 });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-revert");

    await expect(escrow.connect(maker).releaseFunds(tradeId))
      .to.be.revertedWithCustomError(escrow, "RevenueHookFailed");
  });

  it("test_existing_payout_math_unchanged_for_releaseFunds", async function () {
    const { escrow, token, treasury, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "math-release", tier: 0 });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-math-release");

    const trade = await escrow.getTrade(tradeId);
    const takerFee = (trade.cryptoAmount * trade.takerFeeBpsSnapshot) / BPS_DENOMINATOR;
    const makerFeeQuote = (trade.cryptoAmount * trade.makerFeeBpsSnapshot) / BPS_DENOMINATOR;
    const actualMakerFee = trade.makerBond > makerFeeQuote ? makerFeeQuote : trade.makerBond;
    const makerBondBack = trade.makerBond > makerFeeQuote ? trade.makerBond - makerFeeQuote : 0n;

    const treasuryBefore = await token.balanceOf(treasury.address);
    const makerBefore = await token.balanceOf(maker.address);
    const takerBefore = await token.balanceOf(taker.address);

    await escrow.connect(maker).releaseFunds(tradeId);

    const treasuryAfter = await token.balanceOf(treasury.address);
    const makerAfter = await token.balanceOf(maker.address);
    const takerAfter = await token.balanceOf(taker.address);

    expect(treasuryAfter - treasuryBefore).to.equal(takerFee + actualMakerFee);
    expect(makerAfter - makerBefore).to.equal(makerBondBack);
    expect(takerAfter - takerBefore).to.equal((trade.cryptoAmount - takerFee) + trade.takerBond);
  });

  it("test_existing_payout_math_unchanged_for_autoRelease", async function () {
    const { escrow, token, owner, treasury, maker, taker } = await loadFixture(deployFixture);
    await unlockTierOneForMaker({ escrow, owner, maker, taker, token });
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "math-auto", tier: 1 });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-math-auto");
    await time.increase(48 * 3600 + 1);
    await escrow.connect(taker).pingMaker(tradeId);
    await time.increase(24 * 3600 + 1);

    const trade = await escrow.getTrade(tradeId);
    const makerPenalty = (trade.makerBond * (await escrow.AUTO_RELEASE_PENALTY_BPS())) / BPS_DENOMINATOR;
    const takerPenalty = (trade.takerBond * (await escrow.AUTO_RELEASE_PENALTY_BPS())) / BPS_DENOMINATOR;

    const treasuryBefore = await token.balanceOf(treasury.address);
    const makerBefore = await token.balanceOf(maker.address);
    const takerBefore = await token.balanceOf(taker.address);

    await escrow.connect(taker).autoRelease(tradeId);

    const treasuryAfter = await token.balanceOf(treasury.address);
    const makerAfter = await token.balanceOf(maker.address);
    const takerAfter = await token.balanceOf(taker.address);

    expect(treasuryAfter - treasuryBefore).to.equal(makerPenalty + takerPenalty);
    expect(makerAfter - makerBefore).to.equal(trade.makerBond - makerPenalty);
    expect(takerAfter - takerBefore).to.equal(trade.cryptoAmount + (trade.takerBond - takerPenalty));
  });

  it("test_existing_payout_math_unchanged_for_acceptSettlement", async function () {
    const { escrow, token, treasury, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "math-settlement", tier: 0 });
    await moveToChallenged({ escrow, maker, taker, tradeId, receipt: "Qm-math-settlement" });

    const trade = await escrow.getTrade(tradeId);
    const now = await time.latest();
    const makerShareBps = 3000n;
    await escrow.connect(maker).proposeSettlement(tradeId, makerShareBps, now + 3600);

    const pool = trade.cryptoAmount + trade.makerBond + trade.takerBond;
    const makerGross = (pool * makerShareBps) / BPS_DENOMINATOR;
    const takerGross = pool - makerGross;
    const makerFee = (makerGross * trade.makerFeeBpsSnapshot) / BPS_DENOMINATOR;
    const takerFee = (takerGross * trade.takerFeeBpsSnapshot) / BPS_DENOMINATOR;

    const treasuryBefore = await token.balanceOf(treasury.address);
    const makerBefore = await token.balanceOf(maker.address);
    const takerBefore = await token.balanceOf(taker.address);

    await escrow.connect(taker).acceptSettlement(tradeId);

    const treasuryAfter = await token.balanceOf(treasury.address);
    const makerAfter = await token.balanceOf(maker.address);
    const takerAfter = await token.balanceOf(taker.address);

    expect(treasuryAfter - treasuryBefore).to.equal(makerFee + takerFee);
    expect(makerAfter - makerBefore).to.equal(makerGross - makerFee);
    expect(takerAfter - takerBefore).to.equal(takerGross - takerFee);
  });
});
