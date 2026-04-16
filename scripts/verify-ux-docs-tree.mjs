import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const requiredPaths = [
  'contracts/src/ArafEscrow.sol',
  'contracts/test/ArafEscrow.test.js',
  'contracts/scripts/deploy.js',
  'backend/scripts/app.js',
  'backend/scripts/routes/orders.js',
  'backend/scripts/routes/trades.js',
  'backend/scripts/routes/auth.js',
  'backend/scripts/routes/pii.js',
  'backend/scripts/routes/receipts.js',
  'backend/scripts/routes/stats.js',
  'backend/scripts/routes/logs.js',
  'backend/scripts/services/protocolConfig.js',
  'backend/scripts/services/eventListener.js',
  'backend/scripts/services/siwe.js',
  'backend/scripts/middleware/auth.js',
  'frontend/src/App.jsx',
  'frontend/src/app/useAppSessionData.jsx',
  'frontend/src/app/AppModals.jsx',
  'frontend/src/app/AppViews.jsx',
  'frontend/src/app/orderModel.js',
  'frontend/src/hooks/useArafContract.js',
  'frontend/src/hooks/usePII.js',
  'frontend/src/components/PIIDisplay.jsx',
  'frontend/.env.example',
  'docs/TR/ux.md',
  'docs/EN/ux.md',
];

const missing = requiredPaths.filter((p) => !fs.existsSync(path.join(repoRoot, p)));
if (missing.length) {
  console.error('Missing required paths:');
  for (const m of missing) console.error(` - ${m}`);
  process.exit(1);
}

const docsRequiredRefs = [
  'contracts/src/ArafEscrow.sol',
  'backend/scripts/app.js',
  'backend/scripts/routes/{auth,orders,trades,pii,receipts,stats,logs}.js',
  'backend/scripts/services/{eventListener,protocolConfig,siwe}.js',
  'frontend/src/App.jsx',
  'frontend/src/hooks/{useArafContract,usePII}.js|.jsx',
  'docs/TR/ux.md',
  'docs/EN/ux.md',
];

const docs = ['docs/TR/ux.md', 'docs/EN/ux.md'];
for (const docPath of docs) {
  const content = fs.readFileSync(path.join(repoRoot, docPath), 'utf8');
  for (const ref of docsRequiredRefs) {
    if (!content.includes(ref)) {
      console.error(`[${docPath}] does not reference required marker: ${ref}`);
      process.exit(1);
    }
  }
}

console.log('UX doc tree verification passed.');
