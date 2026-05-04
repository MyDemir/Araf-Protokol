import React from 'react';

export const TimerStack = ({ timerCards }) => {
  if (!timerCards || Object.keys(timerCards).length === 0) return null;
  return <div className="mb-2 text-[11px] text-slate-600">⏱️</div>;
};

export default TimerStack;
