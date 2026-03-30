const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * ArafEscrow — Updated V3 test suite
 *
 * Bu dosya şu hedefleri kapsar:
 * - Legacy escrow regression (canonical createEscrow + core lifecycle)
 * - V3 order layer (sell / buy parent orders)
 * - Parent/child accounting
 * - Fee snapshot invariants
 * - Mutable config (fee / cooldown / token direction)
 * - Pause semantics
 */

describe("ArafEscrow V3", function () {
  const USDT_DECIMALS = 6;
  const BPS_DENOM = 10_000n;

  const INITIAL_BAL = ethers.parseUnits("200000", USDT_DECIMALS);
  const TIER0_AMOUNT = ethers.parseUnits("100", USDT_DECIMALS);
  const TIER2_AMOUNT = ethers.parseUnits("1000", USDT_DECIMALS);
  const PARTIAL_FILL = ethers.parseUnits("400", USDT_DECIMALS);

  const DEFAULT_TAKER_FEE_BPS = 15n;
  const DEFAULT_MAKER_FEE_BPS = 15n;

  const GOOD_MAKER_BOND_T2_BPS = 500n; // 600 - 100 good rep discount
  const GOOD_TAKER_BOND_T2_BPS = 700n; // 800 - 100 good rep discount

  const GOOD_MAKER_BOND_T2 = (TIER2_AMOUNT * GOOD_MAKER_BOND_T2_BPS) / BPS_DENOM; // 50
  const GOOD_TAKER_BOND_T2 = (TIER2_AMOUNT * GOOD_TAKER_BOND_T2_BPS) / BPS_DENOM; // 70

  const FOUR_HOURS = 4 * 3600;
  const ONE_DAY = 24 * 3600;
  const TWO_DAYS = 48 * 3600;
  const TEN_DAYS = 10 * 24 * 3600;
  const WALLET_AGE_MIN = 7 * 24 * 3600;
  const BASELINE_SUCCESS = 200;

  function ref(label) {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  function parseEvents(receipt, contract) {
    return receipt.logs.flatMap((log) => {
      try {
        return [contract.interface.parseLog(log)];
      } catch {
        return [];
      }
    });
  }

  function eventByName(receipt, contract, name, index = 0) {
    const hits = parseEvents(receipt, contract).filter((e) => e.name === name);
    if (!hits[index]) throw new Error(`Event not found: ${name}[${index}]`);
    return hits[index];
  }

  function feeOn(amount, bps) {
    return (amount * bps) / BPS_DENOM;
  }

  function makerBondBpsForSuccessTier2() {
    return GOOD_MAKER_BOND_T2_BPS;
  }

  function takerBondBpsForSuccessTier2() {
    return GOOD_TAKER_BOND_T2_BPS;
  }

  async function deployBaseFixture() {
    const [owner, treasury, maker, taker, seller, buyer, filler, stranger] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);

    const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await ArafEscrow.deploy(treasury.address);

    const tokenAddr = await token.getAddress();
    const escrowAddr = await escrow.getAddress();

    await escrow.connect(owner).setSupportedToken(tokenAddr, true);

    for (const user of [maker, taker, seller, buyer, filler]) {
      await token.mint(user.address, INITIAL_BAL);
      await token.connect(user).approve(escrowAddr, ethers.MaxUint256);
      await escrow.connect(user).registerWallet();
    }

    await time.increase(WALLET_AGE_MIN + 1);

    return { escrow, token, owner, treasury, maker, taker, seller, buyer, filler, stranger };
  }

  async function createEscrowCanonical(escrow, token, signer, amount, tier, label) {
    const tx = await escrow.connect(signer)["createEscrow(address,uint256,uint8,bytes32)"](
      await token.getAddress(),
      amount,
      tier,
      ref(label)
    );
    const receipt = await tx.wait();
    return eventByName(receipt, escrow, "EscrowCreated").args.tradeId;
  }

  async function createSellOrder(escrow, token, signer, totalAmount, minFillAmount, tier, label) {
    const tx = await escrow.connect(signer).createSellOrder(
      await token.getAddress(),
      totalAmount,
      minFillAmount,
      tier,
      ref(label)
    );
    const receipt = await tx.wait();
    return eventByName(receipt, escrow, "OrderCreated").args.orderId;
  }

  async function createBuyOrder(escrow, token, signer, totalAmount, minFillAmount, tier, label) {
    const tx = await escrow.connect(signer).createBuyOrder(
      await token.getAddress(),
      totalAmount,
      minFillAmount,
      tier,
      ref(label)
    );
    const receipt = await tx.wait();
    return eventByName(receipt, escrow, "OrderCreated").args.orderId;
  }

  async function boostPairToTier4(escrow, token, maker, taker) {
    const dummyAmount = ethers.parseUnits("1", USDT_DECIMALS);

    for (let i = 0; i < BASELINE_SUCCESS; i++) {
      const tradeId = await createEscrowCanonical(
        escrow,
        token,
        maker,
        dummyAmount,
        0,
        `boost:${i}`
      );

      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, `boost-ipfs-${i}`);
      await escrow.connect(maker).releaseFunds(tradeId);
      await time.increase(FOUR_HOURS + 1);
    }
  }

  async function deployTier4Fixture() {
    const f = await deployBaseFixture();
    await boostPairToTier4(f.escrow, f.token, f.maker, f.taker);
    return f;
  }

  describe("Legacy escrow regression", function () {
    it("rejects deprecated createEscrow(address,uint256,uint8) overload", async function () {
      const { escrow, token, maker } = await loadFixture(deployBaseFixture);

      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8)"](
          await token.getAddress(),
          TIER0_AMOUNT,
          0
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidListingRef");
    });

    it("canonical createEscrow writes authoritative listingRef into EscrowCreated", async function () {
      const { escrow, token, maker } = await loadFixture(deployBaseFixture);

      const listingRef = ref("legacy:canonical:create");
      const tx = await escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
        await token.getAddress(),
        TIER0_AMOUNT,
        0,
        listingRef
      );
      const receipt = await tx.wait();
      const ev = eventByName(receipt, escrow, "EscrowCreated");

      expect(ev.args.listingRef).to.equal(listingRef);
      expect(ev.args.amount).to.equal(TIER0_AMOUNT);
    });

    it("completes canonical happy path on a tier-2 legacy trade with snapshot fees", async function () {
      const { escrow, token, maker, taker, treasury } = await loadFixture(deployTier4Fixture);

      const tradeId = await createEscrowCanonical(escrow, token, maker, TIER2_AMOUNT, 2, "legacy:t2:happy");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "ipfs:happy:t2");

      const takerBefore = await token.balanceOf(taker.address);
      const makerBefore = await token.balanceOf(maker.address);
      const treasuryBefore = await token.balanceOf(treasury.address);

      await escrow.connect(maker).releaseFunds(tradeId);

      const takerFee = feeOn(TIER2_AMOUNT, DEFAULT_TAKER_FEE_BPS);
      const makerFee = feeOn(TIER2_AMOUNT, DEFAULT_MAKER_FEE_BPS);
      const takerExpected = TIER2_AMOUNT - takerFee + GOOD_TAKER_BOND_T2;
      const makerExpected = GOOD_MAKER_BOND_T2 - makerFee;

      expect((await token.balanceOf(taker.address)) - takerBefore).to.equal(takerExpected);
      expect((await token.balanceOf(maker.address)) - makerBefore).to.equal(makerExpected);
      expect((await token.balanceOf(treasury.address)) - treasuryBefore).to.equal(takerFee + makerFee);

      const trade = await escrow.getTrade(tradeId);
      expect(trade.state).to.equal(4n);
      expect(trade.takerFeeBpsSnapshot).to.equal(DEFAULT_TAKER_FEE_BPS);
      expect(trade.makerFeeBpsSnapshot).to.equal(DEFAULT_MAKER_FEE_BPS);
    });

    it("supports autoRelease path on legacy trades", async function () {
      const { escrow, token, maker, taker } = await loadFixture(deployTier4Fixture);

      const tradeId = await createEscrowCanonical(escrow, token, maker, TIER2_AMOUNT, 2, "legacy:auto-release");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "ipfs:auto-release");

      await time.increase(TWO_DAYS + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(ONE_DAY + 1);
      await escrow.connect(taker).autoRelease(tradeId);

      const trade = await escrow.getTrade(tradeId);
      expect(trade.state).to.equal(4n);

      const [makerSucc, makerFail] = await escrow.getReputation(maker.address);
      const [takerSucc, takerFail] = await escrow.getReputation(taker.address);
      expect(makerSucc).to.equal(BigInt(BASELINE_SUCCESS));
      expect(makerFail).to.equal(1n);
      expect(takerSucc).to.equal(BigInt(BASELINE_SUCCESS + 1));
      expect(takerFail).to.equal(0n);
    });

    it("supports collaborative cancel in PAID state using fee snapshots", async function () {
      const { escrow, token, maker, taker, treasury } = await loadFixture(deployTier4Fixture);

      const tradeId = await createEscrowCanonical(escrow, token, maker, TIER2_AMOUNT, 2, "legacy:paid-cancel");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "ipfs:paid-cancel");

      const makerBefore = await token.balanceOf(maker.address);
      const takerBefore = await token.balanceOf(taker.address);
      const treasuryBefore = await token.balanceOf(treasury.address);

      const deadline = (await time.latest()) + 3600;
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

      const makerNonce = await escrow.sigNonces(maker.address);
      const makerSig = await maker.signTypedData(domain, types, {
        tradeId,
        proposer: maker.address,
        nonce: makerNonce,
        deadline,
      });
      await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);

      const takerNonce = await escrow.sigNonces(taker.address);
      const takerSig = await taker.signTypedData(domain, types, {
        tradeId,
        proposer: taker.address,
        nonce: takerNonce,
        deadline,
      });
      await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);

      const takerFee = feeOn(TIER2_AMOUNT, DEFAULT_TAKER_FEE_BPS);
      const makerFee = feeOn(TIER2_AMOUNT, DEFAULT_MAKER_FEE_BPS);

      expect((await token.balanceOf(maker.address)) - makerBefore).to.equal(TIER2_AMOUNT + GOOD_MAKER_BOND_T2 - makerFee);
      expect((await token.balanceOf(taker.address)) - takerBefore).to.equal(GOOD_TAKER_BOND_T2 - takerFee);
      expect((await token.balanceOf(treasury.address)) - treasuryBefore).to.equal(takerFee + makerFee);
      expect((await escrow.getTrade(tradeId)).state).to.equal(5n);
    });
  });

  describe("V3 sell orders", function () {
    it("creates a sell order with correct reserve, snapshots and OPEN state", async function () {
      const { escrow, token, maker } = await loadFixture(deployTier4Fixture);

      const orderId = await createSellOrder(escrow, token, maker, TIER2_AMOUNT, ethers.parseUnits("250", USDT_DECIMALS), 2, "sell:create");
      const order = await escrow.getOrder(orderId);

      expect(order.owner).to.equal(maker.address);
      expect(order.side).to.equal(0n);
      expect(order.totalAmount).to.equal(TIER2_AMOUNT);
      expect(order.remainingAmount).to.equal(TIER2_AMOUNT);
      expect(order.minFillAmount).to.equal(ethers.parseUnits("250", USDT_DECIMALS));
      expect(order.remainingMakerBondReserve).to.equal(GOOD_MAKER_BOND_T2);
      expect(order.remainingTakerBondReserve).to.equal(0n);
      expect(order.takerFeeBpsSnapshot).to.equal(DEFAULT_TAKER_FEE_BPS);
      expect(order.makerFeeBpsSnapshot).to.equal(DEFAULT_MAKER_FEE_BPS);
      expect(order.state).to.equal(0n);
    });

    it("fillSellOrder creates a LOCKED child trade and updates parent accounting", async function () {
      const { escrow, token, maker, taker } = await loadFixture(deployTier4Fixture);

      const orderId = await createSellOrder(escrow, token, maker, TIER2_AMOUNT, ethers.parseUnits("250", USDT_DECIMALS), 2, "sell:partial");

      const childRef = ref("sell:child:1");
      const tx = await escrow.connect(taker).fillSellOrder(orderId, PARTIAL_FILL, childRef);
      const receipt = await tx.wait();
      const parsed = parseEvents(receipt, escrow).map((e) => e.name);
      expect(parsed.slice(-3)).to.deep.equal(["OrderFilled", "EscrowCreated", "EscrowLocked"]);

      const orderFilled = eventByName(receipt, escrow, "OrderFilled");
      const tradeId = orderFilled.args.tradeId;

      const child = await escrow.getTrade(tradeId);
      const order = await escrow.getOrder(orderId);

      const expectedMakerBondSlice = (GOOD_MAKER_BOND_T2 * PARTIAL_FILL) / TIER2_AMOUNT;
      const expectedTakerBond = (PARTIAL_FILL * takerBondBpsForSuccessTier2()) / BPS_DENOM;

      expect(child.parentOrderId).to.equal(orderId);
      expect(child.maker).to.equal(maker.address);
      expect(child.taker).to.equal(taker.address);
      expect(child.cryptoAmount).to.equal(PARTIAL_FILL);
      expect(child.makerBond).to.equal(expectedMakerBondSlice);
      expect(child.takerBond).to.equal(expectedTakerBond);
      expect(child.state).to.equal(1n);

      expect(order.remainingAmount).to.equal(TIER2_AMOUNT - PARTIAL_FILL);
      expect(order.remainingMakerBondReserve).to.equal(GOOD_MAKER_BOND_T2 - expectedMakerBondSlice);
      expect(order.state).to.equal(1n);

      const created = eventByName(receipt, escrow, "EscrowCreated");
      const locked = eventByName(receipt, escrow, "EscrowLocked");
      expect(created.args.listingRef).to.equal(childRef);
      expect(locked.args.taker).to.equal(taker.address);
      expect(locked.args.takerBond).to.equal(expectedTakerBond);
    });

    it("allows sub-minimum final remainder fill but rejects sub-minimum non-final fill", async function () {
      const { escrow, token, seller, buyer, filler } = await loadFixture(deployBaseFixture);

      const total = ethers.parseUnits("100", USDT_DECIMALS);
      const minFill = ethers.parseUnits("60", USDT_DECIMALS);
      const orderId = await createSellOrder(escrow, token, seller, total, minFill, 0, "sell:min-fill");

      await expect(
        escrow.connect(buyer).fillSellOrder(orderId, ethers.parseUnits("50", USDT_DECIMALS), ref("sell:min-fill:bad"))
      ).to.be.revertedWithCustomError(escrow, "FillAmountBelowMinimum");

      await escrow.connect(buyer).fillSellOrder(orderId, ethers.parseUnits("70", USDT_DECIMALS), ref("sell:min-fill:ok1"));
      await expect(
        escrow.connect(filler).fillSellOrder(orderId, ethers.parseUnits("30", USDT_DECIMALS), ref("sell:min-fill:ok2"))
      ).to.not.be.reverted;

      const order = await escrow.getOrder(orderId);
      expect(order.state).to.equal(2n);
      expect(order.remainingAmount).to.equal(0n);
      expect(order.remainingMakerBondReserve).to.equal(0n);
    });

    it("final fill sweeps the full remaining maker reserve with no rounding drift", async function () {
      const { escrow, token, maker, taker, buyer } = await loadFixture(deployTier4Fixture);

      const total = ethers.parseUnits("1001", USDT_DECIMALS);
      const orderId = await createSellOrder(escrow, token, maker, total, ethers.parseUnits("300", USDT_DECIMALS), 2, "sell:rounding");

      const r1 = await (await escrow.connect(taker).fillSellOrder(orderId, ethers.parseUnits("333", USDT_DECIMALS), ref("sell:r1"))).wait();
      const r2 = await (await escrow.connect(buyer).fillSellOrder(orderId, ethers.parseUnits("333", USDT_DECIMALS), ref("sell:r2"))).wait();
      const r3 = await (await escrow.connect(taker).fillSellOrder(orderId, ethers.parseUnits("335", USDT_DECIMALS), ref("sell:r3"))).wait();

      const id1 = eventByName(r1, escrow, "OrderFilled").args.tradeId;
      const id2 = eventByName(r2, escrow, "OrderFilled").args.tradeId;
      const id3 = eventByName(r3, escrow, "OrderFilled").args.tradeId;

      const t1 = await escrow.getTrade(id1);
      const t2 = await escrow.getTrade(id2);
      const t3 = await escrow.getTrade(id3);
      const order = await escrow.getOrder(orderId);

      const totalMakerReserve = (total * makerBondBpsForSuccessTier2()) / BPS_DENOM;
      expect(t1.makerBond + t2.makerBond + t3.makerBond).to.equal(totalMakerReserve);
      expect(order.remainingAmount).to.equal(0n);
      expect(order.remainingMakerBondReserve).to.equal(0n);
      expect(order.state).to.equal(2n);
    });

    it("cancelSellOrder refunds only unused inventory and unused maker reserve", async function () {
      const { escrow, token, maker, taker } = await loadFixture(deployTier4Fixture);

      const orderId = await createSellOrder(escrow, token, maker, TIER2_AMOUNT, ethers.parseUnits("250", USDT_DECIMALS), 2, "sell:cancel-after-partial");
      await escrow.connect(taker).fillSellOrder(orderId, PARTIAL_FILL, ref("sell:cancel:child"));

      const makerBefore = await token.balanceOf(maker.address);
      await escrow.connect(maker).cancelSellOrder(orderId);

      const consumedMakerReserve = (GOOD_MAKER_BOND_T2 * PARTIAL_FILL) / TIER2_AMOUNT;
      const remainingInventory = TIER2_AMOUNT - PARTIAL_FILL;
      const remainingReserve = GOOD_MAKER_BOND_T2 - consumedMakerReserve;

      expect((await token.balanceOf(maker.address)) - makerBefore).to.equal(remainingInventory + remainingReserve);

      const order = await escrow.getOrder(orderId);
      expect(order.state).to.equal(3n);
      expect(order.remainingAmount).to.equal(0n);
      expect(order.remainingMakerBondReserve).to.equal(0n);
    });
  });

  describe("V3 buy orders", function () {
    it("creates a buy order with correct reserve, snapshots and OPEN state", async function () {
      const { escrow, token, maker } = await loadFixture(deployTier4Fixture);

      const orderId = await createBuyOrder(escrow, token, maker, TIER2_AMOUNT, ethers.parseUnits("250", USDT_DECIMALS), 2, "buy:create");
      const order = await escrow.getOrder(orderId);

      expect(order.owner).to.equal(maker.address);
      expect(order.side).to.equal(1n);
      expect(order.remainingAmount).to.equal(TIER2_AMOUNT);
      expect(order.remainingMakerBondReserve).to.equal(0n);
      expect(order.remainingTakerBondReserve).to.equal(GOOD_TAKER_BOND_T2);
      expect(order.takerFeeBpsSnapshot).to.equal(DEFAULT_TAKER_FEE_BPS);
      expect(order.makerFeeBpsSnapshot).to.equal(DEFAULT_MAKER_FEE_BPS);
      expect(order.state).to.equal(0n);
    });

    it("fillBuyOrder creates a LOCKED child trade with order owner as taker", async function () {
      const { escrow, token, maker, taker } = await loadFixture(deployTier4Fixture);

      const orderId = await createBuyOrder(escrow, token, maker, TIER2_AMOUNT, ethers.parseUnits("250", USDT_DECIMALS), 2, "buy:partial");
      const childRef = ref("buy:child:1");

      const tx = await escrow.connect(taker).fillBuyOrder(orderId, PARTIAL_FILL, childRef);
      const receipt = await tx.wait();
      const parsed = parseEvents(receipt, escrow).map((e) => e.name);
      expect(parsed.slice(-3)).to.deep.equal(["OrderFilled", "EscrowCreated", "EscrowLocked"]);

      const tradeId = eventByName(receipt, escrow, "OrderFilled").args.tradeId;
      const child = await escrow.getTrade(tradeId);
      const order = await escrow.getOrder(orderId);

      const expectedMakerBond = (PARTIAL_FILL * makerBondBpsForSuccessTier2()) / BPS_DENOM;
      const expectedTakerBondSlice = (GOOD_TAKER_BOND_T2 * PARTIAL_FILL) / TIER2_AMOUNT;

      expect(child.parentOrderId).to.equal(orderId);
      expect(child.maker).to.equal(taker.address);
      expect(child.taker).to.equal(maker.address);
      expect(child.cryptoAmount).to.equal(PARTIAL_FILL);
      expect(child.makerBond).to.equal(expectedMakerBond);
      expect(child.takerBond).to.equal(expectedTakerBondSlice);
      expect(child.state).to.equal(1n);

      expect(order.remainingAmount).to.equal(TIER2_AMOUNT - PARTIAL_FILL);
      expect(order.remainingTakerBondReserve).to.equal(GOOD_TAKER_BOND_T2 - expectedTakerBondSlice);
      expect(order.state).to.equal(1n);

      const created = eventByName(receipt, escrow, "EscrowCreated");
      const locked = eventByName(receipt, escrow, "EscrowLocked");
      expect(created.args.listingRef).to.equal(childRef);
      expect(locked.args.taker).to.equal(maker.address);
      expect(locked.args.takerBond).to.equal(expectedTakerBondSlice);
    });

    it("cancelBuyOrder refunds only unused taker reserve after a partial fill", async function () {
      const { escrow, token, maker, taker } = await loadFixture(deployTier4Fixture);

      const orderId = await createBuyOrder(escrow, token, maker, TIER2_AMOUNT, ethers.parseUnits("250", USDT_DECIMALS), 2, "buy:cancel-after-partial");
      await escrow.connect(taker).fillBuyOrder(orderId, PARTIAL_FILL, ref("buy:cancel:child"));

      const makerBefore = await token.balanceOf(maker.address);
      await escrow.connect(maker).cancelBuyOrder(orderId);

      const consumedTakerReserve = (GOOD_TAKER_BOND_T2 * PARTIAL_FILL) / TIER2_AMOUNT;
      const remainingReserve = GOOD_TAKER_BOND_T2 - consumedTakerReserve;

      expect((await token.balanceOf(maker.address)) - makerBefore).to.equal(remainingReserve);
      const order = await escrow.getOrder(orderId);
      expect(order.state).to.equal(3n);
      expect(order.remainingAmount).to.equal(0n);
      expect(order.remainingTakerBondReserve).to.equal(0n);
    });

    it("re-checks taker entry gate on buy-order owner at fill time", async function () {
      const { escrow, token, seller, buyer, filler } = await loadFixture(deployBaseFixture);

      const orderId = await createBuyOrder(escrow, token, buyer, TIER0_AMOUNT, ethers.parseUnits("50", USDT_DECIMALS), 0, "buy:owner-cooldown");

      const tradeId = await createEscrowCanonical(escrow, token, seller, TIER0_AMOUNT, 0, "legacy:sets-cooldown");
      await escrow.connect(buyer).lockEscrow(tradeId);

      await expect(
        escrow.connect(filler).fillBuyOrder(orderId, TIER0_AMOUNT, ref("buy:owner-cooldown:fill"))
      ).to.be.revertedWithCustomError(escrow, "TierCooldownActive");
    });
  });

  describe("Fee snapshot invariants", function () {
    it("legacy trade release uses creation-time fee snapshot after owner fee change", async function () {
      const { escrow, token, owner, maker, taker, treasury } = await loadFixture(deployTier4Fixture);

      const tradeId = await createEscrowCanonical(escrow, token, maker, TIER2_AMOUNT, 2, "snapshot:legacy");
      const tradeBefore = await escrow.getTrade(tradeId);
      expect(tradeBefore.takerFeeBpsSnapshot).to.equal(DEFAULT_TAKER_FEE_BPS);
      expect(tradeBefore.makerFeeBpsSnapshot).to.equal(DEFAULT_MAKER_FEE_BPS);

      await escrow.connect(owner).setFeeConfig(99, 77);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "ipfs:snapshot:legacy");

      const treasuryBefore = await token.balanceOf(treasury.address);
      await escrow.connect(maker).releaseFunds(tradeId);
      const treasuryGain = (await token.balanceOf(treasury.address)) - treasuryBefore;

      expect(treasuryGain).to.equal(feeOn(TIER2_AMOUNT, DEFAULT_TAKER_FEE_BPS) + feeOn(TIER2_AMOUNT, DEFAULT_MAKER_FEE_BPS));
    });

    it("sell-order child trade inherits order-time fee snapshot after owner fee change", async function () {
      const { escrow, token, owner, maker, taker, treasury } = await loadFixture(deployTier4Fixture);

      const orderId = await createSellOrder(escrow, token, maker, TIER2_AMOUNT, ethers.parseUnits("250", USDT_DECIMALS), 2, "snapshot:sell-order");
      const order = await escrow.getOrder(orderId);
      expect(order.takerFeeBpsSnapshot).to.equal(DEFAULT_TAKER_FEE_BPS);
      expect(order.makerFeeBpsSnapshot).to.equal(DEFAULT_MAKER_FEE_BPS);

      await escrow.connect(owner).setFeeConfig(120, 95);

      const receipt = await (await escrow.connect(taker).fillSellOrder(orderId, TIER2_AMOUNT, ref("snapshot:sell-child"))).wait();
      const tradeId = eventByName(receipt, escrow, "OrderFilled").args.tradeId;
      const child = await escrow.getTrade(tradeId);

      expect(child.takerFeeBpsSnapshot).to.equal(DEFAULT_TAKER_FEE_BPS);
      expect(child.makerFeeBpsSnapshot).to.equal(DEFAULT_MAKER_FEE_BPS);

      await escrow.connect(taker).reportPayment(tradeId, "ipfs:snapshot:sell-child");
      const treasuryBefore = await token.balanceOf(treasury.address);
      await escrow.connect(maker).releaseFunds(tradeId);
      const treasuryGain = (await token.balanceOf(treasury.address)) - treasuryBefore;

      expect(treasuryGain).to.equal(feeOn(TIER2_AMOUNT, DEFAULT_TAKER_FEE_BPS) + feeOn(TIER2_AMOUNT, DEFAULT_MAKER_FEE_BPS));
    });

    it("buy-order child trade inherits order-time fee snapshot after owner fee change", async function () {
      const { escrow, token, owner, maker, taker, treasury } = await loadFixture(deployTier4Fixture);

      const orderId = await createBuyOrder(escrow, token, maker, TIER2_AMOUNT, ethers.parseUnits("250", USDT_DECIMALS), 2, "snapshot:buy-order");
      await escrow.connect(owner).setFeeConfig(222, 111);

      const receipt = await (await escrow.connect(taker).fillBuyOrder(orderId, TIER2_AMOUNT, ref("snapshot:buy-child"))).wait();
      const tradeId = eventByName(receipt, escrow, "OrderFilled").args.tradeId;
      const child = await escrow.getTrade(tradeId);

      expect(child.takerFeeBpsSnapshot).to.equal(DEFAULT_TAKER_FEE_BPS);
      expect(child.makerFeeBpsSnapshot).to.equal(DEFAULT_MAKER_FEE_BPS);

      await escrow.connect(maker).reportPayment(tradeId, "ipfs:snapshot:buy-child");
      const treasuryBefore = await token.balanceOf(treasury.address);
      await escrow.connect(taker).releaseFunds(tradeId);
      const treasuryGain = (await token.balanceOf(treasury.address)) - treasuryBefore;

      expect(treasuryGain).to.equal(feeOn(TIER2_AMOUNT, DEFAULT_TAKER_FEE_BPS) + feeOn(TIER2_AMOUNT, DEFAULT_MAKER_FEE_BPS));
    });
  });

  describe("Mutable config, token direction and pause semantics", function () {
    it("owner can update fee config and getters reflect the new values", async function () {
      const { escrow, owner } = await loadFixture(deployBaseFixture);

      await escrow.connect(owner).setFeeConfig(44, 33);
      const [takerFee, makerFee] = await escrow.getFeeConfig();
      expect(takerFee).to.equal(44n);
      expect(makerFee).to.equal(33n);
    });

    it("owner can update cooldown config and new tier-0 entries use the new cooldown", async function () {
      const { escrow, token, owner, seller, buyer, filler } = await loadFixture(deployBaseFixture);

      await escrow.connect(owner).setCooldownConfig(8 * 3600, FOUR_HOURS);
      const [tier0Cd, tier1Cd] = await escrow.getCooldownConfig();
      expect(tier0Cd).to.equal(8n * 3600n);
      expect(tier1Cd).to.equal(BigInt(FOUR_HOURS));

      const tradeId1 = await createEscrowCanonical(escrow, token, seller, TIER0_AMOUNT, 0, "cooldown:new-1");
      await escrow.connect(buyer).lockEscrow(tradeId1);

      const tradeId2 = await createEscrowCanonical(escrow, token, filler, TIER0_AMOUNT, 0, "cooldown:new-2");
      await expect(escrow.connect(buyer).lockEscrow(tradeId2))
        .to.be.revertedWithCustomError(escrow, "TierCooldownActive");

      await time.increase(8 * 3600 + 1);
      await expect(escrow.connect(buyer).lockEscrow(tradeId2)).to.not.be.reverted;
    });

    it("token direction config can disable sell orders while keeping buy orders enabled", async function () {
      const { escrow, token, owner, seller, buyer } = await loadFixture(deployBaseFixture);

      await escrow.connect(owner).setTokenConfig(await token.getAddress(), true, false, true);

      await expect(
        escrow.connect(seller).createSellOrder(
          await token.getAddress(),
          TIER0_AMOUNT,
          ethers.parseUnits("50", USDT_DECIMALS),
          0,
          ref("dir:sell-disabled")
        )
      ).to.be.revertedWithCustomError(escrow, "TokenDirectionNotAllowed");

      await expect(
        escrow.connect(buyer).createBuyOrder(
          await token.getAddress(),
          TIER0_AMOUNT,
          ethers.parseUnits("50", USDT_DECIMALS),
          0,
          ref("dir:buy-enabled")
        )
      ).to.not.be.reverted;
    });

    it("pause blocks new create/lock/fill flows", async function () {
      const { escrow, token, owner, maker, taker } = await loadFixture(deployTier4Fixture);

      const legacyTradeId = await createEscrowCanonical(escrow, token, maker, TIER0_AMOUNT, 0, "pause:legacy-open");
      const sellOrderId = await createSellOrder(escrow, token, maker, TIER0_AMOUNT, ethers.parseUnits("50", USDT_DECIMALS), 0, "pause:sell-order");
      const buyOrderId = await createBuyOrder(escrow, token, maker, TIER0_AMOUNT, ethers.parseUnits("50", USDT_DECIMALS), 0, "pause:buy-order");

      await escrow.connect(owner).pause();

      await expect(
        escrow.connect(maker)["createEscrow(address,uint256,uint8,bytes32)"](
          await token.getAddress(),
          TIER0_AMOUNT,
          0,
          ref("pause:new-legacy")
        )
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");

      await expect(escrow.connect(taker).lockEscrow(legacyTradeId))
        .to.be.revertedWithCustomError(escrow, "EnforcedPause");

      await expect(escrow.connect(taker).fillSellOrder(sellOrderId, TIER0_AMOUNT, ref("pause:fill-sell")))
        .to.be.revertedWithCustomError(escrow, "EnforcedPause");

      await expect(escrow.connect(taker).fillBuyOrder(buyOrderId, TIER0_AMOUNT, ref("pause:fill-buy")))
        .to.be.revertedWithCustomError(escrow, "EnforcedPause");
    });

    it("pause does not block closing an already-paid legacy trade", async function () {
      const { escrow, token, owner, maker, taker } = await loadFixture(deployTier4Fixture);

      const tradeId = await createEscrowCanonical(escrow, token, maker, TIER2_AMOUNT, 2, "pause:close-existing");
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "ipfs:pause:close-existing");

      await escrow.connect(owner).pause();
      await expect(escrow.connect(maker).releaseFunds(tradeId)).to.not.be.reverted;
      expect((await escrow.getTrade(tradeId)).state).to.equal(4n);
    });
  });
});
