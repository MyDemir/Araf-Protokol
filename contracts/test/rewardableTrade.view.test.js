const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafEscrow rewardable terminal trade view", function () {
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

    await escrow.connect(owner).setTokenConfig(
      await token.getAddress(),
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

  async function openLockedTrade({ escrow, maker, taker, token, label = "open", tier = 0, paymentRiskLevel }) {
    const createSell = paymentRiskLevel === undefined
      ? escrow.connect(maker)["createSellOrder(address,uint256,uint256,uint8,bytes32)"](
        await token.getAddress(),
        TRADE_AMOUNT,
        MIN_FILL,
        tier,
        makeRef(`${label}-order`)
      )
      : escrow.connect(maker)["createSellOrder(address,uint256,uint256,uint8,bytes32,uint8)"](
        await token.getAddress(),
        TRADE_AMOUNT,
        MIN_FILL,
        tier,
        makeRef(`${label}-order`),
        paymentRiskLevel
      );

    const orderTx = await createSell;
    const created = await firstEventArgs(await orderTx.wait(), escrow.interface, "OrderCreated");
    const fillTx = await escrow.connect(taker).fillSellOrder(created.orderId, TRADE_AMOUNT, makeRef(`${label}-child`));
    const filled = await firstEventArgs(await fillTx.wait(), escrow.interface, "OrderFilled");
    return filled.tradeId;
  }

  async function moveToChallenged({ escrow, maker, taker, tradeId, hash = "Qm-challenge" }) {
    await escrow.connect(taker).reportPayment(tradeId, hash);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).pingTakerForChallenge(tradeId);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).challengeTrade(tradeId);
  }

  async function unlockTierOneForMaker({ escrow, owner, maker, taker, token }) {
    await escrow.connect(owner).setReputationTierThresholds([0, 1, 1, 1, 1], [100, 100, 100, 100, 100]);
    const warmupTradeId = await openLockedTrade({ escrow, maker, taker, token, label: "warmup-tier", tier: 0 });
    await escrow.connect(taker).reportPayment(warmupTradeId, "Qm-warmup");
    await escrow.connect(maker).releaseFunds(warmupTradeId);
    await time.increase(Number(await escrow.MIN_ACTIVE_PERIOD()) + 1);
  }

  it("test_getRewardableTrade_non_terminal_returns_NONE_or_reverts_consistently", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "non-terminal" });
    const rewardable = await escrow.getRewardableTrade(tradeId);

    expect(rewardable.tradeId).to.equal(tradeId);
    expect(rewardable.outcome).to.equal(TERMINAL_OUTCOME.NONE);
    expect(rewardable.terminalAt).to.equal(0n);
  });

  it("test_getRewardableTrade_clean_release", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "clean-release" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-clean");
    await escrow.connect(maker).releaseFunds(tradeId);

    const rewardable = await escrow.getRewardableTrade(tradeId);
    expect(rewardable.outcome).to.equal(TERMINAL_OUTCOME.CLEAN_RELEASE);
    expect(rewardable.hadChallenge).to.equal(false);
    expect(rewardable.stableNotional).to.equal((await escrow.getTrade(tradeId)).cryptoAmount);
  });

  it("test_getRewardableTrade_auto_release", async function () {
    const { escrow, token, owner, maker, taker } = await loadFixture(deployFixture);
    await unlockTierOneForMaker({ escrow, owner, maker, taker, token });
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "auto-release", tier: 1 });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-auto");
    await time.increase(48 * 3600 + 1);
    await escrow.connect(taker).pingMaker(tradeId);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(taker).autoRelease(tradeId);

    const rewardable = await escrow.getRewardableTrade(tradeId);
    expect(rewardable.outcome).to.equal(TERMINAL_OUTCOME.AUTO_RELEASE);
    expect(rewardable.takerFeePaid).to.be.gt(0n);
    expect(rewardable.makerFeePaid).to.be.gt(0n);
  });

  it("test_getRewardableTrade_partial_settlement", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "settlement" });
    await moveToChallenged({ escrow, maker, taker, tradeId, hash: "Qm-settlement" });
    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 3000, now + 3600);
    await escrow.connect(taker).acceptSettlement(tradeId);

    const rewardable = await escrow.getRewardableTrade(tradeId);
    expect(rewardable.outcome).to.equal(TERMINAL_OUTCOME.PARTIAL_SETTLEMENT);
    expect(rewardable.hadChallenge).to.equal(true);
  });

  it("test_getRewardableTrade_mutual_cancel", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "mutual-cancel" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-cancel");

    const deadline = (await time.latest()) + 3600;
    const makerSig = await cancelSig({ escrow, signer: maker, tradeId, deadline });
    await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);
    const takerSig = await cancelSig({ escrow, signer: taker, tradeId, deadline });
    await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);

    const rewardable = await escrow.getRewardableTrade(tradeId);
    expect(rewardable.outcome).to.equal(TERMINAL_OUTCOME.MUTUAL_CANCEL);
  });

  it("test_getRewardableTrade_disputed_release", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "disputed-release" });
    await moveToChallenged({ escrow, maker, taker, tradeId, hash: "Qm-disputed" });
    await escrow.connect(maker).releaseFunds(tradeId);

    const rewardable = await escrow.getRewardableTrade(tradeId);
    expect(rewardable.outcome).to.equal(TERMINAL_OUTCOME.DISPUTED_RELEASE);
    expect(rewardable.hadChallenge).to.equal(true);
  });

  it("test_getRewardableTrade_burned", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "burned" });
    await moveToChallenged({ escrow, maker, taker, tradeId, hash: "Qm-burn" });
    await time.increase(10 * 24 * 3600 + 1);
    await escrow.connect(taker).burnExpired(tradeId);

    const rewardable = await escrow.getRewardableTrade(tradeId);
    expect(rewardable.outcome).to.equal(TERMINAL_OUTCOME.BURNED);
  });

  it("test_getRewardableTrade_order_child_sets_isOrderChild_true", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "child-flag" });
    const rewardable = await escrow.getRewardableTrade(tradeId);
    expect(rewardable.parentOrderId).to.not.equal(0n);
    expect(rewardable.isOrderChild).to.equal(true);
  });

  it("test_getRewardableTrade_terminalAt_set_once", async function () {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "terminal-once" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-once");
    await escrow.connect(maker).releaseFunds(tradeId);
    const first = await escrow.getRewardableTrade(tradeId);
    await time.increase(3 * 24 * 3600);
    const second = await escrow.getRewardableTrade(tradeId);
    expect(second.terminalAt).to.equal(first.terminalAt);
  });

  it("test_getRewardableTrade_paymentRisk_not_used_for_outcome", async function () {
    const { escrow, token, owner, maker, taker } = await loadFixture(deployFixture);
    await escrow.connect(owner).setCooldownConfig(0, 0);
    const highRiskTradeId = await openLockedTrade({
      escrow, maker, taker, token, label: "risk-high", paymentRiskLevel: 2,
    });
    const restrictedRiskTradeId = await openLockedTrade({
      escrow, maker, taker, token, label: "risk-restricted", paymentRiskLevel: 3,
    });

    await escrow.connect(taker).reportPayment(highRiskTradeId, "Qm-high");
    await escrow.connect(maker).releaseFunds(highRiskTradeId);
    await escrow.connect(taker).reportPayment(restrictedRiskTradeId, "Qm-rest");
    await escrow.connect(maker).releaseFunds(restrictedRiskTradeId);

    const high = await escrow.getRewardableTrade(highRiskTradeId);
    const restricted = await escrow.getRewardableTrade(restrictedRiskTradeId);
    expect(high.outcome).to.equal(TERMINAL_OUTCOME.CLEAN_RELEASE);
    expect(restricted.outcome).to.equal(TERMINAL_OUTCOME.CLEAN_RELEASE);
  });

  it("test_getRewardableTrade_fee_snapshots_match_terminal_event", async function () {
    const { escrow, token, owner, maker, taker } = await loadFixture(deployFixture);
    await unlockTierOneForMaker({ escrow, owner, maker, taker, token });
    await escrow.connect(owner).setCooldownConfig(0, 0);

    const releaseTradeId = await openLockedTrade({ escrow, maker, taker, token, label: "fee-release", tier: 1 });
    await escrow.connect(taker).reportPayment(releaseTradeId, "Qm-fee-release");
    const releaseReceipt = await (await escrow.connect(maker).releaseFunds(releaseTradeId)).wait();
    const released = await firstEventArgs(releaseReceipt, escrow.interface, "EscrowReleased");
    const releaseView = await escrow.getRewardableTrade(releaseTradeId);
    expect(releaseView.takerFeePaid).to.equal(released.takerFee);
    expect(releaseView.makerFeePaid).to.equal(released.makerFee);

    const autoTradeId = await openLockedTrade({ escrow, maker, taker, token, label: "fee-auto", tier: 1 });
    await escrow.connect(taker).reportPayment(autoTradeId, "Qm-fee-auto");
    await time.increase(48 * 3600 + 1);
    await escrow.connect(taker).pingMaker(autoTradeId);
    await time.increase(24 * 3600 + 1);
    const autoReceipt = await (await escrow.connect(taker).autoRelease(autoTradeId)).wait();
    const autoReleased = await firstEventArgs(autoReceipt, escrow.interface, "EscrowReleased");
    const autoView = await escrow.getRewardableTrade(autoTradeId);
    expect(autoView.takerFeePaid).to.equal(autoReleased.takerFee);
    expect(autoView.makerFeePaid).to.equal(autoReleased.makerFee);

    const settlementTradeId = await openLockedTrade({ escrow, maker, taker, token, label: "fee-settlement", tier: 1 });
    await moveToChallenged({ escrow, maker, taker, tradeId: settlementTradeId, hash: "Qm-fee-settlement" });
    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(settlementTradeId, 5000, now + 3600);
    const settlementReceipt = await (await escrow.connect(taker).acceptSettlement(settlementTradeId)).wait();
    const finalized = await firstEventArgs(settlementReceipt, escrow.interface, "SettlementFinalized");
    const settlementView = await escrow.getRewardableTrade(settlementTradeId);
    expect(settlementView.takerFeePaid).to.equal(finalized.takerFee);
    expect(settlementView.makerFeePaid).to.equal(finalized.makerFee);
  });
});
