export const profileTabs = [
  { key: 'account', label: { TR: 'Hesap', EN: 'Account' } },
  { key: 'payment', label: { TR: 'Ödeme Profili', EN: 'Payment Profile' } },
  { key: 'reputation', label: { TR: 'İtibar', EN: 'Reputation' } },
  { key: 'orders', label: { TR: 'Orderlarım', EN: 'My Orders' } },
  { key: 'active', label: { TR: 'Aktif İşlemler', EN: 'Active Trades' } },
  { key: 'history', label: { TR: 'Geçmiş', EN: 'History' } },
  { key: 'security', label: { TR: 'Güvenlik', EN: 'Security' } },
];

export const getProfileTabLabel = (key, lang = 'EN') => {
  const tab = profileTabs.find((item) => item.key === key);
  return tab ? tab.label[lang === 'TR' ? 'TR' : 'EN'] : key;
};
