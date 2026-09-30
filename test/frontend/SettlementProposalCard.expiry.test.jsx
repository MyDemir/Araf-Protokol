import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SettlementProposalCard, {
  SETTLEMENT_EXPIRY_SAFETY_SEC,
  SETTLEMENT_MIN_EXPIRY_SEC,
  computeSettlementExpiresAt,
} from '../../frontend/src/components/SettlementProposalCard';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('F18: settlement expiry is computed at TX time from chain time', () => {
  it('computeSettlementExpiresAt never drops below MIN_SETTLEMENT_EXPIRY plus the safety margin', () => {
    const now = 1_800_000_000;
    // 10 minutes (the UI minimum) would sit exactly on the contract floor; the margin lifts it.
    expect(computeSettlementExpiresAt(now, 10)).toBe(now + SETTLEMENT_MIN_EXPIRY_SEC + SETTLEMENT_EXPIRY_SAFETY_SEC);
    expect(computeSettlementExpiresAt(now, 0)).toBe(now + SETTLEMENT_MIN_EXPIRY_SEC + SETTLEMENT_EXPIRY_SAFETY_SEC);
    expect(computeSettlementExpiresAt(now, Number.NaN)).toBe(now + SETTLEMENT_MIN_EXPIRY_SEC + SETTLEMENT_EXPIRY_SAFETY_SEC);
    // Longer offers are left exactly as chosen.
    expect(computeSettlementExpiresAt(now, 30)).toBe(now + 30 * 60);
    expect(computeSettlementExpiresAt(now, 24 * 60)).toBe(now + 24 * 3600);
  });

  it('recomputes expiresAt when the user confirms, not when the form last rendered', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2030-01-01T00:00:00Z');
    vi.setSystemTime(start);

    const proposeSettlement = vi.fn().mockResolvedValue(undefined);
    const authenticatedFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ preview: { pool: '1000000' } }) });
    const offsetMs = 4000; // chain clock runs 4s ahead of the browser

    render(React.createElement(SettlementProposalCard, {
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
      authenticatedFetch,
      settlementContractFns: {
        proposeSettlement,
        acceptSettlement: vi.fn(),
        rejectSettlement: vi.fn(),
        withdrawSettlement: vi.fn(),
        expireSettlement: vi.fn(),
      },
      fetchMyTrades: vi.fn(),
      showToast: vi.fn(),
      isContractLoading: false,
      setIsContractLoading: vi.fn(),
      nowOffsetMs: offsetMs,
    }));

    fireEvent.click(screen.getByRole('button', { name: /Preview offer/i }));
    const confirm = await screen.findByRole('button', { name: /Submit proposal on-chain/i });

    // The user reads the preview for 5 minutes before signing.
    vi.setSystemTime(new Date(start.getTime() + 5 * 60 * 1000));
    fireEvent.click(confirm);
    await Promise.resolve();
    await Promise.resolve();

    expect(proposeSettlement).toHaveBeenCalledTimes(1);
    const [, , expiresAt] = proposeSettlement.mock.calls[0];
    const chainNowAtConfirm = Math.floor((start.getTime() + 5 * 60 * 1000 + offsetMs) / 1000);
    // Default preset is 2 hours; measured from confirm time, on the chain clock.
    expect(expiresAt).toBe(chainNowAtConfirm + 2 * 3600);
  });
});
