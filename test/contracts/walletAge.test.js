const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployEscrowWithLibraries } = require("../../contracts/scripts/deploy");

// [TR] Cüzdan yaşı şartı: registerWallet sonrası 2 gün. [EN] Wallet age gate: 2 days after registerWallet.
describe("ArafEscrow wallet age gate", function () {
  it("blocks taker entry until 2 days after registration, then allows it", async function () {
    const [owner, treasury, maker, taker] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy("Mock USDT", "USDT", 6);
    const escrow = (await deployEscrowWithLibraries(treasury.address)).escrow;
    const u = (v) => ethers.parseUnits(String(v), 6);
    await escrow.connect(owner).setTokenConfig(await token.getAddress(), true, true, true, 6, [u(150), u(1500), u(7500), u(30000)]);
    for (const w of [maker, taker]) {
      await token.mint(w.address, u(1000));
      await token.connect(w).approve(await escrow.getAddress(), ethers.MaxUint256);
    }
    await escrow.connect(taker).registerWallet();
    const ref = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
    const createTx = await escrow.connect(maker).createSellOrder(await token.getAddress(), u(100), u(50), 0, ref("age-o"), 1);
    const orderId = (await createTx.wait()).logs.map((l) => { try { return escrow.interface.parseLog(l); } catch (_) { return null; } })
      .find((p) => p && p.name === "OrderCreated").args.orderId;

    await time.increase(2 * 24 * 3600 - 120);
    await expect(escrow.connect(taker).fillSellOrder(orderId, u(100), ref("age-c1")))
      .to.be.revertedWithCustomError(escrow, "WalletTooYoung");

    await time.increase(180);
    await expect(escrow.connect(taker).fillSellOrder(orderId, u(100), ref("age-c2"))).to.emit(escrow, "OrderFilled");
  });
});
