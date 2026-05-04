import React from 'react';

export const OperationTradeCard = ({ escrow, lang = 'EN', onGoToRoom }) => {
  if (!escrow) return null;
  const max = escrow?.rawTrade?.max;
  const fiat = escrow?.rawTrade?.fiat;
  const hasAmountSummary = escrow?.amount || (max != null && fiat);
  return (
    <div className="bg-[#111113] p-2.5 rounded-lg border border-[#2a2a2e] text-xs shadow-inner">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-emerald-400 font-bold">{escrow.id || `#${escrow.onchainId ?? '—'}`}</span>
        <span className="text-[9px] border border-[#333] rounded px-1.5 py-0.5 text-slate-500 uppercase">{escrow.role}</span>
      </div>
      <p className="text-slate-400 mb-1.5">{escrow.state}</p>
      {hasAmountSummary && (
        <p className="text-slate-300 mb-2 truncate">
          {escrow.amount || '—'}
          {max != null && fiat && <span className="text-slate-500 ml-1">({Number(max).toFixed(0)} {fiat})</span>}
        </p>
      )}
      <button onClick={onGoToRoom} className="w-full bg-[#1a1a1f] hover:bg-[#222] text-white text-[10px] font-bold py-1.5 rounded transition border border-[#333]">
        {lang === 'TR' ? 'Odaya Git →' : 'Go to Room →'}
      </button>
    </div>
  );
};

export default OperationTradeCard;
