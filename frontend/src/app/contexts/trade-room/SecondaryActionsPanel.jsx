import React from 'react';

export const SecondaryActionsPanel = ({ secondaryActions = [] }) => {
  if (!secondaryActions.length) return null;
  return (
    <div className="mb-2 text-[11px] text-slate-600">{secondaryActions.map((a) => a.key).join(' · ')}</div>
  );
};

export default SecondaryActionsPanel;
