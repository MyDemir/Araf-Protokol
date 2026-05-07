import React from 'react';
import OperationTradeCard from './OperationTradeCard';

export const PendingSyncCard = ({ escrow, lang, onGoToRoom }) => {
  return (
    <div className="rounded-xl border border-sky-500/40 bg-sky-950/10 p-2" data-testid="pending-sync-card">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-sky-300">
        {lang === 'TR' ? 'Backend senkron bekliyor' : 'Pending backend sync'}
      </p>
      <OperationTradeCard escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />
    </div>
  );
};

export default PendingSyncCard;
