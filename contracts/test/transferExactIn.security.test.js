const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafEscrow exact in-transfer security", function () {
  const USDT_DECIMALS = 6;
  const TRADE_AMOUNT = ethers.parseUnits("100", USDT_DECIMALS);
  const MIN_FILL = ethers.parseUnits("50", USDT_DECIMALS);
  const INITIAL_BAL = ethers.parseUnits("100000", USDT_DECIMALS);

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
    const [owner, treasury, maker, taker, feeCollector] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await Escrow.deploy(treasury.address);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const exactToken = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);

    const MockFeeOnTransferERC20 = await ethers.getContractFactory("MockFeeOnTransferERC20");
    const feeToken = await MockFeeOnTransferERC20.deploy(
      "Mock Fee USDT",
      "fUSDT",
      USDT_DECIMALS,
      100, // 1%
      feeCollector.address
    );

    const exactTokenAddress = await exactToken.getAddress();
    const feeTokenAddress = await feeToken.getAddress();

    await escrow.connect(owner).setTokenConfig(exactTokenAddress, true, true, true);
    await escrow.connect(owner).setTokenConfig(feeTokenAddress, true, true, true);

    for (const wallet of [maker, taker]) {
      await exactToken.mint(wallet.address, INITIAL_BAL);
      await feeToken.mint(wallet.address, INITIAL_BAL);

      await exactToken.connect(wallet).approve(await escrow.getAddress(), ethers.MaxUint256);
      await feeToken.connect(wallet).approve(await escrow.getAddress(), ethers.MaxUint256);
      await escrow.connect(wallet).registerWallet();
    }

    await time.increase(7 * 24 * 3600 + 1);

    return { escrow, exactToken, feeToken, owner, maker, taker };
  }

  it("test_createSellOrder_reverts_when_token_receives_less_than_expected", async () => {
    const { escrow, feeToken, maker } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(maker).createSellOrder(
        await feeToken.getAddress(),
        TRADE_AMOUNT,
        MIN_FILL,
        0,
        makeRef("fee-create-sell")
      )
    ).to.be.revertedWithCustomError(escrow, "InvalidTransferAmount");
  });

  it("test_fillBuyOrder_reverts_when_token_receives_less_than_expected", async () => {
    const { escrow, feeToken, maker, taker } = await loadFixture(deployFixture);

    const createBuyTx = await escrow.connect(taker).createBuyOrder(
      await feeToken.getAddress(),
      TRADE_AMOUNT,
      MIN_FILL,
      0,
      makeRef("fee-buy-order")
    );
    const createBuyArgs = await firstEventArgs(await createBuyTx.wait(), escrow.interface, "OrderCreated");

    await expect(
      escrow.connect(maker).fillBuyOrder(createBuyArgs.orderId, TRADE_AMOUNT, makeRef("fee-buy-child"))
    ).to.be.revertedWithCustomError(escrow, "InvalidTransferAmount");
  });

  it("test_exact_transfer_token_still_works", async () => {
    const { escrow, exactToken, maker, taker } = await loadFixture(deployFixture);

    const createSellTx = await escrow.connect(maker).createSellOrder(
      await exactToken.getAddress(),
      TRADE_AMOUNT,
      MIN_FILL,
      0,
      makeRef("exact-sell-order")
    );
    const createSellArgs = await firstEventArgs(await createSellTx.wait(), escrow.interface, "OrderCreated");

    const fillSellTx = await escrow.connect(taker).fillSellOrder(
      createSellArgs.orderId,
      TRADE_AMOUNT,
      makeRef("exact-sell-child")
    );
    const fillSellArgs = await firstEventArgs(await fillSellTx.wait(), escrow.interface, "OrderFilled");

    const trade = await escrow.getTrade(fillSellArgs.tradeId);
    expect(trade.state).to.equal(1n); // LOCKED
  });

  it("test_transfer_exact_helper_reverts_on_fee_on_transfer_token", async () => {
    const { escrow, exactToken, feeToken, owner, maker, taker } = await loadFixture(deployFixture);

    // [TR] Tier-1 bond transfer yolunu açmak için min threshold + active period şartı hazırlanır.
    // [EN] Prepare min threshold + active period so tier-1 bond transfer path becomes reachable.
    await escrow.connect(owner).setReputationTierThresholds([0, 1, 1, 1, 1], [100, 100, 100, 100, 100]);

    const warmupOrderTx = await escrow.connect(maker).createSellOrder(
      await exactToken.getAddress(),
      TRADE_AMOUNT,
      MIN_FILL,
      0,
      makeRef("warmup-order")
    );
    const warmupOrderArgs = await firstEventArgs(await warmupOrderTx.wait(), escrow.interface, "OrderCreated");
    const warmupFillTx = await escrow.connect(taker).fillSellOrder(
      warmupOrderArgs.orderId,
      TRADE_AMOUNT,
      makeRef("warmup-child")
    );
    const warmupFillArgs = await firstEventArgs(await warmupFillTx.wait(), escrow.interface, "OrderFilled");
    await escrow.connect(taker).reportPayment(warmupFillArgs.tradeId, "QmWarmupTier1");
    await escrow.connect(maker).releaseFunds(warmupFillArgs.tradeId);
    await time.increase(15 * 24 * 3600 + 1);

    await expect(
      escrow.connect(taker).createBuyOrder(
        await feeToken.getAddress(),
        TRADE_AMOUNT,
        MIN_FILL,
        1,
        makeRef("fee-create-buy-tier1")
      )
    ).to.be.revertedWithCustomError(escrow, "InvalidTransferAmount");
  });
});
