import React from 'react';

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

export const ProfileNav = ({ lang = 'EN', activeTab, setActiveTab }) => (
  <div className="flex flex-wrap gap-2 mb-4">
    {profileTabs.map((tab) => (
      <button
        key={tab.key}
        onClick={() => setActiveTab(tab.key)}
        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${activeTab === tab.key ? 'bg-[#222] text-white border-[#333]' : 'bg-[#101014] text-slate-400 border-[#222] hover:text-white'}`}
      >
        {tab.label[lang === 'TR' ? 'TR' : 'EN']}
      </button>
    ))}
  </div>
);

export const AccountPanel = ({ lang, address, formatAddress, isConnected, isAuthenticated }) => (
  <div className="bg-[#101014] border border-[#222] rounded-xl p-4">
    <p className="text-xs text-slate-500 mb-2">{lang === 'TR' ? 'Bağlı Cüzdan' : 'Connected Wallet'}</p>
    <p className="text-sm font-mono text-emerald-400">{address ? formatAddress(address) : '—'}</p>
    <p className="text-xs text-slate-400 mt-2">{isConnected && isAuthenticated ? (lang === 'TR' ? 'Oturum aktif' : 'Session active') : (lang === 'TR' ? 'Oturum pasif' : 'Session inactive')}</p>
  </div>
);

export const ReputationPanel = ({ userReputation }) => (
  <div className="bg-[#101014] border border-[#222] rounded-xl p-4 text-sm space-y-1">
    <p>Tier: <span className="text-emerald-400">{userReputation?.effectiveTier ?? 0}</span></p>
    <p>Successful: {userReputation?.successful ?? 0}</p>
    <p>Failed: {userReputation?.failed ?? 0}</p>
  </div>
);

export const HistoryPanel = ({ tradeHistory = [], lang = 'EN', mapResolutionTypeLabel }) => (
  <div className="space-y-2">
    {tradeHistory.map((item, idx) => (
      <div key={`${item.id || idx}`} className="bg-[#101014] border border-[#222] rounded-xl p-3 text-sm">
        <p className="text-white">{item.id || item.onchainId || '-'}</p>
        <p className="text-slate-400 text-xs">{mapResolutionTypeLabel ? mapResolutionTypeLabel(item.resolutionType, lang) : (item.state || '-')}</p>
      </div>
    ))}
  </div>
);

export const SecurityPanel = ({ lang = 'EN', handleLogoutAndDisconnect }) => (
  <div className="bg-[#101014] border border-[#222] rounded-xl p-4">
    <button onClick={handleLogoutAndDisconnect} className="bg-red-900/20 border border-red-900/40 text-red-400 px-4 py-2 rounded-lg text-sm font-bold">
      {lang === 'TR' ? 'Çıkış Yap ve Cüzdanı Ayır' : 'Logout & Disconnect'}
    </button>
  </div>
);
