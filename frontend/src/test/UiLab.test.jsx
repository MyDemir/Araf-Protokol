import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DevScenarioController from '../dev/ui-lab/DevScenarioController';
import { isUiLabEnabled } from '../dev/ui-lab/isUiLabEnabled';
import { scenarioRegistry } from '../dev/ui-lab/scenarioRegistry';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('UI Lab gate', () => {
  it('does not enable when DEV and VITE_ENABLE_UI_LAB are false', () => {
    expect(isUiLabEnabled({ DEV: false, PROD: false, VITE_ENABLE_UI_LAB: 'false' })).toBe(false);
  });

  it('enables outside production when DEV or VITE_ENABLE_UI_LAB is true', () => {
    expect(isUiLabEnabled({ DEV: true, PROD: false, VITE_ENABLE_UI_LAB: 'false' })).toBe(true);
    expect(isUiLabEnabled({ DEV: false, PROD: false, VITE_ENABLE_UI_LAB: 'true' })).toBe(true);
  });

  it('keeps regular production builds disabled without the explicit flag', () => {
    expect(isUiLabEnabled({ DEV: false, PROD: true, VITE_ENABLE_UI_LAB: 'false' })).toBe(false);
  });

  it('allows the explicit UI Lab flag in preview/production-mode builds', () => {
    expect(isUiLabEnabled({ DEV: false, PROD: true, VITE_ENABLE_UI_LAB: 'true' })).toBe(true);
    expect(isUiLabEnabled({ DEV: true, PROD: true, VITE_ENABLE_UI_LAB: 'true' })).toBe(true);
  });
});

describe('scenario registry', () => {
  it('contains required Trade Room maker/taker state combinations', () => {
    const ids = scenarioRegistry.tradeRoom.scenarios.map((scenario) => scenario.id);
    expect(ids).toEqual(expect.arrayContaining(['locked-taker', 'locked-maker', 'paid-taker', 'paid-maker', 'challenged-taker', 'challenged-maker']));
  });

  it('contains required Operations and Admin scenarios', () => {
    expect(scenarioRegistry.operations.scenarios.map((scenario) => scenario.id)).toEqual(expect.arrayContaining(['pending_backend_sync', 'settlement_action_required']));
    expect(scenarioRegistry.admin.scenarios.map((scenario) => scenario.id)).toEqual(expect.arrayContaining(['unauthorized-403', 'overview-degraded']));
  });
});

describe('Dev scenario controller', () => {
  it('applies Active Trades scenarios through controller without rendering a preview shell', async () => {
    const onApplyScenario = vi.fn();
    render(<DevScenarioController onApplyScenario={onApplyScenario} />);
    fireEvent.click(screen.getByRole('button', { name: /Open dev scenario controller/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Active Trades' }));
    fireEvent.click(screen.getByRole('button', { name: 'CHALLENGED filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to real App view' }));

    await waitFor(() => expect(onApplyScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'active-trades-challenged',
        initialFilter: 'CHALLENGED',
        categoryKey: 'activeTrades',
        appendLog: expect.any(Function),
      }),
    ));
    expect(screen.queryByTestId('ui-lab-scenario-shell')).not.toBeInTheDocument();
  });
});
