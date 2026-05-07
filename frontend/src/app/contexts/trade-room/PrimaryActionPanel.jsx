import React from 'react';

const t = (lang, tr, en) => (lang === 'TR' ? tr : en);

const EXECUTABLE_ACTION_TYPES = new Set(['contract', 'conditional']);

const resolveActionConfig = (action, actionCallbacks) => {
  const config = actionCallbacks?.[action?.key];
  if (!config) return null;
  if (typeof config === 'function') return { onClick: config };
  return config;
};

export const ActionGuidanceButton = ({ action, actionCallbacks, disabledReasons = [], variant = 'primary' }) => {
  const config = resolveActionConfig(action, actionCallbacks);
  if (!action || !config || !EXECUTABLE_ACTION_TYPES.has(action.type)) return null;

  const actionDisabledReasons = config.disabledReasons || [];
  const allDisabledReasons = [...disabledReasons, ...actionDisabledReasons].filter(Boolean);
  const isDisabled = Boolean(config.disabled || allDisabledReasons.length);
  const label = config.label || action.label || action.key;

  const enabledClass = variant === 'secondary'
    ? 'bg-elevated hover:bg-surface text-textPrimary border border-borderStrong'
    : 'bg-emerald-600 hover:bg-emerald-500 text-white';

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={config.onClick}
        disabled={isDisabled}
        className={`w-full px-4 py-2.5 rounded-lg font-bold transition ${isDisabled ? 'bg-elevated text-textMuted border border-borderStrong cursor-not-allowed' : enabledClass}`}
      >
        {label}
      </button>
      {allDisabledReasons.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-xs text-amber-300 space-y-0.5">
          {allDisabledReasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
    </div>
  );
};

export const PrimaryActionPanel = ({ primaryAction, disabledReasons = [], actionCallbacks, lang = 'EN' }) => {
  if (!primaryAction && !disabledReasons.length) return null;
  return (
    <div className="mb-3 bg-surface border border-borderSubtle rounded-xl p-4 text-sm text-textSecondary" data-testid="trade-primary-guidance">
      {primaryAction?.description && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand">{t(lang, 'Şimdi yapılacak işlem', 'What to do now')}</p>
          <p className="mt-1 text-sm leading-relaxed text-textPrimary">{primaryAction.description}</p>
        </div>
      )}
      {disabledReasons.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/10 p-3 text-amber-300">
          <p className="font-bold uppercase tracking-wide text-xs">{t(lang, 'Önce bunlar gerekli', 'Required first')}</p>
          <ul className="mt-1 list-disc pl-4 space-y-0.5 text-xs">
            {disabledReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}
      <ActionGuidanceButton action={primaryAction} actionCallbacks={actionCallbacks} disabledReasons={disabledReasons} />
    </div>
  );
};

export default PrimaryActionPanel;
