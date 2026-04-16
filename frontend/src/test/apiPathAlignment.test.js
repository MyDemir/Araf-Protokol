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
      '/api/orders/config',
      '/api/orders',
      '/api/orders/my',
      '/api/trades/my',
      '/api/trades/history',
      '/api/pii/taker-name/',
      '/api/auth/me',
      '/api/auth/refresh',
    ].forEach((pathPart) => expect(session).toContain(pathPart));

    const pii = readFront('src/hooks/usePII.js');
    expect(pii).toContain('/api/pii/request-token/');
    expect(pii).toContain('/api/pii/${tradeId}');

    const contract = readFront('src/hooks/useArafContract.js');
    expect(contract).toContain('resolveApiBaseForLogs');
    expect(contract).toContain('fetch(`${apiUrl}/logs/client-error`');
  });
});
