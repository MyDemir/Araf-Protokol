import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { APP_THEME_STORAGE_KEY, getInitialThemeMode } from '../app/bootstrapState';
import { ThemeProvider, useThemeMode } from '../app/providers/ThemeProvider';

describe('getInitialThemeMode', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.removeItem(APP_THEME_STORAGE_KEY);
    delete document.documentElement.dataset.theme;
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
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

const ThemeProbe = () => {
  const { setThemeMode } = useThemeMode();
  React.useEffect(() => {
    setThemeMode('day');
  }, [setThemeMode]);
  return null;
};

describe('ThemeProvider runtime sync', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.removeItem(APP_THEME_STORAGE_KEY);
    delete document.documentElement.dataset.theme;
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  });

  it('syncs data-theme and persists mode', async () => {
    render(React.createElement(ThemeProvider, null, React.createElement(ThemeProbe)));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('day');
      expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('day');
    });
  });
});
