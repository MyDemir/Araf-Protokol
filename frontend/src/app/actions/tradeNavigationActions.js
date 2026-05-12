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

export function getEscrowRouteId(escrow = {}) {
  const rawTrade = escrow?.rawTrade || {};
  return escrow?.onchainId ?? rawTrade?.onchainId ?? rawTrade?.onchain_escrow_id ?? (String(escrow?.id || '').replace(/^#/, '') || null);
}

export function writeAppHashRoute(route) {
  if (typeof window === 'undefined' || !route) return;
  if (window.location.hash !== route) window.location.hash = route;
}

export function parseAppHashRoute(hashValue = '') {
  const hash = String(hashValue || '').replace(/^#/, '');
  const params = typeof URLSearchParams !== 'undefined' ? new URLSearchParams(hash.startsWith('?') ? hash.slice(1) : '') : null;
  if (hash === '/profile/active-trades') return { view: 'profile', profileTab: 'active' };
  const tradeMatch = hash.match(/^\/trade\/([^/?#]+)/);
  if (tradeMatch) return { view: 'tradeRoom', tradeId: decodeURIComponent(tradeMatch[1]) };
  if (params?.get('view') === 'tradeRoom') return { view: 'tradeRoom', tradeId: params.get('trade') || null };
  return null;
}

export function findEscrowByRouteTradeId(activeEscrows = [], tradeId = null) {
  const normalized = String(tradeId || '').replace(/^#/, '');
  if (!normalized) return null;
  return (activeEscrows || []).find((escrow) => {
    const candidates = [
      escrow?.id,
      String(escrow?.id || '').replace(/^#/, ''),
      escrow?.onchainId,
      escrow?.rawTrade?.onchainId,
      escrow?.rawTrade?.onchain_escrow_id,
    ].filter((value) => value !== null && value !== undefined);
    return candidates.some((value) => String(value).replace(/^#/, '') === normalized);
  }) || null;
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
    const routeId = getEscrowRouteId(safeEscrow);
    if (routeId) writeAppHashRoute(`#/trade/${encodeURIComponent(String(routeId))}`);
    if (typeof setSidebarOpen === 'function') setSidebarOpen(false);
    if (typeof setShowProfileModal === 'function') setShowProfileModal(false);
  };
}
