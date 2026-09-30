import React from 'react';
// [TR] SIWE (EIP-4361) metni viem ile üretilir; siwe paketi ethers + ABNF parser'ı pakete çekiyordu (~1,3 MB).
//      Çıktı siwe.prepareMessage ile birebir aynıdır; backend doğrulaması değişmez.
// [EN] Build the SIWE message with viem; the siwe package pulled ethers + an ABNF parser into the bundle.
import { createSiweMessage } from 'viem/siwe';
import { buildApiUrl } from '../apiConfig';
import { buildTermsStatement, isTermsAcceptedLocally, markTermsAcceptedLocally, TERMS_VERSION } from '../legal/terms';

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
  openProfilePage,
  onTermsRequired,
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
    // [TR] Gerçek çıkış: bekleyen tx kaydı yalnız burada silinir (F7).
    clearLocalSessionState({ navigateHome: true, closeModals: true, clearPendingTx: true });
    disconnect();
  };

  const loginWithSIWE = async () => {
    if (!address) return;
    // [TR] Bu cihazda koşullar kabul edildiyse giriş mesajı kabul beyanını içerir (imza = kanıt). Değilse düz
    //      giriş imzası istenir; backend, imza doğrulandıktan sonra cüzdanın saklı kabulüne bakar. Kabul yoksa
    //      modal açılır (cüzdan başına tek sefer). Kabul durumu hiçbir zaman imzasız sorgulanamaz.
    const acceptsTermsHere = isTermsAcceptedLocally(address);
    try {
      setIsLoggingIn(true);
      showToast(lang === 'TR' ? 'Lütfen cüzdanınızdan imza isteğini onaylayın' : 'Please approve the signature request in your wallet', 'info');

      const nonceRes = await fetch(buildApiUrl(`auth/nonce?wallet=${address}`), { credentials: 'include' });
      if (!nonceRes.ok) {
        throw new Error('Nonce alınamadı');
      }
      const { nonce, siweDomain, siweUri } = await nonceRes.json();
      if (!siweDomain || !siweUri) {
        throw new Error('Backend SIWE konfigürasyonu eksik');
      }

      const message = createSiweMessage({
        domain: siweDomain,
        address,
        // [TR] Kabul beyanı imzalanan metnin parçasıdır; backend sürümü doğrular ve kaydeder.
        statement: acceptsTermsHere ? buildTermsStatement(TERMS_VERSION) : 'Sign in to Araf Protocol.',
        uri: siweUri,
        version: '1',
        chainId,
        nonce,
        issuedAt: new Date(),
      });
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
        // [TR] Kabul sunucuda kayıtlı: bu cihazda da işaretlenir, modal bir daha çıkmaz.
        if (verifyData?.terms?.version === TERMS_VERSION) markTermsAcceptedLocally(verifiedWallet);
        setIsAuthenticated(true);
        setAuthenticatedWallet(verifiedWallet);
        showToast(lang === 'TR' ? 'Sisteme başarıyla giriş yapıldı!' : 'Successfully signed in!', 'success');
      } else {
        const data = await verifyRes.json().catch(() => ({}));
        if (data.code === 'TERMS_NOT_ACCEPTED') {
          if (data.reason === 'UNSUPPORTED_VERSION') {
            // [TR] Arayüz eski bir koşul sürümünü imzalattı (yeni sürüm yayımlandı); yenileme gerekir.
            showToast(lang === 'TR' ? 'Kullanım koşulları güncellendi. Sayfayı yenileyip yeni koşulları kabul edin.' : 'The terms were updated. Reload the page and accept the new terms.', 'error');
          } else {
            // [TR] Bu cüzdanın kayıtlı kabulü yok: modal açılır; kabul edilince beyanlı imza istenir.
            onTermsRequired?.(address);
          }
          return;
        }
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
    // [TR] Oturum açıkken tek profil yüzeyi Profil Merkezi sayfasıdır (eski modal kaldırıldı).
    else openProfilePage?.('account');
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
  // [TR] Eskiden her render'da yeni fonksiyonlar üretiliyordu (dependencies her seferinde yeni nesne).
  //      Şimdi değerler değişmedikçe aynı eylem nesnesi (ve aynı fonksiyon kimlikleri) döner (P3).
  const { createActions } = React.useContext(SessionActionsContext);
  const keys = Object.keys(dependencies).sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => createActions(dependencies), [createActions, ...keys.map((k) => dependencies[k])]);
};

export default SessionProvider;
