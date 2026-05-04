import React from 'react';

const resolveSystemStatus = ({
  envErrors,
  isPaused,
  isConnected,
  isAuthenticated,
  authChecked,
  isSupportedChain,
  activeTrade,
  lang,
}) => {
  if (Array.isArray(envErrors) && envErrors.length > 0) {
    return {
      key: 'env_error',
      tone: 'danger',
      title: lang === 'TR' ? 'Sistem Yapılandırma Uyarısı' : 'System Configuration Warning',
      message: lang === 'TR'
        ? 'Bazı sistem ayarları doğrulanamadı. İşlem öncesi teknik durumu kontrol edin.'
        : 'Some system settings could not be validated. Review technical status before proceeding.',
      details: envErrors,
    };
  }

  if (isConnected && isSupportedChain === false) {
    return {
      key: 'unsupported_chain',
      tone: 'danger',
      title: lang === 'TR' ? 'Desteklenmeyen Ağ' : 'Unsupported Network',
      message: lang === 'TR' ? 'Lütfen desteklenen ağa geçin.' : 'Please switch to a supported network.',
      details: null,
    };
  }

  if (isPaused) {
    return {
      key: 'paused',
      tone: 'warning',
      title: lang === 'TR' ? 'Protokol Bakım Modunda' : 'Protocol in Maintenance',
      message: lang === 'TR' ? 'Bakım süresince yeni işlem açılamaz.' : 'New trades are unavailable during maintenance.',
      details: null,
    };
  }

  if (authChecked && isConnected && !isAuthenticated) {
    return {
      key: 'auth_required',
      tone: 'warning',
      title: lang === 'TR' ? 'Oturum Doğrulaması Gerekli' : 'Session Verification Required',
      message: lang === 'TR' ? 'Korunan bölümler için yeniden giriş yapın.' : 'Sign in again to access protected areas.',
      details: null,
    };
  }

  if (activeTrade?._pendingBackendSync) {
    return {
      key: 'pending_backend_sync',
      tone: 'info',
      title: lang === 'TR' ? 'İşlem Senkronizasyonu Bekleniyor' : 'Trade Sync Pending',
      message: lang === 'TR'
        ? 'İşlem zincire yazıldı; backend kaydı hazırlanıyor.'
        : 'Trade is on-chain; backend record is being prepared.',
      details: null,
    };
  }

  return {
    key: 'informational',
    tone: 'info',
    title: lang === 'TR' ? 'Sistem Durumu' : 'System Status',
    message: lang === 'TR' ? 'Sistem normal görünüyor.' : 'System looks healthy.',
    details: null,
  };
};

export const SystemStatusBar = ({
  envErrors = [],
  isPaused = false,
  isConnected = false,
  isAuthenticated = false,
  authChecked = false,
  chainId = null,
  isSupportedChain = true,
  activeTrade = null,
  isWalletRegistered = null,
  isRegisteringWallet = false,
  handleRegisterWallet = null,
  sybilStatus = null,
  walletAgeRemainingDays = null,
  supportedChains = {},
  lang = 'EN',
  children = null,
}) => {
  const status = resolveSystemStatus({
    envErrors,
    isPaused,
    isConnected,
    isAuthenticated,
    authChecked,
    chainId,
    isSupportedChain,
    activeTrade,
    lang,
  });

  const toneClass = status.tone === 'danger'
    ? 'bg-red-950/90 border-red-800 text-red-100'
    : status.tone === 'warning'
      ? 'bg-orange-950/80 border-orange-800 text-orange-100'
      : 'bg-slate-900/70 border-slate-700 text-slate-100';

  return (
    <div className={`fixed top-0 left-0 right-0 z-[85] border-b px-4 py-2 text-xs ${toneClass}`}>
      <div className="max-w-[1200px] mx-auto flex items-center justify-between gap-3">
        <div>
          <p className="font-bold">{status.title}</p>
          <p className="opacity-90">{status.message}</p>
          {Array.isArray(status.details) && status.details.length > 0 && (
            <details className="mt-1 opacity-85">
              <summary className="cursor-pointer">{lang === 'TR' ? 'Teknik Detay' : 'Technical Details'}</summary>
              <ul className="list-disc pl-4 mt-1">
                {status.details.map((detail, idx) => <li key={idx}>{detail}</li>)}
              </ul>
            </details>
          )}
        </div>
        {children}
      </div>
      {isConnected && isSupportedChain === false && (
        <div className="mt-2 text-sm font-bold">
          ⚠️ {lang === 'TR'
            ? `Yanlış Ağ! Lütfen ${Object.values(supportedChains).join(' / ')} ağına geçin.`
            : `Wrong Network! Please switch to ${Object.values(supportedChains).join(' / ')}.`}
        </div>
      )}
      {isConnected && isWalletRegistered === false && (
        <div className="mt-2 flex items-center gap-4">
          <span className="text-sm font-bold">⚠️ {lang === 'TR' ? 'Cüzdan On-Chain Kayıtlı Değil (Anti-Sybil 7 Gün)' : 'Wallet Not Registered (Anti-Sybil 7 Days)'}</span>
          <button onClick={handleRegisterWallet} disabled={isRegisteringWallet} className="bg-orange-500 text-black px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-400 disabled:opacity-50 transition">{isRegisteringWallet ? '⏳' : '📝 Kaydet'}</button>
        </div>
      )}
      {isConnected && isWalletRegistered === true && sybilStatus && sybilStatus.aged === false && (
        <div className="mt-2 text-xs font-bold">
          ⏳ {lang === 'TR'
            ? `Cüzdan kayıtlı ancak 7 günlük yaş şartı henüz dolmadı. Kalan süre: ~${walletAgeRemainingDays ?? '?'} gün.`
            : `Wallet is registered but the 7-day age requirement is not met yet. Remaining: ~${walletAgeRemainingDays ?? '?'} day(s).`}
        </div>
      )}
    </div>
  );
};

export default SystemStatusBar;
