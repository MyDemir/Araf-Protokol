/**
 * ArafEscrow Deploy Script
 *
 * L-01 Güvenlik Düzeltmesi:
 * Deploy tamamlandıktan hemen sonra ownership, TREASURY_ADDRESS'e devredilir.
 * Bu sayede DEPLOYER_PRIVATE_KEY sızsa bile kontrat üzerinde hiçbir yetkisi kalmaz.
 *
 * Kullanım: npx hardhat run scripts/deploy.js --network base-sepolia
 */
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploy eden cüzdan:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Bakiye:", ethers.formatEther(balance), "ETH");

  // ── Treasury & Owner ──────────────────────────────────────────────────────
  const treasury = process.env.TREASURY_ADDRESS;
  if (!treasury || treasury === "0x0000000000000000000000000000000000000000") {
    throw new Error("TREASURY_ADDRESS .env'de set edilmeli! (deploy eden cüzdan değil, ana cüzdan)");
  }
  console.log("Treasury & Owner adresi:", treasury);

  // ── Kontrat Deploy ────────────────────────────────────────────────────────
  console.log("\nArafEscrow deploy ediliyor...");
  const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
  const escrow = await ArafEscrow.deploy(treasury);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("✅ ArafEscrow deploy edildi:", address);

  // ── Testnet: MockERC20 Deploy ve Desteklenen Token Ekleme ──────────────────
  if (process.env.NODE_ENV !== "production") {
    console.log("\nMockERC20 (test USDT) deploy ediliyor...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdt = await MockERC20.deploy("Mock USDT", "USDT", 6);
    await usdt.waitForDeployment();
    const usdtAddress = await usdt.getAddress();
    console.log("✅ MockUSDT deploy edildi:", usdtAddress);

    // DÜZELTME: Henüz ownership devredilmediği için deployer bunu başarıyla yapabilir
    await escrow.setSupportedToken(usdtAddress, true);
    console.log("✅ USDT desteklenen token listesine eklendi");

    console.log("\n─────────────────────────────────────");
    console.log("Backend .env dosyana şunu ekle:");
    console.log(`ARAF_ESCROW_ADDRESS=${address}`);
    console.log(`USDT_ADDRESS=${usdtAddress}`);
    console.log("─────────────────────────────────────");
  }

  // ── L-01: Ownership Devri (EN SONA ALINDI) ────────────────────────────────
  console.log("\nOwnership devrediliyor →", treasury);
  const tx = await escrow.transferOwnership(treasury);
  await tx.wait();
  console.log("✅ Ownership devredildi:", treasury);
  console.log("   DEPLOYER_PRIVATE_KEY artık .env'den silinebilir.");

  // ── Mainnet Hatırlatması ──────────────────────────────────────────────────
  if (process.env.NODE_ENV === "production") {
    console.log("\n─────────────────────────────────────────────────────────");
    console.log("MAINNET DEPLOY TAMAMLANDI");
    console.log(`Kontrat adresi : ${address}`);
    console.log(`Owner & Treasury: ${treasury}`);
    console.log("─────────────────────────────────────────────────────────");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
