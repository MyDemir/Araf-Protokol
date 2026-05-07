import React from 'react';

const t = (lang, tr, en) => (lang === 'TR' ? tr : en);

const supportedChainNames = (supportedChains) => Object.values(supportedChains || {})
  .filter(Boolean)
  .join(' / ');

export const resolveSystemStatuses = ({
  envErrors = [],
  isPaused = false,
  isConnected = false,
  isAuthenticated = false,
  authChecked = false,
  isSupportedChain = true,
  supportedChains = {},
  isWalletRegistered = null,
  isRegisteringWallet = false,
  sybilStatus = null,
  walletAgeRemainingDays = null,
  activeTrade = null,
  lang = 'EN',
}) => {
  const statuses = [];

  if (Array.isArray(envErrors) && envErrors.length > 0) {
    statuses.push({
      key: 'env_error',
      tone: 'danger',
      title: t(lang, 'Sistem Yapılandırma Uyarısı', 'System Configuration Warning'),
      message: t(
        lang,
        'Bazı sistem ayarları doğrulanamadı. İşlem öncesi teknik durumu kontrol edin.',
        'Some system settings could not be validated. Review technical status before proceeding.',
      ),
      details: envErrors,
    });
  }

  if (isConnected && isSupportedChain === false) {
    const names = supportedChainNames(supportedChains);
    statuses.push({
      key: 'unsupported_chain',
      tone: 'danger',
      title: t(lang, 'Desteklenmeyen Ağ', 'Unsupported Network'),
      message: names
        ? t(lang, `Yanlış Ağ! Lütfen ${names} ağına geçin.`, `Wrong Network! Please switch to ${names}.`)
        : t(lang, 'Lütfen desteklenen ağa geçin.', 'Please switch to a supported network.'),
    });
  }

  if (isPaused) {
    statuses.push({
      key: 'paused',
      tone: 'danger',
      title: t(lang, 'Protokol Bakım Modunda', 'Protocol in Maintenance'),
      message: t(lang, 'Sistem şu an bakım modundadır. Yeni işlem açılamaz.', 'System is currently in maintenance mode. New trades cannot be opened.'),
    });
  }

  if (isConnected && isWalletRegistered === false) {
    statuses.push({
      key: 'wallet_unregistered',
      tone: 'warning',
      title: t(lang, 'Cüzdan On-Chain Kayıtlı Değil', 'Wallet Not Registered'),
      message: t(lang, 'Anti-Sybil 7 gün kontrolü için cüzdanınızı kaydedin.', 'Register your wallet for the 7-day Anti-Sybil check.'),
      action: 'register_wallet',
      isActionLoading: isRegisteringWallet,
    });
  }

  if (isConnected && isWalletRegistered === true && sybilStatus?.aged === false) {
    statuses.push({
      key: 'wallet_age_pending',
      tone: 'warning',
      title: t(lang, 'Cüzdan Yaşı Bekleniyor', 'Wallet Age Pending'),
      message: t(
        lang,
        `Cüzdan kayıtlı ancak 7 günlük yaş şartı henüz dolmadı. Kalan süre: ~${walletAgeRemainingDays ?? '?'} gün.`,
        `Wallet is registered but the 7-day age requirement is not met yet. Remaining: ~${walletAgeRemainingDays ?? '?'} day(s).`,
      ),
    });
  }

  if (authChecked && isConnected && !isAuthenticated) {
    statuses.push({
      key: 'auth_required',
      tone: 'warning',
      title: t(lang, 'Oturum Doğrulaması Gerekli', 'Session Verification Required'),
      message: t(lang, 'Korunan bölümler için yeniden giriş yapın.', 'Sign in again to access protected areas.'),
    });
  }

  if (activeTrade?._pendingBackendSync) {
    statuses.push({
      key: 'pending_backend_sync',
      tone: 'info',
      title: t(lang, 'İşlem Senkronizasyonu Bekleniyor', 'Trade Sync Pending'),
      message: t(lang, 'İşlem zincire yazıldı; backend kaydı hazırlanıyor.', 'Trade is on-chain; backend record is being prepared.'),
    });
  }

  return statuses;
};

const toneClass = (tone) => {
  if (tone === 'danger') return 'bg-red-950/90 border-red-800 text-red-100';
  if (tone === 'warning') return 'bg-orange-950/80 border-orange-800 text-orange-100';
  return 'bg-surface border-borderSubtle text-textPrimary';
};

export const SystemStatusBar = ({
  envErrors = [],
  isPaused = false,
  isConnected = false,
  isAuthenticated = false,
  authChecked = false,
  chainId = null,
  isSupportedChain = true,
  supportedChains = {},
  isWalletRegistered = null,
  isRegisteringWallet = false,
  onRegisterWallet = null,
  sybilStatus = null,
  walletAgeRemainingDays = null,
  activeTrade = null,
  lang = 'EN',
  children = null,
}) => {
  const statuses = resolveSystemStatuses({
    envErrors,
    isPaused,
    isConnected,
    isAuthenticated,
    authChecked,
    chainId,
    isSupportedChain,
    supportedChains,
    isWalletRegistered,
    isRegisteringWallet,
    sybilStatus,
    walletAgeRemainingDays,
    activeTrade,
    lang,
  });

  if (statuses.length === 0 && !children) return null;

  return (
    <section aria-label={lang === 'TR' ? 'Sistem durumu' : 'System status'} className="shrink-0 border-b border-borderSubtle" data-testid="system-status-bar">
      <div className="flex flex-col">
        {statuses.map((status) => (
          <div key={status.key} className={`px-4 py-2 text-sm border-b last:border-b-0 ${toneClass(status.tone)}`} data-status-key={status.key}>
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
              {status.action === 'register_wallet' && (
                <button
                  type="button"
                  onClick={onRegisterWallet || undefined}
                  disabled={isRegisteringWallet}
                  className="bg-orange-500 text-black px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-400 disabled:opacity-50 transition shrink-0"
                >
                  {isRegisteringWallet ? '⏳' : (lang === 'TR' ? '📝 Kaydet' : '📝 Register')}
                </button>
              )}
            </div>
          </div>
        ))}
        {children}
      </div>
    </section>
  );
};

export default SystemStatusBar;
