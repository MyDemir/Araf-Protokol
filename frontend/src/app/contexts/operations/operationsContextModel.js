// [TR] Operations Center lane modeli mevcut session verisinden türetilir.
// [EN] Operations Center lane model is derived from existing session state.
const LANE_DEFS = [
  { key: 'settlement_action_required', label: { TR: 'Settlement Aksiyon Gerekli', EN: 'Settlement Action Required' }, priority: 1 },
  { key: 'pending_backend_sync', label: { TR: 'Backend Senkron Bekliyor', EN: 'Pending Backend Sync' }, priority: 2 },
  { key: 'challenged', label: { TR: 'İtirazlı İşlemler', EN: 'Challenged Trades' }, priority: 3 },
  { key: 'paid', label: { TR: 'Ödeme Bildirildi', EN: 'Paid Trades' }, priority: 4 },
  { key: 'settlement_waiting', label: { TR: 'Settlement Karşı Taraf Yanıtı', EN: 'Settlement Waiting' }, priority: 5 },
  { key: 'locked', label: { TR: 'Kilitli İşlemler', EN: 'Locked Trades' }, priority: 6 },
  { key: 'informational', label: { TR: 'Bilgilendirme', EN: 'Informational' }, priority: 7 },
];


const normalizeSettlementState = (state) => {
  const normalized = String(state || '').toUpperCase();
  return normalized || 'NONE';
};

const classifySettlementLane = (escrow, viewerAddress) => {
  const settlement = escrow?.rawTrade?.settlementProposal;
  if (!settlement || normalizeSettlementState(settlement.state) !== 'PROPOSED') return null;

  const proposer = settlement?.proposer?.toLowerCase?.() || null;
  const viewer = viewerAddress?.toLowerCase?.() || null;

  if (viewer && proposer && proposer !== viewer) return 'settlement_action_required';
  if (viewer && proposer && proposer === viewer) return 'settlement_waiting';
  return 'informational';
};

const mapEscrowLane = (escrow, viewerAddress) => {
  const settlementLane = classifySettlementLane(escrow, viewerAddress);
  if (settlementLane === 'settlement_action_required') return settlementLane;

  const state = String(escrow?.state || '').toUpperCase();
  if (state === 'CHALLENGED') return 'challenged';
  if (state === 'PAID') return 'paid';

  if (settlementLane === 'settlement_waiting') return settlementLane;
  if (state === 'LOCKED') return 'locked';

  return settlementLane || 'informational';
};

const toLaneItem = (escrow, laneKey) => ({
  laneKey,
  escrow,
  rawTrade: escrow?.rawTrade,
});

export const mapEscrowToOperationCardModel = (escrow = {}) => ({
  id: escrow?.id || `#${escrow?.onchainId ?? '—'}`,
  role: escrow?.role || 'viewer',
  state: String(escrow?.state || 'LOCKED').toUpperCase(),
  amount: escrow?.amount || null,
  fiat: escrow?.rawTrade?.max ? `${Number(escrow.rawTrade.max).toFixed(0)} ${escrow?.rawTrade?.fiat || ''}`.trim() : null,
});

export function buildOperationsContextModel({
  activeEscrows = [],
  activeEscrowCounts = {},
  activeTrade = null,
  address = null,
  lang = 'EN',
}) {
  const groups = new Map(LANE_DEFS.map((lane) => [lane.key, []]));

  for (const escrow of activeEscrows || []) {
    const laneKey = mapEscrowLane(escrow, address);
    groups.get(laneKey).push(toLaneItem(escrow, laneKey));
  }

  if (activeTrade?._pendingBackendSync) {
    const pendingEscrow = {
      id: activeTrade?.id ?? null,
      onchainId: activeTrade?.onchainId ?? null,
      role: activeTrade?.role ?? null,
      state: activeTrade?.state || 'LOCKED',
      rawTrade: activeTrade,
    };
    groups.get('pending_backend_sync').push(toLaneItem(pendingEscrow, 'pending_backend_sync'));
  }

  const lanes = LANE_DEFS
    .map((lane) => ({
      key: lane.key,
      label: lane.label[lang === 'TR' ? 'TR' : 'EN'],
      priority: lane.priority,
      items: groups.get(lane.key),
    }))
    .filter((lane) => lane.items.length > 0);

  const settlementCounts = activeEscrowCounts?.settlement || {};
  const summary = {
    totalActive: activeEscrows.length,
    locked: Number(activeEscrowCounts?.LOCKED || 0),
    paid: Number(activeEscrowCounts?.PAID || 0),
    challenged: Number(activeEscrowCounts?.CHALLENGED || 0),
    settlementProposed: Number(settlementCounts?.PROPOSED || 0),
    settlementActionRequired: Number(settlementCounts?.ACTION_REQUIRED || 0),
    settlementWaiting: Number(settlementCounts?.WAITING || 0),
    pendingBackendSync: activeTrade?._pendingBackendSync ? 1 : 0,
  };

  return { summary, lanes };
}

export default buildOperationsContextModel;
