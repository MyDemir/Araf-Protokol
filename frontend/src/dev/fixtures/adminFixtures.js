const now = '2026-05-08T07:00:00.000Z';

export const healthySummary = {
  readiness: { ok: true, checks: { database: true, worker: true, config: true }, worker: { state: 'READY', lagBlocks: 0 }, missingConfig: [] },
  stats: { active_child_trades: 4, open_sell_orders: 8, open_buy_orders: 3, completed_trades: 42, burned_bonds_usdt: 12.5 },
  tradeCounts: { incompleteSnapshot: 0, challenged: 2, locked: 3, paid: 1 },
  dlq: { depth: 0, oldest: null },
  settlementAnalytics: { activeSettlementProposals: 2, expiredSettlementProposals: 1, finalizedSettlementProposals24h: 3, avgSettlementSplitMakerBps: 6100, settlementFinalizationRate: 0.72 },
};

export const degradedSummary = {
  readiness: { ok: false, checks: { database: true, worker: false, config: false }, worker: { state: 'NOT_READY', lagBlocks: 18 }, missingConfig: ['ADMIN_WALLETS', 'INDEXER_RPC_URL'] },
  stats: { active_child_trades: 9, open_sell_orders: 2, open_buy_orders: 1, completed_trades: 38, burned_bonds_usdt: 75 },
  tradeCounts: { incompleteSnapshot: 3, challenged: 5, locked: 2, paid: 2 },
  dlq: { depth: 4, oldest: now },
  settlementAnalytics: { activeSettlementProposals: 5, expiredSettlementProposals: 2, finalizedSettlementProposals24h: 0, avgSettlementSplitMakerBps: 5500, settlementFinalizationRate: 0.31 },
};

export const feedbackRows = [
  { _id: 'fb-1', id: 'fb-1', category: 'ui/ux', rating: 5, comment: 'Preview makes review easier.', wallet_address: '0xFeedback0000000000000000000000000000000001', created_at: now },
  { _id: 'fb-2', id: 'fb-2', category: 'bug', rating: 3, comment: 'Timer copy needs review.', wallet_address: '0xFeedback0000000000000000000000000000000002', created_at: now },
];

export const adminTrades = [
  {
    _id: 'trade-4001',
    id: 'trade-4001',
    onchain_escrow_id: '4001',
    status: 'CHALLENGED',
    maker_address: '0xMaker000000000000000000000000000000000001',
    taker_address: '0xTaker000000000000000000000000000000000001',
    token_symbol: 'USDT',
    crypto_amount: '500000000',
    fiat_currency: 'TRY',
    created_at: now,
    updated_at: now,
    tier: 1,
    origin: 'ORDER_CHILD',
    risk_flags: ['settlement_active'],
    snapshot_complete: true,
    offchain_health_score_input: {
      snapshot: { incompleteReason: '' },
      maker: { reputationBanMirrorContext: { reputation_authority_counters: { burn_count: 0, auto_release_count: 1, mutual_cancel_count: 0, disputed_resolved_count: 2, partial_settlement_count: 1 } } },
    },
  },
];

export const settlementProposals = [
  {
    proposal_id: 'sp-1',
    trade_id: 'trade-4001',
    onchain_escrow_id: '4001',
    status: 'CHALLENGED',
    state: 'PROPOSED',
    maker_address: '0xMaker000000000000000000000000000000000001',
    taker_address: '0xTaker000000000000000000000000000000000001',
    proposed_by: '0xTaker000000000000000000000000000000000001',
    maker_share_bps: 6000,
    taker_share_bps: 4000,
    proposed_at: now,
    expires_at: '2026-05-09T07:00:00.000Z',
    finalized_at: null,
    is_expired: false,
    requires_counterparty_action: true,
    proposal_age_seconds: 300,
    tx_hash: '0xabc123',
  },
];

export const adminScenarios = [
  { id: 'overview-healthy', label: 'Overview healthy', category: 'admin', responseMode: 'healthy', initialTab: 'overview' },
  { id: 'overview-degraded', label: 'Overview degraded', category: 'admin', responseMode: 'degraded', initialTab: 'overview' },
  { id: 'sync-missing-config', label: 'Sync with missing config', category: 'admin', responseMode: 'degraded', initialTab: 'sync' },
  { id: 'feedback-list', label: 'Feedback list', category: 'admin', responseMode: 'healthy', initialTab: 'feedback' },
  { id: 'trades-challenged', label: 'Trades filtered by CHALLENGED', category: 'admin', responseMode: 'healthy', initialTab: 'trades' },
  { id: 'settlement-proposals', label: 'Settlement proposals', category: 'admin', responseMode: 'healthy', initialTab: 'settlement' },
  { id: 'unauthorized-403', label: 'Unauthorized / 403', category: 'admin', responseMode: 'forbidden', initialTab: 'overview' },
  { id: 'session-expired-401', label: 'Session expired / 401', category: 'admin', responseMode: 'expired', initialTab: 'overview' },
  { id: 'empty-admin-data', label: 'Empty admin data', category: 'admin', responseMode: 'empty', initialTab: 'overview' },
];
