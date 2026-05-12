import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useSettlementActions } from '../app/contexts/settlement/useSettlementActions';
import { getSettlementActionContext } from '../app/contexts/settlement/settlementActionModel';

const maker = '0x1111111111111111111111111111111111111111';
const taker = '0x2222222222222222222222222222222222222222';

const makeTrade = (overrides = {}) => ({
  id: 'db-id',
  onchainId: '7',
  state: 'CHALLENGED',
  makerFull: maker,
  takerFull: taker,
  settlementProposal: null,
  ...overrides,
});

const makeProposedTrade = (overrides = {}) => makeTrade({
  settlementProposal: {
    state: 'PROPOSED',
    proposer: maker,
    makerShareBps: 6000,
    takerShareBps: 4000,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  },
  ...overrides,
});

const makeDeps = (overrides = {}) => ({
  activeTrade: makeTrade(),
  userRole: 'maker',
  address: maker,
  lang: 'EN',
  contractFns: {
    proposeSettlement: vi.fn().mockResolvedValue(undefined),
    acceptSettlement: vi.fn().mockResolvedValue(undefined),
    rejectSettlement: vi.fn().mockResolvedValue(undefined),
    withdrawSettlement: vi.fn().mockResolvedValue(undefined),
    expireSettlement: vi.fn().mockResolvedValue(undefined),
  },
  fetchMyTrades: vi.fn().mockResolvedValue(undefined),
  showToast: vi.fn(),
  isContractLoading: false,
  setIsContractLoading: vi.fn(),
  ...overrides,
});

const renderSettlementActions = (deps) => {
  let latest;
  const Harness = () => {
    latest = useSettlementActions(deps);
    return null;
  };
  render(React.createElement(Harness));
  return () => latest;
};

describe('settlement action module', () => {
  it('propose settlement cannot run without onchainId', async () => {
    const deps = makeDeps({ activeTrade: makeTrade({ onchainId: null }) });
    const getActions = renderSettlementActions(deps);

    await act(async () => {
      await getActions().propose({ makerShareBps: 5000, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
    });

    expect(deps.contractFns.proposeSettlement).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('Missing on-chain trade ID.', 'error');
  });

  it('propose settlement cannot run without valid share and expiry', async () => {
    const deps = makeDeps();
    const getActions = renderSettlementActions(deps);

    await act(async () => {
      await getActions().propose({ makerShareBps: 10001, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
    });
    await act(async () => {
      await getActions().propose({ makerShareBps: 5000, expiresAt: Math.floor(Date.now() / 1000) - 1 });
    });

    expect(deps.contractFns.proposeSettlement).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith('makerShareBps must be in range 0..10000.', 'error');
    expect(deps.showToast).toHaveBeenCalledWith('Enter a valid settlement expiry.', 'error');
  });

  it('propose settlement passes BigInt trade id, validated share, expiry and refreshes trades', async () => {
    const deps = makeDeps();
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const getActions = renderSettlementActions(deps);

    await act(async () => {
      await getActions().propose({ makerShareBps: 6000, expiresAt });
    });

    expect(deps.contractFns.proposeSettlement).toHaveBeenCalledWith(7n, 6000, expiresAt);
    expect(deps.fetchMyTrades).toHaveBeenCalledTimes(1);
    expect(deps.showToast).toHaveBeenCalledWith('Settlement proposal submitted on-chain.', 'success');
  });

  it('accept/reject/withdraw/expire call contracts with correct BigInt trade id', async () => {
    const counterpartyDeps = makeDeps({ activeTrade: makeProposedTrade(), userRole: 'taker', address: taker });
    const getCounterpartyActions = renderSettlementActions(counterpartyDeps);

    await act(async () => {
      await getCounterpartyActions().accept();
      await getCounterpartyActions().reject();
    });

    const proposerDeps = makeDeps({ activeTrade: makeProposedTrade(), userRole: 'maker', address: maker });
    const getProposerActions = renderSettlementActions(proposerDeps);
    await act(async () => {
      await getProposerActions().withdraw();
    });

    const expiredDeps = makeDeps({
      activeTrade: makeProposedTrade({
        settlementProposal: {
          state: 'PROPOSED',
          proposer: maker,
          makerShareBps: 6000,
          takerShareBps: 4000,
          expiresAt: Math.floor(Date.now() / 1000) - 60,
        },
      }),
      userRole: 'maker',
      address: maker,
    });
    const getExpiredActions = renderSettlementActions(expiredDeps);
    await act(async () => {
      await getExpiredActions().expire();
    });

    expect(counterpartyDeps.contractFns.acceptSettlement).toHaveBeenCalledWith(7n);
    expect(counterpartyDeps.contractFns.rejectSettlement).toHaveBeenCalledWith(7n);
    expect(proposerDeps.contractFns.withdrawSettlement).toHaveBeenCalledWith(7n);
    expect(expiredDeps.contractFns.expireSettlement).toHaveBeenCalledWith(7n);
    expect(counterpartyDeps.fetchMyTrades).toHaveBeenCalledTimes(2);
    expect(proposerDeps.fetchMyTrades).toHaveBeenCalledTimes(1);
    expect(expiredDeps.fetchMyTrades).toHaveBeenCalledTimes(1);
  });

  it('settlement actions fail closed for zero on-chain trade id before contract calls', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const proposeDeps = makeDeps({ activeTrade: makeTrade({ onchainId: '0' }) });
    const getProposeActions = renderSettlementActions(proposeDeps);
    await act(async () => {
      await getProposeActions().propose({ makerShareBps: 5000, expiresAt });
    });

    const counterpartyDeps = makeDeps({ activeTrade: makeProposedTrade({ onchainId: '0' }), userRole: 'taker', address: taker });
    const getCounterpartyActions = renderSettlementActions(counterpartyDeps);
    await act(async () => {
      await getCounterpartyActions().accept();
      await getCounterpartyActions().reject();
    });

    const proposerDeps = makeDeps({ activeTrade: makeProposedTrade({ onchainId: '0' }), userRole: 'maker', address: maker });
    const getProposerActions = renderSettlementActions(proposerDeps);
    await act(async () => {
      await getProposerActions().withdraw();
    });

    const expiredDeps = makeDeps({
      activeTrade: makeProposedTrade({
        onchainId: '0',
        settlementProposal: {
          state: 'PROPOSED',
          proposer: maker,
          makerShareBps: 6000,
          takerShareBps: 4000,
          expiresAt: Math.floor(Date.now() / 1000) - 60,
        },
      }),
      userRole: 'maker',
      address: maker,
    });
    const getExpiredActions = renderSettlementActions(expiredDeps);
    await act(async () => {
      await getExpiredActions().expire();
    });

    expect(proposeDeps.contractFns.proposeSettlement).not.toHaveBeenCalled();
    expect(counterpartyDeps.contractFns.acceptSettlement).not.toHaveBeenCalled();
    expect(counterpartyDeps.contractFns.rejectSettlement).not.toHaveBeenCalled();
    expect(proposerDeps.contractFns.withdrawSettlement).not.toHaveBeenCalled();
    expect(expiredDeps.contractFns.expireSettlement).not.toHaveBeenCalled();
    expect(proposeDeps.showToast).toHaveBeenCalledWith('Invalid on-chain trade ID.', 'error');
    expect(counterpartyDeps.showToast).toHaveBeenCalledWith('Invalid on-chain trade ID.', 'error');
    expect(proposerDeps.showToast).toHaveBeenCalledWith('Invalid on-chain trade ID.', 'error');
    expect(expiredDeps.showToast).toHaveBeenCalledWith('Invalid on-chain trade ID.', 'error');
  });

  it('proposer/viewer action visibility remains proposer waits and counterparty acts', () => {
    const proposerContext = getSettlementActionContext({ activeTrade: makeProposedTrade(), userRole: 'maker', address: maker });
    const counterpartyContext = getSettlementActionContext({ activeTrade: makeProposedTrade(), userRole: 'taker', address: taker });

    expect(proposerContext.isProposer).toBe(true);
    expect(proposerContext.canWithdraw).toBe(true);
    expect(proposerContext.canAccept).toBe(false);
    expect(counterpartyContext.isCounterparty).toBe(true);
    expect(counterpartyContext.canAccept).toBe(true);
    expect(counterpartyContext.canReject).toBe(true);
    expect(counterpartyContext.canWithdraw).toBe(false);
  });

  it('expired or finalized proposal cannot be accepted', async () => {
    const finalizedDeps = makeDeps({
      activeTrade: makeProposedTrade({ settlementProposal: { state: 'FINALIZED', proposer: maker, expiresAt: Math.floor(Date.now() / 1000) + 3600 } }),
      userRole: 'taker',
      address: taker,
    });
    const getFinalizedActions = renderSettlementActions(finalizedDeps);
    await act(async () => {
      await getFinalizedActions().accept();
    });

    const expiredDeps = makeDeps({
      activeTrade: makeProposedTrade({ settlementProposal: { state: 'PROPOSED', proposer: maker, expiresAt: Math.floor(Date.now() / 1000) - 60 } }),
      userRole: 'taker',
      address: taker,
    });
    const getExpiredActions = renderSettlementActions(expiredDeps);
    await act(async () => {
      await getExpiredActions().accept();
    });

    expect(finalizedDeps.contractFns.acceptSettlement).not.toHaveBeenCalled();
    expect(expiredDeps.contractFns.acceptSettlement).not.toHaveBeenCalled();
    expect(finalizedDeps.showToast).toHaveBeenCalledWith('Settlement proposal cannot be accepted.', 'error');
    expect(expiredDeps.showToast).toHaveBeenCalledWith('Settlement proposal cannot be accepted.', 'error');
  });
});
