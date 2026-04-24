import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const readRepo = (p) => fs.readFileSync(path.resolve(process.cwd(), '..', p), 'utf8');
const readFront = (p) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

describe('frontend ↔ backend API path alignment', () => {
  it('backend mounts expected /api route prefixes', () => {
    const app = readRepo('backend/scripts/app.js');
    [
      '/api/logs',
      '/api/auth',
      '/api/orders',
      '/api/trades',
      '/api/pii',
      '/api/stats',
      '/api/receipts',
    ].forEach((prefix) => expect(app).toContain(`app.use("${prefix}"`));
  });

  it('frontend fetches canonical endpoints used by UX flow', () => {
    const session = readFront('src/app/useAppSessionData.jsx');
    [
      "buildApiUrl('orders/config')",
      "buildApiUrl('orders')",
      "buildApiUrl('orders/my')",
      "buildApiUrl('trades/my')",
      'buildApiUrl(`trades/history?page=${page}&limit=5`)',
      'buildApiUrl(`pii/taker-name/${activeTrade.onchainId}`)',
      "buildApiUrl('auth/me')",
      "buildApiUrl('auth/refresh')",
    ].forEach((pathPart) => expect(session).toContain(pathPart));
    const pii = readFront('src/hooks/usePII.js');
    // [TR] PII endpoint çözümlemesi artık hardcoded /api yerine
    //      canonical buildApiUrl helper'ı üstünden yürür.
    // [EN] PII endpoint resolution now uses canonical buildApiUrl
    //      instead of hardcoded /api strings.
    expect(pii).toContain('buildApiUrl(`pii/request-token/${tradeId}`)');
    expect(pii).toContain('buildApiUrl(`pii/${tradeId}`)');

    const contract = readFront('src/hooks/useArafContract.js');
    expect(contract).toContain('resolveClientErrorLogUrl');
    expect(contract).toContain('fetch(logUrl, {');
    expect(contract).toContain('manualReleaseCount');
    expect(contract).not.toContain('view returns (uint256 successful, uint256 failed, uint256 bannedUntil, uint256 consecutiveBans, uint8 effectiveTier)');

    const sessionSource = readFront('src/app/useAppSessionData.jsx');
    expect(sessionSource).not.toContain('repData[0]');
    expect(sessionSource).toContain('authorityCounters');

    const boundary = readFront('src/components/ErrorBoundary.jsx');
    expect(boundary).toContain('resolveClientErrorLogUrl');
    expect(boundary).toContain('fetch(logUrl, {');
  });
});
