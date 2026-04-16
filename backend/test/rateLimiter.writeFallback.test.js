const fs = require('fs');
const path = require('path');

describe('rateLimiter write-surface fallback', () => {
  it('uses in-memory fallback wrappers for write surfaces', () => {
    const source = fs.readFileSync(path.join(__dirname, '../scripts/middleware/rateLimiter.js'), 'utf8');
    expect(source).toContain('ordersWriteLimiterWithFallback');
    expect(source).toContain('tradesLimiterWithFallback');
    expect(source).toContain('feedbackLimiterWithFallback');
  });
});
