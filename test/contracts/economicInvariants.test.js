const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployEscrowWithLibraries } = require("../../contracts/scripts/deploy");

// [TR] Ekonomik değişmezler: parçalı fill envanter/bond korunumu ve mikro işlemlerin reputation'ı şişirememesi.
// [EN] Economic invariants: partial-fill inventory/bond conservation and micro trades not inflating reputation.
describe("ArafEscrow economic invariants", function () {
  const D = 6;
  const u = (v) => ethers.parseUnits(String(v), D);
  const TIER_MAX = [u(150), u(1500), u(7500), u(30000)];
  const ref = (label) => ethers.keccak256(ethers.toUtf8Bytes(label));

  async function eventArgs(tx, iface, name) {
    const receipt = await tx.wait();
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === name) return parsed.args;
      } catch (_) { /* other contract */ }
    }
    throw new Error(`event ${name} not found`);
  }

  async function deployFixture() {
    const [owner, treasury, maker, taker] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Mock USDT", "USDT", D);
    const escrow = (await deployEscrowWithLibraries(treasury.address)).escrow;
    const tokenAddress = await token.getAddress();
    await escrow.connect(owner).setTokenConfig(tokenAddress, true, true, true, D, TIER_MAX);
    // [TR] Testleri hızlandırmak için bekleme süreleri kapatılır. [EN] Cooldowns off to keep tests fast.
    await escrow.connect(owner).setCooldownConfig(0, 0);
    for (const w of [maker, taker]) {
      await token.mint(w.address, u(1_000_000));
      await token.connect(w).approve(await escrow.getAddress(), ethers.MaxUint256);
      await escrow.connect(w).registerWallet();
    }
    await time.increase(7 * 24 * 3600 + 1);
    return { escrow, token, tokenAddress, owner, maker, taker };
  }

  async function cleanTrade({ escrow, tokenAddress, maker, taker, amount, label }) {
    const created = await eventArgs(
      await escrow.connect(maker).createSellOrder(tokenAddress, amount, amount, 0, ref(`${label}-o`), 1),
      escrow.interface, "OrderCreated"
    );
    const filled = await eventArgs(
      await escrow.connect(taker).fillSellOrder(created.orderId, amount, ref(`${label}-c`)),
      escrow.interface, "OrderFilled"
    );
    return filled.tradeId;
  }

  async function tierOneFixture() {
    const f = await deployFixture();
    const { escrow, owner, maker, taker, tokenAddress } = f;
    await escrow.connect(owner).setReputationTierThresholds([0, 1, 1, 1, 1], [100, 100, 100, 100, 100]);
    const warm = await cleanTrade({ escrow, tokenAddress, maker, taker, amount: u(100), label: "warm" });
    await escrow.connect(taker).reportPayment(warm, "Qm-warm");
    await escrow.connect(maker).releaseFunds(warm);
    await time.increase(Number(await escrow.MIN_ACTIVE_PERIOD()) + 1);
    return f;
  }

  // [TR] Eşit olmayan, toplamı birebir tutan parçalar. [EN] Uneven parts that sum exactly to the total.
  function splitAmounts(total, n) {
    const parts = [];
    let left = total;
    for (let i = 0; i < n - 1; i++) {
      const weight = BigInt((i % 3) + 1);
      const part = (total * weight) / BigInt(2 * n) || 1n;
      parts.push(part);
      left -= part;
    }
    parts.push(left);
    return parts;
  }

  for (const n of [1, 2, 3, 7, 37]) {
    it(`sell order split into ${n} fill(s) conserves inventory and maker bond reserve`, async function () {
      const { escrow, token, tokenAddress, maker, taker } = await loadFixture(tierOneFixture);
      const total = u(1000) + 1n; // [TR] tek bir birim, yuvarlamayı zorlar [EN] one extra unit forces rounding
      const escrowAddress = await escrow.getAddress();
      const balanceBefore = await token.balanceOf(escrowAddress);
      const created = await eventArgs(
        await escrow.connect(maker).createSellOrder(tokenAddress, total, 1, 1, ref(`sell-${n}`), 1),
        escrow.interface, "OrderCreated"
      );
      const initial = await escrow.getOrder(created.orderId);
      expect(initial.remainingMakerBondReserve).to.be.gt(0n);

      let filledSum = 0n;
      let makerBondSum = 0n;
      let takerBondSum = 0n;
      const parts = splitAmounts(total, n);
      for (let i = 0; i < parts.length; i++) {
        const filled = await eventArgs(
          await escrow.connect(taker).fillSellOrder(created.orderId, parts[i], ref(`sell-${n}-${i}`)),
          escrow.interface, "OrderFilled"
        );
        const trade = await escrow.getTrade(filled.tradeId);
        filledSum += trade.cryptoAmount;
        makerBondSum += trade.makerBond;
        takerBondSum += trade.takerBond;
        const order = await escrow.getOrder(created.orderId);
        expect(filledSum + order.remainingAmount).to.equal(total);
        expect(makerBondSum + order.remainingMakerBondReserve).to.equal(initial.remainingMakerBondReserve);
      }
      const final = await escrow.getOrder(created.orderId);
      expect(final.remainingAmount).to.equal(0n);
      expect(final.remainingMakerBondReserve).to.equal(0n);
      // [TR] Kontrattaki bakiye = açık trade'lerin toplam kilidi; hiçbir birim kaybolmaz ya da takılı kalmaz.
      // [EN] Escrow balance = total locked by open trades; no unit is lost or stranded.
      expect((await token.balanceOf(escrowAddress)) - balanceBefore).to.equal(filledSum + makerBondSum + takerBondSum);
    });

    it(`buy order split into ${n} fill(s) conserves inventory and taker bond reserve`, async function () {
      const { escrow, token, tokenAddress, maker, taker } = await loadFixture(tierOneFixture);
      const total = u(1000) + 1n;
      const escrowAddress = await escrow.getAddress();
      const balanceBefore = await token.balanceOf(escrowAddress);
      const created = await eventArgs(
        await escrow.connect(taker).createBuyOrder(tokenAddress, total, 1, 1, ref(`buy-${n}`), 1),
        escrow.interface, "OrderCreated"
      );
      const initial = await escrow.getOrder(created.orderId);
      expect(initial.remainingTakerBondReserve).to.be.gt(0n);

      let filledSum = 0n;
      let makerBondSum = 0n;
      let takerBondSum = 0n;
      const parts = splitAmounts(total, n);
      for (let i = 0; i < parts.length; i++) {
        const filled = await eventArgs(
          await escrow.connect(maker).fillBuyOrder(created.orderId, parts[i], ref(`buy-${n}-${i}`)),
          escrow.interface, "OrderFilled"
        );
        const trade = await escrow.getTrade(filled.tradeId);
        filledSum += trade.cryptoAmount;
        makerBondSum += trade.makerBond;
        takerBondSum += trade.takerBond;
        const order = await escrow.getOrder(created.orderId);
        expect(filledSum + order.remainingAmount).to.equal(total);
        expect(takerBondSum + order.remainingTakerBondReserve).to.equal(initial.remainingTakerBondReserve);
      }
      const final = await escrow.getOrder(created.orderId);
      expect(final.remainingAmount).to.equal(0n);
      expect(final.remainingTakerBondReserve).to.equal(0n);
      expect((await token.balanceOf(escrowAddress)) - balanceBefore).to.equal(filledSum + makerBondSum + takerBondSum);
    });
  }

  it("micro trades below the reputation floor add no successful trades or active-period clock", async function () {
    const { escrow, tokenAddress, maker, taker } = await loadFixture(deployFixture);
    for (let i = 0; i < 5; i++) {
      const id = await cleanTrade({ escrow, tokenAddress, maker, taker, amount: u(1), label: `micro-${i}` });
      await escrow.connect(taker).reportPayment(id, `Qm-micro-${i}`);
      await escrow.connect(maker).releaseFunds(id);
    }
    for (const w of [maker, taker]) {
      const rep = await escrow.getReputation(w.address);
      expect(rep.successful).to.equal(0n);
      expect(rep.manualReleaseCount).to.equal(5n);
      expect(await escrow.getFirstSuccessfulTradeAt(w.address)).to.equal(0n);
    }

    // [TR] Eşik (20 USD) ve üstü sayılır. [EN] At or above the floor (20 USD) counts.
    const id = await cleanTrade({ escrow, tokenAddress, maker, taker, amount: u(20), label: "floor" });
    await escrow.connect(taker).reportPayment(id, "Qm-floor");
    await escrow.connect(maker).releaseFunds(id);
    expect((await escrow.getReputation(maker.address)).successful).to.equal(1n);
    expect((await escrow.getReputation(taker.address)).successful).to.equal(1n);
    expect(await escrow.getFirstSuccessfulTradeAt(taker.address)).to.be.gt(0n);
  });

  it("micro trades still carry penalties", async function () {
    const { escrow, tokenAddress, maker, taker } = await loadFixture(deployFixture);
    const id = await cleanTrade({ escrow, tokenAddress, maker, taker, amount: u(1), label: "micro-auto" });
    await escrow.connect(taker).reportPayment(id, "Qm-micro-auto");
    await time.increase(48 * 3600 + 1);
    await escrow.connect(taker).pingMaker(id);
    await time.increase(24 * 3600 + 1);
    await escrow.connect(taker).autoRelease(id);

    const makerRep = await escrow.getReputation(maker.address);
    const takerRep = await escrow.getReputation(taker.address);
    expect(makerRep.failed).to.equal(1n);
    expect(takerRep.successful).to.equal(0n);
    expect(takerRep.autoReleaseCount).to.equal(1n);
  });

  it("reputation floor is measured in dollars across token decimals", async function () {
    const { escrow, owner, maker, taker } = await loadFixture(deployFixture);
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const dai = await MockERC20.deploy("Mock DAI", "DAI", 18);
    const daiAddress = await dai.getAddress();
    const d18 = (v) => ethers.parseUnits(String(v), 18);
    await escrow.connect(owner).setTokenConfig(daiAddress, true, true, true, 18, [d18(150), d18(1500), d18(7500), d18(30000)]);
    for (const w of [maker, taker]) {
      await dai.mint(w.address, d18(100000));
      await dai.connect(w).approve(await escrow.getAddress(), ethers.MaxUint256);
    }
    const micro = await cleanTrade({ escrow, tokenAddress: daiAddress, maker, taker, amount: d18("19.99"), label: "dai-micro" });
    await escrow.connect(taker).reportPayment(micro, "Qm-dai-micro");
    await escrow.connect(maker).releaseFunds(micro);
    expect((await escrow.getReputation(taker.address)).successful).to.equal(0n);

    const counted = await cleanTrade({ escrow, tokenAddress: daiAddress, maker, taker, amount: d18(20), label: "dai-floor" });
    await escrow.connect(taker).reportPayment(counted, "Qm-dai-floor");
    await escrow.connect(maker).releaseFunds(counted);
    expect((await escrow.getReputation(taker.address)).successful).to.equal(1n);
  });
});
