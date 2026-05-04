import React from 'react';

export const SecurityPanel = ({ lang = 'EN', handleLogoutAndDisconnect }) => (
  <div className="bg-[#101014] border border-[#222] rounded-xl p-4">
    <button onClick={handleLogoutAndDisconnect} className="bg-red-900/20 border border-red-900/40 text-red-400 px-4 py-2 rounded-lg text-sm font-bold">
      {lang === 'TR' ? 'Çıkış Yap ve Cüzdanı Ayır' : 'Logout & Disconnect'}
    </button>
  </div>
);

export default SecurityPanel;
