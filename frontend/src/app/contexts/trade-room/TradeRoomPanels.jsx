import React from 'react';

export const TradeSummaryCard = ({ stateLabel, roleLabel }) => (
  <div className="mb-3 bg-[#101014] border border-[#222] rounded-xl p-3 text-xs text-slate-300">
    <p>State: <span className="text-white">{stateLabel}</span></p>
    <p>Role: <span className="text-white">{roleLabel}</span></p>
  </div>
);

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

export const TimerStack = ({ timerCards = [] }) => {
  if (!Array.isArray(timerCards) || timerCards.length === 0) return null;
  return (
    <div className="mb-3 bg-[#0f1014] border border-[#222] rounded-xl p-3 text-[11px] text-slate-400" data-testid="trade-timer-summaries">
      <p className="text-slate-500 font-bold uppercase tracking-wide text-[10px] mb-2">Timer summaries</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {timerCards.map((timer) => (
          <div key={timer.key} className="flex justify-between gap-3 bg-[#0a0a0c] border border-[#1f1f24] rounded-lg px-2 py-1.5">
            <span>{timer.label}</span>
            <span className="font-mono text-slate-200">{timer.summary}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const TechnicalDetailsDisclosure = ({ technicalDetails }) => {
  if (!technicalDetails) return null;
  return (
    <details className="mb-3 text-[11px] text-slate-500">
      <summary className="cursor-pointer">Technical details</summary>
      <pre className="mt-2 bg-[#101014] border border-[#222] rounded-lg p-2 overflow-auto">{JSON.stringify(technicalDetails, null, 2)}</pre>
    </details>
  );
};
