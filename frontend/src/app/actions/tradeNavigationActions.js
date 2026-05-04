// [TR] Trade Room'a geçişte tekrar eden state atamalarını tek bir action'da toplar.
// [EN] Consolidates repeated Trade Room navigation state assignments in one action.
export function buildGoToTradeRoomAction({
  escrow,
  setActiveTrade,
  setUserRole,
  setTradeState,
  setChargebackAccepted,
  setCurrentView,
  setSidebarOpen,
  setShowProfileModal,
}) {
  return () => {
    setActiveTrade(escrow.rawTrade);
    setUserRole(escrow.role);
    setTradeState(escrow.state);
    setChargebackAccepted(escrow.rawTrade?.chargebackAcked === true);
    setCurrentView('tradeRoom');
    if (typeof setSidebarOpen === 'function') setSidebarOpen(false);
    if (typeof setShowProfileModal === 'function') setShowProfileModal(false);
  };
}
