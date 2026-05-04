import React from 'react';

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

export default HistoryPanel;
