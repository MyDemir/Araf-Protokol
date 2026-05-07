import React from 'react';
import { SiweMessage } from 'siwe';
import { buildApiUrl } from '../apiConfig';

export const createSessionActions = ({
  address,
  connectedWallet,
  chainId,
  isConnected,
  isAuthenticated,
  authenticatedWallet,
  authChecked,
  lang = 'EN',
  signMessageAsync,
  disconnect,
  showToast,
  setIsLoggingIn,
  setIsAuthenticated,
  setAuthenticatedWallet,
  bestEffortBackendLogout,
  clearLocalSessionState,
  setShowWalletModal,
  setProfileTab,
  setShowProfileModal,
}) => {
  const hasSignedSessionForActiveWallet = Boolean(
    isConnected
    && connectedWallet
    && isAuthenticated
    && authenticatedWallet === connectedWallet,
  );

  const requireSignedSessionForActiveWallet = () => {
    if (!authChecked) {
      showToast(
        lang === 'TR'
          ? 'Oturum doğrulanıyor. Lütfen 1-2 saniye sonra tekrar deneyin.'
          : 'Session check in progress. Please try again in a moment.',
        'info',
      );
      return false;
    }
    if (hasSignedSessionForActiveWallet) return true;
    showToast(
      lang === 'TR'
        ? 'Aktif cüzdan için imzalı oturum yok. Lütfen yeniden giriş yapın.'
        : 'No signed session for the active wallet. Please sign in again.',
      'error',
    );
    return false;
  };

  const handleLogoutAndDisconnect = async () => {
    await bestEffortBackendLogout();
    clearLocalSessionState({ navigateHome: true, closeModals: true });
    disconnect();
  };

  const loginWithSIWE = async () => {
    if (!address) return;
    try {
      setIsLoggingIn(true);
      showToast(lang === 'TR' ? 'Lütfen cüzdanınızdan imza isteğini onaylayın 🦊' : 'Please approve the signature request in your wallet 🦊', 'info');

      const nonceRes = await fetch(buildApiUrl(`auth/nonce?wallet=${address}`), { credentials: 'include' });
      if (!nonceRes.ok) {
        throw new Error('Nonce alınamadı');
      }
      const { nonce, siweDomain, siweUri } = await nonceRes.json();
      if (!siweDomain || !siweUri) {
        throw new Error('Backend SIWE konfigürasyonu eksik');
      }

      const siweMessage = new SiweMessage({
        domain: siweDomain,
        address,
        statement: 'Sign in to Araf Protocol to manage your trades and secure PII data.',
        uri: siweUri,
        version: '1',
        chainId,
        nonce,
        issuedAt: new Date().toISOString(),
      });
      const message = siweMessage.prepareMessage();
      const signature = await signMessageAsync({ message });

      const verifyRes = await fetch(buildApiUrl('auth/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, signature }),
      });

      if (verifyRes.ok) {
        const verifyData = await verifyRes.json().catch(() => ({}));
        const verifiedWallet = verifyData?.wallet?.toLowerCase?.() || null;
        if (!verifiedWallet || verifiedWallet !== connectedWallet) {
          await bestEffortBackendLogout();
          clearLocalSessionState();
          throw new Error('Aktif cüzdan ile oturum cüzdanı eşleşmiyor');
        }
        setIsAuthenticated(true);
        setAuthenticatedWallet(verifiedWallet);
        showToast(lang === 'TR' ? 'Sisteme başarıyla giriş yapıldı! 🚀' : 'Successfully signed in! 🚀', 'success');
      } else {
        const data = await verifyRes.json().catch(() => ({}));
        throw new Error(data.error || 'Doğrulama başarısız');
      }
    } catch (error) {
      console.error('SIWE Error:', error);
      if (error.message?.includes('rejected') || error.message?.includes('User rejected')) {
        showToast(lang === 'TR' ? 'İmza işlemi sizin tarafınızdan iptal edildi.' : 'Signature request was cancelled by you.', 'error');
      } else {
        showToast(lang === 'TR' ? 'Giriş başarısız oldu.' : 'Login failed.', 'error');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleAuthAction = () => {
    if (isConnected && !authChecked) {
      showToast(
        lang === 'TR'
          ? 'Cüzdan oturumu doğrulanıyor. Lütfen bekleyin.'
          : 'Validating wallet session. Please wait.',
        'info',
      );
      return;
    }
    if (!isConnected) setShowWalletModal(true);
    else if (!isAuthenticated) loginWithSIWE();
    else {
      setProfileTab('ayarlar');
      setShowProfileModal(true);
    }
  };

  return {
    hasSignedSessionForActiveWallet,
    requireSignedSessionForActiveWallet,
    handleLogoutAndDisconnect,
    loginWithSIWE,
    handleAuthAction,
  };
};

const SessionActionsContext = React.createContext({ createActions: createSessionActions });

export const SessionProvider = ({ children, actionFactory = createSessionActions }) => {
  const value = React.useMemo(() => ({ createActions: actionFactory }), [actionFactory]);
  return <SessionActionsContext.Provider value={value}>{children}</SessionActionsContext.Provider>;
};

export const useSessionActions = (dependencies) => {
  const { createActions } = React.useContext(SessionActionsContext);
  return React.useMemo(() => createActions(dependencies), [createActions, dependencies]);
};

export default SessionProvider;
