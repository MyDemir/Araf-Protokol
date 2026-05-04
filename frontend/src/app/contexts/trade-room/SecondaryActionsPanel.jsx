import React from 'react';

const SECONDARY_HANDLER_BY_KEY = {
  start_challenge: 'handleChallenge',
  ping_maker: 'handlePingMaker',
  auto_release: 'handleAutoRelease',
  reject_or_withdraw: 'rejectSettlement',
  burn_or_expire: 'burnExpired',
};

export const SecondaryActionsPanel = ({ secondaryActions = [], actionHandlers = {}, disabledReasons = [] }) => {
  if (!secondaryActions.length) return null;
  return (
    <div className="mb-2 flex flex-col gap-1">
      {secondaryActions.map((action) => {
        const handlerName = SECONDARY_HANDLER_BY_KEY[action.key];
        const onClick = handlerName ? actionHandlers?.[handlerName] : null;
        const isDisabled = !onClick || disabledReasons.length > 0;
        return (
          <button
            key={action.key}
            onClick={() => {
              if (isDisabled) return;
              onClick();
            }}
            disabled={isDisabled}
            className={`w-full py-2 rounded-lg text-[11px] font-bold border ${isDisabled ? 'bg-[#1a1a1f] text-slate-500 border-[#333] cursor-not-allowed' : 'bg-[#101014] text-slate-300 border-[#333] hover:bg-[#222]'}`}
          >
            {action.key}
          </button>
        );
      })}
      {disabledReasons.length > 0 && <p className="text-[10px] text-slate-500">{disabledReasons[0]}</p>}
    </div>
  );
};

export default SecondaryActionsPanel;
