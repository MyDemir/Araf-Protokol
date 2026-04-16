const fs = require('fs');
const path = require('path');

describe('backend route mounts', () => {
  it('keeps frontend-consumed /api mount paths in app.js', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../scripts/app.js'), 'utf8');

    const expectedMounts = [
      '/api/logs',
      '/api/auth',
      '/api/orders',
      '/api/trades',
      '/api/pii',
      '/api/stats',
      '/api/receipts',
    ];

    for (const mount of expectedMounts) {
      expect(appSource).toContain(`app.use("${mount}"`);
    }
  });
});
