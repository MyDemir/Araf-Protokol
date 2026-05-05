import React from 'react';
import OperationTradeCard from './OperationTradeCard';

export const SettlementQueueCard = ({ escrow, lang, onGoToRoom, isWaiting = false }) => {
  return (
    <div className="space-y-1">
      <div className={`text-[10px] px-2 py-0.5 rounded border inline-flex ${isWaiting ? 'text-sky-400 border-sky-500/30' : 'text-orange-400 border-orange-500/30'}`}>
        {isWaiting ? (lang === 'TR' ? 'Bekleniyor' : 'Waiting') : (lang === 'TR' ? 'Aksiyon Gerekli' : 'Action Required')}
      </div>
      <OperationTradeCard escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />
    </div>
  );
};

export default SettlementQueueCard;
