import React from 'react';
import OperationTradeCard from './OperationTradeCard';

export const SettlementQueueCard = ({ escrow, lang, onGoToRoom }) => {
  return <OperationTradeCard escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />;
};

export default SettlementQueueCard;
