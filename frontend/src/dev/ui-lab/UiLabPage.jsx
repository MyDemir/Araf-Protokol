import React from 'react';
import AdminPanel from '../../AdminPanel';
import TradeRoomPage from '../../app/contexts/trade-room/TradeRoomPage';
import OperationsCenterPage from '../../app/contexts/operations/OperationsCenterPage';
import ActiveTradesPanel from '../../app/contexts/profile/ActiveTradesPanel';
import { createMockAdminFetch } from '../mocks/mockAdminFetch';
import { createSetterAction, createTradeRoomActionCallbacks } from '../mocks/mockActions';
import { findScenario, scenarioCategories } from './scenarioRegistry';
import ScenarioActionLog from './ScenarioActionLog';
import ScenarioSelector from './ScenarioSelector';
import ScenarioShell from './ScenarioShell';

const appendEntry = (setActionLog) => (entry) => setActionLog((prev) => [entry, ...prev].slice(0, 30));

const useUiLabScenarioState = () => {
  const [activeCategoryKey, setActiveCategoryKey] = React.useState(scenarioCategories[0].key);
  const [activeScenarioId, setActiveScenarioId] = React.useState(scenarioCategories[0].scenarios[0].id);

  const activeCategory = scenarioCategories.find((category) => category.key === activeCategoryKey) || scenarioCategories[0];
  const activeScenario = findScenario(activeCategory.key, activeScenarioId);

  const selectCategory = (categoryKey) => {
    const category = scenarioCategories.find((item) => item.key === categoryKey) || scenarioCategories[0];
    setActiveCategoryKey(category.key);
    setActiveScenarioId(category.scenarios[0]?.id || '');
  };

  return { activeCategory, activeCategoryKey, activeScenario, activeScenarioId, selectCategory, setActiveScenarioId };
};

const TradeRoomPreview = ({ scenario, lang, onLog }) => {
  const decisionInput = React.useMemo(() => ({ ...scenario.decisionInput, lang }), [scenario, lang]);
  const actionCallbacks = React.useMemo(() => createTradeRoomActionCallbacks({ scenarioId: scenario.id, appendLog: onLog }), [scenario.id, onLog]);
  return <TradeRoomPage decisionInput={decisionInput} actionCallbacks={actionCallbacks} />;
};

const OperationsPreview = ({ scenario, lang, onLog }) => {
  const setter = (key) => createSetterAction({ scenarioId: scenario.id, appendLog: onLog, actionKey: key });
  return (
    <OperationsCenterPage
      activeEscrows={scenario.activeEscrows}
      activeEscrowCounts={scenario.activeEscrowCounts}
      activeTrade={null}
      address={scenario.address}
      lang={lang}
      setActiveTrade={setter('setActiveTrade')}
      setUserRole={setter('setUserRole')}
      setTradeState={setter('setTradeState')}
      setChargebackAccepted={setter('setChargebackAccepted')}
      setCurrentView={setter('go_to_room')}
      setSidebarOpen={setter('setSidebarOpen')}
      setShowProfileModal={setter('setShowProfileModal')}
    />
  );
};

const ActiveTradesPreview = ({ scenario, lang, onLog }) => {
  const [filter, setFilter] = React.useState(scenario.initialFilter || 'ALL');
  React.useEffect(() => setFilter(scenario.initialFilter || 'ALL'), [scenario.id, scenario.initialFilter]);
  const setter = (key) => createSetterAction({ scenarioId: scenario.id, appendLog: onLog, actionKey: key });
  const setLoggedFilter = (nextFilter) => {
    setFilter(nextFilter);
    setter('setActiveTradesFilter')(nextFilter);
  };

  return (
    <div className="w-full max-w-[700px]">
      <ActiveTradesPanel
        lang={lang}
        activeTradesFilter={filter}
        setActiveTradesFilter={setLoggedFilter}
        activeEscrows={scenario.activeEscrows}
        setActiveTrade={setter('setActiveTrade')}
        setUserRole={setter('setUserRole')}
        setTradeState={setter('setTradeState')}
        setChargebackAccepted={setter('setChargebackAccepted')}
        setCurrentView={setter('go_to_room')}
        setShowProfileModal={setter('setShowProfileModal')}
      />
      {scenario.activeEscrows.length === 0 && (
        <div className="bg-surface border border-borderSubtle rounded-xl p-4 text-sm text-textSecondary">
          {lang === 'TR' ? 'Aktif işlem bulunmuyor.' : 'No active trades in this scenario.'}
        </div>
      )}
    </div>
  );
};

const AdminPreview = ({ scenario, lang, onLog }) => {
  const authenticatedFetch = React.useMemo(() => createMockAdminFetch(scenario), [scenario]);
  const containerRef = React.useRef(null);
  React.useEffect(() => {
    const tab = scenario.initialTab || 'overview';
    onLog({ actionKey: `admin_tab:${tab}`, scenarioId: scenario.id, timestamp: new Date().toISOString(), details: {} });
    const tabLabel = tab === 'overview' ? 'Overview' : tab === 'sync' ? 'Sync' : tab === 'feedback' ? 'Feedback' : tab === 'trades' ? 'Trades' : 'Settlement';
    const timer = window.setTimeout(() => {
      const button = Array.from(containerRef.current?.querySelectorAll('button') || []).find((node) => node.textContent?.trim() === tabLabel);
      if (button && tab !== 'overview') button.click();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [scenario.id, scenario.initialTab, onLog]);

  return (
    <div ref={containerRef} className="w-full" data-ui-lab-admin-initial-tab={scenario.initialTab || 'overview'}>
      <AdminPanel
        key={scenario.id}
        lang={lang}
        authenticatedFetch={authenticatedFetch}
        isAuthenticated={true}
        authChecked={true}
        showToast={(message, tone) => onLog({ actionKey: 'showToast', scenarioId: scenario.id, timestamp: new Date().toISOString(), details: { message, tone } })}
      />
    </div>
  );
};

const renderScenario = ({ scenario, categoryKey, lang, onLog }) => {
  if (categoryKey === 'tradeRoom') return <TradeRoomPreview scenario={scenario} lang={lang} onLog={onLog} />;
  if (categoryKey === 'operations') return <OperationsPreview scenario={scenario} lang={lang} onLog={onLog} />;
  if (categoryKey === 'activeTrades') return <ActiveTradesPreview scenario={scenario} lang={lang} onLog={onLog} />;
  if (categoryKey === 'admin') return <AdminPreview scenario={scenario} lang={lang} onLog={onLog} />;
  return null;
};

export const UiLabPage = () => {
  const { activeCategory, activeCategoryKey, activeScenario, activeScenarioId, selectCategory, setActiveScenarioId } = useUiLabScenarioState();
  const [lang, setLang] = React.useState('EN');
  const [actionLog, setActionLog] = React.useState([]);
  const onLog = React.useMemo(() => appendEntry(setActionLog), []);

  React.useEffect(() => setActionLog([]), [activeScenario?.id]);

  return (
    <div className="w-full max-w-[1400px] px-4 md:px-8" data-testid="ui-lab-page">
      <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-textPrimary">🧪 Scenario Preview / UI Lab</h1>
          <p className="text-sm text-textSecondary">Dev-only fixture preview. No wallet, backend, or contract calls are made.</p>
        </div>
        <label className="text-sm text-textSecondary flex items-center gap-2">
          Lang
          <select value={lang} onChange={(event) => setLang(event.target.value)} className="bg-surface border border-borderStrong rounded-lg px-3 py-2 text-textPrimary">
            <option value="EN">EN</option>
            <option value="TR">TR</option>
          </select>
        </label>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-start">
        <ScenarioSelector
          categories={scenarioCategories}
          activeCategoryKey={activeCategoryKey}
          activeScenarioId={activeScenarioId}
          onSelectCategory={selectCategory}
          onSelectScenario={setActiveScenarioId}
        />
        <main className="flex-1 min-w-0 space-y-4">
          <ScenarioShell title={`${activeCategory.label}: ${activeScenario.label}`} description={`Scenario id: ${activeScenario.id}`}>
            {renderScenario({ scenario: activeScenario, categoryKey: activeCategory.key, lang, onLog })}
          </ScenarioShell>
          <ScenarioActionLog entries={actionLog} />
        </main>
      </div>
    </div>
  );
};

export default UiLabPage;
