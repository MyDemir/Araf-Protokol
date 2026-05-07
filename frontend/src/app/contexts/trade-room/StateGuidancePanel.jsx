import React from 'react';

export const StateGuidancePanel = ({ guidance = [], riskCopy }) => {
  if (!guidance.length && !riskCopy) return null;
  return (
    <div className="mb-3 bg-[#101014] border border-[#222] rounded-xl p-3 text-xs text-slate-300 space-y-1" data-testid="trade-guidance-panel">
      {guidance.map((g, i) => <p key={i}>{g}</p>)}
      {riskCopy?.chargeback && <p className="text-slate-500">{riskCopy.chargeback}</p>}
      {riskCopy?.settlement && <p className="text-slate-500">{riskCopy.settlement}</p>}
    </div>
  );
};

export default StateGuidancePanel;
