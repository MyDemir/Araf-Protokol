import React from 'react';

export const OperationTradeCard = ({ escrow, lang = 'EN', onGoToRoom }) => {
  if (!escrow) return null;
  return (
    <div className="bg-[#101014] border border-[#222] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-emerald-400 text-sm">{escrow.id || `#${escrow.onchainId ?? '—'}`}</span>
        <span className="text-[10px] border border-[#333] rounded px-2 py-0.5 text-slate-400 uppercase">{escrow.role}</span>
      </div>
      <p className="text-xs text-slate-400 mb-2">{escrow.state}</p>
      <button onClick={onGoToRoom} className="w-full bg-[#1a1a1f] hover:bg-[#222] text-white text-xs font-bold py-2 rounded-lg border border-[#333]">
        {lang === 'TR' ? 'Odaya Git →' : 'Go to Room →'}
      </button>
    </div>
  );
};

export default OperationTradeCard;
