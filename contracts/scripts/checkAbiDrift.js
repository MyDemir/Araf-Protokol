"use strict";

const fs = require("fs");
const path = require("path");

function normalizeSig(sig) {
  return sig
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function extractQuotedSignatures(source) {
  const out = [];
  const rx = /['"](event [^'"]+|function [^'"]+)['"]/g;
  let m;
  while ((m = rx.exec(source))) out.push(normalizeSig(m[1]));
  return out;
}

function assertIncludes(signatureList, sig, where) {
  if (!signatureList.includes(normalizeSig(sig))) {
    throw new Error(`[ABI-DRIFT] Missing signature in ${where}: ${sig}`);
  }
}

function runAbiDriftCheck() {
  const root = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(root, "..");
  const artifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts/src/ArafEscrow.sol/ArafEscrow.json"), "utf8"));
  const frontend = fs.readFileSync(path.join(repoRoot, "frontend/src/hooks/useArafContract.js"), "utf8");
  const backend = fs.readFileSync(path.join(repoRoot, "backend/scripts/services/eventListener.js"), "utf8");

  const frontendSigs = extractQuotedSignatures(frontend);
  const backendSigs = extractQuotedSignatures(backend);

  const criticalEvents = ["OrderFilled", "EscrowReleased", "ProtocolRevenueSent", "SettlementFinalized", "ReputationUpdated"];
  const criticalGetters = ["getReputation", "getTrade", "getOrder", "getCurrentAmounts", "getSettlementProposal"];

  for (const name of criticalEvents) {
    const ev = artifact.abi.find((x) => x.type === "event" && x.name === name);
    if (!ev) throw new Error(`[ABI-DRIFT] Event missing in artifact: ${name}`);
    const evSig = `event ${name}(${ev.inputs.map((i) => `${i.type}${i.indexed ? " indexed" : ""} ${i.name}`).join(", ")})`;
    assertIncludes(backendSigs, evSig, "backend event ABI");
    if (name === "OrderFilled") assertIncludes(frontendSigs, evSig, "frontend event ABI");
  }

  for (const name of criticalGetters) {
    const fn = artifact.abi.find((x) => x.type === "function" && x.name === name);
    if (!fn) throw new Error(`[ABI-DRIFT] Getter missing in artifact: ${name}`);
    const inSig = fn.inputs.map((i) => `${i.type} ${i.name}`).join(", ");
    const outSig = fn.outputs.map((o) => {
      if (o.type === "tuple") {
        return `(${o.components.map((c) => `${c.type} ${c.name}`).join(", ")})`;
      }
      return `${o.type} ${o.name}`.trim();
    }).join(", ");
    const fnSig = `function ${name}(${inSig}) view returns (${outSig})`;
    assertIncludes(frontendSigs, fnSig, "frontend function ABI");
    if (["getReputation", "getTrade", "getOrder"].includes(name)) {
      assertIncludes(backendSigs, fnSig, "backend function ABI");
    }
  }

  const rep = artifact.abi.find((x) => x.type === "function" && x.name === "getReputation");
  const repNames = (rep?.outputs || []).map((x) => x.name);
  const expected = ["successful","failed","bannedUntil","consecutiveBans","effectiveTier","manualReleaseCount","autoReleaseCount","mutualCancelCount","disputedResolvedCount","burnCount","disputeWinCount","disputeLossCount","partialSettlementCount","riskPoints","lastPositiveEventAt","lastNegativeEventAt"];
  if (JSON.stringify(repNames) !== JSON.stringify(expected)) {
    throw new Error(`[ABI-DRIFT] getReputation tuple order drift: ${repNames.join(",")}`);
  }

  if (!backend.includes("sideNum === 1 ? \"BUY_CRYPTO\" : \"SELL_CRYPTO\"")) {
    throw new Error("[ABI-DRIFT] backend side enum ordinal mapping drift");
  }
  if (!frontend.includes("const PAYMENT_RISK_LEVEL_TO_ENUM = { LOW: 0, MEDIUM: 1, HIGH: 2, RESTRICTED: 3 }")) {
    throw new Error("[ABI-DRIFT] frontend payment risk enum ordinal mapping drift");
  }

  return true;
}

if (require.main === module) {
  runAbiDriftCheck();
  console.log("[ABI-DRIFT] OK");
}

module.exports = { runAbiDriftCheck };
