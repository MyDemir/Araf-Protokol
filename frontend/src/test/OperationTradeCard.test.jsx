import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import OperationTradeCard from '../app/contexts/operations/OperationTradeCard';
import { OperationsSummaryBar, PendingSyncCard, SettlementQueueCard } from '../app/contexts/operations/OperationsPanels';
import { getStateLabel } from '../app/copy';

afterEach(() => cleanup());

describe('shared active trade cards', () => {
  it.each(['LOCKED', 'PAID', 'CHALLENGED'])('renders %s trade identity, amount, fiat estimate, and CTA', (state) => {
    const onGoToRoom = vi.fn();
    render(
      <OperationTradeCard
        escrow={{
          id: '#42',
          role: 'maker',
          state,
          amount: '12.5 USDT',
          rawTrade: { max: 410, fiat: 'TRY' },
        }}
        lang="EN"
        onGoToRoom={onGoToRoom}
      />,
    );

    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getByText('Maker')).toBeInTheDocument();
    expect(screen.getByText(getStateLabel(state, 'EN'))).toBeInTheDocument();
    expect(screen.queryByText(state)).not.toBeInTheDocument();
    expect(screen.getByText(/12.5 USDT/)).toBeInTheDocument();
    expect(screen.getByText('(410 TRY)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Go to Room/i }));
    expect(onGoToRoom).toHaveBeenCalledTimes(1);
  });

  it('renders settlement proposal status through SettlementQueueCard without settlement action buttons', () => {
    render(
      <SettlementQueueCard
        escrow={{
          id: '#7',
          role: 'taker',
          state: 'CHALLENGED',
          viewerAddress: '0xviewer',
          rawTrade: {
            settlementProposal: { state: 'PROPOSED', proposer: '0xother' },
          },
        }}
        lang="EN"
        onGoToRoom={vi.fn()}
      />,
    );

    expect(screen.getByText(/Settlement: action required/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go to Room/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept|Reject|Withdraw|Expire/i })).toBeNull();
  });

  it('renders pending sync state only through PendingSyncCard', () => {
    render(
      <PendingSyncCard
        escrow={{
          onchainId: '99',
          role: 'taker',
          state: 'LOCKED',
          rawTrade: { _pendingBackendSync: true },
        }}
        lang="EN"
        onGoToRoom={vi.fn()}
      />,
    );

    expect(screen.getByText('#99')).toBeInTheDocument();
    expect(screen.getAllByText(/Pending backend sync/i).length).toBeGreaterThan(0);
    expect(screen.getByTestId('pending-sync-card')).toHaveClass('border-sky-500/40');
    expect(screen.getByRole('button', { name: /Go to Room/i })).toBeInTheDocument();
  });

  it('renders operations summary with localized state labels', () => {
    render(
      <OperationsSummaryBar
        lang="EN"
        summary={{ totalActive: 3, locked: 1, paid: 1, challenged: 1 }}
      />,
    );

    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Payment Reported')).toBeInTheDocument();
    expect(screen.getByText('Challenge Phase')).toBeInTheDocument();
    expect(screen.queryByText('PAID')).not.toBeInTheDocument();
    expect(screen.queryByText('CHALLENGED')).not.toBeInTheDocument();
  });

  it('keeps sidebar/profile/operations surfaces on shared card components without new data fetches', () => {
    const appViewsSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/AppViews.jsx'), 'utf8');
    const profileSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/contexts/profile/ActiveTradesPanel.jsx'), 'utf8');
    const operationsPanelSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/contexts/operations/OperationsPanels.jsx'), 'utf8');
    const sessionSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/useAppSessionData.jsx'), 'utf8');

    expect(appViewsSource).toContain("import OperationTradeCard from './contexts/operations/OperationTradeCard';");
    expect(appViewsSource).toContain("import { SettlementQueueCard } from './contexts/operations/OperationsPanels';");
    expect(profileSource).toContain("import OperationTradeCard from '../operations/OperationTradeCard';");
    expect(operationsPanelSource).toContain('<SettlementQueueCard');
    expect(operationsPanelSource).toContain('<PendingSyncCard');
    expect(operationsPanelSource).toContain('<OperationTradeCard');
    expect(sessionSource).toContain('const fetchMyTrades = React.useCallback');
    expect(profileSource).not.toContain('fetch(');
    expect(appViewsSource).toContain("onClick={() => { fetchMyTrades(); }}");
  });

});
