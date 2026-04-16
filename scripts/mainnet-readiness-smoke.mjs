import fs from 'node:fs';
import path from 'node:path';

/**
 * Mainnet readiness smoke checker.
 *
 * [TR] Bu script protocol authority üretmez; yalnız deployment öncesi
 *      kritik dosya/env gate'lerini hızlıca denetler.
 * [EN] This script does not create protocol authority; it only validates
 *      critical file/env gates before deployment.
 */

const repoRoot = process.cwd();
const envPath = path.join(repoRoot, 'backend/.env');

const mustExistFiles = [
  'contracts/src/ArafEscrow.sol',
  'contracts/scripts/deploy.js',
  'backend/scripts/app.js',
  'backend/scripts/services/siwe.js',
  'backend/scripts/services/protocolConfig.js',
  'frontend/vercel.json',
];

const requiredBackendEnv = [
  'NODE_ENV',
  'ALLOWED_ORIGINS',
  'SIWE_DOMAIN',
  'SIWE_URI',
  'JWT_SECRET',
  'ARAF_ESCROW_ADDRESS',
  'BASE_RPC_URL',
  'ARAF_TRACKED_TOKENS',
];

function parseEnv(fileContent) {
  const map = new Map();
  for (const line of fileContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    map.set(key, value);
  }
  return map;
}

let failed = false;
console.log('=== Mainnet readiness smoke ===');

for (const rel of mustExistFiles) {
  const exists = fs.existsSync(path.join(repoRoot, rel));
  console.log(`${exists ? 'PASS' : 'FAIL'} file: ${rel}`);
  if (!exists) failed = true;
}

if (!fs.existsSync(envPath)) {
  console.log('WARN env: backend/.env not found (env checks skipped)');
  process.exit(failed ? 1 : 0);
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
for (const key of requiredBackendEnv) {
  const val = env.get(key);
  const ok = Boolean(val && val.length > 0);
  console.log(`${ok ? 'PASS' : 'FAIL'} env: ${key}`);
  if (!ok) failed = true;
}

const nodeEnv = env.get('NODE_ENV');
if (nodeEnv && nodeEnv !== 'production') {
  console.log(`WARN env: NODE_ENV is '${nodeEnv}', expected 'production' for mainnet deploy checks`);
}

process.exit(failed ? 1 : 0);
