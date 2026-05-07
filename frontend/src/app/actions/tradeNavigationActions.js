// [TR] Trade Room'a geçişte tekrar eden state atamalarını tek bir action'da toplar.
// [EN] Consolidates repeated Trade Room navigation state assignments in one action.
export function buildNextActiveTrade(escrow = {}) {
  const { rawTrade: rawTradePayload, ...escrowFields } = escrow || {};
  const rawTrade = rawTradePayload && typeof rawTradePayload === 'object' ? rawTradePayload : escrowFields;
  const nextTrade = { ...rawTrade };

  const settlementProposal = rawTrade.settlementProposal ?? escrow?.settlementProposal;
  if (settlementProposal !== undefined) nextTrade.settlementProposal = settlementProposal;

  const pendingBackendSync = rawTrade._pendingBackendSync ?? escrow?._pendingBackendSync;
  if (pendingBackendSync !== undefined) nextTrade._pendingBackendSync = pendingBackendSync;

  return nextTrade;
}

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
    const safeEscrow = escrow || {};
    const nextActiveTrade = buildNextActiveTrade(safeEscrow);
    setActiveTrade(nextActiveTrade);
    setUserRole(safeEscrow.role);
    setTradeState(safeEscrow.state);
    setChargebackAccepted(safeEscrow.rawTrade?.chargebackAcked === true);
    setCurrentView('tradeRoom');
    if (typeof setSidebarOpen === 'function') setSidebarOpen(false);
    if (typeof setShowProfileModal === 'function') setShowProfileModal(false);
  };
}
