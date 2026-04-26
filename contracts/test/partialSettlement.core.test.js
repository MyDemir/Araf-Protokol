const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafEscrow partial settlement core", () => {
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

  async function cancelSig({ escrow, signer, tradeId, deadline, nonceOverride }) {
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
    const nonce = nonceOverride ?? await escrow.sigNonces(signer.address, tradeId);
    return signer.signTypedData(domain, types, {
      tradeId,
      proposer: signer.address,
      nonce,
      deadline,
    });
  }

  async function deployFixture() {
    const [owner, treasury, maker, taker, outsider] = await ethers.getSigners();
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

    return { escrow, mockUSDT, owner, treasury, maker, taker, outsider };
  }

  async function openLockedTrade({ escrow, maker, taker, token, label, tier = 0 }) {
    const orderTx = await escrow.connect(maker).createSellOrder(token, TRADE_AMOUNT, MIN_FILL, tier, makeRef(`${label}-order`));
    const orderArgs = await firstEventArgs(await orderTx.wait(), escrow.interface, "OrderCreated");
    const fillTx = await escrow.connect(taker).fillSellOrder(orderArgs.orderId, TRADE_AMOUNT, makeRef(`${label}-child`));
    const fillArgs = await firstEventArgs(await fillTx.wait(), escrow.interface, "OrderFilled");
    return fillArgs.tradeId;
  }

  async function openChallengedTrade({ escrow, maker, taker, token, label }) {
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label });
    await escrow.connect(taker).reportPayment(tradeId, `Qm-${label}`);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).pingTakerForChallenge(tradeId);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(maker).challengeTrade(tradeId);
    return tradeId;
  }

  it("maker proposal accepted by taker in CHALLENGED state charges fees on gross split", async () => {
    const { escrow, mockUSDT, treasury, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "m-proposes" });

    const trade = await escrow.getTrade(tradeId);
    const rawPool = trade.cryptoAmount + trade.makerBond + trade.takerBond;
    await time.increase(145 * 3600);

    const now = await time.latest();
    const expiresAt = now + 3600;

    await expect(escrow.connect(maker).proposeSettlement(tradeId, 3000, expiresAt))
      .to.emit(escrow, "SettlementProposed");

    const treasuryBefore = await mockUSDT.balanceOf(treasury.address);
    const makerBefore = await mockUSDT.balanceOf(maker.address);
    const takerBefore = await mockUSDT.balanceOf(taker.address);
    const acceptTx = await escrow.connect(taker).acceptSettlement(tradeId);
    const acceptReceipt = await acceptTx.wait();
    const decayedEvent = await firstEventArgs(acceptReceipt, escrow.interface, "BleedingDecayed");
    const finalizedEvent = await firstEventArgs(acceptReceipt, escrow.interface, "SettlementFinalized");
    const eventDecayed = decayedEvent.decayedAmount;

    const currentPool = rawPool - eventDecayed;
    const makerGross = (currentPool * 3000n) / 10_000n;
    const takerGross = currentPool - makerGross;
    const makerFee = (makerGross * trade.makerFeeBpsSnapshot) / 10_000n;
    const takerFee = (takerGross * trade.takerFeeBpsSnapshot) / 10_000n;
    const makerExpected = makerGross - makerFee;
    const takerExpected = takerGross - takerFee;

    const makerAfter = await mockUSDT.balanceOf(maker.address);
    const takerAfter = await mockUSDT.balanceOf(taker.address);
    const treasuryAfter = await mockUSDT.balanceOf(treasury.address);

    expect(makerAfter - makerBefore).to.equal(makerExpected);
    expect(takerAfter - takerBefore).to.equal(takerExpected);
    expect(treasuryAfter - treasuryBefore).to.equal(eventDecayed + makerFee + takerFee);
    expect(finalizedEvent.makerPayout).to.equal(makerExpected);
    expect(finalizedEvent.takerPayout).to.equal(takerExpected);
    expect(finalizedEvent.makerFee).to.equal(makerFee);
    expect(finalizedEvent.takerFee).to.equal(takerFee);
    expect((await escrow.getTrade(tradeId)).state).to.equal(4); // RESOLVED
    expect((await escrow.getSettlementProposal(tradeId)).state).to.equal(5); // FINALIZED
  });

  it("security_partial_settlement_increments_agreed_counter_without_failure_or_risk_penalty", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "partial-reputation" });
    const now = await time.latest();

    const makerRepBefore = await escrow.getReputation(maker.address);
    const takerRepBefore = await escrow.getReputation(taker.address);

    await escrow.connect(maker).proposeSettlement(tradeId, 7000, now + 3600);
    await escrow.connect(taker).acceptSettlement(tradeId);

    const makerRepAfter = await escrow.getReputation(maker.address);
    const takerRepAfter = await escrow.getReputation(taker.address);

    expect(makerRepAfter.successful).to.equal(makerRepBefore.successful + 1n);
    expect(takerRepAfter.successful).to.equal(takerRepBefore.successful + 1n);
    expect(makerRepAfter.partialSettlementCount).to.equal(makerRepBefore.partialSettlementCount + 1n);
    expect(takerRepAfter.partialSettlementCount).to.equal(takerRepBefore.partialSettlementCount + 1n);
    expect(makerRepAfter.failed).to.equal(makerRepBefore.failed);
    expect(takerRepAfter.failed).to.equal(takerRepBefore.failed);
    expect(makerRepAfter.riskPoints).to.equal(makerRepBefore.riskPoints);
    expect(takerRepAfter.riskPoints).to.equal(takerRepBefore.riskPoints);
  });

  it("taker proposal accepted by maker finalizes with deterministic rounding on net payouts", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "t-proposes" });

    const trade = await escrow.getTrade(tradeId);
    const rawPool = trade.cryptoAmount + trade.makerBond + trade.takerBond;
    await time.increase(145 * 3600);

    const now = await time.latest();
    await escrow.connect(taker).proposeSettlement(tradeId, 1250, now + 3600);

    const makerBefore = await mockUSDT.balanceOf(maker.address);
    const takerBefore = await mockUSDT.balanceOf(taker.address);
    const acceptTx = await escrow.connect(maker).acceptSettlement(tradeId);
    const acceptReceipt = await acceptTx.wait();
    const decayedEvent = await firstEventArgs(acceptReceipt, escrow.interface, "BleedingDecayed");
    const eventDecayed = decayedEvent.decayedAmount;
    const currentPool = rawPool - eventDecayed;
    const makerGross = (currentPool * 1250n) / 10_000n;
    const takerGross = currentPool - makerGross;
    const makerExpected = makerGross - ((makerGross * trade.makerFeeBpsSnapshot) / 10_000n);
    const takerExpected = takerGross - ((takerGross * trade.takerFeeBpsSnapshot) / 10_000n);
    const makerAfter = await mockUSDT.balanceOf(maker.address);
    const takerAfter = await mockUSDT.balanceOf(taker.address);

    expect(makerAfter - makerBefore).to.equal(makerExpected);
    expect(takerAfter - takerBefore).to.equal(takerExpected);
  });

  it("only counterparty can accept or reject settlement proposal", async () => {
    const { escrow, mockUSDT, maker, taker, outsider } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "counterparty-guard" });

    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 3600);

    await expect(escrow.connect(maker).acceptSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "OnlySettlementCounterparty");
    await expect(escrow.connect(maker).rejectSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "OnlySettlementCounterparty");
    await expect(escrow.connect(outsider).acceptSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "NotTradeParty");
    await expect(escrow.connect(outsider).rejectSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "NotTradeParty");
  });

  it("security_non_party_cannot_propose_settlement", async () => {
    const { escrow, mockUSDT, maker, taker, outsider } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "outsider-propose" });

    const now = await time.latest();
    await expect(escrow.connect(outsider).proposeSettlement(tradeId, 5000, now + 3600))
      .to.be.revertedWithCustomError(escrow, "NotTradeParty");
  });

  it("security_non_counterparty_cannot_reject_settlement", async () => {
    const { escrow, mockUSDT, maker, taker, outsider } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "reject-guard" });

    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 3600);

    await expect(escrow.connect(maker).rejectSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "OnlySettlementCounterparty");
    await expect(escrow.connect(outsider).rejectSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "NotTradeParty");
  });

  it("proposer can withdraw active settlement proposal", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "withdraw" });

    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 3600);
    await expect(escrow.connect(maker).withdrawSettlement(tradeId))
      .to.emit(escrow, "SettlementWithdrawn");

    expect((await escrow.getSettlementProposal(tradeId)).state).to.equal(3); // WITHDRAWN
  });

  it("expired settlement proposal cannot be accepted", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "expiry" });

    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 601);
    await time.increase(700);

    await expect(escrow.connect(taker).acceptSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementProposalExpired");
  });

  it("cannot propose settlement when trade is LOCKED or PAID (only CHALLENGED allowed)", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "state-guard" });
    const now = await time.latest();

    await expect(escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 3600))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");

    await escrow.connect(taker).reportPayment(tradeId, "QmPaid");
    await expect(escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 3700))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
  });

  it("cannot propose settlement for terminal RESOLVED trades", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "terminal" });
    await escrow.connect(taker).reportPayment(tradeId, "QmTerminal");
    await escrow.connect(maker).releaseFunds(tradeId);
    const now = await time.latest();
    await expect(escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 3600))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
  });

  it("reverts when settlement split does not sum to 10000 bps", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "invalid-split" });

    const now = await time.latest();
    await expect(escrow.connect(maker).proposeSettlement(tradeId, 10_001, now + 3600))
      .to.be.revertedWithCustomError(escrow, "InvalidSettlementSplit");
  });

  it("disallows opening a second active settlement proposal for same trade", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "single-active" });

    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 3600);
    await expect(escrow.connect(taker).proposeSettlement(tradeId, 6000, now + 3700))
      .to.be.revertedWithCustomError(escrow, "ActiveSettlementProposalExists");
  });

  it("after settlement finalization, release/cancel/burn paths are blocked by terminal state", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "terminal-block" });

    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 3600);
    await escrow.connect(taker).acceptSettlement(tradeId);

    await expect(escrow.connect(maker).releaseFunds(tradeId))
      .to.be.revertedWithCustomError(escrow, "CannotReleaseInState");

    const deadline = (await time.latest()) + 3600;
    const makerSig = await cancelSig({ escrow, signer: maker, tradeId, deadline });
    await expect(escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig))
      .to.be.revertedWithCustomError(escrow, "CannotReleaseInState");

    await expect(escrow.burnExpired(tradeId))
      .to.be.revertedWithCustomError(escrow, "InvalidState");
  });

  it("security_no_hidden_admin_or_backend_authority_on_partial_settlement", async () => {
    const { escrow, mockUSDT, owner, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "no-admin-authority" });

    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 7000, now + 3600);

    await expect(escrow.connect(owner).acceptSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "NotTradeParty");
    await expect(escrow.connect(owner).rejectSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "NotTradeParty");
    await expect(escrow.connect(owner).withdrawSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "OnlySettlementProposer");
  });

  it("security_challenged_settlement_transfers_decayed_amount_to_treasury", async () => {
    const { escrow, mockUSDT, treasury, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "challenged-decay" });

    await time.increase(145 * 3600);
    const now = await time.latest();
    await escrow.connect(maker).proposeSettlement(tradeId, 6500, now + 3600);

    const treasuryBefore = await mockUSDT.balanceOf(treasury.address);
    const makerBefore = await mockUSDT.balanceOf(maker.address);
    const takerBefore = await mockUSDT.balanceOf(taker.address);

    const acceptTx = await escrow.connect(taker).acceptSettlement(tradeId);
    const acceptReceipt = await acceptTx.wait();
    const decayedEvent = await firstEventArgs(acceptReceipt, escrow.interface, "BleedingDecayed");
    const finalizedEvent = await firstEventArgs(acceptReceipt, escrow.interface, "SettlementFinalized");
    const eventDecayed = decayedEvent.decayedAmount;
    const eventMakerPayout = finalizedEvent.makerPayout;
    const eventTakerPayout = finalizedEvent.takerPayout;

    const treasuryAfter = await mockUSDT.balanceOf(treasury.address);
    const makerAfter = await mockUSDT.balanceOf(maker.address);
    const takerAfter = await mockUSDT.balanceOf(taker.address);

    expect(eventDecayed).to.be.gt(0n);
    expect(treasuryAfter - treasuryBefore).to.equal(eventDecayed + finalizedEvent.makerFee + finalizedEvent.takerFee);
    expect(makerAfter - makerBefore).to.equal(eventMakerPayout);
    expect(takerAfter - takerBefore).to.equal(eventTakerPayout);
  });

  it("security_settlement_split_uses_current_pool_and_conserves_raw_locked_pool", async () => {
    const { escrow, mockUSDT, treasury, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "challenged-conservation" });
    const trade = await escrow.getTrade(tradeId);
    const rawPool = trade.cryptoAmount + trade.makerBond + trade.takerBond;

    await time.increase(145 * 3600);
    const now = await time.latest();
    await escrow.connect(taker).proposeSettlement(tradeId, 3333, now + 3600);

    const treasuryBefore = await mockUSDT.balanceOf(treasury.address);
    const makerBefore = await mockUSDT.balanceOf(maker.address);
    const takerBefore = await mockUSDT.balanceOf(taker.address);
    const acceptTx = await escrow.connect(maker).acceptSettlement(tradeId);
    const acceptReceipt = await acceptTx.wait();
    const decayedEvent = await firstEventArgs(acceptReceipt, escrow.interface, "BleedingDecayed");
    const finalizedEvent = await firstEventArgs(acceptReceipt, escrow.interface, "SettlementFinalized");
    const treasuryAfter = await mockUSDT.balanceOf(treasury.address);
    const makerAfter = await mockUSDT.balanceOf(maker.address);
    const takerAfter = await mockUSDT.balanceOf(taker.address);

    const makerDelta = makerAfter - makerBefore;
    const takerDelta = takerAfter - takerBefore;
    const treasuryDelta = treasuryAfter - treasuryBefore;
    const eventDecayed = decayedEvent.decayedAmount;
    const eventMakerPayout = finalizedEvent.makerPayout;
    const eventTakerPayout = finalizedEvent.takerPayout;

    expect(makerDelta).to.equal(eventMakerPayout);
    expect(takerDelta).to.equal(eventTakerPayout);
    expect(treasuryDelta).to.equal(eventDecayed + finalizedEvent.makerFee + finalizedEvent.takerFee);
    expect(makerDelta + takerDelta + eventDecayed + finalizedEvent.makerFee + finalizedEvent.takerFee).to.equal(rawPool);
    expect(makerDelta + takerDelta + treasuryDelta).to.equal(rawPool);
  });

  it("security_active_settlement_proposal_becomes_non_actionable_after_mutual_cancel_terminalization", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "cancel-terminal-non-actionable" });
    const now = await time.latest();

    await escrow.connect(maker).proposeSettlement(tradeId, 6200, now + 7200);

    const deadline = (await time.latest()) + 3600;
    const makerSig = await cancelSig({ escrow, signer: maker, tradeId, deadline });
    const takerSig = await cancelSig({ escrow, signer: taker, tradeId, deadline });
    await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);
    await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);

    expect((await escrow.getTrade(tradeId)).state).to.equal(5); // CANCELED
    expect((await escrow.getSettlementProposal(tradeId)).state).to.equal(1); // PROPOSED (frozen)

    await expect(escrow.connect(taker).rejectSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
    await expect(escrow.connect(maker).withdrawSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
    await expect(escrow.connect(maker).expireSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
  });

  it("security_active_settlement_proposal_becomes_non_actionable_after_burn_terminalization", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "burn-terminal-non-actionable" });
    const now = await time.latest();

    await escrow.connect(maker).proposeSettlement(tradeId, 5100, now + 7200);
    await time.increase(241 * 3600);
    await escrow.burnExpired(tradeId);

    expect((await escrow.getTrade(tradeId)).state).to.equal(6); // BURNED
    expect((await escrow.getSettlementProposal(tradeId)).state).to.equal(1); // PROPOSED (frozen)

    await expect(escrow.connect(taker).rejectSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
    await expect(escrow.connect(maker).withdrawSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
    await expect(escrow.connect(maker).expireSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
  });

  it("security_settlement_actions_revert_after_release_terminalization", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "release-terminal-settlement-guard" });

    await escrow.connect(taker).reportPayment(tradeId, "QmReleaseTerminal");
    await escrow.connect(maker).releaseFunds(tradeId);
    expect((await escrow.getTrade(tradeId)).state).to.equal(4); // RESOLVED

    await expect(escrow.connect(taker).acceptSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
    await expect(escrow.connect(taker).rejectSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
    await expect(escrow.connect(maker).withdrawSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
    await expect(escrow.connect(maker).expireSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
  });

  it("security_settlement_actions_revert_after_settlement_terminalization", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openChallengedTrade({ escrow, maker, taker, token, label: "settlement-terminal-guard" });
    const now = await time.latest();

    await escrow.connect(maker).proposeSettlement(tradeId, 5000, now + 3600);
    await escrow.connect(taker).acceptSettlement(tradeId);
    expect((await escrow.getTrade(tradeId)).state).to.equal(4); // RESOLVED
    expect((await escrow.getSettlementProposal(tradeId)).state).to.equal(5); // FINALIZED

    await expect(escrow.connect(taker).acceptSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
    await expect(escrow.connect(taker).rejectSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
    await expect(escrow.connect(maker).withdrawSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
    await expect(escrow.connect(maker).expireSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
  });

  it("acceptSettlement reverts in PAID state even with active proposal", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "paid-no-decay" });
    await escrow.connect(taker).reportPayment(tradeId, "Qm-paid-no-decay");
    await expect(escrow.connect(taker).acceptSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
  });

  it("acceptSettlement reverts in LOCKED state with SettlementNotAllowedInState", async () => {
    const { escrow, mockUSDT, maker, taker } = await loadFixture(deployFixture);
    const token = await mockUSDT.getAddress();
    const tradeId = await openLockedTrade({ escrow, maker, taker, token, label: "locked-accept-revert" });
    await expect(escrow.connect(taker).acceptSettlement(tradeId))
      .to.be.revertedWithCustomError(escrow, "SettlementNotAllowedInState");
  });
});
