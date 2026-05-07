import React from 'react';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { APP_THEME_STORAGE_KEY, getInitialThemeMode } from '../app/bootstrapState';
import { ThemeProvider, useThemeMode } from '../app/providers/ThemeProvider';

describe('getInitialThemeMode', () => {
  beforeEach(() => {
    window.localStorage.removeItem(APP_THEME_STORAGE_KEY);
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => cleanup());

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

  it('ThemeProvider persists mode and syncs data-theme', async () => {
    const ThemeHarness = () => {
      const { themeMode, setThemeMode } = useThemeMode();
      return React.createElement('button', { onClick: () => setThemeMode('day') }, themeMode);
    };

    render(React.createElement(ThemeProvider, null, React.createElement(ThemeHarness)));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('night'));
    expect(screen.getByRole('button', { name: 'system' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'system' }));

    await waitFor(() => expect(window.localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe('day'));
    expect(document.documentElement.dataset.theme).toBe('day');
    expect(screen.getByRole('button', { name: 'day' })).toBeInTheDocument();
  });

});
