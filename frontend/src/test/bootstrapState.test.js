import { describe, it, expect } from 'vitest';
import {
  APP_LANG_STORAGE_KEY,
  TERMS_ACCEPTED_STORAGE_KEY,
  getInitialLang,
  getInitialTermsAccepted,
} from '../app/bootstrapState';

describe('bootstrapState persistence helpers', () => {
  it('defaults to EN when no language preference exists', () => {
    localStorage.removeItem(APP_LANG_STORAGE_KEY);
    expect(getInitialLang()).toBe('EN');
  });

  it('hydrates saved language from localStorage', () => {
    localStorage.setItem(APP_LANG_STORAGE_KEY, 'TR');
    expect(getInitialLang()).toBe('TR');

    localStorage.setItem(APP_LANG_STORAGE_KEY, 'EN');
    expect(getInitialLang()).toBe('EN');
  });

  it('hydrates terms acceptance from localStorage', () => {
    localStorage.removeItem(TERMS_ACCEPTED_STORAGE_KEY);
    expect(getInitialTermsAccepted()).toBe(false);

    localStorage.setItem(TERMS_ACCEPTED_STORAGE_KEY, 'true');
    expect(getInitialTermsAccepted()).toBe(true);
  });
});
