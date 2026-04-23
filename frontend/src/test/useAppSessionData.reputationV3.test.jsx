import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useAppSessionData } from '../app/useAppSessionData';

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
  connectedWallet: '0xabc',
  setShowMakerModal: vi.fn(),
  setShowProfileModal: vi.fn(),
  setCurrentView: vi.fn(),
  showToast: vi.fn(),
  getTakerFeeBps: undefined,
  getTokenDecimals: undefined,
  getCurrentAmounts: undefined,
  getWalletRegisteredAt: vi.fn().mockResolvedValue(0n),
  antiSybilCheck: undefined,
  getCooldownRemaining: undefined,
  getPaused: undefined,
  SUPPORTED_TOKEN_ADDRESSES: { USDT: '', USDC: '' },
  filterTier1: false,
  filterToken: 'ALL',
  searchAmount: '',
};

const Harness = (props) => {
  const state = useAppSessionData(props);
  return <div data-testid="effective-tier">{String(state.userReputation?.effectiveTier ?? '')}</div>;
};

describe('useAppSessionData reputation V3 mapping', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn((url) => {
      const target = String(url);
      if (target.includes('/api/auth/me')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ wallet: '0xabc' }) });
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
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps named getReputation fields into userReputation state', async () => {
    const getReputation = vi.fn().mockResolvedValue({
      successful: 5n,
      failed: 1n,
      bannedUntil: 0n,
      consecutiveBans: 2n,
      effectiveTier: 4,
    });
    const getFirstSuccessfulTradeAt = vi.fn().mockResolvedValue(100n);

    render(
      <Harness
        {...baseProps}
        getReputation={getReputation}
        getFirstSuccessfulTradeAt={getFirstSuccessfulTradeAt}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('effective-tier').textContent).toBe('4');
    });
  });
});
