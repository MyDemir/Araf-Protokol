import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ProfileContextPage from '../../frontend/src/app/contexts/profile/ProfileContextPage';

describe('ProfileContextPage', () => {
  it('renders and switches tabs', () => {
    render(
      <ProfileContextPage
        lang="EN"
        address="0xabc"
        formatAddress={(v) => v}
        isConnected
        isAuthenticated
        payoutProfileDraft={{ rail: 'TR_IBAN', country: 'TR', fields: { account_holder_name: '', iban: '' } }}
        setPayoutProfileDraft={vi.fn()}
        handleUpdatePII={(e) => e.preventDefault()}
        userReputation={{ effectiveTier: 2, successful: 3, failed: 1 }}
        myOrders={[]}
        setConfirmDeleteId={vi.fn()}
        activeTradesFilter="ALL"
        setActiveTradesFilter={vi.fn()}
        activeEscrows={[]}
        setActiveTrade={vi.fn()}
        setUserRole={vi.fn()}
        setTradeState={vi.fn()}
        setChargebackAccepted={vi.fn()}
        setCurrentView={vi.fn()}
        setShowProfileModal={vi.fn()}
        tradeHistory={[]}
        mapResolutionTypeLabel={(key) => key}
        handleLogoutAndDisconnect={vi.fn()}
      />
    );

    expect(screen.getByText('Profile Center')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Security'));
    expect(screen.getByText('Logout & Disconnect')).toBeInTheDocument();
  });

  it('active trades tab uses go to room transition setters', () => {
    cleanup();
    const setActiveTrade = vi.fn();
    const setUserRole = vi.fn();
    const setTradeState = vi.fn();
    const setChargebackAccepted = vi.fn();
    const setCurrentView = vi.fn();
    const setShowProfileModal = vi.fn();

    render(
      <ProfileContextPage
        lang="EN"
        address="0xabc"
        formatAddress={(v) => v}
        isConnected
        isAuthenticated
        payoutProfileDraft={{ rail: 'TR_IBAN', country: 'TR', fields: { account_holder_name: '', iban: '' } }}
        setPayoutProfileDraft={vi.fn()}
        handleUpdatePII={(e) => e.preventDefault()}
        userReputation={{}}
        myOrders={[]}
        setConfirmDeleteId={vi.fn()}
        activeTradesFilter="ALL"
        setActiveTradesFilter={vi.fn()}
        activeEscrows={[{ id: 'T-1', state: 'LOCKED', role: 'maker', rawTrade: { chargebackAcked: true } }]}
        setActiveTrade={setActiveTrade}
        setUserRole={setUserRole}
        setTradeState={setTradeState}
        setChargebackAccepted={setChargebackAccepted}
        setCurrentView={setCurrentView}
        setShowProfileModal={setShowProfileModal}
        tradeHistory={[]}
        mapResolutionTypeLabel={(key) => key}
        handleLogoutAndDisconnect={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByText('Active Trades')[0]);
    fireEvent.click(screen.getByText('Go to Room →'));

    expect(setActiveTrade).toHaveBeenCalledWith(expect.objectContaining({ chargebackAcked: true }));
    expect(setUserRole).toHaveBeenCalledWith('maker');
    expect(setTradeState).toHaveBeenCalledWith('LOCKED');
    expect(setChargebackAccepted).toHaveBeenCalledWith(true);
    expect(setCurrentView).toHaveBeenCalledWith('tradeRoom');
    expect(setShowProfileModal).toHaveBeenCalledWith(false);
  });
});
