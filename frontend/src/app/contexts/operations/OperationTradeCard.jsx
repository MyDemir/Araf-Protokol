import React from 'react';
import { mapEscrowToOperationCardModel } from './operationsContextModel';

export const OperationTradeCard = ({ escrow, lang = 'EN', onGoToRoom }) => {
  if (!escrow) return null;
  const model = mapEscrowToOperationCardModel(escrow);
  const pendingSync = escrow?.rawTrade?._pendingBackendSync === true;
  return (
    <div className="bg-[#101014] border border-[#222] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-emerald-400 text-sm">{model.id}</span>
        <span className="text-[10px] border border-[#333] rounded px-2 py-0.5 text-slate-400 uppercase">{model.role}</span>
      </div>
      <p className="text-xs text-slate-400 mb-2">{model.state}</p>
      {model.amount && <p className="text-xs text-slate-500 mb-2">{model.amount}{model.fiat ? ` (${model.fiat})` : ''}</p>}
      {pendingSync && <p className="text-[11px] text-amber-400 mb-2">{lang === 'TR' ? 'Backend senkronizasyonu bekleniyor' : 'Pending backend sync'}</p>}
      <button onClick={onGoToRoom} className="w-full bg-[#1a1a1f] hover:bg-[#222] text-white text-xs font-bold py-2 rounded-lg border border-[#333]">
        {lang === 'TR' ? 'Odaya Git →' : 'Go to Room →'}
      </button>
    </div>
  );
};

export default OperationTradeCard;
