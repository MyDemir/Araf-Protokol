import React from 'react';

export const AccountPanel = ({ lang, address, formatAddress, isConnected, isAuthenticated }) => (
  <div className="bg-[#101014] border border-[#222] rounded-xl p-4">
    <p className="text-xs text-slate-500 mb-2">{lang === 'TR' ? 'Bağlı Cüzdan' : 'Connected Wallet'}</p>
    <p className="text-sm font-mono text-emerald-400">{address ? formatAddress(address) : '—'}</p>
    <p className="text-xs text-slate-400 mt-2">{isConnected && isAuthenticated ? (lang === 'TR' ? 'Oturum aktif' : 'Session active') : (lang === 'TR' ? 'Oturum pasif' : 'Session inactive')}</p>
  </div>
);

export default AccountPanel;
