/**
 * ArafEscrow V3 — Güvenlik Odaklı Nihai Deploy Script
 *
 * Bu sürüm, V3 kontrat yüzeyine göre hazırlanmıştır:
 *   - constructor(address treasury)
 *   - setTokenConfig(address,bool,bool,bool,uint8,uint256[4])
 *   - getTokenConfig(address)
 *   - getFeeConfig()
 *   - getCooldownConfig()
 *   - transferOwnership(address)
 *
 * Tasarım hedefleri:
 *   - Local geliştirmede hızlı ve güvenli mock deploy
 *   - Public chain'de mock token kurulumunu yasaklama
 *   - Token desteğini zincir üstünde doğrulama
 *   - Ownership devrini ancak kurulum doğrulanınca yapma
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

function toJsonSafe(value) {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

function defaultTierLimitsByDecimals(decimals) {
  const scale = 10n ** BigInt(decimals);
  return [
    150n * scale,
    1500n * scale,
    7500n * scale,
    30000n * scale,
  ];
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

function resolveProductionTokenConfig({ chainId, requireConfigured = false } = {}) {
  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction && !requireConfigured) {
    return { isProduction, usdtAddress: null, usdcAddress: null };
  }

  const normalizedChainId = Number(chainId);
  if (normalizedChainId === 8453) {
    const usdtRaw = process.env.BASE_MAINNET_USDT_ADDRESS || process.env.MAINNET_USDT_ADDRESS;
    const usdcRaw = process.env.BASE_MAINNET_USDC_ADDRESS || process.env.MAINNET_USDC_ADDRESS;
    return {
      isProduction,
      usdtAddress: normalizeAddress("BASE_MAINNET_USDT_ADDRESS", usdtRaw),
      usdcAddress: normalizeAddress("BASE_MAINNET_USDC_ADDRESS", usdcRaw),
    };
  }

  if (normalizedChainId === 84532) {
    if (process.env.MAINNET_USDT_ADDRESS || process.env.MAINNET_USDC_ADDRESS) {
      throw new Error("❌ Base Sepolia deploy MAINNET_* alias kabul etmez. BASE_SEPOLIA_* env kullanın.");
    }
    return {
      isProduction,
      usdtAddress: getRequiredEnvAddress("BASE_SEPOLIA_USDT_ADDRESS"),
      usdcAddress: getRequiredEnvAddress("BASE_SEPOLIA_USDC_ADDRESS"),
    };
  }

  throw new Error(`❌ Production deploy için desteklenmeyen chainId: ${normalizedChainId}`);
}

function resolveFinalOwnerAddress({ deployMode, treasuryAddress }) {
  const isLocal = deployMode === "local";
  const finalOwnerAddress = isLocal
    ? getOptionalEnvAddress("FINAL_OWNER_ADDRESS", treasuryAddress)
    : getRequiredEnvAddress("FINAL_OWNER_ADDRESS");

  if (!isLocal && finalOwnerAddress === treasuryAddress) {
    throw new Error(
      "❌ FINAL_OWNER_ADDRESS ve TREASURY_ADDRESS public/custom deploy modunda aynı olamaz."
    );
  }

  return finalOwnerAddress;
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
  // Authoritative read path: explicit getter.
  // Not: Solidity mapping auto-getter'ı struct içindeki fixed array alanını güvenilir döndürmeyebilir.
  const cfg = await escrow.getTokenConfig(tokenAddress);
  const tierMaxAmountsBaseUnit = Array.from(cfg.tierMaxAmountsBaseUnit ?? cfg[4] ?? []).map((x) => x.toString());

  if (tierMaxAmountsBaseUnit.length !== 4) {
    throw new Error(`❌ Token config tier limit snapshot invalid for ${tokenAddress}`);
  }

  return {
    supported: Boolean(cfg.supported ?? cfg[0]),
    allowSellOrders: Boolean(cfg.allowSellOrders ?? cfg[1]),
    allowBuyOrders: Boolean(cfg.allowBuyOrders ?? cfg[2]),
    decimals: Number(cfg.decimals ?? cfg[3]),
    tierMaxAmountsBaseUnit,
  };
}

async function setAndVerifyTokenConfig(escrow, tokenAddress, symbol, config) {
  const expectedTierLimits = config.tierMaxAmountsBaseUnit.map((v) => v.toString());
  if (expectedTierLimits.length !== 4) {
    throw new Error(`❌ ${symbol} tokenConfig tierMaxAmountsBaseUnit 4 eleman olmalı.`);
  }

  const tx = await escrow.setTokenConfig(
    tokenAddress,
    config.supported,
    config.allowSellOrders,
    config.allowBuyOrders,
    config.decimals,
    config.tierMaxAmountsBaseUnit
  );
  const receipt = await tx.wait();

  const snapshot = await getTokenConfigSnapshot(escrow, tokenAddress);
  const tierLimitExactMatch =
    snapshot.tierMaxAmountsBaseUnit.length === 4 &&
    expectedTierLimits.length === 4 &&
    snapshot.tierMaxAmountsBaseUnit.every((v, i) => v === expectedTierLimits[i]);

  if (
    snapshot.supported !== config.supported ||
    snapshot.allowSellOrders !== config.allowSellOrders ||
    snapshot.allowBuyOrders !== config.allowBuyOrders ||
    snapshot.decimals !== Number(config.decimals) ||
    !tierLimitExactMatch
  ) {
    throw new Error(
      `❌ ${symbol} tokenConfig doğrulaması başarısız. ` +
      `Beklenen=${toJsonSafe(config)} Gerçek=${toJsonSafe(snapshot)}`
    );
  }

  console.log(
    `✅ ${symbol} token config doğrulandı ` +
    `(supported=${snapshot.supported}, sell=${snapshot.allowSellOrders}, buy=${snapshot.allowBuyOrders}, decimals=${snapshot.decimals})`
  );

  return {
    symbol,
    address: tokenAddress,
    txHash: receipt.hash,
    config: snapshot,
  };
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
  const finalOwnerAddress = resolveFinalOwnerAddress({ deployMode, treasuryAddress });

  if (isLocal && finalOwnerAddress === treasuryAddress) {
    console.log("ℹ️ Local mod: FINAL_OWNER_ADDRESS tanımlı değil, güvenli varsayılan olarak treasury kullanıldı.");
  }

  let usdtAddress;
  let usdcAddress;
  let deployedMocks = [];

  if (isPublic) {
    const tokenConfig = resolveProductionTokenConfig({ chainId, requireConfigured: true });
    usdtAddress = tokenConfig.usdtAddress;
    usdcAddress = tokenConfig.usdcAddress;
  } else {
    const useExternalTokens = ensureBooleanEnv("USE_EXTERNAL_TOKEN_ADDRESSES", false);
    if (useExternalTokens) {
      const tokenConfig = resolveProductionTokenConfig({ chainId, requireConfigured: true });
      usdtAddress = tokenConfig.usdtAddress;
      usdcAddress = tokenConfig.usdcAddress;
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
      decimals: 6,
      tierMaxAmountsBaseUnit: defaultTierLimitsByDecimals(6),
    })
  );
  tokenResults.push(
    await setAndVerifyTokenConfig(escrow, usdcAddress, "USDC", {
      supported: true,
      allowSellOrders: true,
      allowBuyOrders: true,
      decimals: 6,
      tierMaxAmountsBaseUnit: defaultTierLimitsByDecimals(6),
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

  const abiPath = artifacts.artifactPathSync("ArafEscrow");
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
  resolveProductionTokenConfig,
  resolveFinalOwnerAddress,
  getTokenConfigSnapshot,
  setAndVerifyTokenConfig,
};
