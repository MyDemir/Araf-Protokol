import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { normalizeSettlementState, SETTLEMENT_NEUTRALITY_COPY, toUnixSeconds, safeDate } from '../components/SettlementProposalCard';
import { getPreviewTotalPool, shortNum } from '../components/SettlementPreviewModal';
import SettlementProposalCard from '../components/SettlementProposalCard';

describe('SettlementProposalCard state normalization safety', () => {
  it('maps tuple-like numeric states to explicit labels', () => {
    expect(normalizeSettlementState(1)).toBe('PROPOSED');
    expect(normalizeSettlementState(5)).toBe('FINALIZED');
  });

  it('fails closed for malformed state payloads', () => {
    expect(normalizeSettlementState(undefined)).toBe('NONE');
    expect(normalizeSettlementState({})).toBe('NONE');
  });

  it('exposes explicit non-authoritative settlement copy for TR and EN', () => {
    expect(SETTLEMENT_NEUTRALITY_COPY.TR).toContain('kimin haklı olduğuna karar vermez');
    expect(SETTLEMENT_NEUTRALITY_COPY.TR).toContain('CHALLENGED dispute fazında');
    expect(SETTLEMENT_NEUTRALITY_COPY.EN).toContain('does not decide who is right');
    expect(SETTLEMENT_NEUTRALITY_COPY.EN).toContain('CHALLENGED dispute phase');
  });

  it('parses settlement expiry from unix, ms, and ISO formats safely', () => {
    expect(toUnixSeconds(1735689600)).toBe(1735689600);
    expect(toUnixSeconds(1735689600000)).toBe(1735689600);
    expect(toUnixSeconds('2025-01-01T00:00:00.000Z')).toBe(1735689600);
    expect(toUnixSeconds('')).toBe(0);
  });

  it('renders valid safeDate for ISO timestamps and fails closed for invalid payloads', () => {
    expect(safeDate('2025-01-01T00:00:00.000Z')).not.toBe('—');
    expect(safeDate('invalid-date')).toBe('—');
  });

  it('reads preview pool from backend `pool` field before legacy aliases', () => {
    expect(getPreviewTotalPool({ pool: '1200000', totalPool: '1', total_pool: '2' })).toBe('1200000');
    expect(getPreviewTotalPool({ totalPool: '999' })).toBe('999');
    expect(getPreviewTotalPool({ total_pool: '333' })).toBe('333');
  });

  it('formats very large preview integers without Number overflow', () => {
    expect(shortNum('123456789012345678901234567890')).toContain(',');
    expect(shortNum('123456789012345678901234567890')).not.toContain('e+');
  });

  it('security_non_party_user_does_not_see_settlement_action_buttons', () => {
    render(React.createElement(SettlementProposalCard, {
      activeTrade: {
        id: 'db-id',
        onchainId: '7',
        state: 'CHALLENGED',
        makerFull: '0x1111111111111111111111111111111111111111',
        takerFull: '0x2222222222222222222222222222222222222222',
        settlementProposal: {
          state: 'PROPOSED',
          proposer: '0x1111111111111111111111111111111111111111',
          makerShareBps: 6000,
          takerShareBps: 4000,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      },
      userRole: 'taker',
      address: '0x3333333333333333333333333333333333333333',
      lang: 'EN',
      authenticatedFetch: vi.fn(),
      proposeSettlement: vi.fn(),
      acceptSettlement: vi.fn(),
      rejectSettlement: vi.fn(),
      withdrawSettlement: vi.fn(),
      expireSettlement: vi.fn(),
      fetchMyTrades: vi.fn(),
      showToast: vi.fn(),
      isContractLoading: false,
      setIsContractLoading: vi.fn(),
    }));
    expect(screen.queryByRole('button', { name: /Withdraw/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Accept \(Preview\)/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject/i })).toBeNull();
  });

  it('security_expired_proposal_hides_accept_reject_withdraw_and_shows_expire_for_party', () => {
    render(React.createElement(SettlementProposalCard, {
      activeTrade: {
        id: 'db-id',
        onchainId: '7',
        state: 'CHALLENGED',
        makerFull: '0x1111111111111111111111111111111111111111',
        takerFull: '0x2222222222222222222222222222222222222222',
        settlementProposal: {
          state: 'PROPOSED',
          proposer: '0x1111111111111111111111111111111111111111',
          makerShareBps: 6000,
          takerShareBps: 4000,
          expiresAt: '2000-01-01T00:00:00.000Z',
        },
      },
      userRole: 'maker',
      address: '0x1111111111111111111111111111111111111111',
      lang: 'EN',
      authenticatedFetch: vi.fn(),
      proposeSettlement: vi.fn(),
      acceptSettlement: vi.fn(),
      rejectSettlement: vi.fn(),
      withdrawSettlement: vi.fn(),
      expireSettlement: vi.fn(),
      fetchMyTrades: vi.fn(),
      showToast: vi.fn(),
      isContractLoading: false,
      setIsContractLoading: vi.fn(),
    }));
    expect(screen.queryByRole('button', { name: /Accept \(Preview\)/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Withdraw/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Mark as Expired/i })).toBeInTheDocument();
  });

  it('security_terminal_trade_with_proposed_settlement_shows_historical_copy_without_action_buttons', () => {
    const view = render(React.createElement(SettlementProposalCard, {
      activeTrade: {
        id: 'db-id',
        onchainId: '7',
        state: 'RESOLVED',
        makerFull: '0x1111111111111111111111111111111111111111',
        takerFull: '0x2222222222222222222222222222222222222222',
        settlementProposal: {
          state: 'PROPOSED',
          proposer: '0x1111111111111111111111111111111111111111',
          makerShareBps: 6000,
          takerShareBps: 4000,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      },
      userRole: 'taker',
      address: '0x2222222222222222222222222222222222222222',
      lang: 'EN',
      authenticatedFetch: vi.fn(),
      proposeSettlement: vi.fn(),
      acceptSettlement: vi.fn(),
      rejectSettlement: vi.fn(),
      withdrawSettlement: vi.fn(),
      expireSettlement: vi.fn(),
      fetchMyTrades: vi.fn(),
      showToast: vi.fn(),
      isContractLoading: false,
      setIsContractLoading: vi.fn(),
    }));

    const scope = within(view.container);
    expect(scope.getByText(/This trade already reached a terminal state/i)).toBeInTheDocument();
    expect(scope.queryByRole('button', { name: /Withdraw/i })).toBeNull();
    expect(scope.queryByRole('button', { name: /Accept \(Preview\)/i })).toBeNull();
    expect(scope.queryByRole('button', { name: /Reject/i })).toBeNull();
    expect(scope.queryByRole('button', { name: /Mark as Expired/i })).toBeNull();
  });

  it('security_custom_expiry_below_contract_minimum_blocks_preview_with_validation_error', () => {
    const view = render(React.createElement(SettlementProposalCard, {
      activeTrade: {
        id: 'db-id',
        onchainId: '7',
        state: 'CHALLENGED',
        makerFull: '0x1111111111111111111111111111111111111111',
        takerFull: '0x2222222222222222222222222222222222222222',
        settlementProposal: null,
      },
      userRole: 'maker',
      address: '0x1111111111111111111111111111111111111111',
      lang: 'EN',
      authenticatedFetch: vi.fn(),
      proposeSettlement: vi.fn(),
      acceptSettlement: vi.fn(),
      rejectSettlement: vi.fn(),
      withdrawSettlement: vi.fn(),
      expireSettlement: vi.fn(),
      fetchMyTrades: vi.fn(),
      showToast: vi.fn(),
      isContractLoading: false,
      setIsContractLoading: vi.fn(),
    }));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /Custom minutes/i }), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));

    expect(screen.getByText(/Custom expiry must be between 10 minutes and 7 days/i)).toBeInTheDocument();
  });

  it('shows backend preview unavailable and missing on-chain id warnings in create flow', () => {
    const view = render(React.createElement(SettlementProposalCard, {
      activeTrade: {
        id: null,
        onchainId: null,
        state: 'CHALLENGED',
        rawTrade: {
          maker_address: '0x1111111111111111111111111111111111111111',
          taker_address: '0x2222222222222222222222222222222222222222',
        },
        settlementProposal: null,
      },
      userRole: 'maker',
      address: '0x1111111111111111111111111111111111111111',
      lang: 'EN',
      authenticatedFetch: vi.fn(),
      proposeSettlement: vi.fn(),
      acceptSettlement: vi.fn(),
      rejectSettlement: vi.fn(),
      withdrawSettlement: vi.fn(),
      expireSettlement: vi.fn(),
      fetchMyTrades: vi.fn(),
      showToast: vi.fn(),
      isContractLoading: false,
      setIsContractLoading: vi.fn(),
    }));
    const scope = within(view.container);
    expect(scope.getByText(/Settlement preview is unavailable until backend trade record is ready/i)).toBeInTheDocument();
    expect(scope.getByText(/Missing on-chain trade ID/i)).toBeInTheDocument();
    expect(scope.getByRole('button', { name: /Preview/i })).toBeDisabled();
  });

  it('security_settlement_controls_hidden_in_locked_and_paid_with_challenged_only_copy', () => {
    const commonProps = {
      userRole: 'maker',
      address: '0x1111111111111111111111111111111111111111',
      lang: 'EN',
      authenticatedFetch: vi.fn(),
      proposeSettlement: vi.fn(),
      acceptSettlement: vi.fn(),
      rejectSettlement: vi.fn(),
      withdrawSettlement: vi.fn(),
      expireSettlement: vi.fn(),
      fetchMyTrades: vi.fn(),
      showToast: vi.fn(),
      isContractLoading: false,
      setIsContractLoading: vi.fn(),
    };

    const lockedView = render(React.createElement(SettlementProposalCard, {
      ...commonProps,
      activeTrade: {
        id: 'db-id',
        onchainId: '7',
        state: 'LOCKED',
        makerFull: '0x1111111111111111111111111111111111111111',
        takerFull: '0x2222222222222222222222222222222222222222',
        settlementProposal: null,
      },
    }));
    let scope = within(lockedView.container);
    expect(scope.getByText(/available only during CHALLENGED disputes/i)).toBeInTheDocument();
    expect(scope.queryByRole('button', { name: /Preview/i })).toBeNull();

    lockedView.unmount();

    const paidView = render(React.createElement(SettlementProposalCard, {
      ...commonProps,
      activeTrade: {
        id: 'db-id-2',
        onchainId: '8',
        state: 'PAID',
        makerFull: '0x1111111111111111111111111111111111111111',
        takerFull: '0x2222222222222222222222222222222222222222',
        settlementProposal: null,
      },
    }));
    scope = within(paidView.container);
    expect(scope.getByText(/available only during CHALLENGED disputes/i)).toBeInTheDocument();
    expect(scope.queryByRole('button', { name: /Preview/i })).toBeNull();
  });
});
