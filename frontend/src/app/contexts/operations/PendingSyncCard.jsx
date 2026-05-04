import React from 'react';
import OperationTradeCard from './OperationTradeCard';

export const PendingSyncCard = ({ escrow, lang, onGoToRoom }) => {
  return <OperationTradeCard escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />;
};

export default PendingSyncCard;
