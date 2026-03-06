/**
 * ArafEscrow Deploy Script
 *
 * L-01 Güvenlik Düzeltmesi:
 * Deploy ve test token ayarları tamamlandıktan hemen sonra ownership, TREASURY_ADDRESS'e devredilir.
 * Bu sayede DEPLOYER_PRIVATE_KEY sızsa bile kontrat üzerinde hiçbir yetkisi kalmaz.
 *
 * Kullanım: npx hardhat run scripts/deploy.js --network base-sepolia
 */
const { ethers } = require("hardhat");
const fs   = require("fs");
const path = require("path");

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

  // ethers v6 Fix: resolveName hatası için getAddress kullan
  const treasuryAddress = ethers.getAddress(treasury);
  console.log("Treasury & Owner adresi:", treasuryAddress);

  // ── Kontrat Deploy ────────────────────────────────────────────────────────
  console.log("\nArafEscrow deploy ediliyor...");
  const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
  const escrow = await ArafEscrow.deploy(treasuryAddress);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("✅ ArafEscrow deploy edildi:", address);

  // H-07 Fix: ABI'ı frontend'e kopyala — useArafContract hook'u bu dosyayı kullanır
  // Deploy sonrası ABI otomatik olarak frontend/src/abi/ArafEscrow.json'a yazılır
  try {
    const artifactPath = path.resolve(__dirname, "../artifacts/contracts/src/ArafEscrow.sol/ArafEscrow.json");
    const artifact     = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abiDestDir   = path.resolve(__dirname, "../../frontend/src/abi");
    const abiDestPath  = path.join(abiDestDir, "ArafEscrow.json");

    fs.mkdirSync(abiDestDir, { recursive: true });
    fs.writeFileSync(abiDestPath, JSON.stringify(artifact.abi, null, 2));
    console.log("✅ ABI frontend'e kopyalandı:", abiDestPath);
  } catch (err) {
    console.warn("⚠ ABI kopyalanamadı (frontend klasörü bulunamadı):", err.message);
  }

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
  console.log("\nOwnership devrediliyor →", treasuryAddress);
  const tx = await escrow.transferOwnership(treasuryAddress);
  await tx.wait();
  console.log("✅ Ownership devredildi:", treasuryAddress);
  console.log("   DEPLOYER_PRIVATE_KEY artık .env'den silinebilir.");

  // ── Mainnet Hatırlatması ──────────────────────────────────────────────────
  if (process.env.NODE_ENV === "production") {
    console.log("\n─────────────────────────────────────────────────────────");
    console.log("MAINNET DEPLOY TAMAMLANDI");
    console.log(`Kontrat adresi : ${address}`);
    console.log(`Owner & Treasury: ${treasuryAddress}`);
    console.log("─────────────────────────────────────────────────────────");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
