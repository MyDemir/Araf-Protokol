import { describe, expect, it } from 'vitest';
import { resolveValidatedFillAmountRaw } from '../app/fillAmountPolicy';

describe('fillAmountPolicy fail-closed partial-fill validation', () => {
  it('rejects invalid partial-fill string and does not fallback to remaining', () => {
    expect(() =>
      resolveValidatedFillAmountRaw({
        fillAmountRaw: 'abc',
        remainingAmountRaw: 100n,
        minFillAmountRaw: 10n,
        lang: 'EN',
      })
    ).toThrow(/invalid partial fill amount/i);
  });

  it('rejects zero/negative partial-fill values', () => {
    expect(() =>
      resolveValidatedFillAmountRaw({
        fillAmountRaw: '0',
        remainingAmountRaw: 100n,
        minFillAmountRaw: 10n,
        lang: 'EN',
      })
    ).toThrow(/greater than zero/i);

    expect(() =>
      resolveValidatedFillAmountRaw({
        fillAmountRaw: '-1',
        remainingAmountRaw: 100n,
        minFillAmountRaw: 10n,
        lang: 'EN',
      })
    ).toThrow(/greater than zero/i);
  });

  it('rejects partial-fill values greater than remaining', () => {
    expect(() =>
      resolveValidatedFillAmountRaw({
        fillAmountRaw: '101',
        remainingAmountRaw: 100n,
        minFillAmountRaw: 10n,
        lang: 'EN',
      })
    ).toThrow(/cannot exceed remaining amount/i);
  });

  it('accepts valid partial-fill value and returns exact requested raw amount', () => {
    const result = resolveValidatedFillAmountRaw({
      fillAmountRaw: '25',
      remainingAmountRaw: 100n,
      minFillAmountRaw: 10n,
      lang: 'EN',
    });
    expect(result).toBe(25n);
  });

  it('rejects partial-fill below min-fill unless it equals full remaining amount', () => {
    expect(() =>
      resolveValidatedFillAmountRaw({
        fillAmountRaw: '5',
        remainingAmountRaw: 100n,
        minFillAmountRaw: 10n,
        lang: 'EN',
      })
    ).toThrow(/below minimum fill/i);

    const fullRemaining = resolveValidatedFillAmountRaw({
      fillAmountRaw: '9',
      remainingAmountRaw: 9n,
      minFillAmountRaw: 10n,
      lang: 'EN',
    });
    expect(fullRemaining).toBe(9n);
  });

  it('keeps remaining-fill behavior when fillAmountRaw is not provided', () => {
    const result = resolveValidatedFillAmountRaw({
      fillAmountRaw: '',
      remainingAmountRaw: 100n,
      minFillAmountRaw: 10n,
      lang: 'EN',
    });
    expect(result).toBe(100n);
  });
});
