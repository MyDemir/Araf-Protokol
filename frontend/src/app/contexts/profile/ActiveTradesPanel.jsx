import React from 'react';
import { buildGoToTradeRoomAction } from '../../actions/tradeNavigationActions';
import { getStateLabel } from '../../copy/states';
import OperationTradeCard from '../operations/OperationTradeCard';

const ACTIVE_TRADE_FILTERS = ['ALL', 'LOCKED', 'PAID', 'CHALLENGED'];

export const ActiveTradesPanel = ({
  lang,
  activeTradesFilter,
  setActiveTradesFilter,
  activeEscrows = [],
  setActiveTrade,
  setUserRole,
  setTradeState,
  setChargebackAccepted,
  setCurrentView,
  setShowProfileModal,
}) => {
  const filteredEscrows = activeTradesFilter === 'ALL' ? activeEscrows : activeEscrows.filter((e) => e.state === activeTradesFilter);
  const getFilterCount = (filter) => {
    if (filter === 'ALL') return activeEscrows.length;
    return activeEscrows.filter((escrow) => escrow.state === filter).length;
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {ACTIVE_TRADE_FILTERS.map((f) => (
          <button key={f} onClick={() => setActiveTradesFilter(f)} className={`px-2 py-1 rounded text-xs ${activeTradesFilter === f ? 'bg-[#222] text-white' : 'bg-[#101014] text-slate-400'}`}>
            <span>{getStateLabel(f, lang)}</span>
            <span className="ml-1 text-slate-500">{getFilterCount(f)}</span>
          </button>
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
