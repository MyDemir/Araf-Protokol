const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ArafEscrow token decimals and token-specific tier limits", function () {
  const DECIMALS_6 = 6;
  const DECIMALS_18 = 18;
  const INITIAL_BAL_6 = ethers.parseUnits("1000000", DECIMALS_6);
  const INITIAL_BAL_18 = ethers.parseUnits("1000000", DECIMALS_18);

  const TIER_LIMITS_6 = [
    ethers.parseUnits("150", DECIMALS_6),
    ethers.parseUnits("1500", DECIMALS_6),
    ethers.parseUnits("7500", DECIMALS_6),
    ethers.parseUnits("30000", DECIMALS_6),
  ];
  const TIER_LIMITS_18 = [
    ethers.parseUnits("150", DECIMALS_18),
    ethers.parseUnits("1500", DECIMALS_18),
    ethers.parseUnits("7500", DECIMALS_18),
    ethers.parseUnits("30000", DECIMALS_18),
  ];

  function makeRef(label) {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  async function deployFixture() {
    const [owner, treasury, maker, taker] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await Escrow.deploy(treasury.address);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token6 = await MockERC20.deploy("Token6", "TK6", DECIMALS_6);
    const token18 = await MockERC20.deploy("Token18", "TK18", DECIMALS_18);

    await escrow.connect(owner).setTokenConfig(
      await token6.getAddress(),
      true,
      true,
      true,
      DECIMALS_6,
      TIER_LIMITS_6
    );
    await escrow.connect(owner).setTokenConfig(
      await token18.getAddress(),
      true,
      true,
      true,
      DECIMALS_18,
      TIER_LIMITS_18
    );

    await token6.mint(maker.address, INITIAL_BAL_6);
    await token18.mint(maker.address, INITIAL_BAL_18);
    await token6.connect(maker).approve(await escrow.getAddress(), ethers.MaxUint256);
    await token18.connect(maker).approve(await escrow.getAddress(), ethers.MaxUint256);

    await escrow.connect(maker).registerWallet();
    await escrow.connect(taker).registerWallet();
    await time.increase(7 * 24 * 3600 + 1);

    return { escrow, owner, maker, token6, token18 };
  }

  it("test_tokenConfig_stores_decimals", async () => {
    const { escrow, token6, token18 } = await loadFixture(deployFixture);

    const cfg6 = await escrow.getTokenConfig(await token6.getAddress());
    const cfg18 = await escrow.getTokenConfig(await token18.getAddress());

    expect(cfg6.decimals).to.equal(DECIMALS_6);
    expect(cfg18.decimals).to.equal(DECIMALS_18);
  });

  it("test_setTokenConfig_reverts_for_decimals_above_18", async () => {
    const { escrow, owner, token6 } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(owner).setTokenConfig(
        await token6.getAddress(),
        true,
        true,
        true,
        19,
        TIER_LIMITS_6
      )
    ).to.be.revertedWithCustomError(escrow, "InvalidDecimals");
  });

  it("test_tierLimit_works_for_6_decimals_token", async () => {
    const { escrow, maker, token6 } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(maker).createSellOrder(
        await token6.getAddress(),
        TIER_LIMITS_6[0],
        TIER_LIMITS_6[0],
        0,
        makeRef("tier6-ok")
      )
    ).to.not.be.reverted;
  });

  it("test_tierLimit_works_for_18_decimals_token", async () => {
    const { escrow, maker, token18 } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(maker).createSellOrder(
        await token18.getAddress(),
        TIER_LIMITS_18[0],
        TIER_LIMITS_18[0],
        0,
        makeRef("tier18-ok")
      )
    ).to.not.be.reverted;
  });

  it("test_order_reverts_when_amount_exceeds_token_specific_tier_limit", async () => {
    const { escrow, maker, token18 } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(maker).createSellOrder(
        await token18.getAddress(),
        TIER_LIMITS_18[0] + 1n,
        TIER_LIMITS_18[0],
        0,
        makeRef("tier18-over")
      )
    ).to.be.revertedWithCustomError(escrow, "AmountExceedsTierLimit");
  });
});
