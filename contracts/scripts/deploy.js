/**
 * ArafEscrow V3 — Güvenlik Odaklı Nihai Deploy Script
 *
 * Bu sürüm, V3 kontrat yüzeyine göre hazırlanmıştır:
 *   - constructor(address treasury)
 *   - setTokenConfig(address,bool,bool,bool)
 *   - getFeeConfig()
 *   - getCooldownConfig()
 *   - tokenConfigs(address)
 *   - transferOwnership(address)
 *
 * Tasarım hedefleri:
 *   - Local geliştirmede hızlı ve güvenli mock deploy
 *   - Public chain'de mock token kurulumunu yasaklama
 *   - Token desteğini zincir üstünde doğrulama
 *   - Ownership devrini ancak kurulum doğrulanınca yapma
 *   - ABI artifact'ını frontend'e senkronlama
 *   - Deployment manifest'i üretme
 *
 * Kullanım örnekleri:
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network hardhat
 *   CONFIRM_PUBLIC_DEPLOY=yes npx hardhat run scripts/deploy.js --network base-sepolia
 *   CONFIRM_PUBLIC_DEPLOY=yes NODE_ENV=production npx hardhat run scripts/deploy.js --network base
 */

const hre = require("hardhat");
const { ethers, artifacts, network } = hre;
const fs = require("fs");
const path = require("path");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PUBLIC_CHAIN_IDS = new Set([8453, 84532]);
const LOCAL_NETWORK_NAMES = new Set(["hardhat", "localhost"]);

function isAddress(value) {
  try {
    return !!value && ethers.isAddress(value);
  } catch {
    return false;
  }
}

function normalizeAddress(name, value) {
  if (!isAddress(value) || value === ZERO_ADDRESS) {
    throw new Error(`❌ ${name} geçerli bir EVM adresi olmalı. Gelen değer: ${value || "<empty>"}`);
  }
  return ethers.getAddress(value);
}

function getRequiredEnvAddress(name) {
  return normalizeAddress(name, process.env[name]);
}

function getOptionalEnvAddress(name, fallback = null) {
  const value = process.env[name];
  if (!value) return fallback;
  return normalizeAddress(name, value);
}

function ensureBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true";
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function artifactExists(contractName) {
  try {
    await artifacts.readArtifact(contractName);
    return true;
  } catch {
    return false;
  }
}

function getDeployMode(chainId, networkName) {
  if (LOCAL_NETWORK_NAMES.has(networkName) || chainId === 31337n) return "local";
  if (PUBLIC_CHAIN_IDS.has(Number(chainId))) return "public";
  return "custom";
}

async function deployMockToken(name, symbol, decimals) {
  const hasMock = await artifactExists("MockERC20");
  if (!hasMock) {
    throw new Error(
      "❌ Local deploy için MockERC20 artifact'i bulunamadı. " +
      "contracts/src altında MockERC20 derlenmiş olmalı veya public-chain env adresleri kullanılmalı."
    );
  }

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy(name, symbol, decimals);
  await token.waitForDeployment();
  return token;
}

async function getTokenConfigSnapshot(escrow, tokenAddress) {
  const cfg = await escrow.tokenConfigs(tokenAddress);

  return {
    supported: cfg.supported,
    allowSellOrders: cfg.allowSellOrders,
    allowBuyOrders: cfg.allowBuyOrders,
  };
}

async function setAndVerifyTokenConfig(escrow, tokenAddress, symbol, config) {
  const tx = await escrow.setTokenConfig(
    tokenAddress,
    config.supported,
    config.allowSellOrders,
    config.allowBuyOrders
  );
  const receipt = await tx.wait();

  const snapshot = await getTokenConfigSnapshot(escrow, tokenAddress);

  if (
    snapshot.supported !== config.supported ||
    snapshot.allowSellOrders !== config.allowSellOrders ||
    snapshot.allowBuyOrders !== config.allowBuyOrders
  ) {
    throw new Error(
      `❌ ${symbol} tokenConfig doğrulaması başarısız. ` +
      `Beklenen=${JSON.stringify(config)} Gerçek=${JSON.stringify(snapshot)}`
    );
  }

  console.log(
    `✅ ${symbol} token config doğrulandı ` +
    `(supported=${snapshot.supported}, sell=${snapshot.allowSellOrders}, buy=${snapshot.allowBuyOrders})`
  );

  return {
    symbol,
    address: tokenAddress,
    txHash: receipt.hash,
    config: snapshot,
  };
}

async function syncAbiToFrontend() {
  const artifact = await artifacts.readArtifact("ArafEscrow");
  const abiDestDir = path.resolve(__dirname, "../../frontend/src/abi");
  const abiDestPath = path.join(abiDestDir, "ArafEscrow.json");

  ensureDir(abiDestDir);
  fs.writeFileSync(abiDestPath, JSON.stringify(artifact.abi, null, 2));
  console.log(`✅ ABI frontend'e yazıldı: ${abiDestPath}`);
  return abiDestPath;
}

function updateFrontendEnvIfPresent(values) {
  const frontendRoot = path.resolve(__dirname, "../../frontend");
  const envPath = path.join(frontendRoot, ".env");
  const examplePath = path.join(frontendRoot, ".env.example");

  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log("📝 frontend/.env, .env.example üzerinden oluşturuldu.");
  }

  if (!fs.existsSync(envPath)) {
    console.log("ℹ️ frontend/.env bulunamadı; otomatik env güncellemesi atlandı.");
    return null;
  }

  let content = fs.readFileSync(envPath, "utf8");
  const replaceOrAppend = (key, value) => {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(content)) content = content.replace(pattern, line);
    else content += `${content.endsWith("\n") ? "" : "\n"}${line}\n`;
  };

  replaceOrAppend("VITE_ESCROW_ADDRESS", values.escrowAddress);
  replaceOrAppend("VITE_USDT_ADDRESS", values.usdtAddress);
  replaceOrAppend("VITE_USDC_ADDRESS", values.usdcAddress);

  if (process.env.CODESPACE_NAME) {
    replaceOrAppend("VITE_API_URL", `https://${process.env.CODESPACE_NAME}-4000.app.github.dev`);
  }

  fs.writeFileSync(envPath, content);
  console.log(`✅ frontend/.env güncellendi: ${envPath}`);
  return envPath;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const feeData = await ethers.provider.getFeeData();
  const chainId = await hre.getChainId();
  const chainIdBig = BigInt(chainId);
  const deployMode = getDeployMode(chainIdBig, network.name);
  const isPublic = deployMode === "public";
  const isLocal = deployMode === "local";

  if (isPublic && process.env.CONFIRM_PUBLIC_DEPLOY !== "yes") {
    throw new Error(
      "❌ Public chain deploy guard aktif. Devam etmek için CONFIRM_PUBLIC_DEPLOY=yes ver."
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) {
    throw new Error("❌ Deployer bakiyesi 0. Deploy başlatılmadı.");
  }

  console.log("==================================================");
  console.log("🚀 ArafEscrow V3 deploy başlıyor");
  console.log(`🌐 Network       : ${network.name}`);
  console.log(`🧭 Chain ID      : ${chainId}`);
  console.log(`🧱 Mode          : ${deployMode}`);
  console.log(`👤 Deployer      : ${deployer.address}`);
  console.log(`💰 Balance       : ${ethers.formatEther(balance)} ETH`);
  console.log(`⛽ MaxFeePerGas  : ${feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, "gwei") : "n/a"} gwei`);
  console.log(`⛽ MaxPriority   : ${feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei") : "n/a"} gwei`);
  console.log("==================================================\n");

  const treasuryAddress = getRequiredEnvAddress("TREASURY_ADDRESS");
  const finalOwnerAddress = getOptionalEnvAddress("FINAL_OWNER_ADDRESS", treasuryAddress);

  let usdtAddress;
  let usdcAddress;
  let deployedMocks = [];

  if (isPublic) {
    usdtAddress = getRequiredEnvAddress("MAINNET_USDT_ADDRESS");
    usdcAddress = getRequiredEnvAddress("MAINNET_USDC_ADDRESS");
  } else {
    const useExternalTokens = ensureBooleanEnv("USE_EXTERNAL_TOKEN_ADDRESSES", false);
    if (useExternalTokens) {
      usdtAddress = getRequiredEnvAddress("MAINNET_USDT_ADDRESS");
      usdcAddress = getRequiredEnvAddress("MAINNET_USDC_ADDRESS");
      console.log("ℹ️ Local/custom deploy harici token adresleri ile devam ediyor.");
    } else {
      console.log("⏳ Mock token deploy başlatılıyor...");
      const [usdt, usdc] = await Promise.all([
        deployMockToken("Mock USDT", "USDT", 6),
        deployMockToken("Mock USDC", "USDC", 6),
      ]);
      usdtAddress = await usdt.getAddress();
      usdcAddress = await usdc.getAddress();
      deployedMocks = [
        { symbol: "USDT", address: usdtAddress },
        { symbol: "USDC", address: usdcAddress },
      ];
      console.log(`✅ Mock USDT: ${usdtAddress}`);
      console.log(`✅ Mock USDC: ${usdcAddress}`);
    }
  }

  console.log("⏳ ArafEscrow deploy ediliyor...");
  const ArafEscrow = await ethers.getContractFactory("ArafEscrow");
  const escrow = await ArafEscrow.deploy(treasuryAddress);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  const deployTx = escrow.deploymentTransaction();

  console.log(`✅ ArafEscrow deploy edildi: ${escrowAddress}`);
  if (deployTx) console.log(`🧾 Deploy tx: ${deployTx.hash}`);

  console.log("\n⏳ V3 token yön config'leri uygulanıyor...");
  const tokenResults = [];
  tokenResults.push(
    await setAndVerifyTokenConfig(escrow, usdtAddress, "USDT", {
      supported: true,
      allowSellOrders: true,
      allowBuyOrders: true,
    })
  );
  tokenResults.push(
    await setAndVerifyTokenConfig(escrow, usdcAddress, "USDC", {
      supported: true,
      allowSellOrders: true,
      allowBuyOrders: true,
    })
  );

  const [feeConfig, cooldownConfig, ownerAfterDeploy, treasuryAfterDeploy] = await Promise.all([
    escrow.getFeeConfig(),
    escrow.getCooldownConfig(),
    escrow.owner(),
    escrow.treasury(),
  ]);

  console.log(`✅ Fee config snapshot: taker=${feeConfig.currentTakerFeeBps} maker=${feeConfig.currentMakerFeeBps}`);
  console.log(`✅ Cooldown snapshot  : tier0=${cooldownConfig.currentTier0TradeCooldown} tier1=${cooldownConfig.currentTier1TradeCooldown}`);
  console.log(`✅ Owner (pre-transfer): ${ownerAfterDeploy}`);
  console.log(`✅ Treasury           : ${treasuryAfterDeploy}`);

  if (finalOwnerAddress !== ownerAfterDeploy) {
    console.log(`\n🔒 Ownership devrediliyor -> ${finalOwnerAddress}`);
    const transferTx = await escrow.transferOwnership(finalOwnerAddress);
    await transferTx.wait();
    const ownerAfterTransfer = await escrow.owner();
    if (ownerAfterTransfer !== finalOwnerAddress) {
      throw new Error(`❌ Ownership devri doğrulanamadı. Beklenen=${finalOwnerAddress} Gerçek=${ownerAfterTransfer}`);
    }
    console.log(`✅ Ownership devredildi: ${ownerAfterTransfer}`);
  } else {
    console.log("ℹ️ Ownership devri gerekmiyor; deployer zaten final owner değilse treasury ile eşleşiyor.");
  }

  const abiPath = await syncAbiToFrontend();
  let frontendEnvPath = null;
  if (isLocal) {
    frontendEnvPath = updateFrontendEnvIfPresent({
      escrowAddress,
      usdtAddress,
      usdcAddress,
    });
  } else {
    console.log("ℹ️ Public/custom modda frontend .env auto-write yapılmadı.");
  }

  const manifestDir = path.resolve(__dirname, "../deployments");
  ensureDir(manifestDir);
  const manifestPath = path.join(manifestDir, `${network.name}.json`);
  const manifest = {
    generatedAt: new Date().toISOString(),
    network: network.name,
    chainId: Number(chainId),
    deployMode,
    contractName: "ArafEscrow",
    escrowAddress,
    treasuryAddress,
    finalOwnerAddress,
    deployer: deployer.address,
    deployTxHash: deployTx ? deployTx.hash : null,
    abiPath,
    frontendEnvPath,
    tokens: tokenResults,
    deployedMocks,
    feeConfig: {
      takerFeeBps: feeConfig.currentTakerFeeBps.toString(),
      makerFeeBps: feeConfig.currentMakerFeeBps.toString(),
    },
    cooldownConfig: {
      tier0TradeCooldown: cooldownConfig.currentTier0TradeCooldown.toString(),
      tier1TradeCooldown: cooldownConfig.currentTier1TradeCooldown.toString(),
    },
  };
  writeJson(manifestPath, manifest);

  console.log("\n🎉 DEPLOYMENT COMPLETE");
  console.log("--------------------------------------------------");
  console.log(`Escrow        : ${escrowAddress}`);
  console.log(`USDT          : ${usdtAddress}`);
  console.log(`USDC          : ${usdcAddress}`);
  console.log(`Treasury      : ${treasuryAddress}`);
  console.log(`Final Owner   : ${finalOwnerAddress}`);
  console.log(`Manifest      : ${manifestPath}`);
  console.log("--------------------------------------------------");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  main,
  getDeployMode,
  getTokenConfigSnapshot,
  setAndVerifyTokenConfig,
};
