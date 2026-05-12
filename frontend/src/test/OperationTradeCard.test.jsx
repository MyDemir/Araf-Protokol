import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import OperationsCenterPage from '../app/contexts/operations/OperationsCenterPage';
import OperationTradeCard from '../app/contexts/operations/OperationTradeCard';
import ActiveTradesPanel from '../app/contexts/profile/ActiveTradesPanel';
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
          counterparty: '0xcafe...babe',
          rawTrade: { max: 410, fiat: 'TRY' },
        }}
        lang="EN"
        onGoToRoom={onGoToRoom}
      />,
    );

    expect(screen.getByText('#42')).toBeInTheDocument();
    expect(screen.getAllByText('Maker').length).toBeGreaterThan(0);
    expect(screen.queryByText('Order owner')).not.toBeInTheDocument();
    expect(screen.getByText(getStateLabel(state, 'EN'))).toBeInTheDocument();
    expect(screen.getByText('Counterparty')).toBeInTheDocument();
    expect(screen.getByText('0xcafe...babe')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.queryByText(state)).not.toBeInTheDocument();
    expect(screen.getByText(/12.5 USDT/)).toBeInTheDocument();
    expect(screen.getByText('(410 TRY)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Go to Room/i }));
    expect(onGoToRoom).toHaveBeenCalledTimes(1);
  });


  it('renders localized Turkish state labels without exposing raw active-trade enums', () => {
    render(
      <OperationTradeCard
        escrow={{
          id: '#TR-1',
          role: 'taker',
          state: 'CHALLENGED',
          rawTrade: {},
        }}
        lang="TR"
        onGoToRoom={vi.fn()}
      />,
    );

    expect(screen.getByText(getStateLabel('CHALLENGED', 'TR'))).toBeInTheDocument();
    expect(screen.getAllByText('Alıcı').length).toBeGreaterThan(0);
    expect(screen.getByText('Karşı taraf')).toBeInTheDocument();
    expect(screen.queryByText('CHALLENGED')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Odaya Git/i })).toBeInTheDocument();
  });


  it('sorts profile active trades by CHALLENGED, PAID, then LOCKED priority', () => {
    render(
      <ActiveTradesPanel
        lang="EN"
        activeTradesFilter="ALL"
        setActiveTradesFilter={vi.fn()}
        activeEscrows={[
          { id: '#locked', state: 'LOCKED', role: 'maker', counterparty: '0xlocked', amount: '1 USDT', rawTrade: {} },
          { id: '#paid', state: 'PAID', role: 'taker', counterparty: '0xpaid', amount: '2 USDT', rawTrade: {} },
          { id: '#challenged', state: 'CHALLENGED', role: 'maker', counterparty: '0xchallenged', amount: '3 USDT', rawTrade: {} },
        ]}
        setActiveTrade={vi.fn()}
        setUserRole={vi.fn()}
        setTradeState={vi.fn()}
        setChargebackAccepted={vi.fn()}
        setCurrentView={vi.fn()}
        setShowProfileModal={vi.fn()}
      />,
    );

    const cards = screen.getAllByTestId('operation-trade-card');
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('#challenged'),
      expect.stringContaining('#paid'),
      expect.stringContaining('#locked'),
    ]);
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

    expect(screen.getAllByText(/Settlement needs your response/i).length).toBeGreaterThan(0);
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
    expect(screen.getAllByText('Taker').length).toBeGreaterThan(0);
    expect(screen.getByText('Counterparty')).toBeInTheDocument();
    expect(screen.getAllByText(/Room sync in progress/i).length).toBeGreaterThan(0);
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
    expect(screen.getByText('Needs response')).toBeInTheDocument();
    expect(screen.getByText('Room sync')).toBeInTheDocument();
    expect(screen.queryByText('PAID')).not.toBeInTheDocument();
    expect(screen.queryByText('CHALLENGED')).not.toBeInTheDocument();
  });


  it('renders command-center priority guidance and friendly empty state without fetches', () => {
    render(
      <OperationsCenterPage
        activeEscrows={[]}
        activeEscrowCounts={{ LOCKED: 0, PAID: 0, CHALLENGED: 0, settlement: {} }}
        activeTrade={null}
        address="0xviewer"
        lang="EN"
        setActiveTrade={vi.fn()}
        setUserRole={vi.fn()}
        setTradeState={vi.fn()}
        setChargebackAccepted={vi.fn()}
        setCurrentView={vi.fn()}
        setSidebarOpen={vi.fn()}
        setShowProfileModal={vi.fn()}
      />,
    );

    expect(screen.getByText(/settlement\/action required first/i)).toBeInTheDocument();
    expect(screen.getByText(/payment reported next/i)).toBeInTheDocument();
    expect(screen.getByText(/No active trades need attention right now/i)).toBeInTheDocument();
  });

  it('keeps sidebar/profile/operations surfaces on shared card components without new data fetches', () => {
    const appViewsSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/AppViews.jsx'), 'utf8');
    const profileSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/contexts/profile/ActiveTradesPanel.jsx'), 'utf8');
    const operationsPanelSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/contexts/operations/OperationsPanels.jsx'), 'utf8');
    const sessionSource = fs.readFileSync(path.resolve(process.cwd(), 'src/app/useAppSessionData.jsx'), 'utf8');

    expect(appViewsSource).toContain("import OperationTradeCard from './contexts/operations/OperationTradeCard';");
    expect(appViewsSource).toContain("import { SettlementQueueCard } from './contexts/operations/OperationsPanels';");
    expect(profileSource).toContain("import OperationTradeCard, { compareActiveTradePriority } from '../operations/OperationTradeCard';");
    expect(operationsPanelSource).toContain('<SettlementQueueCard');
    expect(operationsPanelSource).toContain('<PendingSyncCard');
    expect(operationsPanelSource).toContain('<OperationTradeCard');
    expect(sessionSource).toContain('const fetchMyTrades = React.useCallback');
    expect(profileSource).not.toContain('fetch(');
    expect(appViewsSource).toContain("onClick={() => { fetchMyTrades(); }}");
  });

});
