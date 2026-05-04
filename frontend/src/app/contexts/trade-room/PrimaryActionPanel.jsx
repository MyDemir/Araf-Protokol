import React from 'react';

const PRIMARY_HANDLER_BY_KEY = {
  report_payment: 'handleReportPayment',
  release_funds: 'handleRelease',
  start_challenge: 'handleChallenge',
  settlement_actions: 'proposeSettlement',
};

export const PrimaryActionPanel = ({ primaryAction, actionHandlers = {}, disabledReasons = [] }) => {
  if (!primaryAction) return null;
  const handlerName = PRIMARY_HANDLER_BY_KEY[primaryAction.key];
  const onClick = handlerName ? actionHandlers?.[handlerName] : null;
  const isDisabled = !onClick || disabledReasons.length > 0;

  if (!handlerName) {
    return <div className="mb-2 text-[11px] text-slate-500">Primary: {primaryAction.key}</div>;
  }

  return (
    <div className="mb-2">
      <button
        onClick={() => {
          if (isDisabled) return;
          onClick();
        }}
        disabled={isDisabled}
        className={`w-full py-2 rounded-lg text-xs font-bold border ${isDisabled ? 'bg-[#1a1a1f] text-slate-500 border-[#333] cursor-not-allowed' : 'bg-blue-600/20 text-blue-300 border-blue-500/30 hover:bg-blue-500 hover:text-white'}`}
      >
        Primary: {primaryAction.key}
      </button>
      {disabledReasons.length > 0 && (
        <p className="text-[10px] text-slate-500 mt-1">{disabledReasons[0]}</p>
      )}
    </div>
  );
};

export default PrimaryActionPanel;
