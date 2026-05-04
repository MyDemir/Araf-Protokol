import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ProfileContextPage from '../app/contexts/profile/ProfileContextPage';

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

    expect(setActiveTrade).toHaveBeenCalled();
    expect(setUserRole).toHaveBeenCalledWith('maker');
    expect(setTradeState).toHaveBeenCalledWith('LOCKED');
    expect(setChargebackAccepted).toHaveBeenCalledWith(true);
    expect(setCurrentView).toHaveBeenCalledWith('tradeRoom');
    expect(setShowProfileModal).toHaveBeenCalledWith(false);
  });

  it('my orders delete flow shows confirmation, cancels, and confirms with correct id', () => {
    cleanup();
    const setConfirmDeleteId = vi.fn();
    const handleDeleteOrder = vi.fn();

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
        myOrders={[{ id: '101', side: 'BUY' }]}
        setConfirmDeleteId={setConfirmDeleteId}
        handleDeleteOrder={handleDeleteOrder}
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

    fireEvent.click(screen.getAllByText('My Orders')[0]);
    expect(screen.getByText('#101 · BUY')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('Delete this order?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Delete this order?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Confirm'));

    expect(handleDeleteOrder).toHaveBeenCalledWith('101');
    expect(setConfirmDeleteId).toHaveBeenCalledWith('101');
    expect(setConfirmDeleteId).toHaveBeenCalledWith(null);
  });

  it('payment profile panel is rail-aware and updates payout field keys correctly', () => {
    cleanup();
    const setPayoutProfileDraft = vi.fn();

    const { rerender } = render(
      <ProfileContextPage
        lang="EN"
        address="0xabc"
        formatAddress={(v) => v}
        isConnected
        isAuthenticated
        payoutProfileDraft={{ rail: 'TR_IBAN', country: 'TR', fields: { account_holder_name: '', iban: '' } }}
        setPayoutProfileDraft={setPayoutProfileDraft}
        handleUpdatePII={(e) => e.preventDefault()}
        userReputation={{}}
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

    fireEvent.click(screen.getAllByText('Payment Profile')[0]);
    expect(screen.getByPlaceholderText('IBAN')).toBeInTheDocument();

    rerender(
      <ProfileContextPage
        lang="EN"
        address="0xabc"
        formatAddress={(v) => v}
        isConnected
        isAuthenticated
        payoutProfileDraft={{ rail: 'SEPA_IBAN', country: 'DE', fields: { account_holder_name: '', iban: '', bic: '' } }}
        setPayoutProfileDraft={setPayoutProfileDraft}
        handleUpdatePII={(e) => e.preventDefault()}
        userReputation={{}}
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
    fireEvent.click(screen.getAllByText('Payment Profile')[0]);
    expect(screen.getByPlaceholderText('BIC / SWIFT')).toBeInTheDocument();

    rerender(
      <ProfileContextPage
        lang="EN"
        address="0xabc"
        formatAddress={(v) => v}
        isConnected
        isAuthenticated
        payoutProfileDraft={{ rail: 'US_ACH', country: 'US', fields: { account_holder_name: '', routing_number: '', account_number: '', account_type: '' } }}
        setPayoutProfileDraft={setPayoutProfileDraft}
        handleUpdatePII={(e) => e.preventDefault()}
        userReputation={{}}
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
    fireEvent.click(screen.getAllByText('Payment Profile')[0]);
    expect(screen.getByPlaceholderText('Routing Number')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Account Number')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Account Type')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('IBAN')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Routing Number'), { target: { value: '021000021' } });
    const updateFn = setPayoutProfileDraft.mock.calls[setPayoutProfileDraft.mock.calls.length - 1][0];
    const updated = updateFn({ rail: 'US_ACH', country: 'US', fields: { account_holder_name: '', routing_number: '', account_number: '', account_type: '' } });
    expect(updated.fields.routing_number).toBe('021000021');
  });
});
