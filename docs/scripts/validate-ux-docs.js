#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const requiredPaths = [
  "contracts/src/ArafEscrow.sol",
  "contracts/test/ArafEscrow.test.js",
  "backend/scripts/app.js",
  "backend/scripts/routes/orders.js",
  "backend/scripts/routes/trades.js",
  "backend/scripts/routes/auth.js",
  "backend/scripts/routes/pii.js",
  "backend/scripts/routes/receipts.js",
  "backend/scripts/routes/logs.js",
  "backend/scripts/services/protocolConfig.js",
  "backend/scripts/services/eventListener.js",
  "frontend/src/App.jsx",
  "frontend/src/app/useAppSessionData.jsx",
  "frontend/src/app/AppModals.jsx",
  "frontend/src/hooks/useArafContract.js",
  "frontend/src/hooks/usePII.js",
  "frontend/.env.example",
  "frontend/vercel.json",
];

const docs = ["docs/TR/ux.md", "docs/EN/ux.md"];

let hasError = false;

for (const rel of requiredPaths) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    console.error(`[MISSING FILE] ${rel}`);
    hasError = true;
  }
}

for (const docRel of docs) {
  const body = fs.readFileSync(path.join(repoRoot, docRel), "utf8");
  for (const rel of requiredPaths) {
    if (!body.includes(rel)) {
      console.error(`[DOC DRIFT] ${docRel} does not reference ${rel}`);
      hasError = true;
    }
  }

  ["Known blockers / failure gates", "Vercel", "testnet", "mainnet"].forEach((keyword) => {
    if (!body.toLowerCase().includes(keyword.toLowerCase())) {
      console.error(`[DOC DRIFT] ${docRel} missing keyword: ${keyword}`);
      hasError = true;
    }
  });
}

if (hasError) {
  process.exit(1);
}

console.log("UX docs validation passed.");
