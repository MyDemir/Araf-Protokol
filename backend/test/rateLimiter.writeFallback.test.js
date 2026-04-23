const fs = require('fs');
const path = require('path');

describe('rateLimiter write-surface fallback', () => {
  it('keeps sensitive surfaces on in-memory fallback path when Redis degrades', () => {
    const source = fs.readFileSync(path.join(__dirname, '../scripts/middleware/rateLimiter.js'), 'utf8');
    expect(source).toContain('makeTieredSensitiveLimiter');
    expect(source).toContain('const ordersReadLimiter = makeTieredSensitiveLimiter');
    expect(source).toContain('const roomReadLimiter = makeTieredSensitiveLimiter');
    expect(source).toContain('const receiptUploadLimiter = makeTieredSensitiveLimiter');
    expect(source).toContain('const coordinationWriteLimiter = makeTieredSensitiveLimiter');
    expect(source).toContain('const feedbackLimiter = makeTieredSensitiveLimiter');
    expect(source).toContain('const adminReadLimiterWithFallback');
    expect(source).toContain('adminReadLimiterWithFallback');
    expect(source).toContain('const marketReadLimiter = rateLimit');
    expect(source).toContain('skip: makeSkipFn()');
  });
});
