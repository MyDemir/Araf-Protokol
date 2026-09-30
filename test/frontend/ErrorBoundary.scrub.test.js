import { describe, it, expect } from 'vitest';
import { scrubPII } from '../../frontend/src/components/ErrorBoundary';

// [TR] F19.1 — ErrorBoundary log temizleme yalnız TR IBAN'ı değil genel PII'yi kapsamalı.
describe('ErrorBoundary scrubPII (F19.1)', () => {
  const redacted = (input, leaked) => {
    const out = scrubPII(input);
    expect(out).not.toContain(leaked);
    expect(out).toContain('[REDACTED]');
    return out;
  };

  it('redacts a TR IBAN', () => {
    redacted('render failed for TR330006100519786457841326', 'TR330006100519786457841326');
  });

  it('redacts non-TR IBANs, compact and space-grouped', () => {
    redacted('bad iban DE89370400440532013000 in card', 'DE89370400440532013000');
    redacted('bad iban GB29 NWBK 6016 1331 9268 19 in card', 'NWBK 6016');
    redacted('FR1420041010050500013M02606', 'FR1420041010050500013M02606');
  });

  it('redacts US routing and account numbers, including JSON form', () => {
    redacted('routing_number: 021000021', '021000021');
    redacted('{"routing_number":"021000021"}', '021000021');
    redacted('account_number=123456789012', '123456789012');
    redacted('{"account_number":"00012345678"}', '00012345678');
  });

  it('redacts email addresses', () => {
    redacted('cannot render alice.b+tag@example.co.uk profile', 'alice.b+tag@example.co.uk');
  });

  it('redacts phone numbers in international, TR and US shapes', () => {
    redacted('phone +44 20 7946 0958 failed', '7946 0958');
    redacted('phone +905321234567 failed', '905321234567');
    redacted('phone 0532 123 45 67 failed', '123 45 67');
    redacted('phone (415) 555-2671 failed', '555-2671');
  });

  it('keeps ordinary error text readable', () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'map') at Foo (http://localhost:5173/src/App.jsx:120:15)";
    expect(scrubPII(msg)).toBe(msg);
  });

  it('is safe on non-string input', () => {
    expect(scrubPII(undefined)).toBeUndefined();
    expect(scrubPII('')).toBe('');
  });
});
