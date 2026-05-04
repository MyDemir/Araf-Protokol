import React from 'react';
import OperationTradeCard from './OperationTradeCard';
import SettlementQueueCard from './SettlementQueueCard';
import PendingSyncCard from './PendingSyncCard';

export const OperationsContextPanel = ({ lane, lang = 'EN', onGoToRoomForEscrow }) => {
  if (!lane) return null;
  return (
    <div className="space-y-2">
      {lane.items.map((item, idx) => {
        const escrow = item.escrow;
        const onGoToRoom = onGoToRoomForEscrow(escrow);
        if (lane.key === 'settlement_action_required' || lane.key === 'settlement_waiting') {
          return <SettlementQueueCard key={`${lane.key}-${idx}`} escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />;
        }
        if (lane.key === 'pending_backend_sync') {
          return <PendingSyncCard key={`${lane.key}-${idx}`} escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />;
        }
        return <OperationTradeCard key={`${lane.key}-${idx}`} escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />;
      })}
    </div>
  );
};

export default OperationsContextPanel;
