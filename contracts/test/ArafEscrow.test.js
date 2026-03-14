const { expect } = require("chai");
const { ethers }  = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * ArafEscrow — Full Test Suite
 * Covers: Happy Path, Anti-Sybil, Bleeding Escrow, Collaborative Cancel, Burns
 */
describe("ArafEscrow", function () {
  let escrow, mockUSDT;
  let owner, treasury, maker, taker, attacker, stranger;

  const USDT_DECIMALS  = 6;
  const TRADE_AMOUNT   = ethers.parseUnits("1000", USDT_DECIMALS);
  const MAKER_BOND_T2  = ethers.parseUnits("60",   USDT_DECIMALS);
  const TAKER_BOND_T2  = ethers.parseUnits("80",   USDT_DECIMALS);
  const TOTAL_LOCK_T2  = TRADE_AMOUNT + MAKER_BOND_T2;
  const INITIAL_BAL    = ethers.parseUnits("50000", USDT_DECIMALS); // Boost işlemleri için artırıldı

  const TAKER_FEE_BPS = 10n;
  const MAKER_FEE_BPS = 10n;
  const BPS_DENOM     = 10000n;

  const SEVEN_DAYS     = 7 * 24 * 3600;
  const FORTY_EIGHT_H  = 48 * 3600;
  const ONE_HOUR       = 3600;
  const TEN_DAYS       = 10 * 24 * 3600;

  // Hesapları baştan Tier 4'e (en üst seviye) çıkarmak için gereken işlem sayısı
  const BASELINE_SUCCESS = 200n; 

  async function deployAndSetupFixture() {
    const [owner, treasury, maker, taker, attacker, stranger] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mockUSDT = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);

    const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
    const escrow = await ArafEscrow.deploy(treasury.address);

    await escrow.connect(owner).setSupportedToken(await mockUSDT.getAddress(), true);

    await mockUSDT.mint(maker.address, INITIAL_BAL);
    await mockUSDT.mint(taker.address, INITIAL_BAL);
    await mockUSDT.mint(attacker.address, INITIAL_BAL);

    const addr = await escrow.getAddress();
    await mockUSDT.connect(maker).approve(addr, ethers.MaxUint256);
    await mockUSDT.connect(taker).approve(addr, ethers.MaxUint256);
    await mockUSDT.connect(attacker).approve(addr, ethers.MaxUint256);

    await escrow.connect(maker).registerWallet();
    await escrow.connect(taker).registerWallet();
    await escrow.connect(attacker).registerWallet();
    await time.increase(SEVEN_DAYS + 1);

    await owner.sendTransaction({ to: taker.address, value: ethers.parseEther("0.1") });
    await owner.sendTransaction({ to: attacker.address, value: ethers.parseEther("0.1") });

    // ─── TIER 4 BOOST DÖNGÜSÜ ───
    // Maker ve Taker'ı Tier 4 seviyesine çıkartmak için 200 işlem
    // Hem successfulTrades sayacını doldurur hem de 30 günlük MIN_ACTIVE_PERIOD'u atlar.
    const tokenAddr = await mockUSDT.getAddress();
    const dummyAmount = ethers.parseUnits("1", USDT_DECIMALS); 
    
    for (let i = 0; i < Number(BASELINE_SUCCESS); i++) {
      const tx = await escrow.connect(maker).createEscrow(tokenAddr, dummyAmount, 0);
      const receipt = await tx.wait();
      const log = receipt.logs.find(l => {
        try { return escrow.interface.parseLog(l).name === "EscrowCreated"; }
        catch { return false; }
      });
      const tradeId = escrow.interface.parseLog(log).args.tradeId;

      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "setup");
      await escrow.connect(maker).releaseFunds(tradeId);

      // TIER0_TRADE_COOLDOWN'ı atlamak için zamanı ileri sarıyoruz
      await time.increase(24 * 3600 + 1);
    }

    return { escrow, mockUSDT, owner, treasury, maker, taker, attacker, stranger };
  }

  beforeEach(async () => {
    // Tüm kurulum ve boost işlemleri bir kez yapılır, state snapshot alınır.
    const fixture = await loadFixture(deployAndSetupFixture);
    escrow = fixture.escrow;
    mockUSDT = fixture.mockUSDT;
    owner = fixture.owner;
    treasury = fixture.treasury;
    maker = fixture.maker;
    taker = fixture.taker;
    attacker = fixture.attacker;
    stranger = fixture.stranger;
  });

  // ─── Helper ───────────────────────────────────────────────────────────────
  async function setupTrade(tierLevel = 2) {
    const tx = await escrow.connect(maker).createEscrow(
      await mockUSDT.getAddress(), TRADE_AMOUNT, tierLevel
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => {
      try { return escrow.interface.parseLog(l).name === "EscrowCreated"; }
      catch { return false; }
    });
    const parsed = escrow.interface.parseLog(event);
    return parsed.args.tradeId;
  }

  async function eip712CancelSig(signer, tradeId, nonce, deadline) {
    const domain = {
      name:              "ArafEscrow",
      version:           "1",
      chainId:           (await ethers.provider.getNetwork()).chainId,
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
    const value = { tradeId, proposer: signer.address, nonce, deadline };
    return signer.signTypedData(domain, types, value);
  }

  function calcFees(cryptoAmount, makerBond) {
    const takerFee       = (cryptoAmount * TAKER_FEE_BPS) / BPS_DENOM;
    const takerReceives  = cryptoAmount - takerFee;
    const makerFee       = (cryptoAmount * MAKER_FEE_BPS) / BPS_DENOM;
    const makerBondBack  = makerBond > makerFee ? makerBond - makerFee : 0n;
    const actualMakerFee = makerBond > makerFee ? makerFee : makerBond;
    const totalTreasury  = takerFee + actualMakerFee;
    return { takerFee, takerReceives, makerFee: actualMakerFee, makerBondBack, totalTreasury };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. HAPPY PATH
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Happy Path", () => {
    it("should complete full trade lifecycle", async () => {
      const tradeId = await setupTrade(2);

      await escrow.connect(taker).lockEscrow(tradeId);
      expect((await escrow.getTrade(tradeId)).state).to.equal(1);

      await escrow.connect(taker).reportPayment(tradeId, "QmTestHashABC123");
      expect((await escrow.getTrade(tradeId)).state).to.equal(2);

      const takerBefore = await mockUSDT.balanceOf(taker.address);
      const makerBefore = await mockUSDT.balanceOf(maker.address);
      await escrow.connect(maker).releaseFunds(tradeId);

      const { takerReceives, makerBondBack } = calcFees(TRADE_AMOUNT, MAKER_BOND_T2);

      expect(await mockUSDT.balanceOf(taker.address) - takerBefore).to.equal(takerReceives + TAKER_BOND_T2);
      expect(await mockUSDT.balanceOf(maker.address) - makerBefore).to.equal(makerBondBack);
      expect((await escrow.getTrade(tradeId)).state).to.equal(4);
    });

    it("taker can auto-release after pinging and waiting 24h", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmAutoRelease");

      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      expect((await escrow.getTrade(tradeId)).pingedByTaker).to.be.true;

      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).autoRelease(tradeId);
      
      expect((await escrow.getTrade(tradeId)).state).to.equal(4);
      const [, makerFailed,,,] = await escrow.getReputation(maker.address);
      expect(makerFailed).to.equal(1); 
    });

    it("should update reputation on successful trade", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await escrow.connect(maker).releaseFunds(tradeId);

      const [makerSuccess,,,] = await escrow.getReputation(maker.address);
      const [takerSuccess,,,] = await escrow.getReputation(taker.address);
      expect(makerSuccess).to.equal(BASELINE_SUCCESS + 1n);
      expect(takerSuccess).to.equal(BASELINE_SUCCESS + 1n);
    });

    it("S1: autoRelease gives maker +1 Failed, taker +1 Successful", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).autoRelease(tradeId);

      const [makerSuccess, makerFailed,,,] = await escrow.getReputation(maker.address);
      const [takerSuccess, takerFailed,,,] = await escrow.getReputation(taker.address);
      
      expect(makerSuccess).to.equal(BASELINE_SUCCESS);
      expect(makerFailed).to.equal(1);  
      expect(takerSuccess).to.equal(BASELINE_SUCCESS + 1n);
      expect(takerFailed).to.equal(0);
    });

    it("S2: releaseFunds from CHALLENGED state gives maker +1 Failed", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      await time.increase(1);
      await escrow.connect(maker).releaseFunds(tradeId);

      const [makerSuccess, makerFailed,,,] = await escrow.getReputation(maker.address);
      const [takerSuccess, takerFailed,,,] = await escrow.getReputation(taker.address);
      
      expect(makerSuccess).to.equal(BASELINE_SUCCESS);
      expect(makerFailed).to.equal(1);  
      expect(takerSuccess).to.equal(BASELINE_SUCCESS + 1n);
      expect(takerFailed).to.equal(0);
    });

    it("S3: collaborative cancel from CHALLENGED state gives no reputation penalty", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      const deadline = (await time.latest()) + 3600;
      const makerSig = await eip712CancelSig(maker, tradeId, await escrow.sigNonces(maker.address), deadline);
      await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);
      const takerSig = await eip712CancelSig(taker, tradeId, await escrow.sigNonces(taker.address), deadline);
      await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);

      expect((await escrow.getTrade(tradeId)).state).to.equal(5); 

      const [makerSuccess, makerFailed,,,] = await escrow.getReputation(maker.address);
      const [takerSuccess, takerFailed,,,] = await escrow.getReputation(taker.address);
      expect(makerSuccess).to.equal(BASELINE_SUCCESS);
      expect(makerFailed).to.equal(0);
      expect(takerSuccess).to.equal(BASELINE_SUCCESS);
      expect(takerFailed).to.equal(0);
    });

    it("1. ban: 30 gun, tier kisitlamasi yok", async () => {
      let tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(FORTY_EIGHT_H + 1);
      await escrow.connect(taker).autoRelease(tradeId); 

      tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(FORTY_EIGHT_H + 1);
      await escrow.connect(taker).autoRelease(tradeId); 

      const [, failed, bannedUntil, consecutive, tierCap] = await escrow.getReputation(maker.address);
      expect(failed).to.equal(2);
      expect(bannedUntil).to.be.gt(0n);
      expect(consecutive).to.equal(1n);
      expect(tierCap).to.equal(4); // Tier 4'te başladığı için etkilenmez
      const now = BigInt(await time.latest());
      expect(bannedUntil).to.be.closeTo(now + BigInt(30 * 24 * 3600), 60n);
    });

    it("2. consecutive ban: 60 gun + tier 1 duser", async () => {
      for (let i = 0; i < 3; i++) {
        let tradeId = await setupTrade(0);
        await escrow.connect(taker).lockEscrow(tradeId);
        await escrow.connect(taker).reportPayment(tradeId, `QmHash${i}`);
        await time.increase(24 * 3600 + 1);
        await escrow.connect(taker).pingMaker(tradeId);
        await time.increase(24 * 3600 + 1);
        await escrow.connect(taker).autoRelease(tradeId);

        const [, , bannedUntil] = await escrow.getReputation(maker.address);
        if (bannedUntil > 0) {
          const now = await time.latest();
          if (bannedUntil > now) {
            await time.increase(bannedUntil - BigInt(now) + 1n);
          }
        }
      }

      const [, , bannedUntil, consecutive, tierCap] = await escrow.getReputation(maker.address);
      expect(consecutive).to.equal(2n);
      expect(tierCap).to.equal(3); // Tier 4'ten 1 düşer -> max Tier 3
      const now = BigInt(await time.latest());
      expect(bannedUntil).to.be.closeTo(now + BigInt(60 * 24 * 3600), 60n);
    });

    it("tier kisitlanan cuzdan ust tierde islem acamaz", async () => {
      for (let i = 0; i < 3; i++) {
        let tradeId = await setupTrade(0);
        await escrow.connect(taker).lockEscrow(tradeId);
        await escrow.connect(taker).reportPayment(tradeId, "QmHash");
        await time.increase(24 * 3600 + 1);
        await escrow.connect(taker).pingMaker(tradeId);
        await time.increase(24 * 3600 + 1);
        await escrow.connect(taker).autoRelease(tradeId);
      }

      await expect(
        escrow.connect(maker).createEscrow(await mockUSDT.getAddress(), TRADE_AMOUNT, 4)
      ).to.be.revertedWithCustomError(escrow, "TierNotAllowed");

      await expect(
        escrow.connect(maker).createEscrow(await mockUSDT.getAddress(), TRADE_AMOUNT, 3)
      ).to.not.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Maker Flow - Cancel OPEN Escrow
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Maker Flow - Cancel OPEN Escrow", () => {
    it("should allow maker to cancel an OPEN escrow and get full refund", async () => {
      const tradeId = await setupTrade(2);
      const makerBefore = await mockUSDT.balanceOf(maker.address);

      await escrow.connect(maker).cancelOpenEscrow(tradeId);

      const makerAfter = await mockUSDT.balanceOf(maker.address);
      expect(makerAfter - makerBefore).to.equal(TOTAL_LOCK_T2);
      expect((await escrow.getTrade(tradeId)).state).to.equal(5); 
    });

    it("should NOT allow taker or stranger to cancel an OPEN escrow", async () => {
      const tradeId = await setupTrade(2);
      await expect(escrow.connect(taker).cancelOpenEscrow(tradeId))
        .to.be.revertedWithCustomError(escrow, "OnlyMaker");
      await expect(escrow.connect(stranger).cancelOpenEscrow(tradeId))
        .to.be.revertedWithCustomError(escrow, "OnlyMaker");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 0
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Tier 0", () => {
    it("maker ve taker bond sifir olmali", async () => {
      const tradeId = await setupTrade(0);
      const trade = await escrow.getTrade(tradeId);
      expect(trade.makerBond).to.equal(0n);
      expect(trade.takerBond).to.equal(0n);
    });

    it("taker bond yatirmaz", async () => {
      const tradeId = await setupTrade(0);
      const takerBefore = await mockUSDT.balanceOf(taker.address);
      await escrow.connect(taker).lockEscrow(tradeId);
      const takerAfter = await mockUSDT.balanceOf(taker.address);
      expect(takerAfter).to.equal(takerBefore);
    });

    it("happy path release — sadece protocol fee kesilir", async () => {
      const tradeId = await setupTrade(0);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      const takerBefore = await mockUSDT.balanceOf(taker.address);
      await escrow.connect(maker).releaseFunds(tradeId);
      const takerAfter = await mockUSDT.balanceOf(taker.address);
      const takerFee = (TRADE_AMOUNT * 10n) / 10000n;
      expect(takerAfter - takerBefore).to.equal(TRADE_AMOUNT - takerFee);
    });

    it("dispute: sadece crypto erir, bond yok", async () => {
      const tradeId = await setupTrade(0);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      await time.increase(FORTY_EIGHT_H + 97 * ONE_HOUR);
      const [currCrypto, currMB, currTB,] = await escrow.getCurrentAmounts(tradeId);

      expect(currMB).to.equal(0n);
      expect(currTB).to.equal(0n);
      expect(currCrypto).to.be.lt(TRADE_AMOUNT);
    });

    it("24h cooldown uygulanir", async () => {
      const tradeId = await setupTrade(0);
      await escrow.connect(taker).lockEscrow(tradeId);
      const tradeId2 = await setupTrade(0);
      await expect(
        escrow.connect(taker).lockEscrow(tradeId2)
      ).to.be.revertedWithCustomError(escrow, "TierCooldownActive");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. ANTI-SYBIL SHIELD
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Anti-Sybil Shield", () => {
    it("blocks self-trade", async () => {
      const tradeId = await setupTrade(1);
      await expect(
        escrow.connect(maker).lockEscrow(tradeId)
      ).to.be.revertedWithCustomError(escrow, "SelfTradeForbidden");
    });

    it("blocks unregistered wallets", async () => {
      const tradeId = await setupTrade(1);
      await expect(
        escrow.connect(stranger).lockEscrow(tradeId)
      ).to.be.revertedWithCustomError(escrow, "WalletTooYoung");
    });

    it("blocks freshly registered wallets (< 7 days)", async () => {
      const tradeId = await setupTrade(1);
      await escrow.connect(stranger).registerWallet();
      await time.increase(3 * 24 * 3600); 

      await owner.sendTransaction({ to: stranger.address, value: ethers.parseEther("0.01") });

      await expect(
        escrow.connect(stranger).lockEscrow(tradeId)
      ).to.be.revertedWithCustomError(escrow, "WalletTooYoung");
    });

    it("blocks Tier1 taker on 24h cooldown", async () => {
      const tradeId1 = await setupTrade(1);
      await escrow.connect(taker).lockEscrow(tradeId1);
      await escrow.connect(taker).reportPayment(tradeId1, "QmHash1");
      await escrow.connect(maker).releaseFunds(tradeId1);

      const tradeId2 = await setupTrade(1);

      await expect(
        escrow.connect(taker).lockEscrow(tradeId2)
      ).to.be.revertedWithCustomError(escrow, "TierCooldownActive");

      await time.increase(24 * 3600 + 1);
      await expect(
        escrow.connect(taker).lockEscrow(tradeId2)
      ).to.not.be.reverted;
    });

    it("blocks banned takers", async () => {
      for (let i = 0; i < 2; i++) {
        const tradeId = await setupTrade(2);
        await escrow.connect(taker).lockEscrow(tradeId);
        await escrow.connect(taker).reportPayment(tradeId, `QmHash${i}`);
        await time.increase(24 * 3600 + 1);
        await escrow.connect(maker).pingTakerForChallenge(tradeId);
        await time.increase(24 * 3600 + 1);
        await escrow.connect(maker).challengeTrade(tradeId);
        await time.increase(TEN_DAYS + 1);
        await escrow.burnExpired(tradeId);
      }

      const newTradeId = await setupTrade(2);
      await expect(
        escrow.connect(taker).lockEscrow(newTradeId)
      ).to.be.revertedWithCustomError(escrow, "TakerBanActive");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DISPUTE — BLEEDING ESCROW
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Bleeding Escrow", () => {
    it("blocks challenge if ping-wait cycle is not followed", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await expect(escrow.connect(maker).challengeTrade(tradeId))
        .to.be.revertedWithCustomError(escrow, "MustPingFirst");

      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await expect(escrow.connect(maker).challengeTrade(tradeId))
        .to.be.revertedWithCustomError(escrow, "ResponseWindowActive");
    });

    it("maker can challenge after ping-wait cycle", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);
      expect((await escrow.getTrade(tradeId)).state).to.equal(3); 
    });

    it("maker can still release during bleeding", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(24 * 3600 * 2 + 2); 
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      await time.increase(FORTY_EIGHT_H + 2 * 24 * 3600);

      const takerBefore = await mockUSDT.balanceOf(taker.address);
      await escrow.connect(maker).releaseFunds(tradeId);
      const takerAfter = await mockUSDT.balanceOf(taker.address);

      expect(takerAfter).to.be.gt(takerBefore);
      expect((await escrow.getTrade(tradeId)).state).to.equal(4); 
    });

    it("decay reduces amounts over time (saatlik granularite)", async () => {
      const tradeId = await setupTrade(1); 
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      const [,makerBond0,,decayed0] = await escrow.getCurrentAmounts(tradeId);
      expect(decayed0).to.equal(0n);

      await time.increase(FORTY_EIGHT_H);
      const [,,,decayedGrace] = await escrow.getCurrentAmounts(tradeId);
      expect(decayedGrace).to.equal(0n);

      await time.increase(ONE_HOUR);
      const [, makerBond1h,, decayed1h] = await escrow.getCurrentAmounts(tradeId);
      expect(decayed1h).to.be.gt(0n);
      expect(makerBond1h).to.be.lt(makerBond0);

      await time.increase(23 * ONE_HOUR);
      const [, makerBond24h,, decayed24h] = await escrow.getCurrentAmounts(tradeId);
      expect(decayed24h).to.be.gt(decayed1h);
      expect(makerBond24h).to.be.lt(makerBond1h);
    });

    it("Crypto decay starts only after Grace(48h)+USDT_DECAY_START(96h)=144h total", async () => {
      const tradeId = await setupTrade(1);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      await time.increase(FORTY_EIGHT_H + 95 * ONE_HOUR);
      const [crypto143,,,] = await escrow.getCurrentAmounts(tradeId);
      expect(crypto143).to.equal(TRADE_AMOUNT);

      await time.increase(2 * ONE_HOUR);
      const [crypto145,,,] = await escrow.getCurrentAmounts(tradeId);
      expect(crypto145).to.be.lt(TRADE_AMOUNT);
    });

    it("burns all funds after 10-day timeout", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      await time.increase(TEN_DAYS + 1);
      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);
      await escrow.burnExpired(tradeId);
      const treasuryAfter = await mockUSDT.balanceOf(treasury.address);

      expect(treasuryAfter).to.be.gt(treasuryBefore);
      expect((await escrow.getTrade(tradeId)).state).to.equal(6); 
    });

    it("both parties get failed dispute after burn", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);
      await time.increase(TEN_DAYS + 1);
      await escrow.burnExpired(tradeId);

      const [, makerFailed,,,] = await escrow.getReputation(maker.address);
      const [, takerFailed,,,] = await escrow.getReputation(taker.address);
      expect(makerFailed).to.equal(1);
      expect(takerFailed).to.equal(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. COLLABORATIVE CANCEL — EIP-712
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Collaborative Cancel (EIP-712)", () => {
    it("requires both parties to sign", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);

      const deadline = (await time.latest()) + 3600;
      const makerNonce = await escrow.sigNonces(maker.address);
      const makerSig = await eip712CancelSig(maker, tradeId, makerNonce, deadline);

      await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);
      expect((await escrow.getTrade(tradeId)).state).to.equal(1); 

      const takerNonce = await escrow.sigNonces(taker.address);
      const takerSig = await eip712CancelSig(taker, tradeId, takerNonce, deadline);
      await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);

      expect((await escrow.getTrade(tradeId)).state).to.equal(5); 
    });

    it("maker gets crypto refund, taker gets bond back — no fee on cancel", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);

      const makerBefore  = await mockUSDT.balanceOf(maker.address);
      const takerBefore  = await mockUSDT.balanceOf(taker.address);

      const deadline = (await time.latest()) + 3600;
      const makerSig = await eip712CancelSig(maker, tradeId, await escrow.sigNonces(maker.address), deadline);
      await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);

      const takerSig = await eip712CancelSig(taker, tradeId, await escrow.sigNonces(taker.address), deadline);
      await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);

      const makerAfter = await mockUSDT.balanceOf(maker.address);
      const takerAfter = await mockUSDT.balanceOf(taker.address);

      expect(makerAfter - makerBefore).to.equal(TRADE_AMOUNT + MAKER_BOND_T2);
      expect(takerAfter - takerBefore).to.equal(TAKER_BOND_T2);
    });

    it("rejects expired signatures", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);

      const deadline = (await time.latest()) - 1; 
      const sig = await eip712CancelSig(maker, tradeId, await escrow.sigNonces(maker.address), deadline);

      await expect(
        escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, sig)
      ).to.be.revertedWithCustomError(escrow, "SignatureExpired");
    });

    it("rejects replayed signatures", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);

      const deadline = (await time.latest()) + 3600;
      const nonce = await escrow.sigNonces(maker.address);
      const sig   = await eip712CancelSig(maker, tradeId, nonce, deadline);

      await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, sig);

      await expect(
        escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, sig)
      ).to.be.revertedWithCustomError(escrow, "InvalidSignature");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. REENTRANCY GUARD
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Reentrancy Guard", () => {
    it("releaseFunds cannot be reentered", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await escrow.connect(maker).releaseFunds(tradeId);

      await expect(
        escrow.connect(maker).releaseFunds(tradeId)
      ).to.be.revertedWithCustomError(escrow, "CannotReleaseInState");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. BOND & FEE CALCULATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Bond & Fee Calculations", () => {
    it("treasury receives %0.1 taker fee + %0.1 maker fee = %0.2 total", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);
      await escrow.connect(maker).releaseFunds(tradeId);
      const treasuryAfter = await mockUSDT.balanceOf(treasury.address);

      const { totalTreasury } = calcFees(TRADE_AMOUNT, MAKER_BOND_T2);
      expect(treasuryAfter - treasuryBefore).to.equal(totalTreasury);
    });

    it("taker receives crypto minus taker fee only (%0.2)", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      const takerBefore = await mockUSDT.balanceOf(taker.address);
      await escrow.connect(maker).releaseFunds(tradeId);

      const { takerReceives } = calcFees(TRADE_AMOUNT, MAKER_BOND_T2);
      expect(await mockUSDT.balanceOf(taker.address) - takerBefore).to.equal(takerReceives + TAKER_BOND_T2);
    });

    it("maker bond refund is reduced by maker fee (%0.2)", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      const makerBefore = await mockUSDT.balanceOf(maker.address);
      await escrow.connect(maker).releaseFunds(tradeId);

      const { makerBondBack } = calcFees(TRADE_AMOUNT, MAKER_BOND_T2);
      expect(await mockUSDT.balanceOf(maker.address) - makerBefore).to.equal(makerBondBack);
    });

    it("autoRelease applies 5% negligence penalty instead of standard fee", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(24 * 3600 + 1);

      const takerBefore    = await mockUSDT.balanceOf(taker.address);
      const makerBefore    = await mockUSDT.balanceOf(maker.address);
      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);

      await escrow.connect(taker).autoRelease(tradeId);
      
      const makerPenalty = (MAKER_BOND_T2 * 500n) / 10000n;
      const takerPenalty = (TAKER_BOND_T2 * 500n) / 10000n;
      const totalPenalty = makerPenalty + takerPenalty;

      expect(await mockUSDT.balanceOf(taker.address) - takerBefore).to.equal(TRADE_AMOUNT + (TAKER_BOND_T2 - takerPenalty));
      expect(await mockUSDT.balanceOf(maker.address) - makerBefore).to.equal(MAKER_BOND_T2 - makerPenalty);
      expect(await mockUSDT.balanceOf(treasury.address) - treasuryBefore).to.equal(totalPenalty);
    });

    it("Tier 0 taker pays 0 bond", async () => {
      const tradeId = await setupTrade(0);
      const takerBefore = await mockUSDT.balanceOf(taker.address);
      await escrow.connect(taker).lockEscrow(tradeId);
      const takerAfter = await mockUSDT.balanceOf(taker.address);

      expect(takerAfter).to.equal(takerBefore); 
    });

    it("cancel has no fee — treasury unchanged, full refund to both parties", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);

      const makerBefore    = await mockUSDT.balanceOf(maker.address);
      const takerBefore    = await mockUSDT.balanceOf(taker.address);
      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);

      const deadline = (await time.latest()) + 3600;
      const makerSig = await eip712CancelSig(maker, tradeId, await escrow.sigNonces(maker.address), deadline);
      await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);
      const takerSig = await eip712CancelSig(taker, tradeId, await escrow.sigNonces(taker.address), deadline);
      await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);

      expect(await mockUSDT.balanceOf(treasury.address)).to.equal(treasuryBefore); 
      expect(await mockUSDT.balanceOf(maker.address) - makerBefore).to.equal(TRADE_AMOUNT + MAKER_BOND_T2);
      expect(await mockUSDT.balanceOf(taker.address) - takerBefore).to.equal(TAKER_BOND_T2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. REPUTATION DECAY (CLEAN SLATE)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Reputation Decay (Clean Slate)", () => {
    async function giveBanToMaker() {
      let tradeId = await setupTrade(0);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash1");
      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(24 * 3600 + 1);

      await escrow.connect(taker).autoRelease(tradeId);

      tradeId = await setupTrade(0);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash2");
      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(24 * 3600 + 1);

      await escrow.connect(taker).autoRelease(tradeId);
    }

    it("should reset consecutiveBans after 180 days clean period", async () => {
      await giveBanToMaker();

      let [,,, consecutiveBefore, ] = await escrow.getReputation(maker.address);
      expect(consecutiveBefore).to.equal(1n, "Pre-condition: consecutiveBans should be 1"); // İlk ban 1. iterasyondur.

      const [, , bannedUntil, ,] = await escrow.getReputation(maker.address);
      const cleanSlatePeriod = 180 * 24 * 3600;
      const timeToElapse = (bannedUntil - BigInt(await time.latest())) + BigInt(cleanSlatePeriod) + BigInt(3600);

      await time.increase(timeToElapse);

      await expect(escrow.decayReputation(maker.address))
        .to.emit(escrow, "ReputationUpdated");

      const [,,, consecutiveAfter, ] = await escrow.getReputation(maker.address);
      expect(consecutiveAfter).to.equal(0n, "consecutiveBans should be reset to 0");
    });

    it("should revert if called for a user with no ban history", async () => {
      await expect(escrow.decayReputation(stranger.address))
        .to.be.revertedWithCustomError(escrow, "NoPriorBanHistory");
    });

    it("should revert if 180-day clean period has not elapsed", async () => {
      await giveBanToMaker();
      const [, , bannedUntil, ,] = await escrow.getReputation(maker.address);
      const lessThanCleanSlate = 170 * 24 * 3600;
      const timeToElapse = (bannedUntil - BigInt(await time.latest())) + BigInt(lessThanCleanSlate);
      await time.increase(timeToElapse);

      await expect(escrow.decayReputation(maker.address))
        .to.be.revertedWithCustomError(escrow, "CleanPeriodNotElapsed");
    });

    it("should revert if consecutiveBans is already zero", async () => {
      await giveBanToMaker(); 
      const [, , bannedUntil, ,] = await escrow.getReputation(maker.address);
      const cleanSlatePeriod = 180 * 24 * 3600;
      const timeToElapse = (bannedUntil - BigInt(await time.latest())) + BigInt(cleanSlatePeriod) + BigInt(3600);
      await time.increase(timeToElapse);
      
      await escrow.decayReputation(maker.address); 
      await expect(escrow.decayReputation(maker.address)) 
        .to.be.revertedWithCustomError(escrow, "NoBansToReset");
    });
  });
});
