import React from 'react';
import { scenarioCategories } from './scenarioRegistry';
import ScenarioActionLog from './ScenarioActionLog';
import ScenarioSelector from './ScenarioSelector';

const appendEntry = (setActionLog) => (entry) => setActionLog((prev) => [entry, ...prev].slice(0, 30));

const firstCategory = scenarioCategories[0];

export const DevScenarioController = ({ activeScenario, onApplyScenario, onClearScenario }) => {
  const [open, setOpen] = React.useState(false);
  const [activeCategoryKey, setActiveCategoryKey] = React.useState(activeScenario?.categoryKey || firstCategory.key);
  const [activeScenarioId, setActiveScenarioId] = React.useState(activeScenario?.scenarioId || firstCategory.scenarios[0]?.id || '');
  const [actionLog, setActionLog] = React.useState([]);
  const appendLog = React.useMemo(() => appendEntry(setActionLog), []);

  React.useEffect(() => {
    if (!activeScenario) return;
    setActiveCategoryKey(activeScenario.categoryKey);
    setActiveScenarioId(activeScenario.scenarioId);
  }, [activeScenario]);

  const selectCategory = (categoryKey) => {
    const category = scenarioCategories.find((item) => item.key === categoryKey) || firstCategory;
    setActiveCategoryKey(category.key);
    setActiveScenarioId(category.scenarios[0]?.id || '');
  };

  const selectedCategory = scenarioCategories.find((category) => category.key === activeCategoryKey) || firstCategory;
  const selectedScenario = selectedCategory.scenarios.find((scenario) => scenario.id === activeScenarioId) || selectedCategory.scenarios[0];

  const applyScenario = () => {
    if (!selectedScenario) return;
    appendLog({
      actionKey: 'apply_scenario',
      scenarioId: selectedScenario.id,
      timestamp: new Date().toISOString(),
      details: { category: selectedCategory.key },
    });
    onApplyScenario?.({ ...selectedScenario, category: selectedCategory.key, categoryKey: selectedCategory.key, appendLog });
  };

  return (
    <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[90] pointer-events-none">
      <div className="flex flex-col items-end gap-3 pointer-events-auto" data-testid="dev-scenario-controller">
        {open && (
          <div className="w-[min(92vw,780px)] max-h-[78vh] overflow-y-auto bg-[#0b0b0f]/95 backdrop-blur-md border border-fuchsia-500/30 rounded-2xl shadow-2xl p-3 md:p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-fuchsia-300">Dev scenario controller</p>
                <h2 className="text-lg font-bold text-white">Scenario sandbox</h2>
                <p className="text-xs text-slate-400">Select a scenario; the real app screen receives mock state while this panel stays control-only.</p>
                {activeScenario && (
                  <p className="mt-1 text-xs text-emerald-300">Active: {activeScenario.categoryKey} / {activeScenario.scenarioId}</p>
                )}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Close UI Lab controller">&times;</button>
            </div>

            <div className="grid md:grid-cols-[18rem_1fr] gap-3">
              <ScenarioSelector
                categories={scenarioCategories}
                activeCategoryKey={activeCategoryKey}
                activeScenarioId={activeScenarioId}
                onSelectCategory={selectCategory}
                onSelectScenario={setActiveScenarioId}
              />
              <section className="bg-surface border border-borderSubtle rounded-xl p-3 min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-textMuted mb-1">Selected scenario</p>
                <h3 className="text-base font-bold text-textPrimary">{selectedCategory.label}: {selectedScenario?.label}</h3>
                <p className="text-xs text-textSecondary mt-1 break-all">Scenario id: {selectedScenario?.id}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={applyScenario} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold">
                    Apply to real App view
                  </button>
                  <button type="button" onClick={onClearScenario} className="px-4 py-2 rounded-xl border border-borderSubtle text-textSecondary hover:text-textPrimary text-sm font-bold">
                    Clear scenario
                  </button>
                </div>
                <div className="mt-4">
                  <ScenarioActionLog entries={actionLog} />
                </div>
              </section>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`h-12 px-4 rounded-full border shadow-xl font-bold text-sm transition ${activeScenario ? 'bg-fuchsia-900/70 border-fuchsia-400/50 text-fuchsia-100' : 'bg-[#111113] border-[#2a2a2e] text-slate-200 hover:text-white'}`}
          aria-label="Open dev scenario controller"
          title="Dev scenario controller"
        >
          🧪 {activeScenario ? 'Scenario active' : 'Scenarios'}
        </button>
      </div>
    </div>
  );
};

export default DevScenarioController;
