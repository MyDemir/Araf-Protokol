// [TR] Bağlayıcı chunk'ı yüklenemezse (ağ hatası, eski deploy) sessiz boş ekran yerine kademeli geri düşüş:
//      1) tüm bağlayıcılar, 2) yalnız injected() (yeniden deneme), 3) bağlayıcısız (EIP-6963 keşfi yine çalışır).
// [EN] If the connectors chunk fails to load (network error, stale deploy), degrade in steps instead of a blank
//      screen: 1) all connectors, 2) injected() only (retry), 3) none (EIP-6963 discovery still works).
export const loadConnectorsSafely = async (importer = () => import('wagmi/connectors'), logger = console) => {
  try {
    const { coinbaseWallet, injected } = await importer();
    return [
      injected(), // OKX Wallet ve diğer injected cüzdanlar
      coinbaseWallet({ appName: 'Araf Protocol' }),
    ];
  } catch (err) {
    logger.error('[bootstrap] connectors chunk failed to load; retrying with injected() only', err);
  }
  try {
    const { injected } = await importer();
    return [injected()];
  } catch (err) {
    logger.error('[bootstrap] injected connector unavailable; continuing without connectors', err);
    return [];
  }
};

export const renderFatalReload = (container, message = 'Uygulama yüklenemedi. / The app failed to load.') => {
  if (!container) return;
  container.textContent = '';
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'padding:2rem;font-family:sans-serif;text-align:center';
  const p = document.createElement('p');
  p.textContent = message;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Yeniden yükle / Reload';
  btn.onclick = () => window.location.reload();
  box.append(p, btn);
  container.append(box);
};
