import { describe, expect, it, beforeEach } from 'vitest';
import { APP_THEME_STORAGE_KEY, getInitialThemeMode } from '../app/bootstrapState';

describe('getInitialThemeMode', () => {
  beforeEach(() => {
    window.localStorage.removeItem(APP_THEME_STORAGE_KEY);
  });

  it('returns system by default', () => {
    expect(getInitialThemeMode()).toBe('system');
  });

  it('accepts persisted day/night/system', () => {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, 'day');
    expect(getInitialThemeMode()).toBe('day');
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, 'night');
    expect(getInitialThemeMode()).toBe('night');
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, 'system');
    expect(getInitialThemeMode()).toBe('system');
  });

  it('rejects invalid values', () => {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, 'purple');
    expect(getInitialThemeMode()).toBe('system');
  });
});
