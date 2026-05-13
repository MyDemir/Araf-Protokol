#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..');
const rootFrontendTestPrefix = 'test/frontend/';
const legacyFrontendTestPrefix = 'frontend/src/test/';

const toPackageRelative = (repoRelative) => path.relative(packageRoot, path.resolve(repoRoot, repoRelative)).replace(/\\/g, '/');

const normalizeFrontendPathArg = (arg) => {
  if (typeof arg !== 'string' || arg.startsWith('-')) return arg;

  const normalized = arg.replace(/\\/g, '/');

  if (normalized === 'test/frontend' || normalized.startsWith(rootFrontendTestPrefix)) {
    return toPackageRelative(normalized);
  }

  if (normalized === 'frontend/src/test') {
    return toPackageRelative('test/frontend');
  }

  if (normalized.startsWith(legacyFrontendTestPrefix)) {
    return toPackageRelative(`${rootFrontendTestPrefix}${normalized.slice(legacyFrontendTestPrefix.length)}`);
  }

  if (!normalized.startsWith('frontend/')) return arg;

  const repoRelativePath = path.resolve(repoRoot, normalized);
  const packageRelative = normalized.slice('frontend/'.length);
  const packageRelativePath = path.resolve(packageRoot, packageRelative);

  return fs.existsSync(repoRelativePath) && fs.existsSync(packageRelativePath)
    ? packageRelative
    : arg;
};

const args = process.argv.slice(2).map(normalizeFrontendPathArg);
const vitestBin = path.resolve(packageRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest');
const result = spawnSync(vitestBin, ['run', ...args], {
  cwd: packageRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
