const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafEscrow V3", function () {
  const USDT_DECIMALS = 6;
  const TRADE_AMOUNT = ethers.parseUnits("100", USDT_DECIMALS);
  const MIN_FILL = ethers.parseUnits("25", USDT_DECIMALS);
  const INITIAL_BAL = ethers.parseUnits("100000", USDT_DECIMALS);
  const TIER_MAX_AMOUNTS_BASE_UNIT = [
    ethers.parseUnits("150", USDT_DECIMALS),
    ethers.parseUnits("1500", USDT_DECIMALS),
    ethers.parseUnits("7500", USDT_DECIMALS),
    ethers.parseUnits("30000", USDT_DECIMALS),
  ];

  const WALLET_AGE_MIN = 7 * 24 * 3600;
  const GRACE_PERIOD = 48 * 3600;
  const RESPONSE_WINDOW = 24 * 3600;
  const DEFAULT_TIER0_COOLDOWN = 4 * 3600;
  const MIN_ACTIVE_PERIOD = 15 * 24 * 3600;

  const TradeState = {
    LOCKED: 1n,
    PAID: 2n,
    RESOLVED: 4n,
  };

  const OrderState = {
    OPEN: 0n,
    PARTIALLY_FILLED: 1n,
    FILLED: 2n,
    CANCELED: 3n,
  };

  function makeRef(label) {
    return ethers.keccak256(ethers.toUtf8Bytes(`${label}:${Date.now()}:${Math.random()}`));
  }

  async function firstEventArgs(receipt, iface, eventName) {
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === eventName) return parsed.args;
      } catch (_) {
        // Ignore logs from other contracts.
      }
    }
    throw new Error(`event ${eventName} not found`);
  }

  async function deployFixture() {
    const [owner, treasury, maker, taker, otherTaker, stranger] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);

    const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await ArafEscrow.deploy(treasury.address);

    const tokenAddress = await token.getAddress();
    await escrow.connect(owner).setTokenConfig(
      tokenAddress,
      true,
      true,
      true,
      USDT_DECIMALS,
      TIER_MAX_AMOUNTS_BASE_UNIT
    );

    for (const wallet of [maker, taker, otherTaker, stranger]) {
      await token.mint(wallet.address, INITIAL_BAL);
      await token.connect(wallet).approve(await escrow.getAddress(), ethers.MaxUint256);
    }

    for (const wallet of [maker, taker, otherTaker]) {
      await escrow.connect(wallet).registerWallet();
    }

    await time.increase(WALLET_AGE_MIN + 1);

    return { escrow, token, owner, treasury, maker, taker, otherTaker, stranger };
  }

  async function createSellOrderDetailed({ escrow, token, maker, amount = TRADE_AMOUNT, minFill = MIN_FILL, tier = 0, label = "sell" }) {
    const orderRef = makeRef(label);
    const tx = await escrow.connect(maker).createSellOrder(
      await token.getAddress(),
      amount,
      minFill,
      tier,
      orderRef
    );
    const receipt = await tx.wait();
    const args = await firstEventArgs(receipt, escrow.interface, "OrderCreated");
    return { orderId: args.orderId, orderRef, receipt, args };
  }

  async function createSellOrder(params) {
    const { orderId } = await createSellOrderDetailed(params);
    return orderId;
  }

  async function createBuyOrderDetailed({ escrow, token, taker, amount = TRADE_AMOUNT, minFill = MIN_FILL, tier = 0, label = "buy" }) {
    const orderRef = makeRef(label);
    const tx = await escrow.connect(taker).createBuyOrder(
      await token.getAddress(),
      amount,
      minFill,
      tier,
      orderRef
    );
    const receipt = await tx.wait();
    const args = await firstEventArgs(receipt, escrow.interface, "OrderCreated");
    return { orderId: args.orderId, orderRef, receipt, args };
  }

  async function createBuyOrder(params) {
    const { orderId } = await createBuyOrderDetailed(params);
    return orderId;
  }

  async function fillSellOrder({ escrow, orderId, taker, amount = TRADE_AMOUNT, label = "sell-child" }) {
    const tx = await escrow.connect(taker).fillSellOrder(orderId, amount, makeRef(label));
    const args = await firstEventArgs(await tx.wait(), escrow.interface, "OrderFilled");
    return args.tradeId;
  }

  async function fillBuyOrder({ escrow, orderId, maker, amount = TRADE_AMOUNT, label = "buy-child" }) {
    const tx = await escrow.connect(maker).fillBuyOrder(orderId, amount, makeRef(label));
    const args = await firstEventArgs(await tx.wait(), escrow.interface, "OrderFilled");
    return args.tradeId;
  }

  async function openSellTrade(ctx, overrides = {}) {
    const amount = overrides.amount ?? TRADE_AMOUNT;
    const orderId = await createSellOrder({ ...ctx, ...overrides, amount });
    const tradeId = await fillSellOrder({ escrow: ctx.escrow, orderId, taker: overrides.taker ?? ctx.taker, amount });
    return { orderId, tradeId };
  }

  async function openBuyTrade(ctx, overrides = {}) {
    const amount = overrides.amount ?? TRADE_AMOUNT;
    const orderId = await createBuyOrder({ ...ctx, ...overrides, amount });
    const tradeId = await fillBuyOrder({ escrow: ctx.escrow, orderId, maker: overrides.maker ?? ctx.maker, amount });
    return { orderId, tradeId };
  }

  async function qualifyForTierOne(ctx) {
    await ctx.escrow.connect(ctx.owner).setReputationTierThresholds(
      [0, 1, 1, 1, 1],
      [100, 100, 100, 100, 100]
    );

    const { tradeId } = await openSellTrade(ctx, { amount: TRADE_AMOUNT, label: "tier-warmup" });
    await ctx.escrow.connect(ctx.taker).reportPayment(tradeId, "QmTierWarmup");
    await ctx.escrow.connect(ctx.maker).releaseFunds(tradeId);
    await time.increase(MIN_ACTIVE_PERIOD + 1);
  }

  describe("ArafEscrow V3 order lifecycle", function () {
    it("sell-order child trade follows LOCKED -> PAID -> RESOLVED", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, maker, taker } = ctx;
      const { tradeId } = await openSellTrade(ctx);

      let trade = await escrow.getTrade(tradeId);
      expect(trade.parentOrderId).to.not.equal(0n);
      expect(trade.maker).to.equal(maker.address);
      expect(trade.taker).to.equal(taker.address);
      expect(trade.state).to.equal(TradeState.LOCKED);

      await escrow.connect(taker).reportPayment(tradeId, "QmPaid");
      expect((await escrow.getTrade(tradeId)).state).to.equal(TradeState.PAID);

      await expect(escrow.connect(maker).releaseFunds(tradeId)).to.emit(escrow, "EscrowReleased");
      expect((await escrow.getTrade(tradeId)).state).to.equal(TradeState.RESOLVED);
    });

    it("buy-order child trade follows LOCKED -> PAID -> RESOLVED", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, maker, taker } = ctx;
      const { tradeId } = await openBuyTrade(ctx);

      let trade = await escrow.getTrade(tradeId);
      expect(trade.parentOrderId).to.not.equal(0n);
      expect(trade.maker).to.equal(maker.address);
      expect(trade.taker).to.equal(taker.address);
      expect(trade.state).to.equal(TradeState.LOCKED);

      await escrow.connect(taker).reportPayment(tradeId, "QmBuyPaid");
      expect((await escrow.getTrade(tradeId)).state).to.equal(TradeState.PAID);

      await expect(escrow.connect(maker).releaseFunds(tradeId)).to.emit(escrow, "EscrowReleased");
      expect((await escrow.getTrade(tradeId)).state).to.equal(TradeState.RESOLVED);
    });

    it("auto-release resolves a paid order child after grace and response windows", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, taker } = ctx;
      const { tradeId } = await openSellTrade(ctx);

      await escrow.connect(taker).reportPayment(tradeId, "QmAutoRelease");
      await time.increase(GRACE_PERIOD + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(RESPONSE_WINDOW + 1);

      await expect(escrow.connect(taker).autoRelease(tradeId)).to.emit(escrow, "EscrowReleased");
      expect((await escrow.getTrade(tradeId)).state).to.equal(TradeState.RESOLVED);
    });

    it("tier cooldown blocks immediate second Tier 0 fill and allows it after cooldown", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, taker } = ctx;

      const firstOrderId = await createSellOrder({ escrow, token, maker, amount: TRADE_AMOUNT, label: "cooldown-1" });
      await fillSellOrder({ escrow, orderId: firstOrderId, taker, amount: TRADE_AMOUNT, label: "cooldown-child-1" });

      const secondOrderId = await createSellOrder({ escrow, token, maker, amount: TRADE_AMOUNT, label: "cooldown-2" });
      await expect(
        escrow.connect(taker).fillSellOrder(secondOrderId, TRADE_AMOUNT, makeRef("cooldown-child-blocked"))
      ).to.be.revertedWithCustomError(escrow, "TierCooldownActive");

      await time.increase(DEFAULT_TIER0_COOLDOWN + 1);
      await expect(
        escrow.connect(taker).fillSellOrder(secondOrderId, TRADE_AMOUNT, makeRef("cooldown-child-allowed"))
      ).to.not.be.reverted;
    });

    it("token tier amount limits apply to V3 sell and buy parent orders", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, taker } = ctx;
      const tier0Max = TIER_MAX_AMOUNTS_BASE_UNIT[0];

      await expect(
        escrow.connect(maker).createSellOrder(await token.getAddress(), tier0Max + 1n, tier0Max, 0, makeRef("sell-over"))
      ).to.be.revertedWithCustomError(escrow, "AmountExceedsTierLimit");

      await expect(
        escrow.connect(taker).createBuyOrder(await token.getAddress(), tier0Max + 1n, tier0Max, 0, makeRef("buy-over"))
      ).to.be.revertedWithCustomError(escrow, "AmountExceedsTierLimit");

      await expect(
        escrow.connect(maker).createSellOrder(await token.getAddress(), tier0Max, tier0Max, 0, makeRef("sell-at"))
      ).to.not.be.reverted;
    });

    it("self-trade guard rejects filling your own sell or buy order", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, taker } = ctx;

      const sellOrderId = await createSellOrder({ escrow, token, maker, label: "self-sell" });
      await expect(
        escrow.connect(maker).fillSellOrder(sellOrderId, TRADE_AMOUNT, makeRef("self-sell-child"))
      ).to.be.revertedWithCustomError(escrow, "SelfTradeForbidden");

      const buyOrderId = await createBuyOrder({ escrow, token, taker, label: "self-buy" });
      await expect(
        escrow.connect(taker).fillBuyOrder(buyOrderId, TRADE_AMOUNT, makeRef("self-buy-child"))
      ).to.be.revertedWithCustomError(escrow, "SelfTradeForbidden");
    });

    it("unregistered wallets cannot fill a sell order as taker", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, stranger } = ctx;
      const orderId = await createSellOrder({ escrow, token, maker, label: "unregistered" });

      await expect(
        escrow.connect(stranger).fillSellOrder(orderId, TRADE_AMOUNT, makeRef("unregistered-child"))
      ).to.be.revertedWithCustomError(escrow, "WalletTooYoung");
    });

    it("sell order fee snapshots are inherited by child trades even after config changes", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, owner, maker, taker } = ctx;
      await qualifyForTierOne(ctx);

      await escrow.connect(owner).setFeeConfig(111, 222);
      const orderId = await createSellOrder({ escrow, token, maker, tier: 1, amount: TRADE_AMOUNT, label: "fee-snapshot" });
      const order = await escrow.getOrder(orderId);
      expect(order.takerFeeBpsSnapshot).to.equal(111n);
      expect(order.makerFeeBpsSnapshot).to.equal(222n);

      await escrow.connect(owner).setFeeConfig(333, 444);
      const tradeId = await fillSellOrder({ escrow, orderId, taker, amount: TRADE_AMOUNT, label: "fee-child" });
      const trade = await escrow.getTrade(tradeId);
      expect(trade.takerFeeBpsSnapshot).to.equal(111n);
      expect(trade.makerFeeBpsSnapshot).to.equal(222n);
    });


    it("sell and buy order creation stores canonical fields and emits authoritative refs", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, taker } = ctx;
      const sellAmount = ethers.parseUnits("120", USDT_DECIMALS);
      const buyAmount = ethers.parseUnits("80", USDT_DECIMALS);

      const sell = await createSellOrderDetailed({ escrow, token, maker, amount: sellAmount, minFill: MIN_FILL, label: "sell-fields" });
      const sellOrder = await escrow.getOrder(sell.orderId);
      expect(sell.args.side).to.equal(0n);
      expect(sell.args.orderRef).to.equal(sell.orderRef);
      expect(sellOrder.id).to.equal(sell.orderId);
      expect(sellOrder.owner).to.equal(maker.address);
      expect(sellOrder.side).to.equal(0n);
      expect(sellOrder.tokenAddress).to.equal(await token.getAddress());
      expect(sellOrder.totalAmount).to.equal(sellAmount);
      expect(sellOrder.remainingAmount).to.equal(sellAmount);
      expect(sellOrder.minFillAmount).to.equal(MIN_FILL);
      expect(sellOrder.remainingMakerBondReserve).to.equal(0n);
      expect(sellOrder.remainingTakerBondReserve).to.equal(0n);
      expect(sellOrder.state).to.equal(OrderState.OPEN);
      expect(sellOrder.orderRef).to.equal(sell.orderRef);

      const buy = await createBuyOrderDetailed({ escrow, token, taker, amount: buyAmount, minFill: MIN_FILL, label: "buy-fields" });
      const buyOrder = await escrow.getOrder(buy.orderId);
      expect(buy.args.side).to.equal(1n);
      expect(buy.args.orderRef).to.equal(buy.orderRef);
      expect(buyOrder.id).to.equal(buy.orderId);
      expect(buyOrder.owner).to.equal(taker.address);
      expect(buyOrder.side).to.equal(1n);
      expect(buyOrder.totalAmount).to.equal(buyAmount);
      expect(buyOrder.remainingAmount).to.equal(buyAmount);
      expect(buyOrder.state).to.equal(OrderState.OPEN);
      expect(buyOrder.orderRef).to.equal(buy.orderRef);
    });

    it("order creation rejects invalid amount, min fill, tier, refs, and disabled directions", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, owner, maker, taker } = ctx;
      const tokenAddress = await token.getAddress();

      await expect(escrow.connect(maker).createSellOrder(tokenAddress, 0, MIN_FILL, 0, makeRef("sell-zero")))
        .to.be.revertedWithCustomError(escrow, "ZeroAmount");
      await expect(escrow.connect(maker).createSellOrder(tokenAddress, TRADE_AMOUNT, 0, 0, makeRef("sell-min-zero")))
        .to.be.revertedWithCustomError(escrow, "InvalidMinFill");
      await expect(escrow.connect(maker).createSellOrder(tokenAddress, TRADE_AMOUNT, TRADE_AMOUNT + 1n, 0, makeRef("sell-min-high")))
        .to.be.revertedWithCustomError(escrow, "InvalidMinFill");
      await expect(escrow.connect(maker).createSellOrder(tokenAddress, TRADE_AMOUNT, MIN_FILL, 9, makeRef("sell-tier")))
        .to.be.revertedWithCustomError(escrow, "InvalidTier");
      await expect(escrow.connect(maker).createSellOrder(tokenAddress, TRADE_AMOUNT, MIN_FILL, 0, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, "InvalidOrderRef");

      await expect(escrow.connect(taker).createBuyOrder(tokenAddress, 0, MIN_FILL, 0, makeRef("buy-zero")))
        .to.be.revertedWithCustomError(escrow, "ZeroAmount");
      await expect(escrow.connect(taker).createBuyOrder(tokenAddress, TRADE_AMOUNT, 0, 0, makeRef("buy-min-zero")))
        .to.be.revertedWithCustomError(escrow, "InvalidMinFill");
      await expect(escrow.connect(taker).createBuyOrder(tokenAddress, TRADE_AMOUNT, MIN_FILL, 0, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, "InvalidOrderRef");

      await escrow.connect(owner).setTokenConfig(tokenAddress, true, false, true, USDT_DECIMALS, TIER_MAX_AMOUNTS_BASE_UNIT);
      await expect(escrow.connect(maker).createSellOrder(tokenAddress, TRADE_AMOUNT, MIN_FILL, 0, makeRef("sell-off")))
        .to.be.revertedWithCustomError(escrow, "TokenDirectionNotAllowed");
      await expect(escrow.connect(taker).createBuyOrder(tokenAddress, TRADE_AMOUNT, MIN_FILL, 0, makeRef("buy-on")))
        .to.not.be.reverted;

      await escrow.connect(owner).setTokenConfig(tokenAddress, true, true, false, USDT_DECIMALS, TIER_MAX_AMOUNTS_BASE_UNIT);
      await expect(escrow.connect(taker).createBuyOrder(tokenAddress, TRADE_AMOUNT, MIN_FILL, 0, makeRef("buy-off")))
        .to.be.revertedWithCustomError(escrow, "TokenDirectionNotAllowed");
    });

    it("fill validation rejects zero, overfill, below-minimum, zero child refs, canceled orders, and side mismatch", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, taker } = ctx;
      const sellOrderId = await createSellOrder({ escrow, token, maker, amount: TRADE_AMOUNT, minFill: MIN_FILL, label: "sell-validation" });

      await expect(escrow.connect(taker).fillSellOrder(sellOrderId, 0, makeRef("zero-fill")))
        .to.be.revertedWithCustomError(escrow, "ZeroAmount");
      await expect(escrow.connect(taker).fillSellOrder(sellOrderId, TRADE_AMOUNT + 1n, makeRef("over-fill")))
        .to.be.revertedWithCustomError(escrow, "FillAmountExceedsRemaining");
      await expect(escrow.connect(taker).fillSellOrder(sellOrderId, MIN_FILL - 1n, makeRef("below-min")))
        .to.be.revertedWithCustomError(escrow, "FillAmountBelowMinimum");
      await expect(escrow.connect(taker).fillSellOrder(sellOrderId, MIN_FILL, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, "InvalidListingRef");

      const buyOrderId = await createBuyOrder({ escrow, token, taker, amount: TRADE_AMOUNT, minFill: MIN_FILL, label: "buy-validation" });
      await expect(escrow.connect(maker).fillSellOrder(buyOrderId, MIN_FILL, makeRef("wrong-sell-side")))
        .to.be.revertedWithCustomError(escrow, "OrderSideMismatch");
      await expect(escrow.connect(taker).fillBuyOrder(sellOrderId, MIN_FILL, makeRef("wrong-buy-side")))
        .to.be.revertedWithCustomError(escrow, "OrderSideMismatch");
      await expect(escrow.connect(maker).fillBuyOrder(buyOrderId, 0, makeRef("buy-zero-fill")))
        .to.be.revertedWithCustomError(escrow, "ZeroAmount");
      await expect(escrow.connect(maker).fillBuyOrder(buyOrderId, TRADE_AMOUNT + 1n, makeRef("buy-over-fill")))
        .to.be.revertedWithCustomError(escrow, "FillAmountExceedsRemaining");
      await expect(escrow.connect(maker).fillBuyOrder(buyOrderId, MIN_FILL - 1n, makeRef("buy-below-min")))
        .to.be.revertedWithCustomError(escrow, "FillAmountBelowMinimum");
      await expect(escrow.connect(maker).fillBuyOrder(buyOrderId, MIN_FILL, ethers.ZeroHash))
        .to.be.revertedWithCustomError(escrow, "InvalidListingRef");

      await escrow.connect(maker).cancelSellOrder(sellOrderId);
      await expect(escrow.connect(taker).fillSellOrder(sellOrderId, MIN_FILL, makeRef("canceled-fill")))
        .to.be.revertedWithCustomError(escrow, "InvalidOrderState");
    });

    it("final remainder below minFill is fillable for sell and buy orders", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, taker, otherTaker } = ctx;
      await escrow.connect(ctx.owner).setCooldownConfig(0, 0);
      const total = ethers.parseUnits("100", USDT_DECIMALS);
      const minFill = ethers.parseUnits("40", USDT_DECIMALS);
      const firstFill = ethers.parseUnits("70", USDT_DECIMALS);
      const remainder = ethers.parseUnits("30", USDT_DECIMALS);

      const sellOrderId = await createSellOrder({ escrow, token, maker, amount: total, minFill, label: "sell-small-remainder" });
      await fillSellOrder({ escrow, orderId: sellOrderId, taker, amount: firstFill, label: "sell-remainder-first" });
      await expect(escrow.connect(otherTaker).fillSellOrder(sellOrderId, remainder, makeRef("sell-small-final")))
        .to.not.be.reverted;
      expect((await escrow.getOrder(sellOrderId)).state).to.equal(OrderState.FILLED);

      const buyOrderId = await createBuyOrder({ escrow, token, taker, amount: total, minFill, label: "buy-small-remainder" });
      await fillBuyOrder({ escrow, orderId: buyOrderId, maker, amount: firstFill, label: "buy-remainder-first" });
      await expect(escrow.connect(otherTaker).fillBuyOrder(buyOrderId, remainder, makeRef("buy-small-final")))
        .to.not.be.reverted;
      expect((await escrow.getOrder(buyOrderId)).state).to.equal(OrderState.FILLED);
    });

    it("cancelSellOrder refunds unused inventory, closes the order, and enforces owner/state/side guards", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, taker } = ctx;
      await escrow.connect(ctx.owner).setCooldownConfig(0, 0);
      const fillAmount = ethers.parseUnits("40", USDT_DECIMALS);
      const orderId = await createSellOrder({ escrow, token, maker, amount: TRADE_AMOUNT, minFill: fillAmount, label: "cancel-sell" });
      await fillSellOrder({ escrow, orderId, taker, amount: fillAmount, label: "cancel-sell-fill" });

      const orderBefore = await escrow.getOrder(orderId);
      const makerBefore = await token.balanceOf(maker.address);
      await expect(escrow.connect(taker).cancelSellOrder(orderId))
        .to.be.revertedWithCustomError(escrow, "OnlyOrderOwner");
      await expect(escrow.connect(maker).cancelSellOrder(orderId))
        .to.emit(escrow, "OrderCanceled")
        .withArgs(orderId, 0, orderBefore.remainingAmount, orderBefore.remainingMakerBondReserve, 0);
      expect((await token.balanceOf(maker.address)) - makerBefore).to.equal(orderBefore.remainingAmount + orderBefore.remainingMakerBondReserve);
      const orderAfter = await escrow.getOrder(orderId);
      expect(orderAfter.state).to.equal(OrderState.CANCELED);
      expect(orderAfter.remainingAmount).to.equal(0n);

      await expect(escrow.connect(maker).cancelSellOrder(orderId))
        .to.be.revertedWithCustomError(escrow, "InvalidOrderState");
      const buyOrderId = await createBuyOrder({ escrow, token, taker, label: "cancel-sell-side" });
      await expect(escrow.connect(taker).cancelSellOrder(buyOrderId))
        .to.be.revertedWithCustomError(escrow, "OrderSideMismatch");
    });

    it("cancelBuyOrder refunds unused taker reserve, closes the order, and enforces owner/state/side guards", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, taker } = ctx;
      await escrow.connect(ctx.owner).setCooldownConfig(0, 0);
      const fillAmount = ethers.parseUnits("40", USDT_DECIMALS);
      const orderId = await createBuyOrder({ escrow, token, taker, amount: TRADE_AMOUNT, minFill: fillAmount, label: "cancel-buy" });
      await fillBuyOrder({ escrow, orderId, maker, amount: fillAmount, label: "cancel-buy-fill" });

      const orderBefore = await escrow.getOrder(orderId);
      const takerBefore = await token.balanceOf(taker.address);
      await expect(escrow.connect(maker).cancelBuyOrder(orderId))
        .to.be.revertedWithCustomError(escrow, "OnlyOrderOwner");
      await expect(escrow.connect(taker).cancelBuyOrder(orderId))
        .to.emit(escrow, "OrderCanceled")
        .withArgs(orderId, 1, orderBefore.remainingAmount, 0, orderBefore.remainingTakerBondReserve);
      expect((await token.balanceOf(taker.address)) - takerBefore).to.equal(orderBefore.remainingTakerBondReserve);
      const orderAfter = await escrow.getOrder(orderId);
      expect(orderAfter.state).to.equal(OrderState.CANCELED);
      expect(orderAfter.remainingAmount).to.equal(0n);

      await expect(escrow.connect(taker).cancelBuyOrder(orderId))
        .to.be.revertedWithCustomError(escrow, "InvalidOrderState");
      const sellOrderId = await createSellOrder({ escrow, token, maker, label: "cancel-buy-side" });
      await expect(escrow.connect(maker).cancelBuyOrder(sellOrderId))
        .to.be.revertedWithCustomError(escrow, "OrderSideMismatch");
    });

    it("partial sell fills keep parent/child accounting in sync", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, taker, otherTaker } = ctx;
      await escrow.connect(ctx.owner).setCooldownConfig(0, 0);

      const totalAmount = ethers.parseUnits("120", USDT_DECIMALS);
      const firstFill = ethers.parseUnits("40", USDT_DECIMALS);
      const secondFill = ethers.parseUnits("80", USDT_DECIMALS);
      const orderId = await createSellOrder({ escrow, token, maker, amount: totalAmount, minFill: firstFill, label: "partial-sell" });

      const firstTradeId = await fillSellOrder({ escrow, orderId, taker, amount: firstFill, label: "partial-sell-1" });
      let order = await escrow.getOrder(orderId);
      let firstTrade = await escrow.getTrade(firstTradeId);
      expect(order.remainingAmount).to.equal(secondFill);
      expect(order.state).to.equal(OrderState.PARTIALLY_FILLED);
      expect(firstTrade.parentOrderId).to.equal(orderId);
      expect(firstTrade.cryptoAmount).to.equal(firstFill);

      const secondTradeId = await fillSellOrder({ escrow, orderId, taker: otherTaker, amount: secondFill, label: "partial-sell-2" });
      order = await escrow.getOrder(orderId);
      const secondTrade = await escrow.getTrade(secondTradeId);
      expect(order.remainingAmount).to.equal(0n);
      expect(order.state).to.equal(OrderState.FILLED);
      expect(secondTrade.parentOrderId).to.equal(orderId);
      expect(secondTrade.cryptoAmount).to.equal(secondFill);
    });

    it("partial buy fills keep parent/child accounting in sync", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, maker, taker, otherTaker } = ctx;
      await escrow.connect(ctx.owner).setCooldownConfig(0, 0);

      const totalAmount = ethers.parseUnits("120", USDT_DECIMALS);
      const firstFill = ethers.parseUnits("40", USDT_DECIMALS);
      const secondFill = ethers.parseUnits("80", USDT_DECIMALS);
      const orderId = await createBuyOrder({ escrow, token, taker, amount: totalAmount, minFill: firstFill, label: "partial-buy" });

      const firstTradeId = await fillBuyOrder({ escrow, orderId, maker, amount: firstFill, label: "partial-buy-1" });
      let order = await escrow.getOrder(orderId);
      let firstTrade = await escrow.getTrade(firstTradeId);
      expect(order.remainingAmount).to.equal(secondFill);
      expect(order.state).to.equal(OrderState.PARTIALLY_FILLED);
      expect(firstTrade.parentOrderId).to.equal(orderId);
      expect(firstTrade.cryptoAmount).to.equal(firstFill);

      const secondTradeId = await fillBuyOrder({ escrow, orderId, maker: otherTaker, amount: secondFill, label: "partial-buy-2" });
      order = await escrow.getOrder(orderId);
      const secondTrade = await escrow.getTrade(secondTradeId);
      expect(order.remainingAmount).to.equal(0n);
      expect(order.state).to.equal(OrderState.FILLED);
      expect(secondTrade.parentOrderId).to.equal(orderId);
      expect(secondTrade.cryptoAmount).to.equal(secondFill);
    });
  });

  describe("ArafEscrow V3 config and pause semantics", function () {
    it("only owner can update fee and cooldown config or pause/unpause", async () => {
      const { escrow, taker } = await loadFixture(deployFixture);

      await expect(escrow.connect(taker).setFeeConfig(10, 10))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount")
        .withArgs(taker.address);
      await expect(escrow.connect(taker).setCooldownConfig(0, 0))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount")
        .withArgs(taker.address);
      await expect(escrow.connect(taker).pause())
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount")
        .withArgs(taker.address);
      await expect(escrow.connect(taker).unpause())
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount")
        .withArgs(taker.address);
    });


    it("view helpers expose cooldown, anti-sybil, fee, tier, and EIP-712 domain state", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, owner, maker, taker } = ctx;
      await escrow.connect(owner).setCooldownConfig(8 * 3600, 6 * 3600);
      await escrow.connect(owner).setFeeConfig(101, 202);

      const [takerFee, makerFee] = await escrow.getFeeConfig();
      expect(takerFee).to.equal(101n);
      expect(makerFee).to.equal(202n);
      expect(await escrow.getTierMaxAmount(await token.getAddress(), 0)).to.equal(TIER_MAX_AMOUNTS_BASE_UNIT[0]);
      expect(await escrow.domainSeparator()).to.not.equal(ethers.ZeroHash);

      const { tradeId } = await openSellTrade(ctx, { amount: TRADE_AMOUNT, label: "view-cooldown" });
      expect((await escrow.getTrade(tradeId)).id).to.equal(tradeId);
      const remaining = await escrow.getCooldownRemaining(taker.address);
      expect(remaining).to.be.closeTo(8n * 3600n, 5n);

      const [aged, funded, cooldownOk] = await escrow.antiSybilCheck(taker.address);
      expect(aged).to.equal(true);
      expect(funded).to.equal(true);
      expect(cooldownOk).to.equal(false);
    });

    it("token direction config can independently toggle sell and buy order surfaces", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, owner, maker, taker } = ctx;
      const tokenAddress = await token.getAddress();

      await escrow.connect(owner).setTokenConfig(tokenAddress, true, false, true, USDT_DECIMALS, TIER_MAX_AMOUNTS_BASE_UNIT);
      await expect(escrow.connect(maker).createSellOrder(tokenAddress, TRADE_AMOUNT, MIN_FILL, 0, makeRef("direction-sell-off")))
        .to.be.revertedWithCustomError(escrow, "TokenDirectionNotAllowed");
      await expect(escrow.connect(taker).createBuyOrder(tokenAddress, TRADE_AMOUNT, MIN_FILL, 0, makeRef("direction-buy-on")))
        .to.not.be.reverted;

      await escrow.connect(owner).setTokenConfig(tokenAddress, true, true, false, USDT_DECIMALS, TIER_MAX_AMOUNTS_BASE_UNIT);
      await expect(escrow.connect(taker).createBuyOrder(tokenAddress, TRADE_AMOUNT, MIN_FILL, 0, makeRef("direction-buy-off")))
        .to.be.revertedWithCustomError(escrow, "TokenDirectionNotAllowed");
      await expect(escrow.connect(maker).createSellOrder(tokenAddress, TRADE_AMOUNT, MIN_FILL, 0, makeRef("direction-sell-on")))
        .to.not.be.reverted;
    });

    it("pause blocks new parent orders and child fills", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, token, owner, maker, taker } = ctx;
      const orderId = await createSellOrder({ escrow, token, maker, label: "pause-fill" });

      await escrow.connect(owner).pause();

      await expect(
        escrow.connect(maker).createSellOrder(await token.getAddress(), TRADE_AMOUNT, MIN_FILL, 0, makeRef("paused-sell"))
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
      await expect(
        escrow.connect(taker).createBuyOrder(await token.getAddress(), TRADE_AMOUNT, MIN_FILL, 0, makeRef("paused-buy"))
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");
      await expect(
        escrow.connect(taker).fillSellOrder(orderId, TRADE_AMOUNT, makeRef("paused-fill"))
      ).to.be.revertedWithCustomError(escrow, "EnforcedPause");

      await escrow.connect(owner).unpause();
      await expect(
        escrow.connect(taker).fillSellOrder(orderId, TRADE_AMOUNT, makeRef("unpaused-fill"))
      ).to.not.be.reverted;
    });

    it("pause does not block closing an existing paid child trade", async () => {
      const ctx = await loadFixture(deployFixture);
      const { escrow, owner, maker, taker } = ctx;
      const { tradeId } = await openSellTrade(ctx);

      await escrow.connect(taker).reportPayment(tradeId, "QmPausedClose");
      await escrow.connect(owner).pause();

      await expect(escrow.connect(maker).releaseFunds(tradeId)).to.emit(escrow, "EscrowReleased");
      expect((await escrow.getTrade(tradeId)).state).to.equal(TradeState.RESOLVED);
    });
  });

  describe("ArafEscrow legacy direct escrow compatibility", function () {
    it("deprecated 3-arg createEscrow ABI is unsupported", async () => {
      const { escrow, token, maker } = await loadFixture(deployFixture);
      const legacyIface = new ethers.Interface([
        "function createEscrow(address tokenAddress, uint256 amount, uint8 tier)",
      ]);
      const data = legacyIface.encodeFunctionData("createEscrow", [await token.getAddress(), TRADE_AMOUNT, 0]);

      await expect(maker.sendTransaction({ to: await escrow.getAddress(), data })).to.be.reverted;
    });
  });
});
