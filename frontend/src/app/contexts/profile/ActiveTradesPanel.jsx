import React from 'react';
import { buildGoToTradeRoomAction } from '../../actions/tradeNavigationActions';

export const ActiveTradesPanel = ({
  lang,
  activeTradesFilter,
  setActiveTradesFilter,
  activeEscrows,
  setActiveTrade,
  setUserRole,
  setTradeState,
  setChargebackAccepted,
  setCurrentView,
  setShowProfileModal,
}) => {
  const filteredEscrows = activeTradesFilter === 'ALL' ? activeEscrows : activeEscrows.filter((e) => e.state === activeTradesFilter);
  return (
    <div>
      <div className="flex gap-2 mb-3">
        {['ALL', 'LOCKED', 'PAID', 'CHALLENGED'].map((f) => (
          <button key={f} onClick={() => setActiveTradesFilter(f)} className={`px-2 py-1 rounded text-xs ${activeTradesFilter === f ? 'bg-[#222] text-white' : 'bg-[#101014] text-slate-400'}`}>{f}</button>
        ))}
      </div>
      <div className="space-y-2">
        {filteredEscrows.map((escrow, index) => (
          <div key={`${escrow.id}-${index}`} className="bg-[#101014] border border-[#222] rounded-xl p-3">
            <p className="text-sm text-white">{escrow.id} · {escrow.state}</p>
            <button onClick={buildGoToTradeRoomAction({ escrow, setActiveTrade, setUserRole, setTradeState, setChargebackAccepted, setCurrentView, setShowProfileModal })} className="mt-2 w-full bg-[#1a1a1f] text-white text-xs font-bold py-2 rounded-lg border border-[#333]">
              {lang === 'TR' ? 'Odaya Git →' : 'Go to Room →'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ActiveTradesPanel;
