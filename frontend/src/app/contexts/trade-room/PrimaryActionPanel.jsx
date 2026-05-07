import React from 'react';

const EXECUTABLE_ACTION_TYPES = new Set(['contract', 'conditional']);

const resolveActionConfig = (action, actionCallbacks) => {
  const config = actionCallbacks?.[action?.key];
  if (!config) return null;
  if (typeof config === 'function') return { onClick: config };
  return config;
};

export const ActionGuidanceButton = ({ action, actionCallbacks, disabledReasons = [] }) => {
  const config = resolveActionConfig(action, actionCallbacks);
  if (!action || !config || !EXECUTABLE_ACTION_TYPES.has(action.type)) return null;

  const actionDisabledReasons = config.disabledReasons || [];
  const allDisabledReasons = [...disabledReasons, ...actionDisabledReasons].filter(Boolean);
  const isDisabled = Boolean(config.disabled || allDisabledReasons.length);
  const label = config.label || action.label || action.key;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={config.onClick}
        disabled={isDisabled}
        className={`w-full px-4 py-2 rounded-lg font-bold transition ${isDisabled ? 'bg-[#1a1a1f] text-slate-500 border border-[#2a2a2e] cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
      >
        {label}
      </button>
      {allDisabledReasons.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-[11px] text-amber-300 space-y-0.5">
          {allDisabledReasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
    </div>
  );
};

export const PrimaryActionPanel = ({ primaryAction, disabledReasons = [], actionCallbacks }) => {
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
      <ActionGuidanceButton action={primaryAction} actionCallbacks={actionCallbacks} disabledReasons={disabledReasons} />
    </div>
  );
};

export default PrimaryActionPanel;
