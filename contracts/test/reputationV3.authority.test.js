const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafEscrow V3 reputation authority", () => {
  const USDT_DECIMALS = 6;
  const TRADE_AMOUNT = ethers.parseUnits("100", USDT_DECIMALS);
  const MIN_FILL = ethers.parseUnits("50", USDT_DECIMALS);
  const INITIAL_BAL = ethers.parseUnits("100000", USDT_DECIMALS);
  const TIER_MAX_AMOUNTS_BASE_UNIT = [
    ethers.parseUnits("150", USDT_DECIMALS),
    ethers.parseUnits("1500", USDT_DECIMALS),
    ethers.parseUnits("7500", USDT_DECIMALS),
    ethers.parseUnits("30000", USDT_DECIMALS),
  ];
  const REF_1D = 24 * 3600;
  const REF_2D = 48 * 3600;
  const REF_10D = 10 * 24 * 3600;

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
    const nonce = await escrow.sigNonces(signer.address);
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
    const mockUSDT = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);
    const Escrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await Escrow.deploy(treasury.address);

    const token = await mockUSDT.getAddress();
    await escrow.connect(owner).setTokenConfig(token, true, true, true, USDT_DECIMALS, TIER_MAX_AMOUNTS_BASE_UNIT);

    for (const wallet of [maker, taker]) {
      await mockUSDT.mint(wallet.address, INITIAL_BAL);
      await mockUSDT.connect(wallet).approve(await escrow.getAddress(), ethers.MaxUint256);
      await escrow.connect(wallet).registerWallet();
    }
    await time.increase(7 * 24 * 3600 + 1);

    return { escrow, mockUSDT, owner, maker, taker };
  }

  it("manual release and auto release are classified onchain with V3 counters", async () => {
    const { escrow, maker, taker, mockUSDT } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();

    // [TR] Trade-1 manual release path
    // [EN] Trade-1 manual release path
    const order1 = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, 0, makeRef("m1"));
    const order1Args = await firstEventArgs(await order1.wait(), escrow.interface, "OrderCreated");
    const fill1 = await escrow.connect(taker).fillSellOrder(order1Args.orderId, TRADE_AMOUNT, makeRef("m1-child"));
    const fill1Args = await firstEventArgs(await fill1.wait(), escrow.interface, "OrderFilled");
    await escrow.connect(taker).reportPayment(fill1Args.tradeId, "QmManual");
    await escrow.connect(maker).releaseFunds(fill1Args.tradeId);
    await time.increase(4 * 3600 + 1);

    // [TR] Trade-2 auto release path
    // [EN] Trade-2 auto release path
    const order2 = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, 0, makeRef("a1"));
    const order2Args = await firstEventArgs(await order2.wait(), escrow.interface, "OrderCreated");
    const fill2 = await escrow.connect(taker).fillSellOrder(order2Args.orderId, TRADE_AMOUNT, makeRef("a1-child"));
    const fill2Args = await firstEventArgs(await fill2.wait(), escrow.interface, "OrderFilled");
    await escrow.connect(taker).reportPayment(fill2Args.tradeId, "QmAuto");
    await time.increase(REF_2D + 1);
    await escrow.connect(taker).pingMaker(fill2Args.tradeId);
    await time.increase(REF_1D + 1);
    await escrow.connect(taker).autoRelease(fill2Args.tradeId);

    const [, makerFailed, , , , makerManual, makerAuto, , , , , , makerRisk] =
      await escrow.getReputation(maker.address);
    const [takerSuccessful, takerFailed, , , , takerManual, takerAuto] =
      await escrow.getReputation(taker.address);

    expect(makerManual).to.equal(1n);
    expect(makerAuto).to.equal(1n);
    expect(makerFailed).to.equal(1n);
    expect(makerRisk).to.be.gt(0n);
    expect(takerSuccessful).to.be.gte(2n);
    expect(takerFailed).to.equal(0n);
    expect(takerManual).to.equal(1n);
    expect(takerAuto).to.equal(1n);
  });

  it("test_autoRelease_emits_takerPenalty_before_makerPenalty", async () => {
    const { escrow, owner, maker, taker, mockUSDT } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();

    await escrow
      .connect(owner)
      .setReputationTierThresholds([0, 1, 1, 1, 1], [100, 100, 100, 100, 100]);

    const warmupOrder = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, 0, makeRef("event-order-warmup"));
    const warmupOrderArgs = await firstEventArgs(await warmupOrder.wait(), escrow.interface, "OrderCreated");
    const warmupFill = await escrow.connect(taker).fillSellOrder(warmupOrderArgs.orderId, TRADE_AMOUNT, makeRef("event-order-warmup-child"));
    const warmupFillArgs = await firstEventArgs(await warmupFill.wait(), escrow.interface, "OrderFilled");
    await escrow.connect(taker).reportPayment(warmupFillArgs.tradeId, "QmPenaltyWarmup");
    await escrow.connect(maker).releaseFunds(warmupFillArgs.tradeId);
    await time.increase(15 * 24 * 3600 + 1);

    const order = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, 1, makeRef("event-order"));
    const orderArgs = await firstEventArgs(await order.wait(), escrow.interface, "OrderCreated");
    const fill = await escrow.connect(taker).fillSellOrder(orderArgs.orderId, TRADE_AMOUNT, makeRef("event-order-child"));
    const fillArgs = await firstEventArgs(await fill.wait(), escrow.interface, "OrderFilled");

    await escrow.connect(taker).reportPayment(fillArgs.tradeId, "QmPenaltyOrder");
    await time.increase(REF_2D + 1);
    await escrow.connect(taker).pingMaker(fillArgs.tradeId);
    await time.increase(REF_1D + 1);

    const tradeBeforeRelease = await escrow.getTrade(fillArgs.tradeId);
    const makerPenalty = (tradeBeforeRelease.makerBond * 200n) / 10_000n;
    const takerPenalty = (tradeBeforeRelease.takerBond * 200n) / 10_000n;

    await expect(escrow.connect(taker).autoRelease(fillArgs.tradeId))
      .to.emit(escrow, "EscrowReleased")
      .withArgs(fillArgs.tradeId, maker.address, taker.address, takerPenalty, makerPenalty);
  });

  it("mutual cancel, dispute resolution and burn are authority-classified onchain", async () => {
    const { escrow, maker, taker, mockUSDT } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();

    // mutual cancel
    const o1 = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, 0, makeRef("c1"));
    const o1Args = await firstEventArgs(await o1.wait(), escrow.interface, "OrderCreated");
    const f1 = await escrow.connect(taker).fillSellOrder(o1Args.orderId, TRADE_AMOUNT, makeRef("c1-child"));
    const f1Args = await firstEventArgs(await f1.wait(), escrow.interface, "OrderFilled");
    const deadline = (await time.latest()) + 3600;
    const makerSig = await cancelSig({ escrow, signer: maker, tradeId: f1Args.tradeId, deadline });
    await escrow.connect(maker).proposeOrApproveCancel(f1Args.tradeId, deadline, makerSig);
    const takerSig = await cancelSig({ escrow, signer: taker, tradeId: f1Args.tradeId, deadline });
    await escrow.connect(taker).proposeOrApproveCancel(f1Args.tradeId, deadline, takerSig);
    await time.increase(4 * 3600 + 1);

    // dispute resolution (maker challenge-loss path)
    const o2 = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, 0, makeRef("d1"));
    const o2Args = await firstEventArgs(await o2.wait(), escrow.interface, "OrderCreated");
    const f2 = await escrow.connect(taker).fillSellOrder(o2Args.orderId, TRADE_AMOUNT, makeRef("d1-child"));
    const f2Args = await firstEventArgs(await f2.wait(), escrow.interface, "OrderFilled");
    await escrow.connect(taker).reportPayment(f2Args.tradeId, "QmDispute");
    await time.increase(REF_1D + 1);
    await escrow.connect(maker).pingTakerForChallenge(f2Args.tradeId);
    await time.increase(REF_1D + 1);
    await escrow.connect(maker).challengeTrade(f2Args.tradeId);
    await escrow.connect(maker).releaseFunds(f2Args.tradeId);
    await time.increase(4 * 3600 + 1);

    // burn path
    const o3 = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, 0, makeRef("b1"));
    const o3Args = await firstEventArgs(await o3.wait(), escrow.interface, "OrderCreated");
    const f3 = await escrow.connect(taker).fillSellOrder(o3Args.orderId, TRADE_AMOUNT, makeRef("b1-child"));
    const f3Args = await firstEventArgs(await f3.wait(), escrow.interface, "OrderFilled");
    await escrow.connect(taker).reportPayment(f3Args.tradeId, "QmBurn");
    await time.increase(REF_1D + 1);
    await escrow.connect(maker).pingTakerForChallenge(f3Args.tradeId);
    await time.increase(REF_1D + 1);
    await escrow.connect(maker).challengeTrade(f3Args.tradeId);
    await time.increase(REF_10D + 1);
    await escrow.burnExpired(f3Args.tradeId);

    const [, makerFailed, , , , , , makerMutual, makerDisputed, makerBurn, makerWin, makerLoss] =
      await escrow.getReputation(maker.address);
    const [, takerFailed, , , , , , takerMutual, takerDisputed, takerBurn, takerWin, takerLoss] =
      await escrow.getReputation(taker.address);

    expect(makerMutual).to.equal(1n);
    expect(takerMutual).to.equal(1n);
    expect(makerDisputed).to.equal(1n);
    expect(takerDisputed).to.equal(1n);
    expect(makerBurn).to.equal(1n);
    expect(takerBurn).to.equal(1n);
    expect(makerLoss).to.equal(1n);
    expect(takerWin).to.equal(1n);
    expect(makerWin).to.equal(0n);
    expect(takerLoss).to.equal(0n);
    expect(makerFailed).to.be.gte(2n);
    expect(takerFailed).to.be.gte(1n);
  });

  it("validates policy setters and exposes V3-only getter shape", async () => {
    const { escrow, owner, maker } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(owner).setReputationPolicy(
        6 * 24 * 3600,
        8,
        60,
        10,
        60,
        90,
        20,
        30 * 24 * 3600,
        100
      )
    ).to.be.reverted;

    await expect(
      escrow.connect(owner).setReputationTierThresholds(
        [0, 15, 50, 40, 200],
        [100, 80, 50, 30, 15]
      )
    ).to.be.reverted;

    await expect(
      escrow.connect(owner).setReputationPolicy(
        500 * 24 * 3600,
        9,
        55,
        11,
        61,
        95,
        22,
        35 * 24 * 3600,
        101
      )
    ).to.be.reverted;

    await expect(
      escrow.connect(owner).setReputationPolicy(
        90 * 24 * 3600,
        9,
        55,
        11,
        61,
        95,
        22,
        35 * 24 * 3600,
        100
      )
    ).to.emit(escrow, "ReputationPolicyUpdated");

    const rep = await escrow.getReputation(maker.address);
    expect(rep.length).to.equal(15);
  });

  it("test_setCooldownConfig_accepts_maximum_cooldown", async () => {
    const { escrow, owner } = await loadFixture(deployFixture);
    const maxCooldown = await escrow.MAX_TRADE_COOLDOWN();

    await expect(
      escrow.connect(owner).setCooldownConfig(maxCooldown, maxCooldown)
    ).to.emit(escrow, "CooldownConfigUpdated");
  });

  it("test_setCooldownConfig_reverts_when_tier0_cooldown_too_high", async () => {
    const { escrow, owner } = await loadFixture(deployFixture);
    const maxCooldown = await escrow.MAX_TRADE_COOLDOWN();

    await expect(
      escrow.connect(owner).setCooldownConfig(maxCooldown + 1n, maxCooldown)
    ).to.be.revertedWithCustomError(escrow, "CooldownTooHigh");
  });

  it("test_setCooldownConfig_reverts_when_tier1_cooldown_too_high", async () => {
    const { escrow, owner } = await loadFixture(deployFixture);
    const maxCooldown = await escrow.MAX_TRADE_COOLDOWN();

    await expect(
      escrow.connect(owner).setCooldownConfig(maxCooldown, maxCooldown + 1n)
    ).to.be.revertedWithCustomError(escrow, "CooldownTooHigh");
  });

  it("test_setReputationPolicy_reverts_when_decay_period_too_high", async () => {
    const { escrow, owner } = await loadFixture(deployFixture);
    const maxDecay = await escrow.MAX_REPUTATION_DECAY_PERIOD();

    await expect(
      escrow.connect(owner).setReputationPolicy(
        maxDecay + 1n,
        9,
        55,
        11,
        61,
        95,
        22,
        35 * 24 * 3600,
        100
      )
    ).to.be.revertedWithCustomError(escrow, "DecayTooHigh");
  });

  it("test_setReputationPolicy_reverts_when_ban_duration_too_high", async () => {
    const { escrow, owner } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(owner).setReputationPolicy(
        90 * 24 * 3600,
        9,
        55,
        11,
        61,
        95,
        22,
        366 * 24 * 3600,
        100
      )
    ).to.be.revertedWithCustomError(escrow, "BanTooHigh");
  });

  it("cooldown and policy setters still enforce onlyOwner", async () => {
    const { escrow, taker } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(taker).setCooldownConfig(4 * 3600, 4 * 3600)
    ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");

    await expect(
      escrow.connect(taker).setReputationPolicy(
        90 * 24 * 3600,
        9,
        55,
        11,
        61,
        95,
        22,
        35 * 24 * 3600,
        100
      )
    ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
  });

  it("resists repeated terminal actions and prevents double counting", async () => {
    const { escrow, maker, taker, mockUSDT } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();

    const order = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, 0, makeRef("double-count"));
    const orderArgs = await firstEventArgs(await order.wait(), escrow.interface, "OrderCreated");
    const fill = await escrow.connect(taker).fillSellOrder(orderArgs.orderId, TRADE_AMOUNT, makeRef("double-count-child"));
    const fillArgs = await firstEventArgs(await fill.wait(), escrow.interface, "OrderFilled");
    await escrow.connect(taker).reportPayment(fillArgs.tradeId, "QmOnce");
    await escrow.connect(maker).releaseFunds(fillArgs.tradeId);

    const repAfterRelease = await escrow.getReputation(maker.address);
    await expect(escrow.connect(maker).releaseFunds(fillArgs.tradeId)).to.be.reverted;
    await expect(escrow.connect(taker).autoRelease(fillArgs.tradeId)).to.be.reverted;

    const repAfterRepeats = await escrow.getReputation(maker.address);
    expect(repAfterRepeats.successful).to.equal(repAfterRelease.successful);
    expect(repAfterRepeats.manualReleaseCount).to.equal(repAfterRelease.manualReleaseCount);
    expect(repAfterRepeats.autoReleaseCount).to.equal(repAfterRelease.autoReleaseCount);
  });

  it("emits complete V3 ReputationUpdated payload for authority mirrors", async () => {
    const { escrow, maker, taker, mockUSDT } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const order = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, 0, makeRef("event-shape"));
    const orderArgs = await firstEventArgs(await order.wait(), escrow.interface, "OrderCreated");
    const fill = await escrow.connect(taker).fillSellOrder(orderArgs.orderId, TRADE_AMOUNT, makeRef("event-shape-child"));
    const fillArgs = await firstEventArgs(await fill.wait(), escrow.interface, "OrderFilled");
    await escrow.connect(taker).reportPayment(fillArgs.tradeId, "QmEvent");

    const releaseTx = await escrow.connect(maker).releaseFunds(fillArgs.tradeId);
    const releaseRc = await releaseTx.wait();
    const repEvents = releaseRc.logs
      .map((log) => {
        try { return escrow.interface.parseLog(log); } catch { return null; }
      })
      .filter(Boolean)
      .filter((event) => event.name === "ReputationUpdated");

    expect(repEvents.length).to.equal(2);
    const makerEvent = repEvents.find((event) => event.args.wallet.toLowerCase() === maker.address.toLowerCase());
    const makerRep = await escrow.getReputation(maker.address);

    expect(makerEvent.args.manualReleaseCount).to.equal(makerRep.manualReleaseCount);
    expect(makerEvent.args.riskPoints).to.equal(makerRep.riskPoints);
    expect(makerEvent.args.lastPositiveEventAt).to.equal(makerRep.lastPositiveEventAt);
    expect(makerEvent.args.lastNegativeEventAt).to.equal(makerRep.lastNegativeEventAt);
  });

  it("keeps tier progression eligible with zero manual reward by initializing firstSuccessfulTradeAt", async () => {
    const { escrow, owner, maker, taker, mockUSDT } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();

    await escrow.connect(owner).setReputationPolicy(
      90 * 24 * 3600,
      0, // manual release reward = 0
      60,
      10,
      60,
      90,
      20,
      30 * 24 * 3600,
      100
    );
    await escrow.connect(owner).setReputationTierThresholds(
      [0, 1, 50, 100, 200],
      [100, 80, 50, 30, 15]
    );

    const order = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, 0, makeRef("zero-reward-tier"));
    const orderArgs = await firstEventArgs(await order.wait(), escrow.interface, "OrderCreated");
    const fill = await escrow.connect(taker).fillSellOrder(orderArgs.orderId, TRADE_AMOUNT, makeRef("zero-reward-tier-child"));
    const fillArgs = await firstEventArgs(await fill.wait(), escrow.interface, "OrderFilled");
    await escrow.connect(taker).reportPayment(fillArgs.tradeId, "QmZeroReward");
    await escrow.connect(maker).releaseFunds(fillArgs.tradeId);

    const firstSuccessAt = await escrow.getFirstSuccessfulTradeAt(maker.address);
    expect(firstSuccessAt).to.be.gt(0n);

    const repBeforeActivePeriod = await escrow.getReputation(maker.address);
    expect(repBeforeActivePeriod.effectiveTier).to.equal(0n);

    await time.increase(15 * 24 * 3600 + 1);
    const repAfterActivePeriod = await escrow.getReputation(maker.address);
    expect(repAfterActivePeriod.successful).to.equal(1n);
    expect(repAfterActivePeriod.effectiveTier).to.equal(1n);
  });
});
