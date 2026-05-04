import React from 'react';

export const OperationsSummaryBar = ({ summary, lang = 'EN' }) => {
  const items = [
    { key: 'totalActive', label: lang === 'TR' ? 'Toplam Aktif' : 'Total Active' },
    { key: 'locked', label: 'LOCKED' },
    { key: 'paid', label: 'PAID' },
    { key: 'challenged', label: 'CHALLENGED' },
    { key: 'settlementActionRequired', label: lang === 'TR' ? 'Settlement Aksiyon' : 'Settlement Action' },
    { key: 'settlementWaiting', label: lang === 'TR' ? 'Settlement Bekleme' : 'Settlement Waiting' },
    { key: 'pendingBackendSync', label: lang === 'TR' ? 'Backend Senkron' : 'Backend Sync' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2 mb-4">
      {items.map((item) => (
        <div key={item.key} className="bg-[#101014] border border-[#222] rounded-lg px-3 py-2">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">{item.label}</p>
          <p className="text-sm font-bold text-white">{summary?.[item.key] ?? 0}</p>
        </div>
      ))}
    </div>
  );
};

export default OperationsSummaryBar;
