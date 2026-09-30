const { expect } = require("chai");
const { artifacts, ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// [TR] Backend/frontend'deki her insan-okunur ABI parçası (function/event) derlenmiş kontrat ABI'sinde
//      birebir bulunmalı. Aksi halde canlıda çağrı revert eder ya da event hiç yakalanmaz.
// [EN] Every human-readable ABI fragment (function/event) in backend/frontend must exist verbatim in the
//      compiled contract ABIs. Otherwise calls revert live or events are never matched.
describe("ABI drift: off-chain fragments match compiled contracts", function () {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const SCAN_DIRS = ["frontend/src", "backend/scripts", "contracts/scripts"];
  // Generic ERC-20 / Ownable helpers and deprecated historical events are intentionally not Araf ABI.
  const IGNORED = new Set([
    "approve", "allowance", "decimals", "balanceOf", "transfer", "transferFrom", "mint", "symbol", "name",
    "Transfer", "owner", "EscrowCreated", "EscrowLocked",
  ]);

  // [TR] Kasıtlı kontrat ABI değişikliği (K5: acceptSettlement(uint256,uint256)); frontend/backend senkronu ayrı
  //      aşamada yapılacak. Yalnız bu birebir eski parçalar geçici olarak tolere edilir; senkron sonrası SİLİN.
  // [EN] Intentional ABI change (K5); off-chain sync is a separate stage. Only these exact stale fragments are
  //      tolerated temporarily. REMOVE after the frontend/backend ABI sync.
  const PENDING_OFFCHAIN_SYNC = new Set([
    "frontend/src/hooks/useArafContract.js: acceptSettlement(uint256)",
  ]);

  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it("every function/event fragment resolves with identical inputs and outputs", async function () {
    const interfaces = await Promise.all(
      ["ArafEscrow", "ArafRewards", "ArafRevenueVault"].map(async (n) => new ethers.Interface((await artifacts.readArtifact(n)).abi))
    );
    const rx = /['"`]((?:function|event) [^'"`]+)['"`]/g;
    const problems = [];
    let checked = 0;

    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.join(repoRoot, dir))) {
        const src = fs.readFileSync(file, "utf8");
        let m;
        while ((m = rx.exec(src))) {
          let frag;
          try { frag = ethers.Fragment.from(m[1]); } catch { continue; }
          if (IGNORED.has(frag.name)) continue;
          checked += 1;
          const sig = frag.format("sighash");
          const match = interfaces
            .map((iface) => { try { return frag.type === "event" ? iface.getEvent(sig) : iface.getFunction(sig); } catch { return null; } })
            .find(Boolean);
          const where = path.relative(repoRoot, file);
          if (!match) {
            if (PENDING_OFFCHAIN_SYNC.has(`${where}: ${sig}`)) continue;
            problems.push(`${where}: ${sig} not found in any Araf contract`);
          } else if (frag.type === "function" && frag.outputs.length) {
            const want = match.outputs.map((o) => o.format()).join(",");
            const got = frag.outputs.map((o) => o.format()).join(",");
            if (want !== got) problems.push(`${where}: ${frag.name} outputs differ\n  contract: ${want}\n  client:   ${got}`);
          }
        }
      }
    }

    expect(checked).to.be.greaterThan(50);
    expect(problems, problems.join("\n")).to.deep.equal([]);
  });
});
