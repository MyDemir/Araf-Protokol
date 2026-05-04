import React from 'react';
import { PrimaryActionPanel } from './PrimaryActionPanel';

export const SecondaryActionsPanel = ({ secondaryActions = [], actionHandlers = {}, disabledReason = null, lang = 'EN' }) => {
  if (!secondaryActions.length) return null;
  return (
    <div className="space-y-2">
      {secondaryActions.map((a) => (
        <PrimaryActionPanel key={a.key} primaryAction={a} actionHandlers={actionHandlers} disabledReason={disabledReason} lang={lang} />
      ))}
    </div>
  );
};

export default SecondaryActionsPanel;
