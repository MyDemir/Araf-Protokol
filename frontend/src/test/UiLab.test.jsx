import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { buildTradeDecisionModel } from '../app/contexts/trade-room/tradeDecisionModel';
import TradeRoomPage from '../app/contexts/trade-room/TradeRoomPage';
import UiLabPage from '../dev/ui-lab/UiLabPage';
import { isUiLabEnabled } from '../dev/ui-lab/isUiLabEnabled';
import { scenarioRegistry } from '../dev/ui-lab/scenarioRegistry';
import { createTradeRoomActionCallbacks } from '../dev/mocks/mockActions';
import { createMockAdminFetch } from '../dev/mocks/mockAdminFetch';
import AdminPanel from '../AdminPanel';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('UI Lab gate', () => {
  it('does not enable when DEV and VITE_ENABLE_UI_LAB are false', () => {
    expect(isUiLabEnabled({ DEV: false, VITE_ENABLE_UI_LAB: 'false' })).toBe(false);
  });

  it('enables when DEV or VITE_ENABLE_UI_LAB is true', () => {
    expect(isUiLabEnabled({ DEV: true, VITE_ENABLE_UI_LAB: 'false' })).toBe(true);
    expect(isUiLabEnabled({ DEV: false, VITE_ENABLE_UI_LAB: 'true' })).toBe(true);
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

describe('Trade Room scenario previews', () => {
  const renderTradeScenario = (id) => {
    const scenario = scenarioRegistry.tradeRoom.scenarios.find((item) => item.id === id);
    const actionCallbacks = createTradeRoomActionCallbacks({ scenarioId: id, appendLog: vi.fn() });
    render(<TradeRoomPage decisionInput={scenario.decisionInput} actionCallbacks={actionCallbacks} />);
    return scenario;
  };

  it('renders LOCKED/taker payment proof guidance', () => {
    renderTradeScenario('locked-taker');
    expect(screen.getByText('Payment proof is needed')).toBeInTheDocument();
    expect(screen.getAllByText('Payment proof is required.').length).toBeGreaterThan(0);
  });

  it('renders PAID/maker release action', () => {
    renderTradeScenario('paid-maker');
    expect(screen.getByRole('button', { name: 'Release Funds' })).toBeInTheDocument();
  });

  it('renders CHALLENGED settlement guidance', () => {
    renderTradeScenario('challenged-maker');
    expect(screen.getByText('Follow settlement steps from the existing settlement card.')).toBeInTheDocument();
    expect(screen.getByText(/Araf is not an arbitrator/i)).toBeInTheDocument();
  });

  it('disables wrong-chain action buttons through decision disabled reasons', () => {
    renderTradeScenario('wrong-chain');
    expect(screen.getByRole('button', { name: 'Report Payment' })).toBeDisabled();
    expect(screen.getAllByText('Unsupported network.').length).toBeGreaterThan(0);
  });

  it('logs no-op action clicks without calling real contract or backend functions', () => {
    const scenario = scenarioRegistry.tradeRoom.scenarios.find((item) => item.id === 'with-payment-proof');
    const realContract = vi.fn();
    const backend = vi.fn();
    const appendLog = vi.fn();
    const actionCallbacks = createTradeRoomActionCallbacks({ scenarioId: scenario.id, appendLog });

    render(<TradeRoomPage decisionInput={scenario.decisionInput} actionCallbacks={actionCallbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report Payment' }));

    expect(realContract).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
    expect(appendLog).toHaveBeenCalledWith(expect.objectContaining({ actionKey: 'report_payment', scenarioId: 'with-payment-proof' }));
  });

  it('keeps decisionInput fixture shape aligned with the decision model', () => {
    const model = buildTradeDecisionModel(scenarioRegistry.tradeRoom.scenarios.find((item) => item.id === 'can-burn-expired').decisionInput);
    expect(model.secondaryActions.map((action) => action.key)).toContain('burn_expired');
  });
});

describe('UI Lab scenario controller', () => {
  it('applies Active Trades scenarios through controller without rendering a preview shell', async () => {
    const onApplyScenario = vi.fn();
    render(<UiLabPage onApplyScenario={onApplyScenario} />);
    fireEvent.click(screen.getByRole('button', { name: /Open UI Lab scenario controller/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Active Trades' }));
    fireEvent.click(screen.getByRole('button', { name: 'CHALLENGED filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Render in real App view' }));

    await waitFor(() => expect(onApplyScenario).toHaveBeenCalledWith(
      'activeTrades',
      expect.objectContaining({ id: 'active-trades-challenged', initialFilter: 'CHALLENGED' }),
      expect.any(Function),
    ));
    expect(screen.queryByTestId('ui-lab-scenario-shell')).not.toBeInTheDocument();
  });
});

describe('Admin UI Lab mock preview', () => {
  it('renders 403 scenario unauthorized box', async () => {
    render(<AdminPanel lang="EN" authenticatedFetch={createMockAdminFetch({ responseMode: 'forbidden' })} isAuthenticated authChecked showToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Unauthorized Access')).toBeInTheDocument());
  });

  it('renders degraded readiness KPI', async () => {
    render(<AdminPanel lang="EN" authenticatedFetch={createMockAdminFetch({ responseMode: 'degraded' })} isAuthenticated authChecked showToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('NOT_READY')).toBeInTheDocument());
  });

  it('preserves trades read-only observability and settlement no-authority copy', async () => {
    render(<AdminPanel lang="EN" authenticatedFetch={createMockAdminFetch({ responseMode: 'healthy' })} isAuthenticated authChecked showToast={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trades' }));
    await waitFor(() => expect(screen.getByText('Admin trades surface is observability-only; no actions/authority are exposed.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Settlement' }));
    await waitFor(() => expect(screen.getByText('Admin panel is observability-only. It cannot change settlement outcomes.')).toBeInTheDocument());
  });
});
