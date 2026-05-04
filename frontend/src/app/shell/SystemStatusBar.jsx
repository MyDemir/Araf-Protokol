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
    <div className={`border-b px-4 py-2 text-xs ${toneClass}`}>
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
    </div>
  );
};

export default SystemStatusBar;
