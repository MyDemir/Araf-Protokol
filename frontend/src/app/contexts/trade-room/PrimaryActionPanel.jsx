import React from 'react';

export const PrimaryActionPanel = ({ primaryAction }) => {
  if (!primaryAction) return null;
  return (
    <div className="mb-2 text-[11px] text-slate-500">Primary: {primaryAction.key}</div>
  );
};

export default PrimaryActionPanel;
