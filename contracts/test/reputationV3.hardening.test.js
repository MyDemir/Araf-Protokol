const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafEscrow Reputation V3 hardening", function () {
  const USDT_DECIMALS = 6;
  const ONE_USDT = 10n ** 6n;
  const INITIAL_BAL = ethers.parseUnits("100000", USDT_DECIMALS);
  const EIGHT_DAYS = 8 * 24 * 3600;

  async function deployFixture() {
    const [owner, treasury, maker, taker] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdt = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);

    const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await ArafEscrow.deploy(treasury.address);

    const token = await usdt.getAddress();
    const escrowAddress = await escrow.getAddress();

    await escrow.connect(owner).setSupportedToken(token, true);

    await usdt.mint(maker.address, INITIAL_BAL);
    await usdt.mint(taker.address, INITIAL_BAL);
    await usdt.connect(maker).approve(escrowAddress, ethers.MaxUint256);
    await usdt.connect(taker).approve(escrowAddress, ethers.MaxUint256);

    await escrow.connect(maker).registerWallet();
    await escrow.connect(taker).registerWallet();
    await time.increase(EIGHT_DAYS);
    await owner.sendTransaction({ to: taker.address, value: ethers.parseEther("1.0") });

    return { escrow, usdt, maker, taker, token };
  }

  async function createPaidTrade({ escrow, maker, taker, token, amount = 100n * ONE_USDT }) {
    const orderRef = ethers.keccak256(ethers.toUtf8Bytes(`order:${Date.now()}:${Math.random()}`));
    const createTx = await escrow.connect(maker).createSellOrder(token, amount, amount, 0, orderRef);
    const createRc = await createTx.wait();
    const orderFilledTopic = escrow.interface.getEvent("OrderCreated").topicHash;
    const createLog = createRc.logs.find((l) => l.topics[0] === orderFilledTopic);
    const { orderId } = escrow.interface.parseLog(createLog).args;

    const childRef = ethers.keccak256(ethers.toUtf8Bytes(`child:${Date.now()}:${Math.random()}`));
    const fillTx = await escrow.connect(taker).fillSellOrder(orderId, amount, childRef);
    const fillRc = await fillTx.wait();
    const filledTopic = escrow.interface.getEvent("OrderFilled").topicHash;
    const fillLog = fillRc.logs.find((l) => l.topics[0] === filledTopic);
    const { tradeId } = escrow.interface.parseLog(fillLog).args;

    await escrow.connect(taker).reportPayment(tradeId, "QmHardeningV3");
    return tradeId;
  }

  it("enforces policy setter bounds for cleanPeriod/baseBanDuration/points", async () => {
    const { escrow } = await deployFixture();

    await expect(
      escrow.setReputationPolicy(
        0,
        2,
        8,
        6,
        15,
        30,
        2,
        30 * 24 * 3600
      )
    ).to.be.revertedWithCustomError(escrow, "InvalidReputationPolicyBounds");

    await expect(
      escrow.setReputationPolicy(
        90 * 24 * 3600,
        501,
        8,
        6,
        15,
        30,
        2,
        30 * 24 * 3600
      )
    ).to.be.revertedWithCustomError(escrow, "InvalidSignalPoints");
  });

  it("rejects excessive cooldown windows and accepts monotonic tier thresholds", async () => {
    const { escrow } = await deployFixture();

    await expect(escrow.setCooldownConfig(31 * 24 * 3600, 4 * 3600))
      .to.be.revertedWithCustomError(escrow, "InvalidCooldownWindow");

    await expect(escrow.setReputationTierThresholds(10, 10, 100, 100)).to.not.be.reverted;
    await expect(escrow.setReputationTierThresholds(30, 20, 100, 100))
      .to.be.revertedWithCustomError(escrow, "InvalidTier");
  });

  it("keeps terminal action single-use and emits V3-shaped reputation updates", async () => {
    const fixture = await deployFixture();
    const tradeId = await createPaidTrade(fixture);
    const { escrow, maker } = fixture;

    const tx = await escrow.connect(maker).releaseFunds(tradeId);
    const rc = await tx.wait();

    const repTopic = escrow.interface.getEvent("ReputationUpdated").topicHash;
    const repLogs = rc.logs
      .filter((l) => l.topics[0] === repTopic)
      .map((l) => escrow.interface.parseLog(l).args);
    expect(repLogs.length).to.equal(2);

    const makerRep = repLogs.find((x) => x.wallet.toLowerCase() === maker.address.toLowerCase());
    expect(makerRep.successfulTrades).to.be.gte(1n);
    expect(makerRep.manualReleaseCount).to.be.gte(1n);
    expect(makerRep.failedDisputes).to.equal(0n);
    expect(makerRep.effectiveTier).to.be.gte(0n);

    await expect(escrow.connect(maker).releaseFunds(tradeId))
      .to.be.revertedWithCustomError(escrow, "CannotReleaseInState");
  });

  it("returns stable V3 getter shape (15 fields) without tuple-index dependency", async () => {
    const fixture = await deployFixture();
    const tradeId = await createPaidTrade(fixture);
    await fixture.escrow.connect(fixture.maker).releaseFunds(tradeId);

    const rep = await fixture.escrow.getReputation(fixture.maker.address);
    expect(rep.length).to.equal(15);
    expect(rep.successfulTrades).to.be.a("bigint");
    expect(rep.failedDisputes).to.be.a("bigint");
    expect(rep.consecutiveBans).to.be.a("bigint");
    expect(rep.riskPoints).to.be.a("bigint");
    expect(rep.lastPositiveEventAt).to.be.a("bigint");
    expect(rep.lastNegativeEventAt).to.be.a("bigint");
  });
});
