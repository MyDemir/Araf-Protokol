import React from 'react';

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

export default TimerStack;
