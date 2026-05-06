import { describe, expect, it } from 'vitest';
import { buildOperationsContextModel } from '../app/contexts/operations/operationsContextModel';

const baseCounts = {
  LOCKED: 0,
  PAID: 0,
  CHALLENGED: 0,
  settlement: { PROPOSED: 0, ACTION_REQUIRED: 0, WAITING: 0 },
};

describe('buildOperationsContextModel', () => {
  it('empty activeEscrows returns empty lanes and zero summary', () => {
    const model = buildOperationsContextModel({
      activeEscrows: [],
      activeEscrowCounts: baseCounts,
      activeTrade: null,
      address: '0xviewer',
      lang: 'EN',
    });

    expect(model.lanes).toEqual([]);
    expect(model.summary).toEqual({
      totalActive: 0,
      locked: 0,
      paid: 0,
      challenged: 0,
      settlementProposed: 0,
      settlementActionRequired: 0,
      settlementWaiting: 0,
      pendingBackendSync: 0,
    });
  });

  it('LOCKED / PAID / CHALLENGED counts are correct', () => {
    const escrows = [
      { id: 'a', state: 'LOCKED', role: 'maker', rawTrade: {} },
      { id: 'b', state: 'PAID', role: 'maker', rawTrade: {} },
      { id: 'c', state: 'CHALLENGED', role: 'maker', rawTrade: {} },
    ];
    const model = buildOperationsContextModel({
      activeEscrows: escrows,
      activeEscrowCounts: {
        ...baseCounts,
        LOCKED: 1,
        PAID: 1,
        CHALLENGED: 1,
      },
      address: '0xviewer',
      lang: 'EN',
    });

    expect(model.summary.locked).toBe(1);
    expect(model.summary.paid).toBe(1);
    expect(model.summary.challenged).toBe(1);
  });

  it('settlement proposal where proposer is not viewer becomes settlement_action_required', () => {
    const rawTrade = { settlementProposal: { state: 'PROPOSED', proposer: '0xother' } };
    const model = buildOperationsContextModel({
      activeEscrows: [{ id: 'x', state: 'LOCKED', role: 'taker', rawTrade }],
      activeEscrowCounts: baseCounts,
      address: '0xviewer',
      lang: 'EN',
    });

    const lane = model.lanes.find((l) => l.key === 'settlement_action_required');
    expect(lane).toBeTruthy();
    expect(lane.items).toHaveLength(1);
  });

  it('settlement proposal where proposer is viewer becomes settlement_waiting', () => {
    const rawTrade = { settlementProposal: { state: 'PROPOSED', proposer: '0xviewer' } };
    const model = buildOperationsContextModel({
      activeEscrows: [{ id: 'x', state: 'LOCKED', role: 'taker', rawTrade }],
      activeEscrowCounts: baseCounts,
      address: '0xviewer',
      lang: 'EN',
    });

    const lane = model.lanes.find((l) => l.key === 'settlement_waiting');
    expect(lane).toBeTruthy();
    expect(lane.items).toHaveLength(1);
  });

  it('pending activeTrade with _pendingBackendSync appears in pending_backend_sync lane', () => {
    const activeTrade = { id: null, onchainId: 99, _pendingBackendSync: true, settlementProposal: { state: 'PROPOSED' } };
    const model = buildOperationsContextModel({
      activeEscrows: [],
      activeEscrowCounts: baseCounts,
      activeTrade,
      address: '0xviewer',
      lang: 'EN',
    });

    const lane = model.lanes.find((l) => l.key === 'pending_backend_sync');
    expect(lane).toBeTruthy();
    expect(lane.items).toHaveLength(1);
    expect(lane.items[0].escrow.rawTrade).toBe(activeTrade);
    expect(lane.items[0].escrow.rawTrade._pendingBackendSync).toBe(true);
    expect(lane.items[0].escrow.rawTrade.settlementProposal).toEqual({ state: 'PROPOSED' });
    expect(model.summary.pendingBackendSync).toBe(1);
  });

  it('priority order is correct', () => {
    const escrows = [
      { id: '1', state: 'LOCKED', role: 'maker', rawTrade: {} },
      { id: '2', state: 'PAID', role: 'maker', rawTrade: {} },
      { id: '3', state: 'CHALLENGED', role: 'maker', rawTrade: {} },
      { id: '4', state: 'LOCKED', role: 'maker', rawTrade: { settlementProposal: { state: 'PROPOSED', proposer: '0xother' } } },
      { id: '5', state: 'LOCKED', role: 'maker', rawTrade: { settlementProposal: { state: 'PROPOSED', proposer: '0xviewer' } } },
    ];
    const model = buildOperationsContextModel({
      activeEscrows: escrows,
      activeEscrowCounts: baseCounts,
      activeTrade: { _pendingBackendSync: true },
      address: '0xviewer',
      lang: 'EN',
    });

    expect(model.lanes.map((l) => l.key)).toEqual([
      'settlement_action_required',
      'pending_backend_sync',
      'challenged',
      'paid',
      'settlement_waiting',
      'locked',
    ]);
  });

  it('rawTrade is preserved on each item', () => {
    const rawTrade = { foo: 'bar', settlementProposal: { state: 'NONE' } };
    const model = buildOperationsContextModel({
      activeEscrows: [{ id: 'z', state: 'LOCKED', role: 'maker', rawTrade }],
      activeEscrowCounts: baseCounts,
      address: '0xviewer',
      lang: 'EN',
    });

    const lane = model.lanes.find((l) => l.key === 'locked');
    expect(lane.items[0].rawTrade).toBe(rawTrade);
    expect(lane.items[0].escrow.rawTrade).toBe(rawTrade);
  });
});
