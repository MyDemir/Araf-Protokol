import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('frontend -> backend API path alignment', () => {
  it('uses canonical /api-prefixed paths consumed by backend mounts', () => {
    const targets = [
      'src/App.jsx',
      'src/app/useAppSessionData.jsx',
      'src/hooks/usePII.js',
      'src/hooks/useArafContract.js',
      'src/components/ErrorBoundary.jsx',
    ];

    const content = targets
      .map((f) => fs.readFileSync(path.join(process.cwd(), f), 'utf8'))
      .join('\n');

    const requiredPaths = [
      '/api/orders/config',
      '/api/orders',
      '/api/orders/my',
      '/api/trades/my',
      '/api/trades/history',
      '/api/pii/',
      '/api/auth/',
      '/api/logs/client-error',
    ];

    for (const endpoint of requiredPaths) {
      expect(content).toContain(endpoint);
    }
  });
});
