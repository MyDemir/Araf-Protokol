import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createSessionActions } from '../../frontend/src/app/providers/SessionProvider';

const makeDeps = (overrides = {}) => ({
  address: '0xabc0000000000000000000000000000000000000',
  connectedWallet: '0xabc0000000000000000000000000000000000000',
  chainId: 84532,
  isConnected: true,
  isAuthenticated: false,
  authenticatedWallet: null,
  authChecked: true,
  lang: 'EN',
  signMessageAsync: vi.fn().mockResolvedValue('0xsig'),
  disconnect: vi.fn(),
  showToast: vi.fn(),
  setIsLoggingIn: vi.fn(),
  setIsAuthenticated: vi.fn(),
  setAuthenticatedWallet: vi.fn(),
  bestEffortBackendLogout: vi.fn().mockResolvedValue(undefined),
  clearLocalSessionState: vi.fn(),
  setShowWalletModal: vi.fn(),
  setProfileTab: vi.fn(),
  setShowProfileModal: vi.fn(),
  ...overrides,
});

const jsonResponse = (body, ok = true, status = ok ? 200 : 400) => ({
  ok,
  status,
  json: async () => body,
});

describe('SessionProvider session actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it('siwe_success_uses_backend_nonce_domain_uri_and_sets_authenticated_wallet_only_when_matching_active_wallet', async () => {
    const deps = makeDeps();
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ nonce: 'abc12345', siweDomain: 'backend.example', siweUri: 'https://backend.example/app' }))
      .mockResolvedValueOnce(jsonResponse({ wallet: '0xabc0000000000000000000000000000000000000' }));

    await createSessionActions(deps).loginWithSIWE();

    expect(global.fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('auth/nonce?wallet=0xabc0000000000000000000000000000000000000'), { credentials: 'include' });
    expect(deps.signMessageAsync).toHaveBeenCalledWith({
      message: expect.stringContaining('backend.example wants you to sign in'),
    });
    const signedMessage = deps.signMessageAsync.mock.calls[0][0].message;
    expect(signedMessage).toContain('URI: https://backend.example/app');
    expect(global.fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('auth/verify'), expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(deps.setIsAuthenticated).toHaveBeenCalledWith(true);
    expect(deps.setAuthenticatedWallet).toHaveBeenCalledWith('0xabc0000000000000000000000000000000000000');
    expect(deps.bestEffortBackendLogout).not.toHaveBeenCalled();
    expect(deps.clearLocalSessionState).not.toHaveBeenCalled();
  });

  it('siwe_wallet_mismatch_logs_out_backend_and_clears_local_session', async () => {
    const deps = makeDeps();
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ nonce: 'abc12345', siweDomain: 'backend.example', siweUri: 'https://backend.example/app' }))
      .mockResolvedValueOnce(jsonResponse({ wallet: '0x9999000000000000000000000000000000000000' }));

    await createSessionActions(deps).loginWithSIWE();

    expect(deps.bestEffortBackendLogout).toHaveBeenCalledTimes(1);
    expect(deps.clearLocalSessionState).toHaveBeenCalledTimes(1);
    expect(deps.setIsAuthenticated).not.toHaveBeenCalledWith(true);
    expect(deps.showToast).toHaveBeenCalledWith('Login failed.', 'error');
  });

  it('siwe_rejected_signature_shows_user_facing_error_toast_and_resets_loading', async () => {
    const deps = makeDeps({ signMessageAsync: vi.fn().mockRejectedValue(new Error('User rejected the request')) });
    global.fetch.mockResolvedValueOnce(jsonResponse({ nonce: 'abc12345', siweDomain: 'backend.example', siweUri: 'https://backend.example/app' }));

    await createSessionActions(deps).loginWithSIWE();

    expect(deps.showToast).toHaveBeenCalledWith('Signature request was cancelled by you.', 'error');
    expect(deps.setIsLoggingIn).toHaveBeenLastCalledWith(false);
  });

  it('logout_calls_backend_logout_clear_local_session_then_disconnect', async () => {
    const order = [];
    const deps = makeDeps({
      bestEffortBackendLogout: vi.fn(async () => { order.push('backend'); }),
      clearLocalSessionState: vi.fn(() => { order.push('clear'); }),
      disconnect: vi.fn(() => { order.push('disconnect'); }),
    });

    await createSessionActions(deps).handleLogoutAndDisconnect();

    expect(order).toEqual(['backend', 'clear', 'disconnect']);
    expect(deps.clearLocalSessionState).toHaveBeenCalledWith({ navigateHome: true, closeModals: true });
  });

  it('require_signed_session_blocks_when_auth_check_pending_or_active_wallet_has_no_valid_session', () => {
    const pendingDeps = makeDeps({ authChecked: false });
    expect(createSessionActions(pendingDeps).requireSignedSessionForActiveWallet()).toBe(false);
    expect(pendingDeps.showToast).toHaveBeenCalledWith('Session check in progress. Please try again in a moment.', 'info');

    const unsignedDeps = makeDeps({ isAuthenticated: true, authenticatedWallet: '0xother' });
    expect(createSessionActions(unsignedDeps).requireSignedSessionForActiveWallet()).toBe(false);
    expect(unsignedDeps.showToast).toHaveBeenCalledWith('No signed session for the active wallet. Please sign in again.', 'error');

    const signedDeps = makeDeps({ isAuthenticated: true, authenticatedWallet: '0xabc0000000000000000000000000000000000000' });
    expect(createSessionActions(signedDeps).requireSignedSessionForActiveWallet()).toBe(true);
  });

  it('handle_auth_action_keeps_wallet_modal_siwe_and_profile_routing_behaviour', () => {
    const disconnected = makeDeps({ isConnected: false });
    createSessionActions(disconnected).handleAuthAction();
    expect(disconnected.setShowWalletModal).toHaveBeenCalledWith(true);

    const authenticated = makeDeps({ isAuthenticated: true, authenticatedWallet: '0xabc0000000000000000000000000000000000000' });
    createSessionActions(authenticated).handleAuthAction();
    expect(authenticated.setProfileTab).toHaveBeenCalledWith('ayarlar');
    expect(authenticated.setShowProfileModal).toHaveBeenCalledWith(true);
  });

  it('app_imports_session_actions_instead_of_declaring_siwe_inline', () => {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    const providerSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/providers/SessionProvider.jsx'), 'utf8');

    expect(appSource).toContain("import { useSessionActions } from './app/providers/SessionProvider';");
    expect(appSource).not.toContain('import { SiweMessage }');
    expect(appSource).not.toMatch(/const\s+loginWithSIWE\s*=\s*async/);
    expect(appSource).not.toMatch(/new\s+SiweMessage/);
    expect(providerSource).toContain('buildApiUrl(`auth/nonce?wallet=${address}`)');
    expect(providerSource).toContain('domain: siweDomain');
    expect(providerSource).toContain('uri: siweUri');
  });
});
