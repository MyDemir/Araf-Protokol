import React from 'react';
import { buildGoToTradeRoomAction } from '../../actions/tradeNavigationActions';
import { getStateLabel } from '../../copy/states';
import OperationTradeCard, { compareActiveTradePriority } from '../operations/OperationTradeCard';

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
  const filteredEscrows = (activeTradesFilter === 'ALL' ? activeEscrows : activeEscrows.filter((e) => e.state === activeTradesFilter))
    .slice()
    .sort(compareActiveTradePriority);
  const getFilterCount = (filter) => {
    if (filter === 'ALL') return activeEscrows.length;
    return activeEscrows.filter((escrow) => escrow.state === filter).length;
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {ACTIVE_TRADE_FILTERS.map((f) => (
          <button key={f} onClick={() => setActiveTradesFilter(f)} className={`px-2 py-1 rounded text-xs ${activeTradesFilter === f ? 'bg-elevated text-textPrimary border border-borderStrong' : 'bg-surface text-textSecondary border border-borderSubtle'}`}>
            <span>{getStateLabel(f, lang)}</span>
            <span className="ml-1 text-textMuted">{getFilterCount(f)}</span>
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {filteredEscrows.length === 0 && (
          <p className="text-xs text-textMuted italic border border-borderSubtle rounded-xl p-3 bg-surface">
            {lang === 'TR' ? 'Bu durumda aktif işlem yok.' : 'No active trades in this state.'}
          </p>
        )}
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
