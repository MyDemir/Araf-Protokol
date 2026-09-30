/* eslint-disable no-console */
// [TR] Gas baseline: ana kullanıcı/relayer işlemlerinin gerçek gasUsed değerlerini üretim düzeninde ölçer
//      (escrow treasury = RevenueVault, rewards bağlı). Kullanım: npx hardhat run scripts/gasBaseline.js
//      Çıktı JSON'u GAS_BASELINE_OUT verilirse dosyaya yazılır (önce/sonra karşılaştırması için).
// [EN] Gas baseline: measures real gasUsed of the main user/relayer operations with production wiring.
"use strict";

const fs = require("fs");
const { ethers, network } = require("hardhat");
const { deployEscrowWithLibraries } = require("./deploy");

const D = 6;
const u = (v) => ethers.parseUnits(String(v), D);
const ref = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const HOUR = 3600;
const DAY = 24 * HOUR;

async function increase(sec) {
  await network.provider.send("evm_increaseTime", [sec]);
  await network.provider.send("evm_mine");
}

async function main() {
  const signers = await ethers.getSigners();
  const [owner, maker, taker, maker2, taker2] = signers;
  // [TR] Ceza üreten yollar ayrı cüzdan çiftleriyle ölçülür (ban temiz yolu bozmasın).
  // [EN] Penalty paths use their own wallet pairs so a ban never blocks the clean path.
  const [dispM, dispT, autoM, autoT, expM, expT, burnM, burnT] = signers.slice(5, 13);
  const token = await (await ethers.getContractFactory("MockERC20")).deploy("Mock USDT", "USDT", D);
  const tokenAddress = await token.getAddress();
  const { escrow } = await deployEscrowWithLibraries(owner.address, owner);
  const escrowAddress = await escrow.getAddress();
  const vault = await (await ethers.getContractFactory("ArafRevenueVault")).deploy(escrowAddress, owner.address, owner.address);
  const rewards = await (await ethers.getContractFactory("ArafRewards")).deploy(escrowAddress, await vault.getAddress(), owner.address);
  await vault.setRewards(await rewards.getAddress());
  await vault.setSupportedToken(tokenAddress, true);
  await escrow.setTreasury(await vault.getAddress());
  await escrow.setTokenConfig(tokenAddress, true, true, true, D, [u(150), u(1500), u(7500), u(30000)]);
  await escrow.setCooldownConfig(0, 0);
  await escrow.setReputationTierThresholds([0, 1, 1, 1, 1], [100, 100, 100, 100, 100]);
  for (const w of [maker, taker, maker2, taker2, dispM, dispT, autoM, autoT, expM, expT, burnM, burnT]) {
    await token.mint(w.address, u(1_000_000));
    await token.connect(w).approve(escrowAddress, ethers.MaxUint256);
    await escrow.connect(w).registerWallet();
  }
  await increase(7 * DAY + 1);

  const results = {};
  const measure = async (name, txPromise) => {
    const receipt = await (await txPromise).wait();
    (results[name] ||= []).push(Number(receipt.gasUsed));
    return receipt;
  };
  const parse = (receipt, name) => {
    for (const log of receipt.logs) {
      try { const p = escrow.interface.parseLog(log); if (p && p.name === name) return p.args; } catch (_) { /* skip */ }
    }
    throw new Error(`${name} missing`);
  };
  const sellTrade = async (label, amount, tier, m = maker, t = taker, measured = true) => {
    const run = measured ? measure : async (_n, p) => (await p).wait();
    const created = parse(await run(`createSellOrder_t${tier}`, escrow.connect(m).createSellOrder(tokenAddress, amount, amount, tier, ref(`${label}-o`), 1)), "OrderCreated");
    const filled = parse(await run(`fillSellOrder_t${tier}`, escrow.connect(t).fillSellOrder(created.orderId, amount, ref(`${label}-c`))), "OrderFilled");
    return filled.tradeId;
  };

  // [TR] Isınma: cüzdanların ilk (soğuk) yazımları ölçüme karışmasın. [EN] Warm-up so first-time writes do not skew.
  for (const [m, t] of [[maker, taker], [maker2, taker2], [maker, taker2], [dispM, dispT], [autoM, autoT], [expM, expT], [burnM, burnT]]) {
    const id = await sellTrade(`warm-${m.address}-${t.address}`, u(100), 0, m, t, false);
    await (await escrow.connect(t).reportPayment(id, "Qm-warm")).wait();
    await (await escrow.connect(m).releaseFunds(id)).wait();
  }
  await increase(15 * DAY + 1);

  // Clean path, tier 0 and tier 2 (x3 each for a stable median)
  for (const tier of [0, 2]) {
    for (let i = 0; i < 3; i++) {
      const id = await sellTrade(`clean-${tier}-${i}`, u(100), tier);
      await measure(`reportPayment_t${tier}`, escrow.connect(taker).reportPayment(id, "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"));
      await measure(`releaseFunds_t${tier}`, escrow.connect(maker).releaseFunds(id));
    }
  }

  // Buy order path
  for (let i = 0; i < 3; i++) {
    const created = parse(await measure("createBuyOrder_t2", escrow.connect(taker).createBuyOrder(tokenAddress, u(100), u(100), 2, ref(`buy-${i}`), 1)), "OrderCreated");
    await measure("fillBuyOrder_t2", escrow.connect(maker).fillBuyOrder(created.orderId, u(100), ref(`buy-${i}-c`)));
  }

  // Partial fill: 1 order, 4 fills
  {
    const created = parse(await (await escrow.connect(maker).createSellOrder(tokenAddress, u(400), u(100), 2, ref("partial-o"), 1)).wait(), "OrderCreated");
    for (let i = 0; i < 4; i++) await measure("fillSellOrder_t2_partial", escrow.connect(taker).fillSellOrder(created.orderId, u(100), ref(`partial-${i}`)));
  }

  // Dispute + settlement path
  for (let i = 0; i < 2; i++) {
    const id = await sellTrade(`disp-${i}`, u(100), 2, dispM, dispT, false);
    await (await escrow.connect(dispT).reportPayment(id, "Qm-disp")).wait();
    await increase(DAY + 1);
    await measure("pingTakerForChallenge", escrow.connect(dispM).pingTakerForChallenge(id));
    await increase(DAY + 1);
    await measure("challengeTrade", escrow.connect(dispM).challengeTrade(id));
    await increase(3 * DAY);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await measure("proposeSettlement", escrow.connect(dispM).proposeSettlement(id, 6000, now + DAY));
    const proposalId = (await escrow.getSettlementProposal(id)).id;
    await measure("acceptSettlement", escrow.connect(dispT).acceptSettlement(id, proposalId));
  }

  // Liveness: pingMaker + autoRelease
  for (let i = 0; i < 2; i++) {
    const id = await sellTrade(`auto-${i}`, u(100), 2, autoM, autoT, false);
    await (await escrow.connect(autoT).reportPayment(id, "Qm-auto")).wait();
    await increase(2 * DAY + 1);
    await measure("pingMaker", escrow.connect(autoT).pingMaker(id));
    await increase(DAY + 1);
    await measure("autoRelease", escrow.connect(autoT).autoRelease(id));
  }

  // Payment window expiry and mutual cancel
  for (let i = 0; i < 2; i++) {
    const id2 = await sellTrade(`cancel-${i}`, u(100), 2, expM, expT, false);
    await measure("proposeOrApproveCancel_first", escrow.connect(expM).proposeOrApproveCancel(id2));
    await measure("proposeOrApproveCancel_final", escrow.connect(expT).proposeOrApproveCancel(id2));
  }
  for (let i = 0; i < 1; i++) {
    const id = await sellTrade(`exp-${i}`, u(100), 2, expM, expT, false);
    await increase(2 * DAY + 1);
    await measure("expirePaymentWindow", escrow.connect(expM).expirePaymentWindow(id));
  }

  // Burn path
  {
    const id = await sellTrade("burn", u(100), 2, burnM, burnT, false);
    await (await escrow.connect(burnT).reportPayment(id, "Qm-burn")).wait();
    await increase(DAY + 1);
    await (await escrow.connect(burnM).pingTakerForChallenge(id)).wait();
    await increase(DAY + 1);
    await (await escrow.connect(burnM).challengeTrade(id)).wait();
    await increase(Number(await escrow.MAX_BLEEDING()) + 1);
    await measure("burnExpired", escrow.connect(burnM).burnExpired(id));
  }

  // Rewards: record single, record batch of 10, claim
  {
    const ids = [];
    for (let i = 0; i < 11; i++) {
      const [m, t] = i % 2 ? [maker, taker] : [maker2, taker2];
      const id = await sellTrade(`rw-${i}`, u(100), 2, m, t, false);
      await (await escrow.connect(t).reportPayment(id, "Qm-rw")).wait();
      await (await escrow.connect(m).releaseFunds(id)).wait();
      ids.push(id);
    }
    await measure("recordTradeOutcome_single", rewards.recordTradeOutcome(ids[0]));
    const batch = await measure("recordTradeOutcomes_batch10", rewards.recordTradeOutcomes(ids.slice(1)));
    results.recordTradeOutcomes_perTrade = [Math.round(Number(batch.gasUsed) / 10)];
    const epoch = BigInt((await ethers.provider.getBlock("latest")).timestamp) / (await rewards.epochDuration());
    const reserve = await vault.rewardReserve(tokenAddress);
    await (await rewards.allocateEpochRewards(epoch, tokenAddress, reserve)).wait();
    const epochDuration = Number(await rewards.epochDuration());
    const target = (Number(epoch) + 1) * epochDuration + Number(await rewards.claimDelay()) + 60;
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await increase(target - now);
    await measure("finalizeEpochToken", rewards.finalizeEpochToken(epoch, tokenAddress));
    await measure("claim", rewards.connect(maker).claim(epoch, tokenAddress));
    await measure("claim", rewards.connect(taker).claim(epoch, tokenAddress));
  }

  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const table = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, median(v)]));
  console.table(table);
  if (process.env.GAS_BASELINE_OUT) fs.writeFileSync(process.env.GAS_BASELINE_OUT, JSON.stringify(table, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
