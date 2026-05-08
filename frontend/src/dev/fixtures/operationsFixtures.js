export const UI_LAB_VIEWER = '0xViewer000000000000000000000000000000000001';
export const UI_LAB_COUNTERPARTY = '0xOther000000000000000000000000000000000001';

export const makeEscrow = (id, state, role, extra = {}) => ({
  id: `#${id}`,
  onchainId: id,
  state,
  role,
  maker: '0xMake...0001',
  makerFull: UI_LAB_VIEWER,
  takerFull: UI_LAB_COUNTERPARTY,
  taker: '0xTake...0001',
  counterparty: '0xOther...0001',
  amount: `${state === 'PAID' ? '250' : state === 'CHALLENGED' ? '500' : '100'} USDT`,
  fiat: 'TRY',
  viewerAddress: UI_LAB_VIEWER,
  settlementProposal: extra.settlementProposal || null,
  _pendingBackendSync: Boolean(extra._pendingBackendSync),
  rawTrade: {
    id: `#${id}`,
    onchainId: id,
    state,
    role,
    max: state === 'PAID' ? 8200 : state === 'CHALLENGED' ? 16400 : 3300,
    fiat: 'TRY',
    crypto: 'USDT',
    cryptoAmountUi: state === 'PAID' ? '250' : state === 'CHALLENGED' ? '500' : '100',
    chargebackAcked: true,
    settlementProposal: extra.settlementProposal || null,
    _pendingBackendSync: Boolean(extra._pendingBackendSync),
    ...(extra.rawTrade || {}),
  },
  ...extra,
});

export const operationEscrows = {
  settlementActionRequired: makeEscrow('2001', 'CHALLENGED', 'taker', {
    settlementProposal: { state: 'PROPOSED', proposer: UI_LAB_COUNTERPARTY, makerShareBps: 6000, takerShareBps: 4000 },
  }),
  pendingBackendSync: makeEscrow('2002', 'LOCKED', 'maker', { _pendingBackendSync: true }),
  challenged: makeEscrow('2003', 'CHALLENGED', 'maker'),
  paid: makeEscrow('2004', 'PAID', 'taker'),
  settlementWaiting: makeEscrow('2005', 'CHALLENGED', 'maker', {
    settlementProposal: { state: 'PROPOSED', proposer: UI_LAB_VIEWER, makerShareBps: 5000, takerShareBps: 5000 },
  }),
  locked: makeEscrow('2006', 'LOCKED', 'maker'),
};

export const buildActiveEscrowCounts = (activeEscrows = []) => ({
  LOCKED: activeEscrows.filter((e) => e.state === 'LOCKED').length,
  PAID: activeEscrows.filter((e) => e.state === 'PAID').length,
  CHALLENGED: activeEscrows.filter((e) => e.state === 'CHALLENGED').length,
  settlement: {
    PROPOSED: activeEscrows.filter((e) => e.settlementProposal?.state === 'PROPOSED').length,
    ACTION_REQUIRED: activeEscrows.filter((e) => e.settlementProposal?.state === 'PROPOSED' && String(e.settlementProposal.proposer).toLowerCase() !== UI_LAB_VIEWER.toLowerCase()).length,
    WAITING: activeEscrows.filter((e) => e.settlementProposal?.state === 'PROPOSED' && String(e.settlementProposal.proposer).toLowerCase() === UI_LAB_VIEWER.toLowerCase()).length,
  },
});

const opsScenario = (id, label, escrows) => ({
  id,
  label,
  category: 'operations',
  activeEscrows: escrows,
  activeEscrowCounts: buildActiveEscrowCounts(escrows),
  address: UI_LAB_VIEWER,
});

export const operationsScenarios = [
  opsScenario('settlement_action_required', 'Settlement action required', [operationEscrows.settlementActionRequired]),
  opsScenario('pending_backend_sync', 'Pending backend sync', [operationEscrows.pendingBackendSync]),
  opsScenario('challenged', 'Challenged', [operationEscrows.challenged]),
  opsScenario('paid', 'Paid', [operationEscrows.paid]),
  opsScenario('settlement_waiting', 'Settlement waiting', [operationEscrows.settlementWaiting]),
  opsScenario('locked', 'Locked', [operationEscrows.locked]),
  opsScenario('empty_state', 'Empty state', []),
  opsScenario('mixed_priority_queue', 'Mixed priority queue', Object.values(operationEscrows)),
];
