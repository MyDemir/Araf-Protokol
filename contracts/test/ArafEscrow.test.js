const { expect } = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");

/**
 * ArafEscrow — Full Test Suite
 * Covers: Happy Path, Anti-Sybil, Bleeding Escrow, Collaborative Cancel, Burns
 */
describe("ArafEscrow", function () {
  // ─── Setup ────────────────────────────────────────────────────────────────
  let escrow, mockUSDT;
  let owner, treasury, maker, taker, attacker, stranger;

  const USDT_DECIMALS  = 6;
  const TRADE_AMOUNT   = ethers.parseUnits("1000", USDT_DECIMALS);  // 1000 USDT
  const MAKER_BOND_T2  = ethers.parseUnits("60",   USDT_DECIMALS);  //  6% of 1000
  const TAKER_BOND_T2  = ethers.parseUnits("80",   USDT_DECIMALS);  //  8% of 1000
  const TOTAL_LOCK_T2  = TRADE_AMOUNT + MAKER_BOND_T2;
  const INITIAL_BAL    = ethers.parseUnits("10000", USDT_DECIMALS);

  // Fee sabitleri — kontratla senkron tutulmalı (SUCCESS_FEE_BPS kaldırıldı)
  // Simetrik model: taker %0.1 crypto'dan, maker %0.1 bond'dan öder
  const TAKER_FEE_BPS = 10n;   // %0.1 — taker'ın crypto'sundan
  const MAKER_FEE_BPS = 10n;   // %0.1 — maker'ın bond'undan
  const BPS_DENOM     = 10000n;

  const SEVEN_DAYS     = 7 * 24 * 3600;
  const FORTY_EIGHT_H  = 48 * 3600;
  const ONE_HOUR       = 3600;
  const TEN_DAYS       = 10 * 24 * 3600;

  beforeEach(async () => {
    [owner, treasury, maker, taker, attacker, stranger] = await ethers.getSigners();

    // Deploy mock ERC20 (USDT)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDT = await MockERC20.deploy("Mock USDT", "USDT", USDT_DECIMALS);

    // Deploy ArafEscrow
    const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
    escrow = await ArafEscrow.deploy(treasury.address);

    // Add token support
    await escrow.connect(owner).setSupportedToken(await mockUSDT.getAddress(), true);

    // Mint tokens
    await mockUSDT.mint(maker.address,    INITIAL_BAL);
    await mockUSDT.mint(taker.address,    INITIAL_BAL);
    await mockUSDT.mint(attacker.address, INITIAL_BAL);

    // Approve escrow contract
    const addr = await escrow.getAddress();
    await mockUSDT.connect(maker).approve(addr, ethers.MaxUint256);
    await mockUSDT.connect(taker).approve(addr, ethers.MaxUint256);
    await mockUSDT.connect(attacker).approve(addr, ethers.MaxUint256);

    // Register + age wallets
    await escrow.connect(maker).registerWallet();
    await escrow.connect(taker).registerWallet();
    await escrow.connect(attacker).registerWallet();
    await time.increase(SEVEN_DAYS + 1);

    // Fund wallets with native ETH for dust check
    await owner.sendTransaction({ to: taker.address,    value: ethers.parseEther("0.01") });
    await owner.sendTransaction({ to: attacker.address, value: ethers.parseEther("0.01") });
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

  // Fee hesap yardımcısı — kontrat mantığıyla birebir aynı
  // Testlerde hardcoded sayı yerine bu kullanılmalı; kontrat sabitleri değişirse
  // sadece TAKER_FEE_BPS / MAKER_FEE_BPS'i güncellemek yeterli olur
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

      // Lock
      await escrow.connect(taker).lockEscrow(tradeId);
      expect((await escrow.getTrade(tradeId)).state).to.equal(1); // LOCKED

      // Report payment
      await escrow.connect(taker).reportPayment(tradeId, "QmTestHashABC123");
      expect((await escrow.getTrade(tradeId)).state).to.equal(2); // PAID

      // Release
      const takerBefore = await mockUSDT.balanceOf(taker.address);
      const makerBefore = await mockUSDT.balanceOf(maker.address);
      await escrow.connect(maker).releaseFunds(tradeId);

      const { takerReceives, makerBondBack } = calcFees(TRADE_AMOUNT, MAKER_BOND_T2);

      // Taker receives: crypto - takerFee + takerBond = 999 + 80 = 1079 USDT
      expect(await mockUSDT.balanceOf(taker.address) - takerBefore).to.equal(takerReceives + TAKER_BOND_T2);
      // Maker receives: makerBond - makerFee = 60 - 1 = 59 USDT
      expect(await mockUSDT.balanceOf(maker.address) - makerBefore).to.equal(makerBondBack);

      expect((await escrow.getTrade(tradeId)).state).to.equal(4); // RESOLVED
    });

    it("taker can auto-release after pinging and waiting 24h", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmAutoRelease");

      // 1. Önce 24 saatlik bekleme süresini geç
      await time.increase(24 * 3600 + 1);

      // 2. Maker'ı ping'le
      await escrow.connect(taker).pingMaker(tradeId);
      const trade = await escrow.getTrade(tradeId);
      expect(trade.pingedByTaker).to.be.true;

      // 3. Ping'den sonra 24 saat daha bekle
      await time.increase(24 * 3600 + 1);

      // 4. autoRelease çağır
      await escrow.connect(taker).autoRelease(tradeId);
      expect((await escrow.getTrade(tradeId)).state).to.equal(4); // RESOLVED

      const [, makerFailed,,,] = await escrow.getReputation(maker.address);
      expect(makerFailed).to.equal(1); // Maker pasif kaldığı için ceza almalı
    });

    it("should update reputation on successful trade", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await escrow.connect(maker).releaseFunds(tradeId);

      const [makerSuccess,,,] = await escrow.getReputation(maker.address);
      const [takerSuccess,,,] = await escrow.getReputation(taker.address);
      expect(makerSuccess).to.equal(1);
      expect(takerSuccess).to.equal(1);
    });

    // ── S1: autoRelease → maker pasif kaldı → +1 Failed ─────────────────────
    it("S1: autoRelease gives maker +1 Failed, taker +1 Successful", async () => {
      // Bu test, yukarıdaki "taker can auto-release" testiyle birleştirildi ve
      // orada zaten doğrulanıyor. Ancak akışı tekrar test edelim.
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      // Ping ve bekleme süreleri
      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).autoRelease(tradeId);

      const [makerSuccess, makerFailed,,,] = await escrow.getReputation(maker.address);
      const [takerSuccess, takerFailed,,,] = await escrow.getReputation(taker.address);
      expect(makerSuccess).to.equal(0);
      expect(makerFailed).to.equal(1);  // Pasif maker ceza alır
      expect(takerSuccess).to.equal(1);
      expect(takerFailed).to.equal(0);
    });

    // ── S2: CHALLENGED → maker release → haksız challenge → maker +1 Failed ─
    it("S2: releaseFunds from CHALLENGED state gives maker +1 Failed", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      // Simetrik Ping: Önce Taker'ı uyar
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      // Ping sonrası 24 saat bekle
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      // Maker challenge açtı ama sonra geri adım atıp release etti → haksız challenge
      await time.increase(1); // Challenge sonrası hemen release edebilir
      await escrow.connect(maker).releaseFunds(tradeId);

      const [makerSuccess, makerFailed,,,] = await escrow.getReputation(maker.address);
      const [takerSuccess, takerFailed,,,] = await escrow.getReputation(taker.address);
      expect(makerSuccess).to.equal(0);
      expect(makerFailed).to.equal(1);  // Haksız challenge cezası
      expect(takerSuccess).to.equal(1);
      expect(takerFailed).to.equal(0);
    });

    // ── S3: CHALLENGED → collaborative cancel → ikisi nötr ──────────────────
    it("S3: collaborative cancel from CHALLENGED state gives no reputation penalty", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      // Challenge aç
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      // İki taraf da imzalayıp cancel → hiçbiri ceza almaz
      const deadline = (await time.latest()) + 3600;
      const makerSig = await eip712CancelSig(maker, tradeId, await escrow.sigNonces(maker.address), deadline);
      await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);
      const takerSig = await eip712CancelSig(taker, tradeId, await escrow.sigNonces(taker.address), deadline);
      await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);

      expect((await escrow.getTrade(tradeId)).state).to.equal(5); // CANCELED

      const [makerSuccess, makerFailed,,,] = await escrow.getReputation(maker.address);
      const [takerSuccess, takerFailed,,,] = await escrow.getReputation(taker.address);
      expect(makerSuccess).to.equal(0);
      expect(makerFailed).to.equal(0);  // Nötr — ceza yok
      expect(takerSuccess).to.equal(0);
      expect(takerFailed).to.equal(0);  // Nötr — ceza yok
    });

    // ── Consecutive Ban Testleri ──────────────────────────────────────────────
    it("1. ban: 30 gun, tier kisitlamasi yok", async () => {
      // 2 failed dispute → 1. ban tetiklenir
      // İlk failed dispute (ban tetiklemez)
      let tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(FORTY_EIGHT_H + 1);
      await escrow.connect(taker).autoRelease(tradeId); // maker +1 failed

      // İkinci failed dispute → ban tetiklenir
      tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(FORTY_EIGHT_H + 1);
      await escrow.connect(taker).autoRelease(tradeId); // maker +1 failed → ban

      const [, failed, bannedUntil, consecutive, tierCap] = await escrow.getReputation(maker.address);
      expect(failed).to.equal(2);
      expect(bannedUntil).to.be.gt(0n);
      expect(consecutive).to.equal(1n);
      expect(tierCap).to.equal(0); // maxAllowedTier henüz set edilmedi, varsayılan 0
      // Ban suresi ~30 gun olmali
      const now = BigInt(await time.latest());
      expect(bannedUntil).to.be.closeTo(now + BigInt(30 * 24 * 3600), 60n);
    });

    it("2. consecutive ban: 60 gun + tier 1 duser", async () => {
      // 3 failed dispute → 2. consecutive ban
      // 3 failed dispute vermek için döngü
      for (let i = 0; i < 3; i++) {
        let tradeId = await setupTrade(0);
        await escrow.connect(taker).lockEscrow(tradeId);
        await escrow.connect(taker).reportPayment(tradeId, `QmHash${i}`);
        // autoRelease için gerekli süreleri bekle
        await time.increase(24 * 3600 + 1);
        await escrow.connect(taker).pingMaker(tradeId);
        await time.increase(24 * 3600 + 1);
        await escrow.connect(taker).autoRelease(tradeId);

        // Ban süresinin dolmasını bekle ki yeni işlem yapabilsin
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
      expect(tierCap).to.equal(3); // Tier 4'ten 1 duser → max Tier 3
      const now = BigInt(await time.latest());
      expect(bannedUntil).to.be.closeTo(now + BigInt(60 * 24 * 3600), 60n);
    });

    it("tier kisitlanan cuzdan ust tierde islem acamaz", async () => {
      // maxAllowedTier = 3 olan cüzdan, tier 4 acamaz
      // 3 failed dispute vererek tier cap 3'e indir
      for (let i = 0; i < 3; i++) {
        let tradeId = await setupTrade(0);
        await escrow.connect(taker).lockEscrow(tradeId);
        await escrow.connect(taker).reportPayment(tradeId, "QmHash");
        await time.increase(24 * 3600 + 1);
        await escrow.connect(taker).pingMaker(tradeId);
        await time.increase(24 * 3600 + 1);
        await escrow.connect(taker).autoRelease(tradeId);
      }

      // Tier 4 açmaya çalış → revert beklenir
      await expect(
        escrow.connect(maker).createEscrow(await mockUSDT.getAddress(), TRADE_AMOUNT, 4)
      ).to.be.revertedWithCustomError(escrow, "TierNotAllowed");

      // Tier 3 açabilmeli
      await expect(
        escrow.connect(maker).createEscrow(await mockUSDT.getAddress(), TRADE_AMOUNT, 3)
      ).to.not.be.reverted;
    });
  });
  // ═══════════════════════════════════════════════════════════════════════════
  // YENİ: MAKER FLOW — Cancel OPEN Escrow
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Maker Flow - Cancel OPEN Escrow", () => {
    it("should allow maker to cancel an OPEN escrow and get full refund", async () => {
      const tradeId = await setupTrade(2);
      const makerBefore = await mockUSDT.balanceOf(maker.address);

      await escrow.connect(maker).cancelOpenEscrow(tradeId);

      const makerAfter = await mockUSDT.balanceOf(maker.address);
      expect(makerAfter - makerBefore).to.equal(TOTAL_LOCK_T2);
      expect((await escrow.getTrade(tradeId)).state).to.equal(5); // CANCELED
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
  // TIER 0 — Bond Yok, Sadece Crypto Riski
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

      // Challenge aç
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
      // Register a fresh wallet
      await escrow.connect(stranger).registerWallet();
      await time.increase(3 * 24 * 3600); // Only 3 days

      await owner.sendTransaction({ to: stranger.address, value: ethers.parseEther("0.01") });

      await expect(
        escrow.connect(stranger).lockEscrow(tradeId)
      ).to.be.revertedWithCustomError(escrow, "WalletTooYoung");
    });

    it("blocks Tier1 taker on 24h cooldown", async () => {
      // First trade
      const tradeId1 = await setupTrade(1);
      await escrow.connect(taker).lockEscrow(tradeId1);
      await escrow.connect(taker).reportPayment(tradeId1, "QmHash1");
      await escrow.connect(maker).releaseFunds(tradeId1);

      // Create second listing
      const tradeId2 = await setupTrade(1);

      // Should fail — cooldown active
      await expect(
        escrow.connect(taker).lockEscrow(tradeId2)
      ).to.be.revertedWithCustomError(escrow, "TierCooldownActive");

      // After 24h should work
      await time.increase(24 * 3600 + 1);
      await expect(
        escrow.connect(taker).lockEscrow(tradeId2)
      ).to.not.be.reverted;
    });

    it("blocks banned takers", async () => {
      // Trigger 2 failed disputes to get banned
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

      // Taker should now be banned
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

      // Direkt challenge çağırmayı dene -> MustPingFirst hatası
      await expect(escrow.connect(maker).challengeTrade(tradeId))
        .to.be.revertedWithCustomError(escrow, "MustPingFirst");

      // Ping at ama bekleme -> ResponseWindowActive hatası
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
      expect((await escrow.getTrade(tradeId)).state).to.equal(3); // CHALLENGED
    });

    it("maker can still release during bleeding", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(24 * 3600 * 2 + 2); // ping + challenge için
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      // Grace(48h) + 2 gün bleeding = 96h sonra release → bond kısmen eriyik
      await time.increase(FORTY_EIGHT_H + 2 * 24 * 3600);

      const takerBefore = await mockUSDT.balanceOf(taker.address);
      await escrow.connect(maker).releaseFunds(tradeId);
      const takerAfter = await mockUSDT.balanceOf(taker.address);

      // Taker should receive SOMETHING (less than full due to decay)
      expect(takerAfter).to.be.gt(takerBefore);
      expect((await escrow.getTrade(tradeId)).state).to.equal(4); // RESOLVED
    });

    it("decay reduces amounts over time (saatlik granularite)", async () => {
      const tradeId = await setupTrade(1); // Tier 1: maker %8, taker %10
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).pingTakerForChallenge(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      // Grace icinde — sifir erime
      const [,makerBond0,,decayed0] = await escrow.getCurrentAmounts(tradeId);
      expect(decayed0).to.equal(0n);

      // t=48h: Grace tam sinir — hala sifir
      await time.increase(FORTY_EIGHT_H);
      const [,,,decayedGrace] = await escrow.getCurrentAmounts(tradeId);
      expect(decayedGrace).to.equal(0n);

      // t=48h+1h: 1 saat bleeding — saatlik decay baslar
      await time.increase(ONE_HOUR);
      const [, makerBond1h,, decayed1h] = await escrow.getCurrentAmounts(tradeId);
      expect(decayed1h).to.be.gt(0n);
      expect(makerBond1h).to.be.lt(makerBond0);

      // t=48h+24h: daha fazla erime
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

      // bleedingElapsed=95h < USDT_DECAY_START(96h) — crypto hala tam
      await time.increase(FORTY_EIGHT_H + 95 * ONE_HOUR);
      const [crypto143,,,] = await escrow.getCurrentAmounts(tradeId);
      expect(crypto143).to.equal(TRADE_AMOUNT);

      // bleedingElapsed=97h > 96h — crypto erimeye basladi
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
      expect((await escrow.getTrade(tradeId)).state).to.equal(6); // BURNED
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

      // Only maker proposed — should not cancel yet
      await escrow.connect(maker).proposeOrApproveCancel(tradeId, deadline, makerSig);
      expect((await escrow.getTrade(tradeId)).state).to.equal(1); // Still LOCKED

      // Taker also signs — should cancel now
      const takerNonce = await escrow.sigNonces(taker.address);
      const takerSig = await eip712CancelSig(taker, tradeId, takerNonce, deadline);
      await escrow.connect(taker).proposeOrApproveCancel(tradeId, deadline, takerSig);

      expect((await escrow.getTrade(tradeId)).state).to.equal(5); // CANCELED
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

      // Cancel'da fee kesilmez — her iki taraf tam iade alır
      expect(makerAfter - makerBefore).to.equal(TRADE_AMOUNT + MAKER_BOND_T2);
      // Taker gets back taker bond
      expect(takerAfter - takerBefore).to.equal(TAKER_BOND_T2);
    });

    it("rejects expired signatures", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);

      const deadline = (await time.latest()) - 1; // already expired
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

      // Replay the same signature
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
      // Standard execution should work once
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await escrow.connect(maker).releaseFunds(tradeId);

      // Calling again on RESOLVED trade should revert
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
      // Güncellendi: %0.1 taker + %0.1 maker → 2 USDT (1000 USDT işlem için)
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
      // 999 USDT kripto + 80 USDT bond iadesi
      expect(await mockUSDT.balanceOf(taker.address) - takerBefore).to.equal(takerReceives + TAKER_BOND_T2);
    });

    it("maker bond refund is reduced by maker fee (%0.2)", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      const makerBefore = await mockUSDT.balanceOf(maker.address);
      await escrow.connect(maker).releaseFunds(tradeId);

      const { makerBondBack } = calcFees(TRADE_AMOUNT, MAKER_BOND_T2);
      // 60 USDT bond - 1 USDT fee = 59 USDT
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

      expect(takerAfter).to.equal(takerBefore); // No bond locked
    });

    it("cancel has no fee — treasury unchanged, full refund to both parties", async () => {
      // Cancel işleminde treasury'ye hiçbir şey gitmemeli
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

      expect(await mockUSDT.balanceOf(treasury.address)).to.equal(treasuryBefore); // treasury değişmez
      expect(await mockUSDT.balanceOf(maker.address) - makerBefore).to.equal(TRADE_AMOUNT + MAKER_BOND_T2);
      expect(await mockUSDT.balanceOf(taker.address) - takerBefore).to.equal(TAKER_BOND_T2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. REPUTATION DECAY (CLEAN SLATE)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Reputation Decay (Clean Slate)", () => {
    // Helper: Maker'a 2 failed dispute vererek ban almasını sağla
    async function giveBanToMaker() {
      // Failed #1
      let tradeId = await setupTrade(0);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash1");
      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).pingMaker(tradeId);
      await time.increase(24 * 3600 + 1);
      await escrow.connect(taker).autoRelease(tradeId);

      // Failed #2 -> Ban
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
      expect(consecutiveBefore).to.equal(2, "Pre-condition: consecutiveBans should be 2");

      const [, , bannedUntil, ,] = await escrow.getReputation(maker.address);
      const cleanSlatePeriod = 180 * 24 * 3600;
      const timeToElapse = (bannedUntil - BigInt(await time.latest())) + BigInt(cleanSlatePeriod) + BigInt(3600);

      await time.increase(timeToElapse);

      // Decay fonksiyonunu çağır ve event'i bekle
      await expect(escrow.decayReputation(maker.address))
        .to.emit(escrow, "ReputationUpdated");

      const [,,, consecutiveAfter, ] = await escrow.getReputation(maker.address);
      expect(consecutiveAfter).to.equal(0, "consecutiveBans should be reset to 0");
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
      await giveBanToMaker(); // Ban alır (consecutiveBans = 1)
      const [, , bannedUntil, ,] = await escrow.getReputation(maker.address);
      const cleanSlatePeriod = 180 * 24 * 3600;
      const timeToElapse = (bannedUntil - BigInt(await time.latest())) + BigInt(cleanSlatePeriod) + BigInt(3600);
      await time.increase(timeToElapse);
      await escrow.decayReputation(maker.address); // Sıfırlanır (consecutiveBans = 0)
      await expect(escrow.decayReputation(maker.address)) // Tekrar çağrılırsa hata verir
        .to.be.revertedWithCustomError(escrow, "NoBansToReset");
    });
  });
});
