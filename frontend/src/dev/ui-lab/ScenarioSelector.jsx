import React from 'react';

export const ScenarioSelector = ({ categories, activeCategoryKey, activeScenarioId, onSelectCategory, onSelectScenario }) => (
  <aside className="w-full md:w-72 min-w-0 md:shrink-0 bg-surface border border-borderSubtle rounded-xl p-3" data-testid="ui-lab-selector">
    <p className="text-xs font-bold uppercase tracking-wide text-textMuted mb-3">Scenario categories</p>
    <div className="space-y-3">
      {categories.map((category) => (
        <div key={category.key}>
          <button
            type="button"
            onClick={() => onSelectCategory(category.key)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold border ${activeCategoryKey === category.key ? 'bg-elevated border-borderStrong text-textPrimary' : 'border-borderSubtle text-textSecondary hover:text-textPrimary'}`}
          >
            {category.label}
          </button>
          {activeCategoryKey === category.key && (
            <div className="mt-2 space-y-1 pl-2">
              {category.scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => onSelectScenario(scenario.id)}
                  className={`w-full text-left px-3 py-1.5 rounded text-xs ${activeScenarioId === scenario.id ? 'bg-emerald-900/30 text-emerald-300' : 'text-textSecondary hover:bg-elevated/60'}`}
                >
                  {scenario.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  </aside>
);

export default ScenarioSelector;
