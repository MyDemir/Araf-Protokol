import React from 'react';

export const StateGuidancePanel = ({ guidance = [] }) => {
  if (!guidance.length) return null;
  return (
    <div className="mb-3 bg-[#101014] border border-[#222] rounded-xl p-3 text-xs text-slate-300 space-y-1">
      {guidance.map((g, i) => <p key={i}>{g}</p>)}
    </div>
  );
};

export default StateGuidancePanel;
