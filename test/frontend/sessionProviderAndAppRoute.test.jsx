import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSessionActions } from '../../frontend/src/app/providers/SessionProvider';

describe('useSessionActions memoization (P3)', () => {
  const deps = () => ({
    address: '0xabc', connectedWallet: '0xabc', chainId: 1, isConnected: true, isAuthenticated: true,
    authenticatedWallet: '0xabc', authChecked: true, lang: 'EN', signMessageAsync: vi.fn(), disconnect: vi.fn(),
    showToast: vi.fn(), setIsLoggingIn: vi.fn(), setIsAuthenticated: vi.fn(), setAuthenticatedWallet: vi.fn(),
    bestEffortBackendLogout: vi.fn(), clearLocalSessionState: vi.fn(), setShowWalletModal: vi.fn(),
    openProfilePage: vi.fn(), onTermsRequired: vi.fn(),
  });

  it('returns the same action object while dependency values are unchanged, and a new one when one changes', () => {
    const base = deps();
    const { result, rerender } = renderHook((d) => useSessionActions(d), { initialProps: { ...base } });
    const first = result.current;
    rerender({ ...base });
    expect(result.current).toBe(first);
    expect(result.current.handleAuthAction).toBe(first.handleAuthAction);
    rerender({ ...base, lang: 'TR' });
    expect(result.current).not.toBe(first);
  });

  it('logout clears the pending tx record (real logout only) (F7)', async () => {
    const base = deps();
    const { result } = renderHook((d) => useSessionActions(d), { initialProps: base });
    await result.current.handleLogoutAndDisconnect();
    expect(base.clearLocalSessionState).toHaveBeenCalledWith({ navigateHome: true, closeModals: true, clearPendingTx: true });
  });
});

describe('App hash routing and chain wiring (F5, F11)', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');

  it('applyHashRoute no longer depends on activeEscrows (it re-ran on every escrow change and forced the room)', () => {
    expect(source).toContain('findEscrowByRouteTradeId(escrowsRef.current, route.tradeId)');
    expect(source).toContain('}, [devScenarioActive, openEscrowFromRoute, setActiveTrade, setCurrentView, setActiveTradesFilter, setProfileContextTab]);');
  });

  it('clears the hash when leaving the room or the profile route', () => {
    expect(source).toContain('clearAppHashRoute()');
    expect(source).toContain("prev === 'tradeRoom' && currentView !== 'tradeRoom'");
  });

  it('reads the wallet chain from useAccount and passes the deployment chain to the contract hook', () => {
    expect(source).toContain('chainId: walletChainId } = useAccount()');
    expect(source).toContain('useArafContract({ expectedChainId: deploymentChainId })');
    expect(source).toContain('const chainId = walletChainId ?? configChainId;');
  });
});
