import { describe, it, expect } from 'vitest';
import { normalizeSettlementState, SETTLEMENT_NEUTRALITY_COPY, toUnixSeconds, safeDate } from '../components/SettlementProposalCard';
import { getPreviewTotalPool, shortNum } from '../components/SettlementPreviewModal';

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
});
