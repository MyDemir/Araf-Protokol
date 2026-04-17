const { scrubBody } = require('../scripts/middleware/errorHandler');
const logsRoute = require('../scripts/routes/logs');

describe('scrubbers', () => {
  it('scrubs sensitive freeform values in error body', () => {
    const cleaned = scrubBody({
      note: 'iban TR123456789012345678901234 bearer eyJ.a.b email test@example.com',
      nested: { wallet: '0x1111111111111111111111111111111111111111' },
    });

    expect(cleaned.note).not.toContain('TR123456789012345678901234');
    expect(cleaned.note).not.toContain('test@example.com');
    expect(cleaned.nested.wallet).toBe('[REDACTED]');
  });

  it('scrubs wallet/email/jwt in client error logs', () => {
    const fn = logsRoute.scrubClientErrorText;
    const raw = 'wallet=0x1111111111111111111111111111111111111111 email=a@b.com token=eyJ.xxx.yyy';
    const cleaned = fn(raw);
    expect(cleaned).not.toContain('0x1111111111111111111111111111111111111111');
    expect(cleaned).not.toContain('a@b.com');
    expect(cleaned).not.toContain('eyJ.xxx.yyy');
  });
});
