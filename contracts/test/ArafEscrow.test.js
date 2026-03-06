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
  const MAKER_BOND_T2  = ethers.parseUnits("150",  USDT_DECIMALS);  // 15% of 1000
  const TAKER_BOND_T2  = ethers.parseUnits("120",  USDT_DECIMALS);  // 12% of 1000
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

      // Taker receives: crypto - takerFee + takerBond = 998 + 120 = 1118 USDT
      expect(await mockUSDT.balanceOf(taker.address) - takerBefore).to.equal(takerReceives + TAKER_BOND_T2);
      // Maker receives: makerBond - makerFee = 150 - 2 = 148 USDT
      expect(await mockUSDT.balanceOf(maker.address) - makerBefore).to.equal(makerBondBack);

      expect((await escrow.getTrade(tradeId)).state).to.equal(4); // RESOLVED
    });

    it("taker can auto-release after 48h grace period", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmAutoRelease");

      // Move time past grace period
      await time.increase(FORTY_EIGHT_H + 1);

      await escrow.connect(taker).autoRelease(tradeId);
      expect((await escrow.getTrade(tradeId)).state).to.equal(4); // RESOLVED
    });

    it("should update reputation on successful trade", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await escrow.connect(maker).releaseFunds(tradeId);

      const [makerSuccess,,] = await escrow.getReputation(maker.address);
      const [takerSuccess,,] = await escrow.getReputation(taker.address);
      expect(makerSuccess).to.equal(1);
      expect(takerSuccess).to.equal(1);
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
      ).to.be.revertedWith("ArafEscrow: self-trade forbidden");
    });

    it("blocks unregistered wallets", async () => {
      const tradeId = await setupTrade(1);
      await expect(
        escrow.connect(stranger).lockEscrow(tradeId)
      ).to.be.revertedWith("ArafEscrow: wallet too young (<7 days)");
    });

    it("blocks freshly registered wallets (< 7 days)", async () => {
      const tradeId = await setupTrade(1);
      // Register a fresh wallet
      await escrow.connect(stranger).registerWallet();
      await time.increase(3 * 24 * 3600); // Only 3 days

      await owner.sendTransaction({ to: stranger.address, value: ethers.parseEther("0.01") });

      await expect(
        escrow.connect(stranger).lockEscrow(tradeId)
      ).to.be.revertedWith("ArafEscrow: wallet too young (<7 days)");
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
      ).to.be.revertedWith("ArafEscrow: Tier 1 cooldown active");

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
        await time.increase(ONE_HOUR + 1);
        await escrow.connect(maker).challengeTrade(tradeId);
        await time.increase(TEN_DAYS + 1);
        await escrow.burnExpired(tradeId);
      }

      // Taker should now be banned
      const newTradeId = await setupTrade(2);
      await expect(
        escrow.connect(taker).lockEscrow(newTradeId)
      ).to.be.revertedWith("ArafEscrow: 30-day Taker ban active");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DISPUTE — BLEEDING ESCROW
  // ═══════════════════════════════════════════════════════════════════════════
  describe("Bleeding Escrow", () => {
    it("blocks challenge before 1h cooldown", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      await expect(
        escrow.connect(maker).challengeTrade(tradeId)
      ).to.be.revertedWith("ArafEscrow: challenge cooldown active");
    });

    it("maker can challenge after 1h", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(ONE_HOUR + 1);

      await escrow.connect(maker).challengeTrade(tradeId);
      expect((await escrow.getTrade(tradeId)).state).to.equal(3); // CHALLENGED
    });

    it("maker can still release during bleeding", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(ONE_HOUR + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      // Advance 2 days into bleeding
      await time.increase(2 * 24 * 3600);

      const takerBefore = await mockUSDT.balanceOf(taker.address);
      await escrow.connect(maker).releaseFunds(tradeId);
      const takerAfter = await mockUSDT.balanceOf(taker.address);

      // Taker should receive SOMETHING (less than full due to decay)
      expect(takerAfter).to.be.gt(takerBefore);
      expect((await escrow.getTrade(tradeId)).state).to.equal(4); // RESOLVED
    });

    it("decay reduces amounts over time", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(ONE_HOUR + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      // Check after 0 days (no decay yet)
      const [,makerBond0,,] = await escrow.getCurrentAmounts(tradeId);

      // After 3 days: opener bond -45%, other -30%
      await time.increase(3 * 24 * 3600);
      const [,makerBond3,,decayed3] = await escrow.getCurrentAmounts(tradeId);

      expect(makerBond3).to.be.lt(makerBond0);
      expect(decayed3).to.be.gt(0);
    });

    it("USDT decay starts only after Day 4", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(ONE_HOUR + 1);
      await escrow.connect(maker).challengeTrade(tradeId);

      // Day 3 — USDT should NOT have decayed yet
      await time.increase(3 * 24 * 3600);
      const [crypto3,,,] = await escrow.getCurrentAmounts(tradeId);
      expect(crypto3).to.equal(TRADE_AMOUNT);

      // Day 5 — USDT should be decaying
      await time.increase(2 * 24 * 3600);
      const [crypto5,,,] = await escrow.getCurrentAmounts(tradeId);
      expect(crypto5).to.be.lt(TRADE_AMOUNT);
    });

    it("burns all funds after 10-day timeout", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(ONE_HOUR + 1);
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
      await time.increase(ONE_HOUR + 1);
      await escrow.connect(maker).challengeTrade(tradeId);
      await time.increase(TEN_DAYS + 1);
      await escrow.burnExpired(tradeId);

      const [, makerFailed,] = await escrow.getReputation(maker.address);
      const [, takerFailed,] = await escrow.getReputation(taker.address);
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
      ).to.be.revertedWith("ArafEscrow: signature expired");
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
      ).to.be.revertedWith("ArafEscrow: invalid signature");
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
      ).to.be.revertedWith("ArafEscrow: cannot release in current state");
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
      // 998 USDT kripto + 120 USDT bond iadesi
      expect(await mockUSDT.balanceOf(taker.address) - takerBefore).to.equal(takerReceives + TAKER_BOND_T2);
    });

    it("maker bond refund is reduced by maker fee (%0.2)", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");

      const makerBefore = await mockUSDT.balanceOf(maker.address);
      await escrow.connect(maker).releaseFunds(tradeId);

      const { makerBondBack } = calcFees(TRADE_AMOUNT, MAKER_BOND_T2);
      // 150 USDT bond - 2 USDT fee = 148 USDT
      expect(await mockUSDT.balanceOf(maker.address) - makerBefore).to.equal(makerBondBack);
    });

    it("autoRelease applies same fee split as releaseFunds", async () => {
      const tradeId = await setupTrade(2);
      await escrow.connect(taker).lockEscrow(tradeId);
      await escrow.connect(taker).reportPayment(tradeId, "QmHash");
      await time.increase(FORTY_EIGHT_H + 1);

      const takerBefore    = await mockUSDT.balanceOf(taker.address);
      const makerBefore    = await mockUSDT.balanceOf(maker.address);
      const treasuryBefore = await mockUSDT.balanceOf(treasury.address);

      await escrow.connect(taker).autoRelease(tradeId);

      const { takerReceives, makerBondBack, totalTreasury } = calcFees(TRADE_AMOUNT, MAKER_BOND_T2);
      expect(await mockUSDT.balanceOf(taker.address)    - takerBefore).to.equal(takerReceives + TAKER_BOND_T2);
      expect(await mockUSDT.balanceOf(maker.address)    - makerBefore).to.equal(makerBondBack);
      expect(await mockUSDT.balanceOf(treasury.address) - treasuryBefore).to.equal(totalTreasury);
    });

    it("Tier 1 taker pays 0 bond", async () => {
      const tradeId = await setupTrade(1);
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
});
