import { describe, expect, it, vi } from 'vitest';
import { buildGoToTradeRoomAction } from '../app/actions/tradeNavigationActions';

describe('buildGoToTradeRoomAction', () => {
  it('sets active trade from escrow.rawTrade', () => {
    const escrow = { rawTrade: { id: 't1', chargebackAcked: true }, role: 'maker', state: 'LOCKED' };
    const setActiveTrade = vi.fn();
    const action = buildGoToTradeRoomAction({
      escrow,
      setActiveTrade,
      setUserRole: vi.fn(),
      setTradeState: vi.fn(),
      setChargebackAccepted: vi.fn(),
      setCurrentView: vi.fn(),
    });
    action();
    expect(setActiveTrade).toHaveBeenCalledWith(escrow.rawTrade);
  });

  it('sets user role, trade state, chargeback flag, and currentView', () => {
    const escrow = { rawTrade: { chargebackAcked: true }, role: 'taker', state: 'PAID' };
    const setUserRole = vi.fn();
    const setTradeState = vi.fn();
    const setChargebackAccepted = vi.fn();
    const setCurrentView = vi.fn();

    buildGoToTradeRoomAction({
      escrow,
      setActiveTrade: vi.fn(),
      setUserRole,
      setTradeState,
      setChargebackAccepted,
      setCurrentView,
    })();

    expect(setUserRole).toHaveBeenCalledWith('taker');
    expect(setTradeState).toHaveBeenCalledWith('PAID');
    expect(setChargebackAccepted).toHaveBeenCalledWith(true);
    expect(setCurrentView).toHaveBeenCalledWith('tradeRoom');
  });

  it('closes sidebar if setter exists', () => {
    const setSidebarOpen = vi.fn();
    buildGoToTradeRoomAction({
      escrow: { rawTrade: {}, role: 'maker', state: 'LOCKED' },
      setActiveTrade: vi.fn(),
      setUserRole: vi.fn(),
      setTradeState: vi.fn(),
      setChargebackAccepted: vi.fn(),
      setCurrentView: vi.fn(),
      setSidebarOpen,
    })();
    expect(setSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('closes profile modal if setter exists', () => {
    const setShowProfileModal = vi.fn();
    buildGoToTradeRoomAction({
      escrow: { rawTrade: { chargebackAcked: false }, role: 'maker', state: 'LOCKED' },
      setActiveTrade: vi.fn(),
      setUserRole: vi.fn(),
      setTradeState: vi.fn(),
      setChargebackAccepted: vi.fn(),
      setCurrentView: vi.fn(),
      setShowProfileModal,
    })();
    expect(setShowProfileModal).toHaveBeenCalledWith(false);
  });

  it('sets chargeback accepted false when rawTrade.chargebackAcked is not true', () => {
    const setChargebackAccepted = vi.fn();
    buildGoToTradeRoomAction({
      escrow: { rawTrade: { chargebackAcked: 'yes' }, role: 'maker', state: 'LOCKED' },
      setActiveTrade: vi.fn(),
      setUserRole: vi.fn(),
      setTradeState: vi.fn(),
      setChargebackAccepted,
      setCurrentView: vi.fn(),
    })();
    expect(setChargebackAccepted).toHaveBeenCalledWith(false);
  });

  it('preserves rawTrade payload (including settlement proposal) while navigating', () => {
    const rawTrade = {
      id: 't2',
      chargebackAcked: false,
      settlementProposal: { state: 'PROPOSED', proposer: '0xabc' },
    };
    const setActiveTrade = vi.fn();
    const setSidebarOpen = vi.fn();

    buildGoToTradeRoomAction({
      escrow: { rawTrade, role: 'maker', state: 'CHALLENGED' },
      setActiveTrade,
      setUserRole: vi.fn(),
      setTradeState: vi.fn(),
      setChargebackAccepted: vi.fn(),
      setCurrentView: vi.fn(),
      setSidebarOpen,
    })();

    expect(setActiveTrade).toHaveBeenCalledWith(rawTrade);
    expect(setActiveTrade.mock.calls[0][0].settlementProposal).toEqual(rawTrade.settlementProposal);
    expect(setSidebarOpen).toHaveBeenCalledWith(false);
  });
});
