import { describe, it, expect } from 'vitest';
import { normalizeSettlementState, SETTLEMENT_NEUTRALITY_COPY } from '../components/SettlementProposalCard';

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
    expect(SETTLEMENT_NEUTRALITY_COPY.TR).toContain('iki tarafın imzasıyla');
    expect(SETTLEMENT_NEUTRALITY_COPY.EN).toContain('does not decide who is right');
    expect(SETTLEMENT_NEUTRALITY_COPY.EN).toContain('counterparty-signed settlement');
  });
});
