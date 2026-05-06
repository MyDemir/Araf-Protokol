import React from 'react';

export const PrimaryActionPanel = ({ primaryAction, disabledReasons = [] }) => {
  if (!primaryAction && !disabledReasons.length) return null;
  return (
    <div className="mb-3 bg-[#0f1014] border border-[#222] rounded-xl p-3 text-xs text-slate-300" data-testid="trade-primary-guidance">
      {primaryAction?.description && (
        <p><span className="text-slate-500">Guidance:</span> {primaryAction.description}</p>
      )}
      {disabledReasons.length > 0 && (
        <div className="mt-2 text-amber-300">
          <p className="font-bold uppercase tracking-wide text-[10px]">Disabled until</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {disabledReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PrimaryActionPanel;
