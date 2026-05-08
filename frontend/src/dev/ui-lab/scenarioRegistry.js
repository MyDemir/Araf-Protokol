import { tradeRoomScenarios } from '../fixtures/tradeRoomFixtures';
import { operationsScenarios } from '../fixtures/operationsFixtures';
import { activeTradesScenarios } from '../fixtures/activeTradesFixtures';
import { adminScenarios } from '../fixtures/adminFixtures';

export const scenarioCategories = [
  { key: 'tradeRoom', label: 'Trade Room', scenarios: tradeRoomScenarios },
  { key: 'operations', label: 'Operations Center', scenarios: operationsScenarios },
  { key: 'activeTrades', label: 'Active Trades', scenarios: activeTradesScenarios },
  { key: 'admin', label: 'Admin', scenarios: adminScenarios },
];

export const scenarioRegistry = Object.fromEntries(scenarioCategories.map((category) => [category.key, category]));

export const findScenario = (categoryKey, scenarioId) => {
  const category = scenarioRegistry[categoryKey] || scenarioCategories[0];
  return category.scenarios.find((scenario) => scenario.id === scenarioId) || category.scenarios[0];
};
