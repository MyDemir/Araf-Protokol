import React from 'react';
import { ActionGuidanceButton } from './PrimaryActionPanel';

export const SecondaryActionsPanel = ({ secondaryActions = [], actionCallbacks, disabledReasons = [] }) => {
  if (!secondaryActions.length) return null;
  return (
    <div className="mb-3 bg-[#0f1014] border border-[#222] rounded-xl p-3 text-[11px] text-slate-400 space-y-3" data-testid="trade-secondary-guidance">
      <p className="text-slate-500 font-bold uppercase tracking-wide text-[10px]">Additional guidance</p>
      {secondaryActions.map((action) => (
        <div key={action.key}>
          <p>{action.description || action.key}</p>
          <ActionGuidanceButton action={action} actionCallbacks={actionCallbacks} disabledReasons={disabledReasons} />
        </div>
      ))}
    </div>
  );
};

export default SecondaryActionsPanel;
