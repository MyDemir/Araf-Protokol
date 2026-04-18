import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useAppSessionData } from '../app/useAppSessionData';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const baseProps = {
  address: '0xabc',
  isConnected: true,
  connector: null,
  chainId: 84532,
  publicClient: null,
  currentView: 'home',
  showProfileModal: false,
  profileTab: 'ayarlar',
  lang: 'EN',
  isContractLoading: false,
  setShowMakerModal: vi.fn(),
  setShowProfileModal: vi.fn(),
  setCurrentView: vi.fn(),
  showToast: vi.fn(),
  getTakerFeeBps: undefined,
  getTokenDecimals: undefined,
  getCurrentAmounts: undefined,
  getWalletRegisteredAt: undefined,
  getReputation: undefined,
  getFirstSuccessfulTradeAt: undefined,
  antiSybilCheck: undefined,
  getCooldownRemaining: undefined,
  getPaused: undefined,
  SUPPORTED_TOKEN_ADDRESSES: { USDT: '', USDC: '' },
  filterTier1: false,
  filterToken: 'ALL',
  searchAmount: '',
};

const HookHarness = ({ connectedWallet }) => {
  const state = useAppSessionData({
    ...baseProps,
    connectedWallet,
  });
  return <div data-testid="auth-checked">{String(state.authChecked)}</div>;
};

describe('useAppSessionData authChecked lifecycle', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resets authChecked to false when a new /api/auth/me revalidation cycle starts', async () => {
    const secondAuthDeferred = deferred();
    let authMeCallCount = 0;

    global.fetch = vi.fn((url) => {
      const target = String(url);

      if (target.includes('/api/auth/me')) {
        authMeCallCount += 1;
        if (authMeCallCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ wallet: '0xabc' }),
          });
        }
        return secondAuthDeferred.promise;
      }

      if (target.includes('/api/orders/config')) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      if (target.includes('/api/orders')) {
        return Promise.resolve({ ok: true, json: async () => ({ orders: [] }) });
      }
      if (target.includes('/api/stats')) {
        return Promise.resolve({ ok: true, json: async () => ({ stats: {} }) });
      }

      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const { rerender } = render(<HookHarness connectedWallet="0xabc" />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-checked').textContent).toBe('true');
    });

    rerender(<HookHarness connectedWallet="0xdef" />);

    await waitFor(() => {
      expect(screen.getByTestId('auth-checked').textContent).toBe('false');
    });

    secondAuthDeferred.resolve({
      ok: true,
      status: 200,
      json: async () => ({ wallet: '0xdef' }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-checked').textContent).toBe('true');
    });
  });
});
