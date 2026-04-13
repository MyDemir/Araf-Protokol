
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * ArafEscrow — Updated V3 Full Test Suite
 *
 * Scope:
 * - Legacy escrow regression (canonical listingRef path)
 * - V3 parent sell orders
 * - V3 parent buy orders
 * - Parent/child accounting
 * - Fee snapshots
 * - Mutable fee / cooldown / token config
 * - Same-tx event ordering
 * - Pause semantics
 *
 * Notes:
 * - This suite intentionally keeps the broad coverage style of the previous file.
 * - Legacy createEscrow(address,uint256,uint8) is now expected to revert with InvalidListingRef.
 * - Canonical creation now uses createEscrow(address,uint256,uint8,bytes32).
 */

describe("ArafEscrow V3", function () {
  // ── Constants ──────────────────────────────────────────────────────────────

  const USDT_DECIMALS = 6;
  const TRADE_AMOUNT  = ethers.parseUnits("1000", USDT_DECIMALS);
  const TIER0_AMOUNT  = ethers.parseUnits("100", USDT_DECIMALS);
  const INITIAL_BAL   = ethers.parseUnits("50000", USDT_DECIMALS);
  const BASELINE_SUCCESS = 200n;

  const SEVEN_DAYS     = 7 * 24 * 3600;
  const FORTY_EIGHT_H  = 48 * 3600;
  const TWENTY_FOUR_H  = 24 * 3600;
  const FOUR_HOURS     = 4 * 3600;
  const ONE_HOUR       = 3600;
  const TEN_DAYS       = 10 * 24 * 3600;
  const THIRTY_DAYS    = 30 * 24 * 3600;
  const SIXTY_DAYS     = 60 * 24 * 3600;
  const BPS_DENOM      = 10000n;

  let escrow, mockUSDT;
  let owner, treasury, maker, taker, attacker, stranger;

  // ── Utility helpers ────────────────────────────────────────────────────────

  function makeRef(label) {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  function bn(x) {
    return BigInt(x);
  }

  async function parseLogsByName(receipt, iface, eventName) {
    return receipt.logs
      .map((l) => {
        try { return iface.parseLog(l); } catch { return null; }
      })
      .filter(Boolean)
      .filter((p) => p.name === eventName);
  }

  async function firstEventArgs(receipt, iface, eventName) {
    const parsed = await parseLogsByName(receipt, iface, eventName);
    expect(parsed.length).to.be.gt(0);
    return parsed[0].args;
  }

  async function extractOrderedParsedLogs(receipt, iface) {
    return receipt.logs
      .map((l) => {
        try { return iface.parseLog(l); } catch { return null; }
      })
      .filter(Boolean);
  }

  async function getFeeConfig() {
    const [takerFeeBps, makerFeeBps] = await escrow.getFeeConfig();
    return { takerFeeBps: bn(takerFeeBps), makerFeeBps: bn(makerFeeBps) };
  }

  async function getCooldownConfig() {
    const [tier0TradeCooldown, tier1TradeCooldown] = await escrow.getCooldownConfig();
    return { tier0TradeCooldown: bn(tier0TradeCooldown), tier1TradeCooldown: bn(tier1TradeCooldown) };
  }

  async function getMakerBondBaseBps(tier) {
    if (tier === 0) return bn(await escrow.MAKER_BOND_TIER0_BPS());
    if (tier === 1) return bn(await escrow.MAKER_BOND_TIER1_BPS());
    if (tier === 2) return bn(await escrow.MAKER_BOND_TIER2_BPS());
    if (tier === 3) return bn(await escrow.MAKER_BOND_TIER3_BPS());
    return bn(await escrow.MAKER_BOND_TIER4_BPS());
  }

  async function getTakerBondBaseBps(tier) {
    if (tier === 0) return bn(await escrow.TAKER_BOND_TIER0_BPS());
    if (tier === 1) return bn(await escrow.TAKER_BOND_TIER1_BPS());
    if (tier === 2) return bn(await escrow.TAKER_BOND_TIER2_BPS());
    if (tier === 3) return bn(await escrow.TAKER_BOND_TIER3_BPS());
    return bn(await escrow.TAKER_BOND_TIER4_BPS());
  }

  async function discountedBps(baseBps) {
    const discount = bn(await escrow.GOOD_REP_DISCOUNT_BPS());
    return baseBps > discount ? baseBps - discount : 0n;
  }

  async function makerBondFor(wallet, amount, tier) {
    const [successful, failed] = await escrow.getReputation(wallet.address);
    let bps = await getMakerBondBaseBps(tier);
    if (bn(failed) === 0n && bn(successful) > 0n) {
      bps = await discountedBps(bps);
    } else if (bn(failed) >= 1n) {
      bps += bn(await escrow.BAD_REP_PENALTY_BPS());
    }
    return (amount * bps) / BPS_DENOM;
  }

  async function takerBondFor(wallet, amount, tier) {
    const [successful, failed] = await escrow.getReputation(wallet.address);
    let bps = await getTakerBondBaseBps(tier);
    if (bn(failed) === 0n && bn(successful) > 0n) {
      bps = await discountedBps(bps);
    } else if (bn(failed) >= 1n) {
      bps += bn(await escrow.BAD_REP_PENALTY_BPS());
    }
    return (amount * bps) / BPS_DENOM;
  }

  async function calcReleaseFees(amount, tier, makerBondCurrent) {
    const { takerFeeBps, makerFeeBps } = await getFeeConfig();
    const makerFeeBpsForTier = tier === 0 ? 0n : makerFeeBps;
    const takerFee = (amount * takerFeeBps) / BPS_DENOM;
    const quotedMakerFee = (amount * makerFeeBpsForTier) / BPS_DENOM;
    const actualMakerFee = makerBondCurrent > quotedMakerFee ? quotedMakerFee : makerBondCurrent;
    const makerBondBack = makerBondCurrent > quotedMakerFee ? makerBondCurrent - quotedMakerFee : 0n;
    return {
      takerFee,
      takerReceives: amount - takerFee,
      makerFee: actualMakerFee,
      makerBondBack,
      totalTreasury: takerFee + actualMakerFee,
    };
  }

  async function setupTrade(tierLevel = 2, amount = null, label = "legacy") {
    const tradeAmount = amount ?? (tierLevel === 0 ? TIER0_AMOUNT : TRADE_AMOUNT);
    const listingRef = makeRef(`listing:${label}:${tierLevel}:${tradeAmount.toString()}:${Date.now()}:${Math.random()}`);
    const tx = await escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
      await mockUSDT.getAddress(),
      tradeAmount,
      tierLevel,
      listingRef
    );
    const receipt = await tx.wait();
    const args = await firstEventArgs(receipt, escrow.interface, "EscrowCreated");
    return args.tradeId;
  }

  async function setupSellOrder({
    ownerSigner = maker,
    totalAmount = TRADE_AMOUNT,
    minFillAmount = ethers.parseUnits("200", USDT_DECIMALS),
    tier = 2,
    label = "sell-order",
  } = {}) {
    const orderRef = makeRef(`order:${label}:${tier}:${totalAmount.toString()}:${minFillAmount.toString()}:${Date.now()}:${Math.random()}`);
    const tx = await escrow.connect(ownerSigner).createSellOrder(
      await mockUSDT.getAddress(),
      totalAmount,
      minFillAmount,
      tier,
      orderRef
    );
    const receipt = await tx.wait();
    const args = await firstEventArgs(receipt, escrow.interface, "OrderCreated");
    return { orderId: args.orderId, orderRef, receipt };
  }

  async function setupBuyOrder({
    ownerSigner = taker,
    totalAmount = TRADE_AMOUNT,
    minFillAmount = ethers.parseUnits("200", USDT_DECIMALS),
    tier = 2,
    label = "buy-order",
  } = {}) {
    const orderRef = makeRef(`order:${label}:${tier}:${totalAmount.toString()}:${minFillAmount.toString()}:${Date.now()}:${Math.random()}`);
    const tx = await escrow.connect(ownerSigner).createBuyOrder(
      await mockUSDT.getAddress(),
      totalAmount,
      minFillAmount,
      tier,
      orderRef
    );
    const receipt = await tx.wait();
    const args = await firstEventArgs(receipt, escrow.interface, "OrderCreated");
    return { orderId: args.orderId, orderRef, receipt };
  }

  async function fillSellOrder({ orderId, takerSigner = taker, fillAmount, label = "sell-fill" }) {
    const childListingRef = makeRef(`child:${label}:${fillAmount.toString()}:${Date.now()}:${Math.random()}`);
    const tx = await escrow.connect(takerSigner).fillSellOrder(orderId, fillAmount, childListingRef);
    const receipt = await tx.wait();
    const args = await firstEventArgs(receipt, escrow.interface, "OrderFilled");
    return { tradeId: args.tradeId, childListingRef, receipt };
  }

  async function fillBuyOrder({ orderId, makerSigner = maker, fillAmount, label = "buy-fill" }) {
    const childListingRef = makeRef(`child:${label}:${fillAmount.toString()}:${Date.now()}:${Math.random()}`);
    const tx = await escrow.connect(makerSigner).fillBuyOrder(orderId, fillAmount, childListingRef);
    const receipt = await tx.wait();
    const args = await firstEventArgs(receipt, escrow.interface, "OrderFilled");
    return { tradeId: args.tradeId, childListingRef, receipt };
  }

  async function eip712CancelSig(signer, tradeId, nonce, deadline) {
    const domain = {
      name: "ArafEscrow",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await escrow.getAddress(),
    };
    const types = {
      CancelProposal: [
        { name: "tradeId",  type: "uint256" },
        { name: "proposer", type: "address" },
        { name: "nonce",    type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    return signer.signTypedData(domain, types, {
      tradeId,
      proposer: signer.address,
      nonce,
      deadline,
    });
  }

  async function collaborativeCancel(tradeId) {
    const deadline = (await time.latest()) + 3600;
    const makerSig = await eip712CancelSig(maker, tradeId, await escrow.sigNonces(maker.address), deadline);
    await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);
    const trade = await escrow.getTrade(tradeId);
    const takerSigner = trade.taker.toLowerCase() === taker.address.toLowerCase() ? taker : attacker;
    const takerSig = await eip712CancelSig(
      takerSigner,
      tradeId,
      await escrow.sigNonces(takerSigner.address),
      deadline
    );
    await escrow.connect(takerSigner).proposeOrApproveCancel(tradeId, deadline, takerSig);
  }

  async function giveBanToMaker() {
    for (let i = 0; i < 2; i++) {
      const tradeId = await setupTrade(0, TIER0_AMOUNT, `ban-maker-${i}`);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, `QmBan${i}`);
      await time.increase(FORTY_EIGHT_H + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(taker).autoRelease(tradeId);
    }
  }

  async function deployAndSetupFixture() {
    const [owner, treasury, maker, taker, attacker, stranger] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockUSDT = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);

    const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await ArafEscrow.deploy(treasury.address);

    const tokenAddr = await mockUSDT.getAddress();
    const escrowAddr = await escrow.getAddress();

    await escrow.connect(owner).setSupportedToken(tokenAddr, true);

    await mockUSDT.mint(maker.address, INITIAL_BAL);
    await mockUSDT.mint(taker.address, INITIAL_BAL);
    await mockUSDT.mint(attacker.address, INITIAL_BAL);

    await mockUSDT.connect(maker).approve(escrowAddr, ethers.MaxUint256);
    await mockUSDT.connect(taker).approve(escrowAddr, ethers.MaxUint256);
    await mockUSDT.connect(attacker).approve(escrowAddr, ethers.MaxUint256);

    await escrow.connect(maker).registerWallet();
    await escrow.connect(taker).registerWallet();
    await escrow.connect(attacker).registerWallet();
    await time.increase(SEVEN_DAYS + 1);

    await owner.sendTransaction({ to: taker.address, value: ethers.parseEther("0.1") });
    await owner.sendTransaction({ to: attacker.address, value: ethers.parseEther("0.1") });

    // Warm up maker and taker into high reputation / Tier 4.
    const dummyAmount = ethers.parseUnits("1", USDT_DECIMALS);
    for (let i = 0; i < Number(BASELINE_SUCCESS); i++) {
      const listingRef = makeRef(`boost:${i}`);
      const tx = await escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
        tokenAddr,
        dummyAmount,
        0,
        listingRef
      );
      const receipt = await tx.wait();
      const args = await firstEventArgs(receipt, escrow.interface, "EscrowCreated");
      const tradeId = args.tradeId;

      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "boost");
      await escrow.connect(maker).releaseFunds(tradeId);

      await time.increase(FOUR_HOURS + 1);
    }

    return { escrow, mockUSDT, owner, treasury, maker, taker, attacker, stranger };
  }

  beforeEach(async () => {
    const f = await loadFixture(deployAndSetupFixture);
    escrow = f.escrow;
    mockUSDT = f.mockUSDT;
    owner = f.owner;
    treasury = f.treasury;
    maker = f.maker;
    taker = f.taker;
    attacker = f.attacker;
    stranger = f.stranger;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. LEGACY REGRESSION — Canonical createEscrow path
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Legacy Escrow Regression", () => {
    it("legacy 3-arg createEscrow intentionally reverts with InvalidListingRef", async () => {
      await expect(
        escrow.connect(maker).createEscrow(await mockUSDT.getAddress(), TRADE_AMOUNT, 2)
      ).to.be.revertedWithCustomError(escrow, "InvalidListingRef");
    });

    it("canonical createEscrow emits authoritative listingRef", async () => {
      const listingRef = makeRef("legacy:authoritative-listing");
      const tx = await escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
        await mockUSDT.getAddress(),
        TRADE_AMOUNT,
        2,
        listingRef
      );
      const receipt = await tx.wait();
      const args = await firstEventArgs(receipt, escrow.interface, "EscrowCreated");
      expect(args.listingRef).to.equal(listingRef);
    });

    it("full lifecycle: OPEN → LOCKED → PAID → RESOLVED", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-happy");

      await escrow.connect(taker).lockEscrow(tradeId);
      expect((await escrow.getTrade(tradeId)).state).to.equal(1);

      await escrow.connect(taker).reportPayment(tradeId, "QmTestHashABC123");
      expect((await escrow.getTrade(tradeId)).state).to.equal(2);

      const makerBond = await makerBondFor(maker, TRADE_AMOUNT, 2);
      const takerBond = await takerBondFor(taker, TRADE_AMOUNT, 2);
      const { takerReceives, makerBondBack } = await calcReleaseFees(TRADE_AMOUNT, 2, makerBond);

      const takerBefore = await mockUSDT.balanceOf(taker.address);
      const makerBefore = await mockUSDT.balanceOf(maker.address);
      await escrow.connect(maker).releaseFunds(tradeId);

      expect((await mockUSDT.balanceOf(taker.address)) - takerBefore)
        .to.equal(takerReceives + takerBond);
      expect((await mockUSDT.balanceOf(maker.address)) - makerBefore)
        .to.equal(makerBondBack);
      expect((await escrow.getTrade(tradeId)).state).to.equal(4);
    });

    it("taker can auto-release after 48h + 24h wait", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-auto-release");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmAutoRelease");

      await time.increase(FORTY_EIGHT_H + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      expect((await escrow.getTrade(tradeId)).pingedByTaker).to.equal(true);

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(taker).autoRelease(tradeId);

      expect((await escrow.getTrade(tradeId)).state).to.equal(4);
      const [, makerFailed] = await escrow.getReputation(maker.address);
      expect(makerFailed).to.equal(1n);
    });

    it("successful trade increments both parties reputation", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-reputation");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await escrow.connect(maker).releaseFunds(tradeId);

      const [makerSucc] = await escrow.getReputation(maker.address);
      const [takerSucc] = await escrow.getReputation(taker.address);
      expect(makerSucc).to.equal(BASELINE_SUCCESS + 1n);
      expect(takerSucc).to.equal(BASELINE_SUCCESS + 1n);
    });

    it("S1: autoRelease → maker +1 failed, taker +1 successful", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-s1");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(FORTY_EIGHT_H + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(taker).autoRelease(tradeId);

      const [makerSucc, makerFail] = await escrow.getReputation(maker.address);
      const [takerSucc, takerFail] = await escrow.getReputation(taker.address);
      expect(makerSucc).to.equal(BASELINE_SUCCESS);
      expect(makerFail).to.equal(1n);
      expect(takerSucc).to.equal(BASELINE_SUCCESS + 1n);
      expect(takerFail).to.equal(0n);
    });

    it("S2: releaseFunds from CHALLENGED → maker +1 failed", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-s2");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      await escrow.connect(maker).releaseFunds(tradeId);

      const [, makerFail] = await escrow.getReputation(maker.address);
      const [takerSucc, takerFail] = await escrow.getReputation(taker.address);
      expect(makerFail).to.equal(1n);
      expect(takerSucc).to.equal(BASELINE_SUCCESS + 1n);
      expect(takerFail).to.equal(0n);
    });

    it("S3: collaborative cancel from CHALLENGED → no reputation penalty", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-s3");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      await collaborativeCancel(tradeId);

      expect((await escrow.getTrade(tradeId)).state).to.equal(5);
      const [, makerFail] = await escrow.getReputation(maker.address);
      const [, takerFail] = await escrow.getReputation(taker.address);
      expect(makerFail).to.equal(0n);
      expect(takerFail).to.equal(0n);
    });

    it("maker can cancel OPEN escrow and receive full refund", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-open-cancel");
      const makerBond = await makerBondFor(maker, TRADE_AMOUNT, 2);
      const makerBefore = await mockUSDT.balanceOf(maker.address);

      await escrow.connect(maker).cancelOpenEscrow(tradeId);

      expect((await mockUSDT.balanceOf(maker.address)) - makerBefore)
        .to.equal(TRADE_AMOUNT + makerBond);
      expect((await escrow.getTrade(tradeId)).state).to.equal(5);
    });

    it("taker and stranger cannot cancel OPEN escrow", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-open-cancel-guards");
      await expect(escrow.connect(taker).cancelOpenEscrow(tradeId))
        .to.be.revertedWithCustomError(escrow, "OnlyMaker");
      await expect(escrow.connect(stranger).cancelOpenEscrow(tradeId))
        .to.be.revertedWithCustomError(escrow, "OnlyMaker");
    });

    it("tier 0 maker and taker bonds are zero", async () => {
      const tradeId = await setupTrade(0, TIER0_AMOUNT, "legacy-tier0-bonds");
      const trade = await escrow.getTrade(tradeId);
      expect(trade.makerBond).to.equal(0n);

      const takerBefore = await mockUSDT.balanceOf(taker.address);
      await escrow.connect(taker).lockEscrow(tradeId);
      expect(await mockUSDT.balanceOf(taker.address)).to.equal(takerBefore);
      expect((await escrow.getTrade(tradeId)).takerBond).to.equal(0n);
    });

    it("tier 0 happy path charges taker fee but maker fee remains zero", async () => {
      const tradeId = await setupTrade(0, TIER0_AMOUNT, "legacy-tier0-release");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      const { takerReceives } = await calcReleaseFees(TIER0_AMOUNT, 0, 0n);
      const takerBefore = await mockUSDT.balanceOf(taker.address);
      const makerBefore = await mockUSDT.balanceOf(maker.address);
      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);

      await escrow.connect(maker).releaseFunds(tradeId);

      expect((await mockUSDT.balanceOf(taker.address)) - takerBefore).to.equal(takerReceives);
      expect((await mockUSDT.balanceOf(maker.address)) - makerBefore).to.equal(0n);
      expect((await mockUSDT.balanceOf(treasury.address)) - treasuryBefore)
        .to.equal((TIER0_AMOUNT * (await getFeeConfig()).takerFeeBps) / BPS_DENOM);
    });

    it("tier 0 dispute only decays crypto; no bonds to bleed", async () => {
      const tradeId = await setupTrade(0, TIER0_AMOUNT, "legacy-tier0-bleed");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      await time.increase(FORTY_EIGHT_H + 97 * ONE_HOUR);
      const [currentCrypto, currentMakerBond, currentTakerBond] = await escrow.getCurrentAmounts(tradeId);
      expect(currentMakerBond).to.equal(0n);
      expect(currentTakerBond).to.equal(0n);
      expect(currentCrypto).to.be.lt(TIER0_AMOUNT);
    });

    it("4-hour cooldown enforced between Tier 0 trades", async () => {
      const tradeId1 = await setupTrade(0, TIER0_AMOUNT, "legacy-tier0-cooldown-1");
      await escrow.connect(taker).lockEscrow(tradeId1);
      const tradeId2 = await setupTrade(0, TIER0_AMOUNT, "legacy-tier0-cooldown-2");

      await expect(escrow.connect(taker).lockEscrow(tradeId2))
        .to.be.revertedWithCustomError(escrow, "TierCooldownActive");
    });

    it("second Tier 0 trade succeeds after 4-hour cooldown passes", async () => {
      const tradeId1 = await setupTrade(0, TIER0_AMOUNT, "legacy-tier0-cooldown-pass-1");
      await escrow.connect(taker).lockEscrow(tradeId1);
      const tradeId2 = await setupTrade(0, TIER0_AMOUNT, "legacy-tier0-cooldown-pass-2");

      await time.increase(FOUR_HOURS + 1);
      await expect(escrow.connect(taker).lockEscrow(tradeId2)).to.not.be.reverted;
    });

    it("tier amount limits are still enforced on canonical createEscrow", async () => {
      const over0 = ethers.parseUnits("151", USDT_DECIMALS);
      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await mockUSDT.getAddress(), over0, 0, makeRef("tier0-over")
        )
      ).to.be.revertedWithCustomError(escrow, "AmountExceedsTierLimit");

      const at0 = ethers.parseUnits("150", USDT_DECIMALS);
      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await mockUSDT.getAddress(), at0, 0, makeRef("tier0-at")
        )
      ).to.not.be.reverted;

      const over1 = ethers.parseUnits("1501", USDT_DECIMALS);
      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await mockUSDT.getAddress(), over1, 1, makeRef("tier1-over")
        )
      ).to.be.revertedWithCustomError(escrow, "AmountExceedsTierLimit");

      const over2 = ethers.parseUnits("7501", USDT_DECIMALS);
      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await mockUSDT.getAddress(), over2, 2, makeRef("tier2-over")
        )
      ).to.be.revertedWithCustomError(escrow, "AmountExceedsTierLimit");

      const over3 = ethers.parseUnits("30001", USDT_DECIMALS);
      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await mockUSDT.getAddress(), over3, 3, makeRef("tier3-over")
        )
      ).to.be.revertedWithCustomError(escrow, "AmountExceedsTierLimit");
    });

    it("anti-sybil blocks self-trade", async () => {
      const tradeId = await setupTrade(1, TRADE_AMOUNT, "legacy-self-trade");
      await expect(escrow.connect(maker).lockEscrow(tradeId))
        .to.be.revertedWithCustomError(escrow, "SelfTradeForbidden");
    });

    it("anti-sybil blocks unregistered wallet", async () => {
      const tradeId = await setupTrade(1, TRADE_AMOUNT, "legacy-unregistered");
      await expect(escrow.connect(stranger).lockEscrow(tradeId))
        .to.be.revertedWithCustomError(escrow, "WalletTooYoung");
    });

    it("anti-sybil blocks freshly registered wallet younger than 7 days", async () => {
      const tradeId = await setupTrade(1, TRADE_AMOUNT, "legacy-young-wallet");
      await escrow.connect(stranger).registerWallet();
      await time.increase(3 * 24 * 3600);

      await owner.sendTransaction({ to: stranger.address, value: ethers.parseEther("0.01") });
      await mockUSDT.mint(stranger.address, INITIAL_BAL);
      await mockUSDT.connect(stranger).approve(await escrow.getAddress(), ethers.MaxUint256);

      await expect(escrow.connect(stranger).lockEscrow(tradeId))
        .to.be.revertedWithCustomError(escrow, "WalletTooYoung");
    });

    it("anti-sybil blocks Tier 1 taker on cooldown", async () => {
      const tradeId1 = await setupTrade(1, TRADE_AMOUNT, "legacy-tier1-cooldown-1");
      await escrow.connect(taker).lockEscrow(tradeId1);
      await escrow.connect(taker).reportPayment(tradeId1, "QmHash1");
      await escrow.connect(maker).releaseFunds(tradeId1);

      const tradeId2 = await setupTrade(1, TRADE_AMOUNT, "legacy-tier1-cooldown-2");
      await expect(escrow.connect(taker).lockEscrow(tradeId2))
        .to.be.revertedWithCustomError(escrow, "TierCooldownActive");

      await time.increase(FOUR_HOURS + 1);
      await expect(escrow.connect(taker).lockEscrow(tradeId2)).to.not.be.reverted;
    });

    it("blocks banned takers", async () => {
      for (let i = 0; i < 2; i++) {
        const tradeId = await setupTrade(2, TRADE_AMOUNT, `legacy-ban-taker-${i}`);
        await escrow.connect(taker).lockEscrow(tradeId);
        await escrow.connect(taker).reportPayment(tradeId, `QmHash${i}`);
        await time.increase(TWENTY_FOUR_H + 1);
        await escrow.connect(maker).pingTakerForChallenge(tradeId);
        await time.increase(TWENTY_FOUR_H + 1);
        await escrow.connect(maker).challengeTrade(tradeId);
        await time.increase(TEN_DAYS + 1);
        await escrow.burnExpired(tradeId);
      }

      const newTradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-ban-taker-final");
      await expect(escrow.connect(taker).lockEscrow(newTradeId))
        .to.be.revertedWithCustomError(escrow, "TakerBanActive");
    });

    it("conflicting ping path blocks taker ping after maker ping", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-conflicting-1");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);

      await time.increase(TWENTY_FOUR_H + 1);
      await expect(escrow.connect(taker).pingMaker(tradeId))
        .to.be.revertedWithCustomError(escrow, "ConflictingPingPath");
    });

    it("conflicting ping path blocks maker ping after taker ping", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-conflicting-2");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(FORTY_EIGHT_H + 1);
      await escrow.connect(taker).pingMaker(tradeId);

      await expect(escrow.connect(maker).pingTakerForChallenge(tradeId))
        .to.be.revertedWithCustomError(escrow, "ConflictingPingPath");
    });

    it("challengeTrade reverts without prior pingTakerForChallenge", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-challenge-no-ping");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await expect(escrow.connect(maker).challengeTrade(tradeId))
        .to.be.revertedWithCustomError(escrow, "MustPingFirst");
    });

    it("challengeTrade reverts if response window still active", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-challenge-window");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);

      await expect(escrow.connect(maker).challengeTrade(tradeId))
        .to.be.revertedWithCustomError(escrow, "ResponseWindowActive");
    });

    it("maker can challenge after full ping-wait cycle", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-challenge-ok");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      expect((await escrow.getTrade(tradeId)).state).to.equal(3);
    });

    it("maker can release funds during bleeding", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-release-during-bleeding");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);
      await time.increase(FORTY_EIGHT_H + 2 * 24 * 3600);

      const takerBefore = await mockUSDT.balanceOf(taker.address);
      await escrow.connect(maker).releaseFunds(tradeId);
      expect(await mockUSDT.balanceOf(taker.address)).to.be.gt(takerBefore);
      expect((await escrow.getTrade(tradeId)).state).to.equal(4);
    });

    it("collateral decays per second after grace period", async () => {
      const tradeId = await setupTrade(1, TRADE_AMOUNT, "legacy-decay-per-second");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      const [, mb0,, d0] = await escrow.getCurrentAmounts(tradeId);
      expect(d0).to.equal(0n);

      await time.increase(FORTY_EIGHT_H);
      const [,,, dGrace] = await escrow.getCurrentAmounts(tradeId);
      expect(dGrace).to.equal(0n);

      await time.increase(ONE_HOUR);
      const [, mb1h,, d1h] = await escrow.getCurrentAmounts(tradeId);
      expect(d1h).to.be.gt(0n);
      expect(mb1h).to.be.lt(mb0);

      await time.increase(23 * ONE_HOUR);
      const [, mb24h,, d24h] = await escrow.getCurrentAmounts(tradeId);
      expect(d24h).to.be.gt(d1h);
      expect(mb24h).to.be.lt(mb1h);
    });

    it("crypto decay starts after grace + USDT decay delay", async () => {
      const tradeId = await setupTrade(1, TRADE_AMOUNT, "legacy-crypto-decay-delay");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      await time.increase(FORTY_EIGHT_H + 95 * ONE_HOUR);
      const [crypto143] = await escrow.getCurrentAmounts(tradeId);
      expect(crypto143).to.equal(TRADE_AMOUNT);

      await time.increase(2 * ONE_HOUR);
      const [crypto145] = await escrow.getCurrentAmounts(tradeId);
      expect(crypto145).to.be.lt(TRADE_AMOUNT);
    });

    it("burnExpired transfers remaining funds to treasury after max bleeding", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-burn");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);
      await time.increase(TEN_DAYS + 1);

      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);
      await escrow.burnExpired(tradeId);

      expect(await mockUSDT.balanceOf(treasury.address)).to.be.gt(treasuryBefore);
      expect((await escrow.getTrade(tradeId)).state).to.equal(6);
    });

    it("both parties receive failed dispute on burn", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-burn-reputation");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);
      await time.increase(TEN_DAYS + 1);
      await escrow.burnExpired(tradeId);

      const [, makerFail] = await escrow.getReputation(maker.address);
      const [, takerFail] = await escrow.getReputation(taker.address);
      expect(makerFail).to.equal(1n);
      expect(takerFail).to.equal(1n);
    });

    it("collaborative cancel requires both signatures", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-collab-cancel-1");
      await escrow.connect(taker).lockEscrow(tradeId);

      const deadline = (await time.latest()) + 3600;
      const makerSig = await eip712CancelSig(maker, tradeId, await escrow.sigNonces(maker.address), deadline);
      await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);
      expect((await escrow.getTrade(tradeId)).state).to.equal(1);

      const takerSig = await eip712CancelSig(taker, tradeId, await escrow.sigNonces(taker.address), deadline);
      await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);
      expect((await escrow.getTrade(tradeId)).state).to.equal(5);
    });

    it("collaborative cancel in LOCKED state refunds both parties with zero protocol fee", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-collab-locked");
      await escrow.connect(taker).lockEscrow(tradeId);

      const makerBond = await makerBondFor(maker, TRADE_AMOUNT, 2);
      const takerBond = await takerBondFor(taker, TRADE_AMOUNT, 2);

      const makerBefore = await mockUSDT.balanceOf(maker.address);
      const takerBefore = await mockUSDT.balanceOf(taker.address);
      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);

      await collaborativeCancel(tradeId);

      expect((await mockUSDT.balanceOf(maker.address)) - makerBefore)
        .to.equal(TRADE_AMOUNT + makerBond);
      expect((await mockUSDT.balanceOf(taker.address)) - takerBefore)
        .to.equal(takerBond);
      expect((await mockUSDT.balanceOf(treasury.address)) - treasuryBefore).to.equal(0n);
    });

    it("collaborative cancel in PAID state charges snapshot fees", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-collab-paid");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmPaid");

      const makerBond = await makerBondFor(maker, TRADE_AMOUNT, 2);
      const takerBond = await takerBondFor(taker, TRADE_AMOUNT, 2);
      const { takerFee, makerFee } = await calcReleaseFees(TRADE_AMOUNT, 2, makerBond);

      const makerBefore = await mockUSDT.balanceOf(maker.address);
      const takerBefore = await mockUSDT.balanceOf(taker.address);
      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);

      await collaborativeCancel(tradeId);

      expect((await mockUSDT.balanceOf(maker.address)) - makerBefore)
        .to.equal(TRADE_AMOUNT + makerBond - makerFee);
      expect((await mockUSDT.balanceOf(taker.address)) - takerBefore)
        .to.equal(takerBond - takerFee);
      expect((await mockUSDT.balanceOf(treasury.address)) - treasuryBefore)
        .to.equal(takerFee + makerFee);
    });

    it("rejects expired collaborative cancel signatures", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-expired-cancel");
      await escrow.connect(taker).lockEscrow(tradeId);

      const deadline = (await time.latest()) - 1;
      const sig = await eip712CancelSig(maker, tradeId, await escrow.sigNonces(maker.address), deadline);
      await expect(
        escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, sig)
      ).to.be.revertedWithCustomError(escrow, "SignatureExpired");
    });

    it("rejects replayed collaborative cancel signatures", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-replay-cancel");
      await escrow.connect(taker).lockEscrow(tradeId);

      const deadline = (await time.latest()) + 3600;
      const nonce = await escrow.sigNonces(maker.address);
      const sig = await eip712CancelSig(maker, tradeId, nonce, deadline);

      await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, sig);
      await expect(
        escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, sig)
      ).to.be.revertedWithCustomError(escrow, "InvalidSignature");
    });

    it("rejects cancel signature deadlines beyond MAX_CANCEL_DEADLINE", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-deadline-too-far");
      await escrow.connect(taker).lockEscrow(tradeId);

      const deadline = (await time.latest()) + 8 * 24 * 3600;
      const sig = await eip712CancelSig(maker, tradeId, await escrow.sigNonces(maker.address), deadline);
      await expect(
        escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, sig)
      ).to.be.revertedWithCustomError(escrow, "DeadlineTooFar");
    });

    it("releaseFunds cannot be called twice on same trade", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-double-release");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await escrow.connect(maker).releaseFunds(tradeId);

      await expect(escrow.connect(maker).releaseFunds(tradeId))
        .to.be.revertedWithCustomError(escrow, "CannotReleaseInState");
    });

    it("treasury receives both taker and maker fee on release", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-treasury-fees");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      const makerBond = await makerBondFor(maker, TRADE_AMOUNT, 2);
      const { totalTreasury } = await calcReleaseFees(TRADE_AMOUNT, 2, makerBond);
      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);

      await escrow.connect(maker).releaseFunds(tradeId);

      expect((await mockUSDT.balanceOf(treasury.address)) - treasuryBefore)
        .to.equal(totalTreasury);
    });

    it("autoRelease applies negligence penalty on bonds, not standard snapshot fee", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "legacy-auto-penalty");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(FORTY_EIGHT_H + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);

      const makerBond = await makerBondFor(maker, TRADE_AMOUNT, 2);
      const takerBond = await takerBondFor(taker, TRADE_AMOUNT, 2);
      const makerPenalty = (makerBond * 200n) / BPS_DENOM;
      const takerPenalty = (takerBond * 200n) / BPS_DENOM;

      const takerBefore = await mockUSDT.balanceOf(taker.address);
      const makerBefore = await mockUSDT.balanceOf(maker.address);
      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);

      await escrow.connect(taker).autoRelease(tradeId);

      expect((await mockUSDT.balanceOf(taker.address)) - takerBefore)
        .to.equal(TRADE_AMOUNT + (takerBond - takerPenalty));
      expect((await mockUSDT.balanceOf(maker.address)) - makerBefore)
        .to.equal(makerBond - makerPenalty);
      expect((await mockUSDT.balanceOf(treasury.address)) - treasuryBefore)
        .to.equal(makerPenalty + takerPenalty);
    });

    it("1st ban: 30 days, consecutiveBans = 1, no tier restriction yet", async () => {
      await giveBanToMaker();
      const [, failed, bannedUntil, consecutive, effectiveTier] = await escrow.getReputation(maker.address);

      expect(failed).to.equal(2n);
      expect(bannedUntil).to.be.gt(0n);
      expect(consecutive).to.equal(1n);
      expect(effectiveTier).to.equal(4);

      const now = BigInt(await time.latest());
      expect(bannedUntil).to.be.closeTo(now + BigInt(THIRTY_DAYS), 120n);
    });

    it("2nd consecutive ban: 60 days + maxAllowedTier drops to 3", async () => {
      for (let i = 0; i < 3; i++) {
        const tradeId = await setupTrade(0, TIER0_AMOUNT, `legacy-consecutive-ban-${i}`);
        await escrow.connect(taker).lockEscrow(tradeId);
        await escrow.connect(taker).reportPayment(tradeId, `QmHash${i}`);
        await time.increase(FORTY_EIGHT_H + 1);
        await escrow.connect(taker).pingMaker(tradeId);
        await time.increase(TWENTY_FOUR_H + 1);
        await escrow.connect(taker).autoRelease(tradeId);
      }

      const [, , bannedUntil, consecutive, effectiveTier] = await escrow.getReputation(maker.address);
      expect(consecutive).to.equal(2n);
      expect(effectiveTier).to.equal(3);

      const now = BigInt(await time.latest());
      expect(bannedUntil).to.be.closeTo(now + BigInt(SIXTY_DAYS), 120n);
    });

    it("tier-penalized maker cannot create listing above maxAllowedTier", async () => {
      for (let i = 0; i < 3; i++) {
        const tradeId = await setupTrade(0, TIER0_AMOUNT, `legacy-tier-penalty-${i}`);
        await escrow.connect(taker).lockEscrow(tradeId);
        await escrow.connect(taker).reportPayment(tradeId, `QmHash${i}`);
        await time.increase(FORTY_EIGHT_H + 1);
        await escrow.connect(taker).pingMaker(tradeId);
        await time.increase(TWENTY_FOUR_H + 1);
        await escrow.connect(taker).autoRelease(tradeId);
      }

      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await mockUSDT.getAddress(), TRADE_AMOUNT, 4, makeRef("legacy-tier4-blocked")
        )
      ).to.be.revertedWithCustomError(escrow, "TierNotAllowed");

      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await mockUSDT.getAddress(), TRADE_AMOUNT, 3, makeRef("legacy-tier3-ok")
        )
      ).to.not.be.reverted;
    });

    it("reputation decay resets consecutive bans after 180 clean days", async () => {
      await giveBanToMaker();

      const [, , bannedUntil, consecutiveBefore] = await escrow.getReputation(maker.address);
      expect(consecutiveBefore).to.equal(1n);

      const cleanSlate = 180 * 24 * 3600;
      await time.increase((bannedUntil - BigInt(await time.latest())) + BigInt(cleanSlate) + 3601n);

      await expect(escrow.decayReputation(maker.address))
        .to.emit(escrow, "ReputationUpdated");

      const [, , , consecutiveAfter] = await escrow.getReputation(maker.address);
      expect(consecutiveAfter).to.equal(0n);
    });

    it("reputation decay reverts with NoPriorBanHistory if no prior ban", async () => {
      await expect(escrow.decayReputation(stranger.address))
        .to.be.revertedWithCustomError(escrow, "NoPriorBanHistory");
    });

    it("reputation decay reverts if clean period not elapsed", async () => {
      await giveBanToMaker();
      const [, , bannedUntil] = await escrow.getReputation(maker.address);

      await time.increase((bannedUntil - BigInt(await time.latest())) + BigInt(170 * 24 * 3600));
      await expect(escrow.decayReputation(maker.address))
        .to.be.revertedWithCustomError(escrow, "CleanPeriodNotElapsed");
    });

    it("reputation decay removes tier penalty ceiling after clean slate", async () => {
      for (let i = 0; i < 3; i++) {
        const tradeId = await setupTrade(0, TIER0_AMOUNT, `legacy-decay-tier-cap-${i}`);
        await escrow.connect(taker).lockEscrow(tradeId);
        await escrow.connect(taker).reportPayment(tradeId, `QmDecay${i}`);
        await time.increase(FORTY_EIGHT_H + 1);
        await escrow.connect(taker).pingMaker(tradeId);
        await time.increase(TWENTY_FOUR_H + 1);
        await escrow.connect(taker).autoRelease(tradeId);
      }

      let [, , bannedUntil, , effectiveTierBefore] = await escrow.getReputation(maker.address);
      expect(effectiveTierBefore).to.equal(3);

      await time.increase((bannedUntil - BigInt(await time.latest())) + BigInt(180 * 24 * 3600) + 3601n);
      await escrow.decayReputation(maker.address);

      const [, , , , effectiveTierAfter] = await escrow.getReputation(maker.address);
      expect(effectiveTierAfter).to.equal(4);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. V3 SELL ORDERS
  // ═══════════════════════════════════════════════════════════════════════════
  describe("V3 Sell Orders", () => {
    it("createSellOrder stores correct canonical fields and reserves", async () => {
      const totalAmount = TRADE_AMOUNT;
      const minFill = ethers.parseUnits("250", USDT_DECIMALS);
      const { orderId, orderRef } = await setupSellOrder({
        ownerSigner: maker,
        totalAmount,
        minFillAmount: minFill,
        tier: 2,
        label: "sell-create-fields",
      });

      const order = await escrow.getOrder(orderId);
      const expectedMakerReserve = await makerBondFor(maker, totalAmount, 2);

      expect(order.id).to.equal(orderId);
      expect(order.owner).to.equal(maker.address);
      expect(order.side).to.equal(0);
      expect(order.tokenAddress).to.equal(await mockUSDT.getAddress());
      expect(order.totalAmount).to.equal(totalAmount);
      expect(order.remainingAmount).to.equal(totalAmount);
      expect(order.minFillAmount).to.equal(minFill);
      expect(order.remainingMakerBondReserve).to.equal(expectedMakerReserve);
      expect(order.remainingTakerBondReserve).to.equal(0n);
      expect(order.tier).to.equal(2);
      expect(order.state).to.equal(0);
      expect(order.orderRef).to.equal(orderRef);

      const { takerFeeBps, makerFeeBps } = await getFeeConfig();
      expect(order.takerFeeBpsSnapshot).to.equal(takerFeeBps);
      expect(order.makerFeeBpsSnapshot).to.equal(makerFeeBps);
    });

    it("createSellOrder emits OrderCreated with authoritative orderRef", async () => {
      const { receipt, orderRef } = await setupSellOrder({ label: "sell-order-created" });
      const args = await firstEventArgs(receipt, escrow.interface, "OrderCreated");
      expect(args.side).to.equal(0);
      expect(args.orderRef).to.equal(orderRef);
    });

    it("createSellOrder rejects zero amount", async () => {
      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), 0, 1, 2, makeRef("sell-zero"))
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });

    it("createSellOrder rejects invalid min fill", async () => {
      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 0, 2, makeRef("sell-min-zero"))
      ).to.be.revertedWithCustomError(escrow, "InvalidMinFill");

      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, TRADE_AMOUNT + 1n, 2, makeRef("sell-min-too-high"))
      ).to.be.revertedWithCustomError(escrow, "InvalidMinFill");
    });

    it("createSellOrder rejects invalid tier", async () => {
      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 9, makeRef("sell-invalid-tier"))
      ).to.be.revertedWithCustomError(escrow, "InvalidTier");
    });

    it("createSellOrder rejects zero orderRef", async () => {
      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(escrow, "InvalidOrderRef");
    });

    it("createSellOrder respects amount limits", async () => {
      const over0 = ethers.parseUnits("151", USDT_DECIMALS);
      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), over0, 1, 0, makeRef("sell-limit-0"))
      ).to.be.revertedWithCustomError(escrow, "AmountExceedsTierLimit");
    });

    it("createSellOrder rejects token direction disabled for sell", async () => {
      await escrow.connect(owner).setTokenConfig(await mockUSDT.getAddress(), true, false, true);
      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, makeRef("sell-direction-off"))
      ).to.be.revertedWithCustomError(escrow, "TokenDirectionNotAllowed");
    });

    it("createSellOrder still works for supported token when setSupportedToken is used", async () => {
      await escrow.connect(owner).setSupportedToken(await mockUSDT.getAddress(), true);
      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, makeRef("sell-supported"))
      ).to.not.be.reverted;
    });

    it("fillSellOrder creates LOCKED child trade directly", async () => {
      const fillAmount = ethers.parseUnits("400", USDT_DECIMALS);
      const { orderId } = await setupSellOrder({
        totalAmount: TRADE_AMOUNT,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        tier: 2,
        label: "sell-fill-direct",
      });

      const { tradeId } = await fillSellOrder({ orderId, fillAmount, label: "sell-fill-direct" });
      const trade = await escrow.getTrade(tradeId);

      expect(trade.parentOrderId).to.equal(orderId);
      expect(trade.maker).to.equal(maker.address);
      expect(trade.taker).to.equal(taker.address);
      expect(trade.tokenAddress).to.equal(await mockUSDT.getAddress());
      expect(trade.cryptoAmount).to.equal(fillAmount);
      expect(trade.state).to.equal(1);
      expect(trade.lockedAt).to.be.gt(0n);
    });

    it("fillSellOrder stores proportional maker reserve slice and computed taker bond", async () => {
      const totalAmount = TRADE_AMOUNT;
      const fillAmount = ethers.parseUnits("400", USDT_DECIMALS);
      const { orderId } = await setupSellOrder({
        totalAmount,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        tier: 2,
        label: "sell-fill-reserves",
      });

      const totalMakerReserve = await makerBondFor(maker, totalAmount, 2);
      const expectedMakerSlice = (totalMakerReserve * fillAmount) / totalAmount;
      const expectedTakerBond = await takerBondFor(taker, fillAmount, 2);

      const { tradeId } = await fillSellOrder({ orderId, fillAmount, label: "sell-fill-reserves" });
      const trade = await escrow.getTrade(tradeId);

      expect(trade.makerBond).to.equal(expectedMakerSlice);
      expect(trade.takerBond).to.equal(expectedTakerBond);
    });

    it("fillSellOrder updates parent remaining amount and state on partial fill", async () => {
      const fillAmount = ethers.parseUnits("300", USDT_DECIMALS);
      const { orderId } = await setupSellOrder({
        totalAmount: TRADE_AMOUNT,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        tier: 2,
        label: "sell-partial-state",
      });

      await fillSellOrder({ orderId, fillAmount, label: "sell-partial-state" });
      const order = await escrow.getOrder(orderId);

      expect(order.remainingAmount).to.equal(TRADE_AMOUNT - fillAmount);
      expect(order.state).to.equal(1);
    });

    it("fillSellOrder marks order FILLED on exact final fill", async () => {
      const { orderId } = await setupSellOrder({
        totalAmount: TRADE_AMOUNT,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        tier: 2,
        label: "sell-final-fill",
      });

      await fillSellOrder({ orderId, fillAmount: TRADE_AMOUNT, label: "sell-final-fill" });
      const order = await escrow.getOrder(orderId);

      expect(order.remainingAmount).to.equal(0n);
      expect(order.remainingMakerBondReserve).to.equal(0n);
      expect(order.state).to.equal(2);
    });

    it("fillSellOrder allows final remainder even if below minFill", async () => {
      const totalAmount = ethers.parseUnits("1000", USDT_DECIMALS);
      const minFill = ethers.parseUnits("400", USDT_DECIMALS);
      const { orderId } = await setupSellOrder({
        totalAmount,
        minFillAmount: minFill,
        tier: 2,
        label: "sell-remainder-below-min",
      });

      await fillSellOrder({ orderId, fillAmount: ethers.parseUnits("700", USDT_DECIMALS), label: "sell-first-remainder" });
      const orderAfterFirst = await escrow.getOrder(orderId);
      expect(orderAfterFirst.remainingAmount).to.equal(ethers.parseUnits("300", USDT_DECIMALS));

      await expect(
        escrow.connect(attacker).fillSellOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("sell-last-small"))
      ).to.not.be.reverted;
    });

    it("fillSellOrder rejects zero fill", async () => {
      const { orderId } = await setupSellOrder({ label: "sell-zero-fill" });
      await expect(
        escrow.connect(taker).fillSellOrder(orderId, 0, makeRef("child-zero"))
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });

    it("fillSellOrder rejects fill above remaining", async () => {
      const { orderId } = await setupSellOrder({ label: "sell-overfill" });
      await expect(
        escrow.connect(taker).fillSellOrder(orderId, TRADE_AMOUNT + 1n, makeRef("child-overfill"))
      ).to.be.revertedWithCustomError(escrow, "FillAmountExceedsRemaining");
    });

    it("fillSellOrder rejects fill below minFill when not final remainder", async () => {
      const { orderId } = await setupSellOrder({
        minFillAmount: ethers.parseUnits("400", USDT_DECIMALS),
        label: "sell-below-min",
      });
      await expect(
        escrow.connect(taker).fillSellOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("child-below-min"))
      ).to.be.revertedWithCustomError(escrow, "FillAmountBelowMinimum");
    });

    it("fillSellOrder rejects self-fill", async () => {
      const { orderId } = await setupSellOrder({ label: "sell-self-fill" });
      await expect(
        escrow.connect(maker).fillSellOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("child-self"))
      ).to.be.revertedWithCustomError(escrow, "SelfTradeForbidden");
    });

    it("fillSellOrder rejects zero child listing ref", async () => {
      const { orderId } = await setupSellOrder({ label: "sell-zero-child-ref" });
      await expect(
        escrow.connect(taker).fillSellOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), ethers.ZeroHash)
      ).to.be.revertedWithCustomError(escrow, "InvalidListingRef");
    });

    it("fillSellOrder rejects invalid order state after cancellation", async () => {
      const { orderId } = await setupSellOrder({ label: "sell-invalid-state-canceled" });
      await escrow.connect(maker).cancelSellOrder(orderId);

      await expect(
        escrow.connect(taker).fillSellOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("child-invalid-state"))
      ).to.be.revertedWithCustomError(escrow, "InvalidOrderState");
    });

    it("fillSellOrder rejects order side mismatch when used on buy order", async () => {
      const { orderId } = await setupBuyOrder({ label: "sell-side-mismatch" });
      await expect(
        escrow.connect(maker).fillSellOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("child-side-mismatch"))
      ).to.be.revertedWithCustomError(escrow, "OrderSideMismatch");
    });

    it("fillSellOrder enforces taker cooldown gate", async () => {
      const tradeId = await setupTrade(0, TIER0_AMOUNT, "sell-gate-cooldown-source");
      await escrow.connect(taker).lockEscrow(tradeId);

      const { orderId } = await setupSellOrder({
        totalAmount: TRADE_AMOUNT,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        tier: 0,
        label: "sell-gate-cooldown-target",
      });

      await expect(
        escrow.connect(taker).fillSellOrder(orderId, ethers.parseUnits("200", USDT_DECIMALS), makeRef("sell-gate-cooldown-child"))
      ).to.be.revertedWithCustomError(escrow, "TierCooldownActive");
    });

    it("fillSellOrder enforces taker wallet age gate", async () => {
      await escrow.connect(stranger).registerWallet();
      await owner.sendTransaction({ to: stranger.address, value: ethers.parseEther("0.02") });
      await mockUSDT.mint(stranger.address, INITIAL_BAL);
      await mockUSDT.connect(stranger).approve(await escrow.getAddress(), ethers.MaxUint256);

      const { orderId } = await setupSellOrder({ label: "sell-gate-wallet-age" });
      await expect(
        escrow.connect(stranger).fillSellOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("sell-wallet-age-child"))
      ).to.be.revertedWithCustomError(escrow, "WalletTooYoung");
    });

    it("fillSellOrder uses same tx event chain: OrderFilled → EscrowCreated → EscrowLocked", async () => {
      const { orderId } = await setupSellOrder({ label: "sell-event-order" });
      const tx = await escrow.connect(taker).fillSellOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("sell-event-order-child"));
      const receipt = await tx.wait();
      const parsed = await extractOrderedParsedLogs(receipt, escrow.interface);
      const names = parsed.map((p) => p.name);

      const idxFilled = names.indexOf("OrderFilled");
      const idxCreated = names.indexOf("EscrowCreated");
      const idxLocked = names.indexOf("EscrowLocked");

      expect(idxFilled).to.not.equal(-1);
      expect(idxCreated).to.not.equal(-1);
      expect(idxLocked).to.not.equal(-1);
      expect(idxFilled).to.be.lt(idxCreated);
      expect(idxCreated).to.be.lt(idxLocked);
    });

    it("fillSellOrder emits correct event payloads", async () => {
      const fillAmount = ethers.parseUnits("350", USDT_DECIMALS);
      const { orderId } = await setupSellOrder({ label: "sell-event-payload" });
      const childListingRef = makeRef("sell-event-payload-child");
      const tx = await escrow.connect(taker).fillSellOrder(orderId, fillAmount, childListingRef);
      const receipt = await tx.wait();

      const orderFilled = await firstEventArgs(receipt, escrow.interface, "OrderFilled");
      const escrowCreated = await firstEventArgs(receipt, escrow.interface, "EscrowCreated");
      const escrowLocked = await firstEventArgs(receipt, escrow.interface, "EscrowLocked");

      expect(orderFilled.orderId).to.equal(orderId);
      expect(orderFilled.filler).to.equal(taker.address);
      expect(orderFilled.fillAmount).to.equal(fillAmount);

      expect(escrowCreated.tradeId).to.equal(orderFilled.tradeId);
      expect(escrowCreated.maker).to.equal(maker.address);
      expect(escrowCreated.amount).to.equal(fillAmount);
      expect(escrowCreated.listingRef).to.equal(childListingRef);

      expect(escrowLocked.tradeId).to.equal(orderFilled.tradeId);
      expect(escrowLocked.taker).to.equal(taker.address);
    });

    it("sell order child trade completes full lifecycle with shared trade engine", async () => {
      const fillAmount = ethers.parseUnits("400", USDT_DECIMALS);
      const { orderId } = await setupSellOrder({ label: "sell-child-lifecycle" });
      const { tradeId } = await fillSellOrder({ orderId, fillAmount, label: "sell-child-lifecycle" });

      await escrow.connect(taker).reportPayment(tradeId, "QmSellChild");
      await escrow.connect(maker).releaseFunds(tradeId);

      const trade = await escrow.getTrade(tradeId);
      expect(trade.state).to.equal(4);

      const [makerSucc] = await escrow.getReputation(maker.address);
      const [takerSucc] = await escrow.getReputation(taker.address);
      expect(makerSucc).to.equal(BASELINE_SUCCESS + 1n);
      expect(takerSucc).to.equal(BASELINE_SUCCESS + 1n);
    });

    it("cancelSellOrder refunds only unused inventory and remaining maker reserve", async () => {
      const totalAmount = TRADE_AMOUNT;
      const fillAmount = ethers.parseUnits("300", USDT_DECIMALS);
      const { orderId } = await setupSellOrder({
        totalAmount,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        label: "sell-cancel-partial",
      });

      await fillSellOrder({ orderId, fillAmount, label: "sell-cancel-partial" });

      const orderBeforeCancel = await escrow.getOrder(orderId);
      const makerBefore = await mockUSDT.balanceOf(maker.address);

      await escrow.connect(maker).cancelSellOrder(orderId);

      const makerAfter = await mockUSDT.balanceOf(maker.address);
      expect(makerAfter - makerBefore)
        .to.equal(orderBeforeCancel.remainingAmount + orderBeforeCancel.remainingMakerBondReserve);

      const orderAfterCancel = await escrow.getOrder(orderId);
      expect(orderAfterCancel.state).to.equal(3);
      expect(orderAfterCancel.remainingAmount).to.equal(0n);
      expect(orderAfterCancel.remainingMakerBondReserve).to.equal(0n);
    });

    it("cancelSellOrder rejects non-owner", async () => {
      const { orderId } = await setupSellOrder({ label: "sell-cancel-owner-guard" });
      await expect(escrow.connect(taker).cancelSellOrder(orderId))
        .to.be.revertedWithCustomError(escrow, "OnlyOrderOwner");
    });

    it("cancelSellOrder rejects invalid state once order is FILLED", async () => {
      const { orderId } = await setupSellOrder({ label: "sell-cancel-filled" });
      await fillSellOrder({ orderId, fillAmount: TRADE_AMOUNT, label: "sell-cancel-filled" });

      await expect(escrow.connect(maker).cancelSellOrder(orderId))
        .to.be.revertedWithCustomError(escrow, "InvalidOrderState");
    });

    it("cancelSellOrder rejects side mismatch on buy order", async () => {
      const { orderId } = await setupBuyOrder({ label: "sell-cancel-side-mismatch" });
      await expect(escrow.connect(taker).cancelSellOrder(orderId))
        .to.be.revertedWithCustomError(escrow, "OrderSideMismatch");
    });

    it("multiple partial fills preserve sell-side accounting and final fill sweeps reserve", async () => {
      const totalAmount = ethers.parseUnits("1000", USDT_DECIMALS);
      const { orderId } = await setupSellOrder({
        totalAmount,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        label: "sell-multi-accounting",
      });

      const expectedTotalReserve = await makerBondFor(maker, totalAmount, 2);

      const f1 = ethers.parseUnits("300", USDT_DECIMALS);
      const f2 = ethers.parseUnits("200", USDT_DECIMALS);
      const f3 = ethers.parseUnits("500", USDT_DECIMALS);

      const a = await fillSellOrder({ orderId, fillAmount: f1, label: "sell-multi-a" });
      const t1 = await escrow.getTrade(a.tradeId);

      const orderAfter1 = await escrow.getOrder(orderId);
      expect(orderAfter1.remainingAmount).to.equal(totalAmount - f1);

      const b = await fillSellOrder({ orderId, fillAmount: f2, label: "sell-multi-b" });
      const t2 = await escrow.getTrade(b.tradeId);

      const orderAfter2 = await escrow.getOrder(orderId);
      expect(orderAfter2.remainingAmount).to.equal(totalAmount - f1 - f2);

      const c = await fillSellOrder({ orderId, fillAmount: f3, label: "sell-multi-c" });
      const t3 = await escrow.getTrade(c.tradeId);

      const finalOrder = await escrow.getOrder(orderId);
      expect(finalOrder.remainingAmount).to.equal(0n);
      expect(finalOrder.remainingMakerBondReserve).to.equal(0n);
      expect(finalOrder.state).to.equal(2);

      expect(t1.cryptoAmount + t2.cryptoAmount + t3.cryptoAmount).to.equal(totalAmount);
      expect(t1.makerBond + t2.makerBond + t3.makerBond).to.equal(expectedTotalReserve);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. V3 BUY ORDERS
  // ═══════════════════════════════════════════════════════════════════════════
  describe("V3 Buy Orders", () => {
    it("createBuyOrder stores correct canonical fields and reserves", async () => {
      const totalAmount = TRADE_AMOUNT;
      const minFill = ethers.parseUnits("250", USDT_DECIMALS);
      const { orderId, orderRef } = await setupBuyOrder({
        ownerSigner: taker,
        totalAmount,
        minFillAmount: minFill,
        tier: 2,
        label: "buy-create-fields",
      });

      const order = await escrow.getOrder(orderId);
      const expectedTakerReserve = await takerBondFor(taker, totalAmount, 2);

      expect(order.id).to.equal(orderId);
      expect(order.owner).to.equal(taker.address);
      expect(order.side).to.equal(1);
      expect(order.tokenAddress).to.equal(await mockUSDT.getAddress());
      expect(order.totalAmount).to.equal(totalAmount);
      expect(order.remainingAmount).to.equal(totalAmount);
      expect(order.minFillAmount).to.equal(minFill);
      expect(order.remainingMakerBondReserve).to.equal(0n);
      expect(order.remainingTakerBondReserve).to.equal(expectedTakerReserve);
      expect(order.tier).to.equal(2);
      expect(order.state).to.equal(0);
      expect(order.orderRef).to.equal(orderRef);
    });

    it("createBuyOrder emits OrderCreated with authoritative orderRef", async () => {
      const { receipt, orderRef } = await setupBuyOrder({ label: "buy-order-created" });
      const args = await firstEventArgs(receipt, escrow.interface, "OrderCreated");
      expect(args.side).to.equal(1);
      expect(args.orderRef).to.equal(orderRef);
    });

    it("createBuyOrder rejects token direction disabled for buy", async () => {
      await escrow.connect(owner).setTokenConfig(await mockUSDT.getAddress(), true, true, false);
      await expect(
        escrow.connect(taker).createBuyOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, makeRef("buy-direction-off"))
      ).to.be.revertedWithCustomError(escrow, "TokenDirectionNotAllowed");
    });

    it("createBuyOrder rejects zero amount", async () => {
      await expect(
        escrow.connect(taker).createBuyOrder(await mockUSDT.getAddress(), 0, 1, 2, makeRef("buy-zero"))
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });

    it("createBuyOrder rejects invalid min fill", async () => {
      await expect(
        escrow.connect(taker).createBuyOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 0, 2, makeRef("buy-min-zero"))
      ).to.be.revertedWithCustomError(escrow, "InvalidMinFill");
      await expect(
        escrow.connect(taker).createBuyOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, TRADE_AMOUNT + 1n, 2, makeRef("buy-min-high"))
      ).to.be.revertedWithCustomError(escrow, "InvalidMinFill");
    });

    it("createBuyOrder rejects zero orderRef", async () => {
      await expect(
        escrow.connect(taker).createBuyOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(escrow, "InvalidOrderRef");
    });

    it("fillBuyOrder creates LOCKED child trade with filler as maker and order owner as taker", async () => {
      const fillAmount = ethers.parseUnits("400", USDT_DECIMALS);
      const { orderId } = await setupBuyOrder({ label: "buy-fill-direct" });

      const { tradeId } = await fillBuyOrder({ orderId, makerSigner: maker, fillAmount, label: "buy-fill-direct" });
      const trade = await escrow.getTrade(tradeId);

      expect(trade.parentOrderId).to.equal(orderId);
      expect(trade.maker).to.equal(maker.address);
      expect(trade.taker).to.equal(taker.address);
      expect(trade.cryptoAmount).to.equal(fillAmount);
      expect(trade.state).to.equal(1);
    });

    it("fillBuyOrder stores maker bond and proportional taker reserve slice", async () => {
      const totalAmount = TRADE_AMOUNT;
      const fillAmount = ethers.parseUnits("400", USDT_DECIMALS);
      const { orderId } = await setupBuyOrder({
        totalAmount,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        tier: 2,
        label: "buy-fill-reserves",
      });

      const totalTakerReserve = await takerBondFor(taker, totalAmount, 2);
      const expectedTakerSlice = (totalTakerReserve * fillAmount) / totalAmount;
      const expectedMakerBond = await makerBondFor(maker, fillAmount, 2);

      const { tradeId } = await fillBuyOrder({ orderId, makerSigner: maker, fillAmount, label: "buy-fill-reserves" });
      const trade = await escrow.getTrade(tradeId);

      expect(trade.takerBond).to.equal(expectedTakerSlice);
      expect(trade.makerBond).to.equal(expectedMakerBond);
    });

    it("fillBuyOrder updates parent remaining amount and state on partial fill", async () => {
      const fillAmount = ethers.parseUnits("300", USDT_DECIMALS);
      const { orderId } = await setupBuyOrder({ label: "buy-partial-state" });

      await fillBuyOrder({ orderId, makerSigner: maker, fillAmount, label: "buy-partial-state" });
      const order = await escrow.getOrder(orderId);

      expect(order.remainingAmount).to.equal(TRADE_AMOUNT - fillAmount);
      expect(order.state).to.equal(1);
    });

    it("fillBuyOrder marks order FILLED on exact final fill", async () => {
      const { orderId } = await setupBuyOrder({ label: "buy-final-fill" });

      await fillBuyOrder({ orderId, makerSigner: maker, fillAmount: TRADE_AMOUNT, label: "buy-final-fill" });
      const order = await escrow.getOrder(orderId);

      expect(order.remainingAmount).to.equal(0n);
      expect(order.remainingTakerBondReserve).to.equal(0n);
      expect(order.state).to.equal(2);
    });

    it("fillBuyOrder allows final remainder below minFill", async () => {
      const totalAmount = ethers.parseUnits("1000", USDT_DECIMALS);
      const minFill = ethers.parseUnits("400", USDT_DECIMALS);
      const { orderId } = await setupBuyOrder({
        totalAmount,
        minFillAmount: minFill,
        tier: 2,
        label: "buy-final-remainder-below-min",
      });

      await fillBuyOrder({ orderId, makerSigner: maker, fillAmount: ethers.parseUnits("700", USDT_DECIMALS), label: "buy-first-fill" });
      await expect(
        escrow.connect(attacker).fillBuyOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("buy-last-small"))
      ).to.not.be.reverted;
    });

    it("fillBuyOrder rejects self fill", async () => {
      const { orderId } = await setupBuyOrder({ ownerSigner: taker, label: "buy-self-fill" });
      await expect(
        escrow.connect(taker).fillBuyOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("buy-self-child"))
      ).to.be.revertedWithCustomError(escrow, "SelfTradeForbidden");
    });

    it("fillBuyOrder rejects fill above remaining", async () => {
      const { orderId } = await setupBuyOrder({ label: "buy-overfill" });
      await expect(
        escrow.connect(maker).fillBuyOrder(orderId, TRADE_AMOUNT + 1n, makeRef("buy-overfill-child"))
      ).to.be.revertedWithCustomError(escrow, "FillAmountExceedsRemaining");
    });

    it("fillBuyOrder rejects fill below minFill when not final remainder", async () => {
      const { orderId } = await setupBuyOrder({
        minFillAmount: ethers.parseUnits("400", USDT_DECIMALS),
        label: "buy-below-min",
      });
      await expect(
        escrow.connect(maker).fillBuyOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("buy-below-min-child"))
      ).to.be.revertedWithCustomError(escrow, "FillAmountBelowMinimum");
    });

    it("fillBuyOrder rejects zero child listing ref", async () => {
      const { orderId } = await setupBuyOrder({ label: "buy-zero-child-ref" });
      await expect(
        escrow.connect(maker).fillBuyOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), ethers.ZeroHash)
      ).to.be.revertedWithCustomError(escrow, "InvalidListingRef");
    });

    it("fillBuyOrder rejects invalid order state once canceled", async () => {
      const { orderId } = await setupBuyOrder({ label: "buy-invalid-state" });
      await escrow.connect(taker).cancelBuyOrder(orderId);

      await expect(
        escrow.connect(maker).fillBuyOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("buy-invalid-state-child"))
      ).to.be.revertedWithCustomError(escrow, "InvalidOrderState");
    });

    it("fillBuyOrder rejects side mismatch when used on sell order", async () => {
      const { orderId } = await setupSellOrder({ label: "buy-side-mismatch" });
      await expect(
        escrow.connect(maker).fillBuyOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("buy-side-mismatch-child"))
      ).to.be.revertedWithCustomError(escrow, "OrderSideMismatch");
    });

    it("fillBuyOrder rechecks taker gate on order owner at fill time", async () => {
      const [owner2, treasury2, maker2, buyer2, filler2, alt] = await ethers.getSigners();
      void owner2; void treasury2; void maker2; void alt;

      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);
      const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
      const freshEscrow = await ArafEscrow.deploy(treasury.address);

      await freshEscrow.setSupportedToken(await token.getAddress(), true);
      await token.mint(buyer2.address, INITIAL_BAL);
      await token.mint(filler2.address, INITIAL_BAL);

      await token.connect(buyer2).approve(await freshEscrow.getAddress(), ethers.MaxUint256);
      await token.connect(filler2).approve(await freshEscrow.getAddress(), ethers.MaxUint256);

      await freshEscrow.connect(buyer2).registerWallet();
      await time.increase(SEVEN_DAYS + 1);
      // buyer2 receives no native funding on purpose

      const orderRef = makeRef("buy-owner-gate");
      await freshEscrow.connect(buyer2).createBuyOrder(
        await token.getAddress(),
        TRADE_AMOUNT,
        ethers.parseUnits("200", USDT_DECIMALS),
        2,
        orderRef
      );

      await expect(
        freshEscrow.connect(filler2).fillBuyOrder(1, ethers.parseUnits("300", USDT_DECIMALS), makeRef("buy-owner-gate-child"))
      ).to.be.revertedWithCustomError(freshEscrow, "InsufficientNativeBalance");
    });

    it("fillBuyOrder enforces maker tier eligibility against order tier", async () => {
      const [owner2, treasury2, lowMaker, buyer2] = await ethers.getSigners();
      void owner2; void treasury2;

      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);
      const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
      const freshEscrow = await ArafEscrow.deploy(treasury.address);

      await freshEscrow.setSupportedToken(await token.getAddress(), true);
      await token.mint(lowMaker.address, INITIAL_BAL);
      await token.mint(buyer2.address, INITIAL_BAL);
      await token.connect(lowMaker).approve(await freshEscrow.getAddress(), ethers.MaxUint256);
      await token.connect(buyer2).approve(await freshEscrow.getAddress(), ethers.MaxUint256);

      await freshEscrow.connect(buyer2).registerWallet();
      await time.increase(SEVEN_DAYS + 1);
      await owner.sendTransaction({ to: buyer2.address, value: ethers.parseEther("0.1") });

      await freshEscrow.connect(buyer2).createBuyOrder(
        await token.getAddress(),
        TRADE_AMOUNT,
        ethers.parseUnits("200", USDT_DECIMALS),
        4,
        makeRef("buy-maker-tier-gate")
      );

      await expect(
        freshEscrow.connect(lowMaker).fillBuyOrder(1, ethers.parseUnits("300", USDT_DECIMALS), makeRef("buy-maker-tier-gate-child"))
      ).to.be.revertedWithCustomError(freshEscrow, "TierNotAllowed");
    });

    it("fillBuyOrder uses same tx event chain: OrderFilled → EscrowCreated → EscrowLocked", async () => {
      const { orderId } = await setupBuyOrder({ label: "buy-event-order" });
      const tx = await escrow.connect(maker).fillBuyOrder(orderId, ethers.parseUnits("300", USDT_DECIMALS), makeRef("buy-event-order-child"));
      const receipt = await tx.wait();
      const parsed = await extractOrderedParsedLogs(receipt, escrow.interface);
      const names = parsed.map((p) => p.name);

      const idxFilled = names.indexOf("OrderFilled");
      const idxCreated = names.indexOf("EscrowCreated");
      const idxLocked = names.indexOf("EscrowLocked");

      expect(idxFilled).to.not.equal(-1);
      expect(idxCreated).to.not.equal(-1);
      expect(idxLocked).to.not.equal(-1);
      expect(idxFilled).to.be.lt(idxCreated);
      expect(idxCreated).to.be.lt(idxLocked);
    });

    it("fillBuyOrder emits correct event payloads", async () => {
      const fillAmount = ethers.parseUnits("350", USDT_DECIMALS);
      const { orderId } = await setupBuyOrder({ label: "buy-event-payload" });
      const childListingRef = makeRef("buy-event-payload-child");
      const tx = await escrow.connect(maker).fillBuyOrder(orderId, fillAmount, childListingRef);
      const receipt = await tx.wait();

      const orderFilled = await firstEventArgs(receipt, escrow.interface, "OrderFilled");
      const escrowCreated = await firstEventArgs(receipt, escrow.interface, "EscrowCreated");
      const escrowLocked = await firstEventArgs(receipt, escrow.interface, "EscrowLocked");

      expect(orderFilled.orderId).to.equal(orderId);
      expect(orderFilled.filler).to.equal(maker.address);
      expect(orderFilled.fillAmount).to.equal(fillAmount);

      expect(escrowCreated.tradeId).to.equal(orderFilled.tradeId);
      expect(escrowCreated.maker).to.equal(maker.address);
      expect(escrowCreated.amount).to.equal(fillAmount);
      expect(escrowCreated.listingRef).to.equal(childListingRef);

      expect(escrowLocked.tradeId).to.equal(orderFilled.tradeId);
      expect(escrowLocked.taker).to.equal(taker.address);
    });

    it("buy order child trade completes full lifecycle with shared trade engine", async () => {
      const fillAmount = ethers.parseUnits("400", USDT_DECIMALS);
      const { orderId } = await setupBuyOrder({ label: "buy-child-lifecycle" });
      const { tradeId } = await fillBuyOrder({ orderId, makerSigner: maker, fillAmount, label: "buy-child-lifecycle" });

      await escrow.connect(taker).reportPayment(tradeId, "QmBuyChild");
      await escrow.connect(maker).releaseFunds(tradeId);

      const trade = await escrow.getTrade(tradeId);
      expect(trade.state).to.equal(4);
    });

    it("cancelBuyOrder refunds only unused taker reserve", async () => {
      const fillAmount = ethers.parseUnits("300", USDT_DECIMALS);
      const { orderId } = await setupBuyOrder({ label: "buy-cancel-partial" });
      await fillBuyOrder({ orderId, makerSigner: maker, fillAmount, label: "buy-cancel-partial" });

      const orderBeforeCancel = await escrow.getOrder(orderId);
      const takerBefore = await mockUSDT.balanceOf(taker.address);

      await escrow.connect(taker).cancelBuyOrder(orderId);

      expect((await mockUSDT.balanceOf(taker.address)) - takerBefore)
        .to.equal(orderBeforeCancel.remainingTakerBondReserve);

      const orderAfterCancel = await escrow.getOrder(orderId);
      expect(orderAfterCancel.state).to.equal(3);
      expect(orderAfterCancel.remainingAmount).to.equal(0n);
      expect(orderAfterCancel.remainingTakerBondReserve).to.equal(0n);
    });

    it("cancelBuyOrder rejects non-owner", async () => {
      const { orderId } = await setupBuyOrder({ label: "buy-cancel-owner-guard" });
      await expect(escrow.connect(maker).cancelBuyOrder(orderId))
        .to.be.revertedWithCustomError(escrow, "OnlyOrderOwner");
    });

    it("cancelBuyOrder rejects invalid state once FILLED", async () => {
      const { orderId } = await setupBuyOrder({ label: "buy-cancel-filled" });
      await fillBuyOrder({ orderId, makerSigner: maker, fillAmount: TRADE_AMOUNT, label: "buy-cancel-filled" });

      await expect(escrow.connect(taker).cancelBuyOrder(orderId))
        .to.be.revertedWithCustomError(escrow, "InvalidOrderState");
    });

    it("cancelBuyOrder rejects side mismatch on sell order", async () => {
      const { orderId } = await setupSellOrder({ label: "buy-cancel-side-mismatch" });
      await expect(escrow.connect(maker).cancelBuyOrder(orderId))
        .to.be.revertedWithCustomError(escrow, "OrderSideMismatch");
    });

    it("multiple partial fills preserve buy-side accounting and final fill sweeps reserve", async () => {
      const totalAmount = ethers.parseUnits("1000", USDT_DECIMALS);
      const { orderId } = await setupBuyOrder({
        totalAmount,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        label: "buy-multi-accounting",
      });

      const expectedTotalReserve = await takerBondFor(taker, totalAmount, 2);

      const f1 = ethers.parseUnits("300", USDT_DECIMALS);
      const f2 = ethers.parseUnits("200", USDT_DECIMALS);
      const f3 = ethers.parseUnits("500", USDT_DECIMALS);

      const a = await fillBuyOrder({ orderId, makerSigner: maker, fillAmount: f1, label: "buy-multi-a" });
      const t1 = await escrow.getTrade(a.tradeId);

      const b = await fillBuyOrder({ orderId, makerSigner: attacker, fillAmount: f2, label: "buy-multi-b" });
      const t2 = await escrow.getTrade(b.tradeId);

      const c = await fillBuyOrder({ orderId, makerSigner: maker, fillAmount: f3, label: "buy-multi-c" });
      const t3 = await escrow.getTrade(c.tradeId);

      const finalOrder = await escrow.getOrder(orderId);
      expect(finalOrder.remainingAmount).to.equal(0n);
      expect(finalOrder.remainingTakerBondReserve).to.equal(0n);
      expect(finalOrder.state).to.equal(2);

      expect(t1.cryptoAmount + t2.cryptoAmount + t3.cryptoAmount).to.equal(totalAmount);
      expect(t1.takerBond + t2.takerBond + t3.takerBond).to.equal(expectedTotalReserve);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. SNAPSHOTS, MUTABLE CONFIG, TOKEN CONFIG, VIEWS
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Snapshots and Mutable Config", () => {
    it("legacy escrow snapshots fees at create time", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "snapshot-legacy");
      const tradeBefore = await escrow.getTrade(tradeId);
      const originalTakerFee = tradeBefore.takerFeeBpsSnapshot;
      const originalMakerFee = tradeBefore.makerFeeBpsSnapshot;

      await escrow.connect(owner).setFeeConfig(99, 77);

      const tradeAfter = await escrow.getTrade(tradeId);
      expect(tradeAfter.takerFeeBpsSnapshot).to.equal(originalTakerFee);
      expect(tradeAfter.makerFeeBpsSnapshot).to.equal(originalMakerFee);

      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmSnapshotLegacy");

      const makerBond = await makerBondFor(maker, TRADE_AMOUNT, 2);
      const quotedTakerFee = (TRADE_AMOUNT * bn(originalTakerFee)) / BPS_DENOM;
      const quotedMakerFee = (TRADE_AMOUNT * bn(originalMakerFee)) / BPS_DENOM;
      const actualMakerFee = makerBond > quotedMakerFee ? quotedMakerFee : makerBond;

      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);
      await escrow.connect(maker).releaseFunds(tradeId);

      expect((await mockUSDT.balanceOf(treasury.address)) - treasuryBefore)
        .to.equal(quotedTakerFee + actualMakerFee);
    });

    it("sell order snapshots fees at order creation time and child trade inherits them", async () => {
      const { orderId } = await setupSellOrder({ label: "snapshot-sell-order" });
      const orderBefore = await escrow.getOrder(orderId);

      await escrow.connect(owner).setFeeConfig(88, 66);

      const { tradeId } = await fillSellOrder({
        orderId,
        fillAmount: ethers.parseUnits("300", USDT_DECIMALS),
        label: "snapshot-sell-order",
      });

      const trade = await escrow.getTrade(tradeId);
      expect(trade.takerFeeBpsSnapshot).to.equal(orderBefore.takerFeeBpsSnapshot);
      expect(trade.makerFeeBpsSnapshot).to.equal(orderBefore.makerFeeBpsSnapshot);
    });

    it("buy order snapshots fees at order creation time and child trade inherits them", async () => {
      const { orderId } = await setupBuyOrder({ label: "snapshot-buy-order" });
      const orderBefore = await escrow.getOrder(orderId);

      await escrow.connect(owner).setFeeConfig(88, 66);

      const { tradeId } = await fillBuyOrder({
        orderId,
        makerSigner: maker,
        fillAmount: ethers.parseUnits("300", USDT_DECIMALS),
        label: "snapshot-buy-order",
      });

      const trade = await escrow.getTrade(tradeId);
      expect(trade.takerFeeBpsSnapshot).to.equal(orderBefore.takerFeeBpsSnapshot);
      expect(trade.makerFeeBpsSnapshot).to.equal(orderBefore.makerFeeBpsSnapshot);
    });

    it("new escrow after fee update snapshots new fee config", async () => {
      await escrow.connect(owner).setFeeConfig(50, 40);

      const tradeId = await setupTrade(2, TRADE_AMOUNT, "snapshot-new-legacy");
      const trade = await escrow.getTrade(tradeId);
      expect(trade.takerFeeBpsSnapshot).to.equal(50n);
      expect(trade.makerFeeBpsSnapshot).to.equal(40n);
    });

    it("new sell order after fee update snapshots new fee config", async () => {
      await escrow.connect(owner).setFeeConfig(45, 35);

      const { orderId } = await setupSellOrder({ label: "snapshot-new-sell" });
      const order = await escrow.getOrder(orderId);
      expect(order.takerFeeBpsSnapshot).to.equal(45n);
      expect(order.makerFeeBpsSnapshot).to.equal(35n);
    });

    it("new buy order after fee update snapshots new fee config", async () => {
      await escrow.connect(owner).setFeeConfig(55, 25);

      const { orderId } = await setupBuyOrder({ label: "snapshot-new-buy" });
      const order = await escrow.getOrder(orderId);
      expect(order.takerFeeBpsSnapshot).to.equal(55n);
      expect(order.makerFeeBpsSnapshot).to.equal(25n);
    });

    it("setFeeConfig rejects values above economic cap (10000 bps)", async () => {
      await expect(escrow.connect(owner).setFeeConfig(10001, 0))
        .to.be.revertedWithCustomError(escrow, "FeeBpsExceedsEconomicLimit");
      await expect(escrow.connect(owner).setFeeConfig(0, 10001))
        .to.be.revertedWithCustomError(escrow, "FeeBpsExceedsEconomicLimit");
    });

    it("setFeeConfig rejects values above uint16 range", async () => {
      await expect(escrow.connect(owner).setFeeConfig(65536, 0))
        .to.be.revertedWithCustomError(escrow, "FeeBpsExceedsUint16");
      await expect(escrow.connect(owner).setFeeConfig(0, 65536))
        .to.be.revertedWithCustomError(escrow, "FeeBpsExceedsUint16");
    });

    it("10000 bps fee snapshots do not freeze release path", async () => {
      await escrow.connect(owner).setFeeConfig(10000, 10000);
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "fee-cap-release");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmFeeCap");

      await expect(escrow.connect(maker).releaseFunds(tradeId)).to.not.be.reverted;

      const trade = await escrow.getTrade(tradeId);
      expect(trade.state).to.equal(4);
    });

    it("setCooldownConfig updates getter values", async () => {
      await escrow.connect(owner).setCooldownConfig(8 * 3600, 9 * 3600);
      const { tier0TradeCooldown, tier1TradeCooldown } = await getCooldownConfig();
      expect(tier0TradeCooldown).to.equal(8n * 3600n);
      expect(tier1TradeCooldown).to.equal(9n * 3600n);
    });

    it("updated cooldown affects new Tier 0 entry attempts", async () => {
      const tradeId1 = await setupTrade(0, TIER0_AMOUNT, "cooldown-update-source");
      await escrow.connect(taker).lockEscrow(tradeId1);

      await escrow.connect(owner).setCooldownConfig(8 * 3600, 4 * 3600);

      const tradeId2 = await setupTrade(0, TIER0_AMOUNT, "cooldown-update-target");
      await time.increase(FOUR_HOURS + 1);

      await expect(escrow.connect(taker).lockEscrow(tradeId2))
        .to.be.revertedWithCustomError(escrow, "TierCooldownActive");

      await time.increase(4 * 3600);
      await expect(escrow.connect(taker).lockEscrow(tradeId2)).to.not.be.reverted;
    });

    it("updated cooldown affects new fillSellOrder entries", async () => {
      await escrow.connect(owner).setCooldownConfig(8 * 3600, 4 * 3600);

      const tradeId = await setupTrade(0, TIER0_AMOUNT, "cooldown-sell-source");
      await escrow.connect(taker).lockEscrow(tradeId);

      const { orderId } = await setupSellOrder({
        totalAmount: TRADE_AMOUNT,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        tier: 0,
        label: "cooldown-sell-target",
      });

      await time.increase(FOUR_HOURS + 1);
      await expect(
        escrow.connect(taker).fillSellOrder(orderId, ethers.parseUnits("200", USDT_DECIMALS), makeRef("cooldown-sell-target-child"))
      ).to.be.revertedWithCustomError(escrow, "TierCooldownActive");
    });

    it("updated cooldown affects new fillBuyOrder entries through order owner taker gate", async () => {
      await escrow.connect(owner).setCooldownConfig(8 * 3600, 4 * 3600);

      const tradeId = await setupTrade(0, TIER0_AMOUNT, "cooldown-buy-source");
      await escrow.connect(taker).lockEscrow(tradeId);

      const { orderId } = await setupBuyOrder({
        ownerSigner: taker,
        totalAmount: TRADE_AMOUNT,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        tier: 0,
        label: "cooldown-buy-target",
      });

      await time.increase(FOUR_HOURS + 1);
      await expect(
        escrow.connect(maker).fillBuyOrder(orderId, ethers.parseUnits("200", USDT_DECIMALS), makeRef("cooldown-buy-target-child"))
      ).to.be.revertedWithCustomError(escrow, "TierCooldownActive");
    });

    it("getCooldownRemaining is informational and uses max(tier0, tier1)", async () => {
      await escrow.connect(owner).setCooldownConfig(8 * 3600, 6 * 3600);
      const tradeId = await setupTrade(0, TIER0_AMOUNT, "cooldown-remaining");
      await escrow.connect(taker).lockEscrow(tradeId);

      const remaining = await escrow.getCooldownRemaining(taker.address);
      expect(remaining).to.be.closeTo(8n * 3600n, 5n);
    });

    it("antiSybilCheck reflects age, funding, and cooldown info", async () => {
      const tradeId = await setupTrade(0, TIER0_AMOUNT, "antisybil-helper");
      await escrow.connect(taker).lockEscrow(tradeId);

      const [aged, funded, cooldownOk] = await escrow.antiSybilCheck(taker.address);
      expect(aged).to.equal(true);
      expect(funded).to.equal(true);
      expect(cooldownOk).to.equal(false);
    });

    it("setSupportedToken syncs supportedTokens and tokenConfigs", async () => {
      await escrow.connect(owner).setSupportedToken(await mockUSDT.getAddress(), false);

      expect(await escrow.supportedTokens(await mockUSDT.getAddress())).to.equal(false);
      const cfg = await escrow.tokenConfigs(await mockUSDT.getAddress());
      expect(cfg.supported).to.equal(false);
      expect(cfg.allowSellOrders).to.equal(false);
      expect(cfg.allowBuyOrders).to.equal(false);

      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await mockUSDT.getAddress(), TRADE_AMOUNT, 2, makeRef("token-disabled-legacy")
        )
      ).to.be.revertedWithCustomError(escrow, "TokenNotSupported");
    });

    it("setTokenConfig can independently toggle sell and buy directions", async () => {
      await escrow.connect(owner).setTokenConfig(await mockUSDT.getAddress(), true, false, true);

      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, makeRef("token-config-sell-off"))
      ).to.be.revertedWithCustomError(escrow, "TokenDirectionNotAllowed");

      await expect(
        escrow.connect(taker).createBuyOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, makeRef("token-config-buy-on"))
      ).to.not.be.reverted;

      await escrow.connect(owner).setTokenConfig(await mockUSDT.getAddress(), true, true, false);

      await expect(
        escrow.connect(taker).createBuyOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, makeRef("token-config-buy-off"))
      ).to.be.revertedWithCustomError(escrow, "TokenDirectionNotAllowed");

      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, makeRef("token-config-sell-on"))
      ).to.not.be.reverted;
    });

    it("legacy canonical createEscrow still only depends on support, not direction toggles", async () => {
      await escrow.connect(owner).setTokenConfig(await mockUSDT.getAddress(), true, false, false);

      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await mockUSDT.getAddress(), TRADE_AMOUNT, 2, makeRef("legacy-direction-independent")
        )
      ).to.not.be.reverted;
    });

    it("domainSeparator matches non-zero EIP-712 domain", async () => {
      const ds = await escrow.domainSeparator();
      expect(ds).to.not.equal(ethers.ZeroHash);
    });

    it("getOrder returns the parent order struct", async () => {
      const { orderId, orderRef } = await setupSellOrder({ label: "getter-order" });
      const order = await escrow.getOrder(orderId);
      expect(order.id).to.equal(orderId);
      expect(order.orderRef).to.equal(orderRef);
    });

    it("getTrade returns the trade struct", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "getter-trade");
      const trade = await escrow.getTrade(tradeId);
      expect(trade.id).to.equal(tradeId);
      expect(trade.maker).to.equal(maker.address);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. ACCESS CONTROL AND PAUSE SEMANTICS
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Access Control and Pause", () => {
    it("only owner can set treasury", async () => {
      await expect(
        escrow.connect(taker).setTreasury(stranger.address)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("only owner can set fee config", async () => {
      await expect(
        escrow.connect(taker).setFeeConfig(1, 1)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("only owner can set cooldown config", async () => {
      await expect(
        escrow.connect(taker).setCooldownConfig(1, 1)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("only owner can set supported token", async () => {
      await expect(
        escrow.connect(taker).setSupportedToken(await mockUSDT.getAddress(), true)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("only owner can set token config", async () => {
      await expect(
        escrow.connect(taker).setTokenConfig(await mockUSDT.getAddress(), true, true, true)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("only owner can pause and unpause", async () => {
      await expect(escrow.connect(taker).pause())
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
      await expect(escrow.connect(taker).unpause())
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("pause blocks canonical createEscrow", async () => {
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await mockUSDT.getAddress(), TRADE_AMOUNT, 2, makeRef("pause-legacy")
        )
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks createSellOrder", async () => {
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(maker).createSellOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, makeRef("pause-sell-create"))
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks fillSellOrder", async () => {
      const { orderId } = await setupSellOrder({ label: "pause-sell-fill" });
      await escrow.connect(owner).pause();

      await expect(
        escrow.connect(taker).fillSellOrder(orderId, ethers.parseUnits("200", USDT_DECIMALS), makeRef("pause-sell-fill-child"))
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks createBuyOrder", async () => {
      await escrow.connect(owner).pause();
      await expect(
        escrow.connect(taker).createBuyOrder(await mockUSDT.getAddress(), TRADE_AMOUNT, 1, 2, makeRef("pause-buy-create"))
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks fillBuyOrder", async () => {
      const { orderId } = await setupBuyOrder({ label: "pause-buy-fill" });
      await escrow.connect(owner).pause();

      await expect(
        escrow.connect(maker).fillBuyOrder(orderId, ethers.parseUnits("200", USDT_DECIMALS), makeRef("pause-buy-fill-child"))
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause blocks lockEscrow", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "pause-lock");
      await escrow.connect(owner).pause();

      await expect(escrow.connect(taker).lockEscrow(tradeId))
        .to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause does not block reportPayment / releaseFunds on existing trade", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "pause-close-existing");
      await escrow.connect(taker).lockEscrow(tradeId);

      await escrow.connect(owner).pause();

      await expect(escrow.connect(taker).reportPayment(tradeId, "QmPauseClose")).to.not.be.reverted;
      await expect(escrow.connect(maker).releaseFunds(tradeId)).to.not.be.reverted;
    });

    it("pause does not block collaborative cancel on existing trade", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "pause-cancel-existing");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(owner).pause();

      await expect(collaborativeCancel(tradeId)).to.not.be.reverted;
    });

    it("pause does not block burnExpired on challenged trade", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "pause-burn-existing");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmPauseBurn");
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);
      await time.increase(TEN_DAYS + 1);

      await escrow.connect(owner).pause();

      await expect(escrow.burnExpired(tradeId)).to.not.be.reverted;
    });

    it("pause does not block autoRelease on existing paid trade", async () => {
      const tradeId = await setupTrade(2, TRADE_AMOUNT, "pause-auto-release-existing");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmPauseAutoRelease");
      await time.increase(FORTY_EIGHT_H + 1);
      await escrow.connect(taker).pingMaker(tradeId);

      await escrow.connect(owner).pause();
      await time.increase(TWENTY_FOUR_H + 1);

      await expect(escrow.connect(taker).autoRelease(tradeId)).to.not.be.reverted;
    });

    it("pause does not block pingMaker or pingTakerForChallenge on existing paid trade", async () => {
      const tradeId1 = await setupTrade(2, TRADE_AMOUNT, "pause-ping-maker");
      await escrow.connect(taker).lockEscrow(tradeId1);
      await escrow.connect(taker).reportPayment(tradeId1, "QmPausePingMaker");

      const tradeId2 = await setupTrade(2, TRADE_AMOUNT, "pause-ping-taker");
      await escrow.connect(attacker).lockEscrow(tradeId2);
      await escrow.connect(attacker).reportPayment(tradeId2, "QmPausePingTaker");

      await escrow.connect(owner).pause();

      await time.increase(FORTY_EIGHT_H + 1);
      await expect(escrow.connect(taker).pingMaker(tradeId1)).to.not.be.reverted;

      await time.increase(TWENTY_FOUR_H + 1);
      await expect(escrow.connect(maker).pingTakerForChallenge(tradeId2)).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. END-TO-END ORDER SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════
  describe("End-to-End Order Scenarios", () => {
    it("sell order: partial fill + second fill + cancel remainder", async () => {
      const totalAmount = ethers.parseUnits("1000", USDT_DECIMALS);
      const { orderId } = await setupSellOrder({
        totalAmount,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        tier: 2,
        label: "e2e-sell",
      });

      const first = await fillSellOrder({ orderId, fillAmount: ethers.parseUnits("300", USDT_DECIMALS), label: "e2e-sell-1" });
      await escrow.connect(taker).reportPayment(first.tradeId, "QmE2ESell1");
      await escrow.connect(maker).releaseFunds(first.tradeId);

      const second = await fillSellOrder({ orderId, takerSigner: attacker, fillAmount: ethers.parseUnits("200", USDT_DECIMALS), label: "e2e-sell-2" });
      await escrow.connect(attacker).reportPayment(second.tradeId, "QmE2ESell2");
      await escrow.connect(maker).releaseFunds(second.tradeId);

      const orderBeforeCancel = await escrow.getOrder(orderId);
      expect(orderBeforeCancel.remainingAmount).to.equal(ethers.parseUnits("500", USDT_DECIMALS));

      await escrow.connect(maker).cancelSellOrder(orderId);

      const finalOrder = await escrow.getOrder(orderId);
      expect(finalOrder.state).to.equal(3);
      expect(finalOrder.remainingAmount).to.equal(0n);
    });

    it("buy order: partial fill + second fill + cancel remainder", async () => {
      const totalAmount = ethers.parseUnits("1000", USDT_DECIMALS);
      const { orderId } = await setupBuyOrder({
        ownerSigner: taker,
        totalAmount,
        minFillAmount: ethers.parseUnits("200", USDT_DECIMALS),
        tier: 2,
        label: "e2e-buy",
      });

      const first = await fillBuyOrder({ orderId, makerSigner: maker, fillAmount: ethers.parseUnits("300", USDT_DECIMALS), label: "e2e-buy-1" });
      await escrow.connect(taker).reportPayment(first.tradeId, "QmE2EBuy1");
      await escrow.connect(maker).releaseFunds(first.tradeId);

      const second = await fillBuyOrder({ orderId, makerSigner: attacker, fillAmount: ethers.parseUnits("200", USDT_DECIMALS), label: "e2e-buy-2" });
      await escrow.connect(taker).reportPayment(second.tradeId, "QmE2EBuy2");
      await escrow.connect(attacker).releaseFunds(second.tradeId);

      const orderBeforeCancel = await escrow.getOrder(orderId);
      expect(orderBeforeCancel.remainingAmount).to.equal(ethers.parseUnits("500", USDT_DECIMALS));

      await escrow.connect(taker).cancelBuyOrder(orderId);

      const finalOrder = await escrow.getOrder(orderId);
      expect(finalOrder.state).to.equal(3);
      expect(finalOrder.remainingAmount).to.equal(0n);
    });

    it("sell order child can be collaboratively canceled after payment", async () => {
      const { orderId } = await setupSellOrder({ label: "e2e-sell-cancel-after-payment" });
      const { tradeId } = await fillSellOrder({
        orderId,
        fillAmount: ethers.parseUnits("300", USDT_DECIMALS),
        label: "e2e-sell-cancel-after-payment",
      });

      await escrow.connect(taker).reportPayment(tradeId, "QmE2ECancel");
      await collaborativeCancel(tradeId);

      expect((await escrow.getTrade(tradeId)).state).to.equal(5);
    });

    it("buy order child can enter challenge path and burn", async () => {
      const { orderId } = await setupBuyOrder({ label: "e2e-buy-burn" });
      const { tradeId } = await fillBuyOrder({
        orderId,
        makerSigner: maker,
        fillAmount: ethers.parseUnits("300", USDT_DECIMALS),
        label: "e2e-buy-burn",
      });

      await escrow.connect(taker).reportPayment(tradeId, "QmE2EBurn");
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(TWENTY_FOUR_H + 1);
      await escrow.connect(maker).challengeTrade(tradeId);
      await time.increase(TEN_DAYS + 1);
      await escrow.burnExpired(tradeId);

      expect((await escrow.getTrade(tradeId)).state).to.equal(6);
    });
  });
});
