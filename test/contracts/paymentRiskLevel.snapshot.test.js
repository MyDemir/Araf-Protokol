const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafEscrow payment risk level snapshot", function () {
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

  const PAYMENT_RISK_LEVEL = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    RESTRICTED: 3,
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

  async function deployFixture() {
    const [owner, treasury, maker, taker] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await Escrow.deploy(treasury.address);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);
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

  it("test_createSellOrder_high_risk_is_stored_on_order_snapshot", async () => {
    const { escrow, token, maker } = await loadFixture(deployFixture);

    const tx = await escrow.connect(maker)["createSellOrder(address,uint256,uint256,uint8,bytes32,uint8)"](
      await token.getAddress(),
      TRADE_AMOUNT,
      MIN_FILL,
      0,
      makeRef("sell-high-risk"),
      PAYMENT_RISK_LEVEL.HIGH
    );
    const args = await firstEventArgs(await tx.wait(), escrow.interface, "OrderCreated");
    const order = await escrow.getOrder(args.orderId);

    expect(order.paymentRiskLevel).to.equal(PAYMENT_RISK_LEVEL.HIGH);
  });

  it("test_fillSellOrder_copies_order_payment_risk_to_trade_snapshot", async () => {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);

    const createTx = await escrow.connect(maker)["createSellOrder(address,uint256,uint256,uint8,bytes32,uint8)"](
      await token.getAddress(),
      TRADE_AMOUNT,
      MIN_FILL,
      0,
      makeRef("sell-fill-high-risk"),
      PAYMENT_RISK_LEVEL.HIGH
    );
    const orderCreated = await firstEventArgs(await createTx.wait(), escrow.interface, "OrderCreated");

    const fillTx = await escrow.connect(taker).fillSellOrder(
      orderCreated.orderId,
      MIN_FILL,
      makeRef("sell-fill-child")
    );
    const orderFilled = await firstEventArgs(await fillTx.wait(), escrow.interface, "OrderFilled");
    const trade = await escrow.getTrade(orderFilled.tradeId);

    expect(orderFilled.paymentRiskLevelSnapshot).to.equal(PAYMENT_RISK_LEVEL.HIGH);
    expect(trade.paymentRiskLevelSnapshot).to.equal(PAYMENT_RISK_LEVEL.HIGH);
  });

  it("test_createBuyOrder_restricted_risk_is_stored_on_order_snapshot", async () => {
    const { escrow, token, taker } = await loadFixture(deployFixture);

    const tx = await escrow.connect(taker)["createBuyOrder(address,uint256,uint256,uint8,bytes32,uint8)"](
      await token.getAddress(),
      TRADE_AMOUNT,
      MIN_FILL,
      0,
      makeRef("buy-restricted-risk"),
      PAYMENT_RISK_LEVEL.RESTRICTED
    );
    const args = await firstEventArgs(await tx.wait(), escrow.interface, "OrderCreated");
    const order = await escrow.getOrder(args.orderId);

    expect(order.paymentRiskLevel).to.equal(PAYMENT_RISK_LEVEL.RESTRICTED);
  });

  it("test_fillBuyOrder_copies_order_payment_risk_to_trade_snapshot", async () => {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);

    const createTx = await escrow.connect(taker)["createBuyOrder(address,uint256,uint256,uint8,bytes32,uint8)"](
      await token.getAddress(),
      TRADE_AMOUNT,
      MIN_FILL,
      0,
      makeRef("buy-fill-restricted-risk"),
      PAYMENT_RISK_LEVEL.RESTRICTED
    );
    const orderCreated = await firstEventArgs(await createTx.wait(), escrow.interface, "OrderCreated");

    const fillTx = await escrow.connect(maker).fillBuyOrder(
      orderCreated.orderId,
      MIN_FILL,
      makeRef("buy-fill-child")
    );
    const orderFilled = await firstEventArgs(await fillTx.wait(), escrow.interface, "OrderFilled");
    const trade = await escrow.getTrade(orderFilled.tradeId);

    expect(orderFilled.paymentRiskLevelSnapshot).to.equal(PAYMENT_RISK_LEVEL.RESTRICTED);
    expect(trade.paymentRiskLevelSnapshot).to.equal(PAYMENT_RISK_LEVEL.RESTRICTED);
  });

  it("test_legacy_create_order_overloads_default_to_medium_payment_risk", async () => {
    const { escrow, token, maker, taker } = await loadFixture(deployFixture);

    const sellTx = await escrow.connect(maker)["createSellOrder(address,uint256,uint256,uint8,bytes32)"](
      await token.getAddress(),
      TRADE_AMOUNT,
      MIN_FILL,
      0,
      makeRef("legacy-sell-default")
    );
    const sellArgs = await firstEventArgs(await sellTx.wait(), escrow.interface, "OrderCreated");
    const sellOrder = await escrow.getOrder(sellArgs.orderId);

    const buyTx = await escrow.connect(taker)["createBuyOrder(address,uint256,uint256,uint8,bytes32)"](
      await token.getAddress(),
      TRADE_AMOUNT,
      MIN_FILL,
      0,
      makeRef("legacy-buy-default")
    );
    const buyArgs = await firstEventArgs(await buyTx.wait(), escrow.interface, "OrderCreated");
    const buyOrder = await escrow.getOrder(buyArgs.orderId);

    expect(sellOrder.paymentRiskLevel).to.equal(PAYMENT_RISK_LEVEL.MEDIUM);
    expect(buyOrder.paymentRiskLevel).to.equal(PAYMENT_RISK_LEVEL.MEDIUM);
  });
});
