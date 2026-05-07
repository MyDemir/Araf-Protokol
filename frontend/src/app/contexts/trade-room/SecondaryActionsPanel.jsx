import React from 'react';
import { ActionGuidanceButton } from './PrimaryActionPanel';

const t = (lang, tr, en) => (lang === 'TR' ? tr : en);

export const SecondaryActionsPanel = ({ secondaryActions = [], actionCallbacks, disabledReasons = [], lang = 'EN' }) => {
  if (!secondaryActions.length) return null;
  return (
    <div className="mb-3 bg-surface border border-borderSubtle rounded-xl p-3 text-sm text-textSecondary space-y-3" data-testid="trade-secondary-guidance">
      <p className="text-textMuted font-bold uppercase tracking-wide text-xs">{t(lang, 'Diğer seçenekler', 'Other available paths')}</p>
      {secondaryActions.map((action) => (
        <div key={action.key}>
          <p>{action.description || action.key}</p>
          <ActionGuidanceButton action={action} actionCallbacks={actionCallbacks} disabledReasons={disabledReasons} variant="secondary" />
        </div>
      ))}
    </div>
  );
};

export default SecondaryActionsPanel;
