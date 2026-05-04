import React from 'react';

export const TradeSummaryCard = ({ stateLabel, roleLabel }) => (
  <div className="mb-3 bg-[#101014] border border-[#222] rounded-xl p-3 text-xs text-slate-300">
    <p>State: <span className="text-white">{stateLabel}</span></p>
    <p>Role: <span className="text-white">{roleLabel}</span></p>
  </div>
);

export default TradeSummaryCard;
