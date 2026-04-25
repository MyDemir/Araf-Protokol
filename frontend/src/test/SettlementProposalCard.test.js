import { describe, it, expect } from 'vitest';
import { normalizeSettlementState } from '../components/SettlementProposalCard';

describe('SettlementProposalCard state normalization safety', () => {
  it('maps tuple-like numeric states to explicit labels', () => {
    expect(normalizeSettlementState(1)).toBe('PROPOSED');
    expect(normalizeSettlementState(5)).toBe('FINALIZED');
  });

  it('fails closed for malformed state payloads', () => {
    expect(normalizeSettlementState(undefined)).toBe('NONE');
    expect(normalizeSettlementState({})).toBe('NONE');
  });
});
