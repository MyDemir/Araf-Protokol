const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafEscrow rewardable trade view", function () {
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

  const TERMINAL_OUTCOME = {
    NONE: 0n,
    CLEAN_RELEASE: 1n,
    AUTO_RELEASE: 2n,
    MUTUAL_CANCEL: 3n,
    PARTIAL_SETTLEMENT: 4n,
    DISPUTED_RELEASE: 5n,
    BURNED: 6n,
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

  async function cancelSig({ escrow, signer, tradeId, deadline }) {
    const domain = {
      name: "ArafEscrow",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await escrow.getAddress(),
    };
    const types = {
      CancelProposal: [
        { name: "tradeId", type: "uint256" },
        { name: "proposer", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const nonce = await escrow.sigNonces(signer.address, tradeId);
    return signer.signTypedData(domain, types, {
      tradeId,
      proposer: signer.address,
      nonce,
      deadline,
    });
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

  async function openLockedTrade({ escrow, maker, taker, token, label, tier = 0, paymentRisk = null }) {
    const createTx = paymentRisk === null
      ? await escrow.connect(maker).createSellOrder(
          await token.getAddress(),
          TRADE_AMOUNT,
          MIN_FILL,
          tier,
          makeRef(`${label}-order`)
        )
      : await escrow.connect(maker)["createSellOrder(address,uint256,uint256,uint8,bytes32,uint8)"](
          await token.getAddress(),
          TRADE_AMOUNT,
          MIN_FILL,
          tier,
          makeRef(`${label}-order`),
          paymentRisk
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

  async function unlockTierOneForMaker({ escrow, owner, maker, taker, token }) {
    await escrow.connect(owner).setReputationTierThresholds([0, 1, 1, 1, 1], [100, 100, 100, 100, 100]);
    const warmupTradeId = await openLockedTrade({ escrow, maker, taker, token, label: "warmup-tier", tier: 0 });
    await escrow.connect(taker).reportPayment(warmupTradeId, "Qm-warmup-tier");
    await escrow.connect(maker).releaseFunds(warmupTradeId);
    await time.increase(Number(await escrow.MIN_ACTIVE_PERIOD()) + 1);
  }

  it("test_getRewardableTrade_non_terminal_returns_NONE_or_reverts_consistently", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "non-terminal" });
    const view = await escrow.getRewardableTrade(tradeId);

    expect(view.outcome).to.equal(TERMINAL_OUTCOME.NONE);
    expect(view.terminalAt).to.equal(0n);
    expect(view.takerFeePaid).to.equal(0n);
    expect(view.makerFeePaid).to.equal(0n);
  });

  it("test_getRewardableTrade_clean_release", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "clean-release" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-clean");
    const tx = await escrow.connect(maker).releaseFunds(tradeId);
    const receipt = await tx.wait();
    const released = await firstEventArgs(receipt, escrow.interface, "EscrowReleased");

    const view = await escrow.getRewardableTrade(tradeId);
    expect(view.outcome).to.equal(TERMINAL_OUTCOME.CLEAN_RELEASE);
    expect(view.terminalAt).to.equal((await ethers.provider.getBlock(receipt.blockNumber)).timestamp);
    expect(view.takerFeePaid).to.equal(released.takerFee);
    expect(view.makerFeePaid).to.equal(released.makerFee);
  });

  it("test_getRewardableTrade_auto_release", async function () {
    const { escrow, token, owner, maker, taker } = await loadFixture(deployFixture);
    await unlockTierOneForMaker({ escrow, owner, maker, taker, token });
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "auto-release", tier: 1 });

    await escrow.connect(taker).reportPayment(tradeId, "Qm-auto");
    await time.increase(48 * 3600 + 1);
    await escrow.connect(taker).pingMaker(tradeId);
    await time.increase(24 * 3600 + 1);
    const tx = await escrow.connect(taker).autoRelease(tradeId);
    const receipt = await tx.wait();
    const released = await firstEventArgs(receipt, escrow.interface, "EscrowReleased");

    const view = await escrow.getRewardableTrade(tradeId);
    expect(view.outcome).to.equal(TERMINAL_OUTCOME.AUTO_RELEASE);
    expect(view.takerFeePaid).to.equal(released.takerFee);
    expect(view.makerFeePaid).to.equal(released.makerFee);
  });

  it("test_getRewardableTrade_partial_settlement", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "partial-settlement" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-partial");
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).pingTakerForChallenge(tradeId);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).challengeTrade(tradeId);

    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 6000, now + 3600);
    const tx = await escrow.connect(taker).acceptSettlement(tradeId);
    const receipt = await tx.wait();
    const finalized = await firstEventArgs(receipt, escrow.interface, "SettlementFinalized");

    const view = await escrow.getRewardableTrade(tradeId);
    expect(view.outcome).to.equal(TERMINAL_OUTCOME.PARTIAL_SETTLEMENT);
    expect(view.takerFeePaid).to.equal(finalized.takerFee);
    expect(view.makerFeePaid).to.equal(finalized.makerFee);
  });

  it("test_getRewardableTrade_mutual_cancel", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "mutual-cancel" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-cancel");

    const deadline = (await time.latest()) + 3600;
    const makerSig = await cancelSig({ escrow, signer: maker, tradeId, deadline });
    const takerSig = await cancelSig({ escrow, signer: taker, tradeId, deadline });
    await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);
    await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);

    const view = await escrow.getRewardableTrade(tradeId);
    const trade = await escrow.getTrade(tradeId);
    const quotedTakerFee = (trade.cryptoAmount * trade.takerFeeBpsSnapshot) / BPS_DENOMINATOR;
    const quotedMakerFee = (trade.cryptoAmount * trade.makerFeeBpsSnapshot) / BPS_DENOMINATOR;
    const takerFeeExpected = trade.takerBond >= quotedTakerFee ? quotedTakerFee : trade.takerBond;
    const makerFeeExpected = trade.makerBond >= quotedMakerFee ? quotedMakerFee : trade.makerBond;

    expect(view.outcome).to.equal(TERMINAL_OUTCOME.MUTUAL_CANCEL);
    expect(view.takerFeePaid).to.equal(takerFeeExpected);
    expect(view.makerFeePaid).to.equal(makerFeeExpected);
  });

  it("test_getRewardableTrade_disputed_release", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "disputed-release" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-disputed");
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).pingTakerForChallenge(tradeId);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).challengeTrade(tradeId);

    const tx = await escrow.connect(maker).releaseFunds(tradeId);
    const receipt = await tx.wait();
    const released = await firstEventArgs(receipt, escrow.interface, "EscrowReleased");

    const view = await escrow.getRewardableTrade(tradeId);
    expect(view.outcome).to.equal(TERMINAL_OUTCOME.DISPUTED_RELEASE);
    expect(view.hadChallenge).to.equal(true);
    expect(view.takerFeePaid).to.equal(released.takerFee);
    expect(view.makerFeePaid).to.equal(released.makerFee);
  });

  it("test_getRewardableTrade_burned", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "burned" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-burned");
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).pingTakerForChallenge(tradeId);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).challengeTrade(tradeId);
    await time.increase(10 * 24 * 3600 + 1);
    await escrow.connect(taker).burnExpired(tradeId);

    const view = await escrow.getRewardableTrade(tradeId);
    expect(view.outcome).to.equal(TERMINAL_OUTCOME.BURNED);
    expect(view.takerFeePaid).to.equal(0n);
    expect(view.makerFeePaid).to.equal(0n);
  });

  it("test_getRewardableTrade_order_child_sets_isOrderChild_true", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "order-child" });
    const view = await escrow.getRewardableTrade(tradeId);

    expect(view.isOrderChild).to.equal(true);
    expect(view.parentOrderId).to.be.gt(0n);
  });

  it("test_getRewardableTrade_terminalAt_set_once", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "terminal-once" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-once");
    await escrow.connect(maker).releaseFunds(tradeId);

    const firstRead = await escrow.getRewardableTrade(tradeId);
    await time.increase(7 * 24 * 3600);
    const secondRead = await escrow.getRewardableTrade(tradeId);
    expect(firstRead.terminalAt).to.equal(secondRead.terminalAt);
  });

  it("test_getRewardableTrade_paymentRisk_not_used_for_outcome", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const lowRiskTradeId = await openLockedTrade({
      escrow,
      maker,
      taker,
      token,
      label: "risk-low",
      tier: 0,
      paymentRisk: 0,
    });
    const cooldownConfig = await escrow.getCooldownConfig();
    await time.increase(Number(cooldownConfig.currentTier0TradeCooldown ?? cooldownConfig[0]) + 1);
    const highRiskTradeId = await openLockedTrade({
      escrow,
      maker,
      taker,
      token,
      label: "risk-high",
      tier: 0,
      paymentRisk: 3,
    });

    await escrow.connect(taker).reportPayment(lowRiskTradeId, "Qm-risk-low");
    await escrow.connect(maker).releaseFunds(lowRiskTradeId);
    await escrow.connect(taker).reportPayment(highRiskTradeId, "Qm-risk-high");
    await escrow.connect(maker).releaseFunds(highRiskTradeId);

    const lowView = await escrow.getRewardableTrade(lowRiskTradeId);
    const highView = await escrow.getRewardableTrade(highRiskTradeId);

    expect(lowView.outcome).to.equal(TERMINAL_OUTCOME.CLEAN_RELEASE);
    expect(highView.outcome).to.equal(TERMINAL_OUTCOME.CLEAN_RELEASE);
  });

  it("test_getRewardableTrade_fee_snapshots_match_terminal_event", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "fee-match" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-fee-match");
    const tx = await escrow.connect(maker).releaseFunds(tradeId);
    const receipt = await tx.wait();
    const released = await firstEventArgs(receipt, escrow.interface, "EscrowReleased");
    const view = await escrow.getRewardableTrade(tradeId);

    expect(view.takerFeePaid).to.equal(released.takerFee);
    expect(view.makerFeePaid).to.equal(released.makerFee);
  });
});
