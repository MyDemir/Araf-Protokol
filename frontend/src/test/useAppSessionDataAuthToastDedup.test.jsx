import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppSessionData } from '../app/useAppSessionData';
import { buildApiUrl } from '../app/apiConfig';

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

function Harness({ showToast }) {
  const state = useAppSessionData({
    ...baseProps,
    connectedWallet: '0xabc',
    showToast,
  });

  return (
    <button
      onClick={() => state.authenticatedFetch(buildApiUrl('admin/summary'))}
      type="button"
    >
      Trigger Authenticated Fetch
    </button>
  );
}

describe('useAppSessionData auth toast deduplication', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows only one session-expired toast during clustered 401/refresh failures', async () => {
    const user = userEvent.setup();
    const showToast = vi.fn();

    global.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ wallet: '0xabc' }) };
      }
      if (target.includes('/api/auth/refresh')) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      if (target.includes('/api/admin/summary')) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      if (target.includes('/api/orders/config')) {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (target.includes('/api/orders')) {
        return { ok: true, status: 200, json: async () => ({ orders: [] }) };
      }
      if (target.includes('/api/stats')) {
        return { ok: true, status: 200, json: async () => ({ stats: {} }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(<Harness showToast={showToast} />);

    await user.click(screen.getByRole('button', { name: /Trigger Authenticated Fetch/i }));
    await user.click(screen.getByRole('button', { name: /Trigger Authenticated Fetch/i }));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledTimes(1);
    });
  });
});
