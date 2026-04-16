import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePII } from '../hooks/usePII';

describe('usePII', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchPII performs two-step token + data fetch', async () => {
    const authenticatedFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ piiToken: 'pii-123' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ payoutProfile: { fields: { iban: 'TR00' } } }) });

    const { result } = renderHook(() => usePII('trade-1', authenticatedFetch));

    let payload;
    await act(async () => {
      payload = await result.current.fetchPII();
    });

    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
    expect(payload?.payoutProfile?.fields?.iban).toBe('TR00');
    expect(result.current.pii?.payoutProfile?.fields?.iban).toBe('TR00');
  });

  it('new call aborts previous call without setting error', async () => {
    const never = () => new Promise(() => {});
    const authenticatedFetch = vi.fn().mockImplementation(never);

    const { result } = renderHook(() => usePII('trade-2', authenticatedFetch));

    act(() => {
      result.current.fetchPII();
      result.current.fetchPII();
    });

    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe(null);
  });

  it('clearPII resets payload and error', async () => {
    const authenticatedFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ piiToken: 'pii-123' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ payoutProfile: { fields: { iban: 'TR00' } } }) });

    const { result } = renderHook(() => usePII('trade-3', authenticatedFetch));
    await act(async () => {
      await result.current.fetchPII();
    });

    act(() => {
      result.current.clearPII();
    });

    expect(result.current.pii).toBe(null);
    expect(result.current.error).toBe(null);
  });
});
