import { describe, expect, it, vi } from 'vitest';
import { buildGoToTradeRoomAction, buildNextActiveTrade } from '../app/actions/tradeNavigationActions';

describe('buildGoToTradeRoomAction', () => {
  it('sets active trade from escrow.rawTrade without dropping rawTrade fields', () => {
    const rawTrade = {
      id: 't1',
      onchainId: '77',
      chargebackAcked: true,
      arbitraryBackendField: 'kept',
      nested: { ok: true },
    };
    const escrow = { rawTrade, role: 'maker', state: 'LOCKED' };
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
    expect(setActiveTrade).toHaveBeenCalledWith(expect.objectContaining(rawTrade));
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

  it('preserves settlementProposal from rawTrade before escrow fallback', () => {
    const rawSettlement = { state: 'PROPOSED', proposer: '0xraw' };
    const escrowSettlement = { state: 'PROPOSED', proposer: '0xescrow' };

    expect(buildNextActiveTrade({
      rawTrade: { id: 'raw-first', settlementProposal: rawSettlement },
      settlementProposal: escrowSettlement,
    })).toEqual(expect.objectContaining({ settlementProposal: rawSettlement }));
  });

  it('preserves settlementProposal from escrow when rawTrade omits it', () => {
    const settlementProposal = { state: 'PROPOSED', proposer: '0xescrow' };
    const setActiveTrade = vi.fn();

    buildGoToTradeRoomAction({
      escrow: {
        rawTrade: { id: 'fallback-settlement', untouched: 'yes' },
        settlementProposal,
        role: 'maker',
        state: 'CHALLENGED',
      },
      setActiveTrade,
      setUserRole: vi.fn(),
      setTradeState: vi.fn(),
      setChargebackAccepted: vi.fn(),
      setCurrentView: vi.fn(),
    })();

    expect(setActiveTrade).toHaveBeenCalledWith(expect.objectContaining({
      id: 'fallback-settlement',
      untouched: 'yes',
      settlementProposal,
    }));
  });

  it('preserves _pendingBackendSync from rawTrade or escrow', () => {
    expect(buildNextActiveTrade({
      rawTrade: { id: 'raw-pending', _pendingBackendSync: true },
      _pendingBackendSync: false,
    })).toEqual(expect.objectContaining({ _pendingBackendSync: true }));

    expect(buildNextActiveTrade({
      rawTrade: { id: 'escrow-pending' },
      _pendingBackendSync: true,
    })).toEqual(expect.objectContaining({ _pendingBackendSync: true }));
  });


  it('defensively builds active trade from escrow fields when rawTrade is missing', () => {
    expect(buildNextActiveTrade({
      id: 'escrow-only',
      onchainId: '12',
      role: 'maker',
      state: 'LOCKED',
      settlementProposal: { state: 'PROPOSED' },
      _pendingBackendSync: true,
    })).toEqual(expect.objectContaining({
      id: 'escrow-only',
      onchainId: '12',
      role: 'maker',
      state: 'LOCKED',
      settlementProposal: { state: 'PROPOSED' },
      _pendingBackendSync: true,
    }));
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

  it('keeps sidebar/profile close setters optional and safe', () => {
    expect(() => buildGoToTradeRoomAction({
      escrow: { rawTrade: {}, role: 'maker', state: 'LOCKED' },
      setActiveTrade: vi.fn(),
      setUserRole: vi.fn(),
      setTradeState: vi.fn(),
      setChargebackAccepted: vi.fn(),
      setCurrentView: vi.fn(),
    })()).not.toThrow();
  });

  it('sets chargeback accepted true only when rawTrade.chargebackAcked is exactly true', () => {
    for (const value of ['yes', 1, 'true', false, undefined, null]) {
      const setChargebackAccepted = vi.fn();
      buildGoToTradeRoomAction({
        escrow: { rawTrade: { chargebackAcked: value }, role: 'maker', state: 'LOCKED' },
        setActiveTrade: vi.fn(),
        setUserRole: vi.fn(),
        setTradeState: vi.fn(),
        setChargebackAccepted,
        setCurrentView: vi.fn(),
      })();
      expect(setChargebackAccepted).toHaveBeenCalledWith(false);
    }

    const setChargebackAccepted = vi.fn();
    buildGoToTradeRoomAction({
      escrow: { rawTrade: { chargebackAcked: true }, role: 'maker', state: 'LOCKED' },
      setActiveTrade: vi.fn(),
      setUserRole: vi.fn(),
      setTradeState: vi.fn(),
      setChargebackAccepted,
      setCurrentView: vi.fn(),
    })();
    expect(setChargebackAccepted).toHaveBeenCalledWith(true);
  });
});
