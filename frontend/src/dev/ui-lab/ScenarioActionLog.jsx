import React from 'react';

export const ScenarioActionLog = ({ entries = [] }) => (
  <aside className="bg-surface border border-borderSubtle rounded-xl p-3 text-xs text-textSecondary" data-testid="ui-lab-action-log">
    <p className="font-bold text-textPrimary mb-2">Action log</p>
    {entries.length === 0 ? (
      <p className="text-textMuted">No mock actions yet.</p>
    ) : (
      <div className="space-y-1 max-h-48 overflow-auto">
        {entries.map((entry, index) => (
          <div key={`${entry.timestamp}-${index}`} className="font-mono rounded bg-elevated border border-borderSubtle p-2">
            <span className="text-brand">{entry.actionKey}</span>
            <span className="text-textMuted"> · {entry.scenarioId} · {entry.timestamp}</span>
          </div>
        ))}
      </div>
    )}
  </aside>
);

export default ScenarioActionLog;
