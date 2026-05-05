import React from 'react';
import { PrimaryActionPanel } from './PrimaryActionPanel';

export const SecondaryActionsPanel = ({ secondaryActions = [], actionHandlers = {}, disabledReason = null, lang = 'EN' }) => {
  const filtered = secondaryActions.filter((a) => a.key !== 'burn_expired');
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
