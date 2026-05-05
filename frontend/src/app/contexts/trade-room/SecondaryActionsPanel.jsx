import React from 'react';
import { PrimaryActionPanel } from './PrimaryActionPanel';

export const SecondaryActionsPanel = ({ secondaryActions = [], actionHandlers = {}, disabledReason = null, lang = 'EN', roomState, userRole }) => {
  const filtered = secondaryActions.filter((a) => {
    if (a.key === 'burn_expired') return false;
    if (roomState === 'PAID' && userRole === 'taker' && (a.key === 'ping_maker' || a.key === 'auto_release')) return false;
    return true;
  });
  if (!filtered.length) return null;
  return (
    <div className="space-y-2">
      {filtered.map((a) => (
        <PrimaryActionPanel key={a.key} primaryAction={a} actionHandlers={actionHandlers} disabledReason={disabledReason} lang={lang} />
      ))}
    </div>
  );
};

export default SecondaryActionsPanel;
