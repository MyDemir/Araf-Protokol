import React from 'react';

export const SecondaryActionsPanel = ({ secondaryActions = [] }) => {
  if (!secondaryActions.length) return null;
  return (
    <div className="mb-3 bg-[#0f1014] border border-[#222] rounded-xl p-3 text-[11px] text-slate-400 space-y-1" data-testid="trade-secondary-guidance">
      <p className="text-slate-500 font-bold uppercase tracking-wide text-[10px]">Additional guidance</p>
      {secondaryActions.map((action) => <p key={action.key}>{action.description || action.key}</p>)}
    </div>
  );
};

export default SecondaryActionsPanel;
