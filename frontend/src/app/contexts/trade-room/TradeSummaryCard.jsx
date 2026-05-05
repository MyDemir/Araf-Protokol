import React from 'react';

export const TradeSummaryCard = ({ activeTrade, roomState, userRole, feeBreakdownText, lang, isChallenged }) => (
  <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 border-b border-[#222] pb-6 gap-4 md:gap-0">
    <div>
      <p className="text-slate-500 text-xs tracking-widest mb-1">{lang === 'TR' ? 'İŞLEM ODASI' : 'TRADE ROOM'}: {activeTrade?.id}</p>
      <h2 className="text-2xl font-bold text-white flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {activeTrade?.max || '0.00'} {activeTrade?.fiat}
        <span className={`text-xs px-3 py-1 rounded-full border ${isChallenged ? 'bg-red-900/20 text-red-500 border-red-900' : 'bg-emerald-900/20 text-emerald-500 border-emerald-900'}`}>{isChallenged ? (lang === 'TR' ? 'Araf Fazı' : 'Purgatory') : roomState}</span>
      </h2>
      <p className="text-[10px] text-slate-400 mt-2">{userRole} • {feeBreakdownText}</p>
    </div>
    <div className="text-left md:text-right w-full md:w-auto border-t border-[#222] md:border-none pt-4 md:pt-0">
      <p className="text-slate-500 text-xs">{lang === 'TR' ? 'KARŞI TARAF' : 'COUNTERPARTY'}</p>
      <p className="text-white font-mono">{activeTrade?.maker || '0x...'}</p>
    </div>
  </div>
);

export default TradeSummaryCard;
