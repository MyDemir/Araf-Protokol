import React from 'react';
import { buildGoToTradeRoomAction } from '../../actions/tradeNavigationActions';
import OperationTradeCard from '../operations/OperationTradeCard';

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
          <OperationTradeCard
            key={`${escrow.id}-${index}`}
            escrow={escrow}
            lang={lang}
            onGoToRoom={buildGoToTradeRoomAction({ escrow, setActiveTrade, setUserRole, setTradeState, setChargebackAccepted, setCurrentView, setShowProfileModal })}
          />
        ))}
      </div>
    </div>
  );
};

export default ActiveTradesPanel;
