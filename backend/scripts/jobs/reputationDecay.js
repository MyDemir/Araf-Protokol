"use strict";

/**
 * Reputation Decay Job — V3 On-Chain Clean-Slate Trigger
 *
 * V3 kuralı değişmez:
 *   - İtibarın otoritatif kaynağı kontrattır.
 *   - Backend yalnız aday havuzu çıkarır ve uygun kullanıcılar için
 *     on-chain `decayReputation()` çağrısını tetikler.
 *   - Nihai eligibility kararı MongoDB cache'e değil, kontratın kendi
 *     `getReputation()` çıktısına göre verilir.
 *
 * Bu görev:
 *   1. Geniş bir aday havuzu çıkarır (mirror/cache yardımcıdır)
 *   2. Her aday için kontrattan güncel bannedUntil + consecutiveBans okur
 *   3. 180 günlük clean-slate eşiği dolmuşsa decayReputation() çağırır
 *   4. ReputationUpdated event'i eventListener tarafından mirror'a yansıtılır
 */

const { ethers } = require("ethers");
const User = require("../models/User");
const logger = require("../utils/logger");

const DECAY_ABI = [
  "function decayReputation(address _wallet)",
  "function getReputation(address _wallet) view returns (uint256 successful, uint256 failed, uint256 bannedUntil, uint256 consecutiveBans, uint8 effectiveTier)",
];

const CLEAN_SLATE_DAYS = 180;
const DEFAULT_CANDIDATE_LIMIT = Number(process.env.REPUTATION_DECAY_CANDIDATE_LIMIT || 250);
const DEFAULT_TX_LIMIT = Number(process.env.REPUTATION_DECAY_TX_LIMIT || 50);

let relayerWallet = null;
let decayContract = null;

function getRelayer() {
  if (relayerWallet) return relayerWallet;

  const rpcUrl = process.env.BASE_RPC_URL;
  const privateKey = process.env.RELAYER_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    logger.error("[DecayJob] RELAYER_PRIVATE_KEY veya BASE_RPC_URL tanımsız. Görev çalıştırılamıyor.");
    return null;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  relayerWallet = new ethers.Wallet(privateKey, provider);
  logger.info(`[DecayJob] Relayer cüzdanı yüklendi: ${relayerWallet.address}`);
  return relayerWallet;
}

function getDecayContract() {
  if (decayContract) return decayContract;

  const contractAddress = process.env.ARAF_ESCROW_ADDRESS;
  const relayer = getRelayer();
  if (!contractAddress || !relayer || contractAddress === "0x0000000000000000000000000000000000000000") {
    logger.error("[DecayJob] ARAF_ESCROW_ADDRESS tanımsız veya geçersiz.");
    return null;
  }

  decayContract = new ethers.Contract(contractAddress, DECAY_ABI, relayer);
  return decayContract;
}

async function runReputationDecay() {
  logger.info("[DecayJob] V3 itibar temizleme görevi başlatıldı...");

  const contract = getDecayContract();
  if (!contract) return;

  const cutoffMs = Date.now() - CLEAN_SLATE_DAYS * 24 * 3600 * 1000;

  // [TR] Mirror alanları stale olabilir. Bu yüzden query yalnız aday havuzu içindir.
  //      Nihai eligibility kararı kontratın getReputation() çağrısından gelir.
  // [EN] Mirror fields may be stale. This query only builds a candidate pool.
  const candidates = await User.find({
    $or: [
      { consecutive_bans: { $gt: 0 } },
      { banned_until: { $ne: null } },
    ],
  })
    .select("wallet_address consecutive_bans banned_until")
    .sort({ updated_at: -1, wallet_address: 1 })
    .limit(DEFAULT_CANDIDATE_LIMIT)
    .lean();

  if (candidates.length === 0) {
    logger.info("[DecayJob] Aday havuzunda kullanıcı bulunamadı.");
    return;
  }

  const usersToClean = [];
  for (const user of candidates) {
    try {
      const rep = await contract.getReputation(user.wallet_address);
      const bannedUntil = Number(rep.bannedUntil || 0);
      const consecutiveBans = Number(rep.consecutiveBans || 0);

      if (!bannedUntil || consecutiveBans <= 0) continue;
      const bannedUntilMs = bannedUntil * 1000;
      if (bannedUntilMs <= cutoffMs) {
        usersToClean.push(user.wallet_address);
      }
      if (usersToClean.length >= DEFAULT_TX_LIMIT) break;
    } catch (err) {
      logger.warn(`[DecayJob] getReputation() okunamadı: ${user.wallet_address} err=${err.message}`);
    }
  }

  if (usersToClean.length === 0) {
    logger.info("[DecayJob] On-chain koşullara göre temizlenecek kullanıcı bulunamadı.");
    return;
  }

  logger.info(`[DecayJob] ${usersToClean.length} kullanıcı için decayReputation() denenecek.`);

  for (const wallet of usersToClean) {
    try {
      const tx = await contract.decayReputation(wallet);
      logger.info(`[DecayJob] decayReputation gönderildi: wallet=${wallet} tx=${tx.hash}`);
    } catch (err) {
      logger.error(`[DecayJob] ${wallet} için itibar temizleme başarısız: ${err.reason || err.message}`);
    }
  }
}

module.exports = { runReputationDecay };
