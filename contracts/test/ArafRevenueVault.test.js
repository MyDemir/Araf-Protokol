const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafRevenueVault", function () {
  const DECIMALS = 6;
  const AMOUNT = ethers.parseUnits("100", DECIMALS);

  async function deployFixture() {
    const [owner, escrow, finalTreasury, rewards, stranger, recipient] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock USDT", "USDT", DECIMALS);

    const Vault = await ethers.getContractFactory("ArafRevenueVault");
    const vault = await Vault.deploy(escrow.address, finalTreasury.address, owner.address);
    await vault.connect(owner).setSupportedToken(await token.getAddress(), true);
    await vault.connect(owner).setRewards(rewards.address);

    return { vault, token, owner, escrow, finalTreasury, rewards, stranger, recipient };
  }

  async function pushEscrowRevenue({ token, vault, escrow, amount = AMOUNT, kind = 0, tradeId = 1 }) {
    await token.mint(await vault.getAddress(), amount);
    await vault.connect(escrow).onArafRevenue(await token.getAddress(), amount, kind, tradeId);
  }

  it("test_rewardBps_initially_4000", async function () {
    const { vault } = await loadFixture(deployFixture);
    expect(await vault.rewardBps()).to.equal(4000n);
  });

  it("test_rewardBps_cannot_go_below_40_percent", async function () {
    const { vault, owner } = await loadFixture(deployFixture);
    await expect(vault.connect(owner).setRewardBps(3999))
      .to.be.revertedWithCustomError(vault, "RewardBpsOutOfRange");
  });

  it("test_rewardBps_cannot_go_above_70_percent", async function () {
    const { vault, owner } = await loadFixture(deployFixture);
    await expect(vault.connect(owner).setRewardBps(7001))
      .to.be.revertedWithCustomError(vault, "RewardBpsOutOfRange");
  });

  it("test_owner_can_set_rewardBps_within_range", async function () {
    const { vault, owner } = await loadFixture(deployFixture);
    await expect(vault.connect(owner).setRewardBps(7000))
      .to.emit(vault, "RewardBpsUpdated")
      .withArgs(7000);
    expect(await vault.rewardBps()).to.equal(7000n);
  });

  it("test_onArafRevenue_onlyEscrow", async function () {
    const { vault, token, stranger } = await loadFixture(deployFixture);
    await token.mint(await vault.getAddress(), AMOUNT);
    await expect(
      vault.connect(stranger).onArafRevenue(await token.getAddress(), AMOUNT, 0, 11)
    ).to.be.revertedWithCustomError(vault, "OnlyEscrow");
  });

  it("test_onArafRevenue_reverts_unsupported_token", async function () {
    const { vault, owner, escrow } = await loadFixture(deployFixture);
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const other = await MockERC20.deploy("Mock USDC", "USDC", DECIMALS);
    await other.mint(await vault.getAddress(), AMOUNT);
    await vault.connect(owner).setSupportedToken(await other.getAddress(), false);

    await expect(
      vault.connect(escrow).onArafRevenue(await other.getAddress(), AMOUNT, 0, 12)
    ).to.be.revertedWithCustomError(vault, "UnsupportedRewardToken");
  });

  it("test_onArafRevenue_splits_40_60_initially", async function () {
    const { vault, token, escrow } = await loadFixture(deployFixture);
    const tokenAddr = await token.getAddress();
    await token.mint(await vault.getAddress(), AMOUNT);

    await expect(vault.connect(escrow).onArafRevenue(tokenAddr, AMOUNT, 0, 101))
      .to.emit(vault, "EscrowRevenueReceived")
      .withArgs(tokenAddr, AMOUNT, AMOUNT * 4000n / 10000n, AMOUNT * 6000n / 10000n, 0, 101);

    expect(await vault.rewardReserve(tokenAddr)).to.equal(AMOUNT * 4000n / 10000n);
    expect(await vault.treasuryReserve(tokenAddr)).to.equal(AMOUNT * 6000n / 10000n);
    expect(await vault.totalEscrowRevenue(tokenAddr)).to.equal(AMOUNT);
  });

  it("test_onArafRevenue_splits_70_30_when_configured", async function () {
    const { vault, token, owner, escrow } = await loadFixture(deployFixture);
    const tokenAddr = await token.getAddress();
    await vault.connect(owner).setRewardBps(7000);
    await token.mint(await vault.getAddress(), AMOUNT);
    await vault.connect(escrow).onArafRevenue(tokenAddr, AMOUNT, 1, 102);

    expect(await vault.rewardReserve(tokenAddr)).to.equal(AMOUNT * 7000n / 10000n);
    expect(await vault.treasuryReserve(tokenAddr)).to.equal(AMOUNT * 3000n / 10000n);
  });

  it("test_treasury_can_only_withdraw_treasuryReserve", async function () {
    const { vault, token, owner, escrow, recipient } = await loadFixture(deployFixture);
    const tokenAddr = await token.getAddress();
    await pushEscrowRevenue({ token, vault, escrow, amount: AMOUNT });
    const withdrawAmount = AMOUNT * 6000n / 10000n;

    const before = await token.balanceOf(recipient.address);
    await expect(vault.connect(owner).withdrawTreasuryShare(tokenAddr, withdrawAmount, recipient.address))
      .to.emit(vault, "TreasuryShareWithdrawn")
      .withArgs(tokenAddr, recipient.address, withdrawAmount);
    const after = await token.balanceOf(recipient.address);

    expect(after - before).to.equal(withdrawAmount);
    expect(await vault.treasuryReserve(tokenAddr)).to.equal(0n);
    expect(await vault.rewardReserve(tokenAddr)).to.equal(AMOUNT * 4000n / 10000n);
  });

  it("test_owner_cannot_withdraw_rewardReserve", async function () {
    const { vault, token, owner, escrow, recipient } = await loadFixture(deployFixture);
    const tokenAddr = await token.getAddress();
    await pushEscrowRevenue({ token, vault, escrow, amount: AMOUNT });

    await expect(
      vault.connect(owner).withdrawTreasuryShare(tokenAddr, AMOUNT * 7000n / 10000n, recipient.address)
    ).to.be.revertedWithCustomError(vault, "InsufficientTreasuryReserve");
  });

  it("test_withdrawTreasuryShare_reverts_insufficientReserve", async function () {
    const { vault, token, owner, recipient } = await loadFixture(deployFixture);
    await expect(
      vault.connect(owner).withdrawTreasuryShare(await token.getAddress(), 1, recipient.address)
    ).to.be.revertedWithCustomError(vault, "InsufficientTreasuryReserve");
  });

  it("test_withdrawTreasuryShare_reverts_zero_recipient", async function () {
    const { vault, token, owner, escrow } = await loadFixture(deployFixture);
    await pushEscrowRevenue({ token, vault, escrow, amount: AMOUNT });
    await expect(
      vault.connect(owner).withdrawTreasuryShare(await token.getAddress(), 1, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(vault, "InvalidRecipient");
  });

  it("test_pause_blocks_onArafRevenue", async function () {
    const { vault, token, owner, escrow } = await loadFixture(deployFixture);
    await vault.connect(owner).pause();
    await token.mint(await vault.getAddress(), AMOUNT);
    await expect(
      vault.connect(escrow).onArafRevenue(await token.getAddress(), AMOUNT, 0, 103)
    ).to.be.revertedWithCustomError(vault, "EnforcedPause");
  });

  it("test_accounting_balance_invariant_after_multiple_revenues", async function () {
    const { vault, token, owner, escrow, recipient } = await loadFixture(deployFixture);
    const tokenAddr = await token.getAddress();

    await pushEscrowRevenue({ token, vault, escrow, amount: ethers.parseUnits("100", DECIMALS), tradeId: 1 });
    await pushEscrowRevenue({ token, vault, escrow, amount: ethers.parseUnits("50", DECIMALS), tradeId: 2 });
    await vault.connect(owner).setRewardBps(7000);
    await pushEscrowRevenue({ token, vault, escrow, amount: ethers.parseUnits("25", DECIMALS), tradeId: 3 });

    const treasuryPart1 = (ethers.parseUnits("100", DECIMALS) * 6000n) / 10000n;
    await vault.connect(owner).withdrawTreasuryShare(tokenAddr, treasuryPart1, recipient.address);

    const rewardReserve = await vault.rewardReserve(tokenAddr);
    const treasuryReserve = await vault.treasuryReserve(tokenAddr);
    const balance = await token.balanceOf(await vault.getAddress());
    expect(balance).to.equal(rewardReserve + treasuryReserve);
  });

  it("test_fundGlobalRewards_reverts_unsupported_token", async function () {
    const { vault, stranger } = await loadFixture(deployFixture);
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const unsupported = await MockERC20.deploy("Unsupported", "UNS", DECIMALS);
    await unsupported.mint(stranger.address, AMOUNT);
    await unsupported.connect(stranger).approve(await vault.getAddress(), AMOUNT);

    await expect(
      vault.connect(stranger).fundGlobalRewards(await unsupported.getAddress(), AMOUNT, 1, ethers.id("fund-unsupported"))
    ).to.be.revertedWithCustomError(vault, "UnsupportedRewardToken");
  });

  it("test_fundGlobalRewards_reverts_zero_amount", async function () {
    const { vault, token, stranger } = await loadFixture(deployFixture);
    await token.connect(stranger).approve(await vault.getAddress(), AMOUNT);
    await expect(
      vault.connect(stranger).fundGlobalRewards(await token.getAddress(), 0, 1, ethers.id("fund-zero"))
    ).to.be.revertedWithCustomError(vault, "ZeroAmount");
  });

  it("test_fundGlobalRewards_exact_in_transfer", async function () {
    const { vault, token, stranger } = await loadFixture(deployFixture);
    const tokenAddr = await token.getAddress();
    await token.mint(stranger.address, AMOUNT);
    await token.connect(stranger).approve(await vault.getAddress(), AMOUNT);

    const before = await token.balanceOf(await vault.getAddress());
    await expect(vault.connect(stranger).fundGlobalRewards(tokenAddr, AMOUNT, 7, ethers.id("fund-exact-in")))
      .to.emit(vault, "ExternalRewardFunded");
    const after = await token.balanceOf(await vault.getAddress());
    expect(after - before).to.equal(AMOUNT);
  });

  it("test_fundGlobalRewards_reverts_fee_on_transfer_token", async function () {
    const { vault, owner, stranger } = await loadFixture(deployFixture);
    const FeeToken = await ethers.getContractFactory("MockFeeOnTransferERC20");
    const feeToken = await FeeToken.deploy("Fee Token", "FEE", DECIMALS, 100, owner.address);
    await vault.connect(owner).setSupportedToken(await feeToken.getAddress(), true);

    await feeToken.mint(stranger.address, AMOUNT);
    await feeToken.connect(stranger).approve(await vault.getAddress(), AMOUNT);

    await expect(
      vault.connect(stranger).fundGlobalRewards(await feeToken.getAddress(), AMOUNT, 5, ethers.id("fund-fee-token"))
    ).to.be.revertedWithCustomError(vault, "ExactInMismatch");
  });

  it("test_fundGlobalRewards_adds_to_epoch", async function () {
    const { vault, token, stranger } = await loadFixture(deployFixture);
    const tokenAddr = await token.getAddress();
    await token.mint(stranger.address, AMOUNT);
    await token.connect(stranger).approve(await vault.getAddress(), AMOUNT);

    await vault.connect(stranger).fundGlobalRewards(tokenAddr, AMOUNT, 9, ethers.id("fund-epoch"));
    expect(await vault.externalFundingByEpoch(9, tokenAddr)).to.equal(AMOUNT);
  });

  it("test_fundGlobalRewards_increments_totalExternalFunding", async function () {
    const { vault, token, stranger } = await loadFixture(deployFixture);
    const tokenAddr = await token.getAddress();
    const amount1 = ethers.parseUnits("25", DECIMALS);
    const amount2 = ethers.parseUnits("40", DECIMALS);
    await token.mint(stranger.address, amount1 + amount2);
    await token.connect(stranger).approve(await vault.getAddress(), amount1 + amount2);

    await vault.connect(stranger).fundGlobalRewards(tokenAddr, amount1, 1, ethers.id("fund-total-1"));
    await vault.connect(stranger).fundGlobalRewards(tokenAddr, amount2, 2, ethers.id("fund-total-2"));
    expect(await vault.totalExternalFunding(tokenAddr)).to.equal(amount1 + amount2);
  });

  it("test_setProductPool_onlyOwner", async function () {
    const { vault, owner, stranger } = await loadFixture(deployFixture);
    const productId = ethers.id("product-A");
    await expect(
      vault.connect(stranger).setProductPool(productId, true, "ipfs://product/A")
    ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");

    await expect(vault.connect(owner).setProductPool(productId, true, "ipfs://product/A"))
      .to.emit(vault, "ProductPoolUpdated")
      .withArgs(productId, true, "ipfs://product/A");
  });

  it("test_fundProductRewards_reverts_disabled_product", async function () {
    const { vault, token, stranger } = await loadFixture(deployFixture);
    const productId = ethers.id("product-disabled");
    await token.mint(stranger.address, AMOUNT);
    await token.connect(stranger).approve(await vault.getAddress(), AMOUNT);
    await expect(
      vault.connect(stranger).fundProductRewards(
        productId,
        await token.getAddress(),
        AMOUNT,
        1,
        ethers.id("product-fund-disabled")
      )
    ).to.be.revertedWithCustomError(vault, "ProductPoolDisabled");
  });

  it("test_fundProductRewards_adds_to_product_epoch", async function () {
    const { vault, token, owner, stranger } = await loadFixture(deployFixture);
    const productId = ethers.id("product-enabled");
    const tokenAddr = await token.getAddress();
    await vault.connect(owner).setProductPool(productId, true, "ipfs://product/enabled");
    await token.mint(stranger.address, AMOUNT);
    await token.connect(stranger).approve(await vault.getAddress(), AMOUNT);

    await expect(
      vault.connect(stranger).fundProductRewards(productId, tokenAddr, AMOUNT, 12, ethers.id("product-fund"))
    ).to.emit(vault, "ProductRewardFunded");
    expect(await vault.productFundingByEpoch(12, productId, tokenAddr)).to.equal(AMOUNT);
  });

  it("test_product_funding_does_not_choose_user_or_weight", async function () {
    const { vault } = await loadFixture(deployFixture);
    expect(vault.interface.getFunction("userWeight")).to.equal(null);
    expect(vault.interface.getFunction("totalWeight")).to.equal(null);
    expect(vault.interface.getFunction("setUserWeight")).to.equal(null);
    expect(vault.interface.getFunction("setMultiplier")).to.equal(null);
  });

  it("test_pause_blocks_external_funding", async function () {
    const { vault, token, owner, stranger } = await loadFixture(deployFixture);
    const productId = ethers.id("product-pause");
    await vault.connect(owner).setProductPool(productId, true, "ipfs://product/pause");
    await token.mint(stranger.address, AMOUNT * 2n);
    await token.connect(stranger).approve(await vault.getAddress(), AMOUNT * 2n);
    await vault.connect(owner).pause();

    await expect(
      vault.connect(stranger).fundGlobalRewards(await token.getAddress(), AMOUNT, 1, ethers.id("pause-global"))
    ).to.be.revertedWithCustomError(vault, "EnforcedPause");

    await expect(
      vault.connect(stranger).fundProductRewards(productId, await token.getAddress(), AMOUNT, 1, ethers.id("pause-product"))
    ).to.be.revertedWithCustomError(vault, "EnforcedPause");
  });
});
