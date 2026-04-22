import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import AdminPanel from '../AdminPanel';

describe('AdminPanel polling auth behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stops polling after unauthorized and resumes when auth becomes valid again', async () => {
    const responses = [
      { status: 401, ok: false, json: async () => ({}) },
      { status: 200, ok: true, json: async () => ({ readiness: {}, stats: {}, tradeCounts: {}, dlq: {} }) },
    ];
    const authenticatedFetch = vi.fn(async () => responses.shift() || responses[responses.length - 1]);

    const { rerender } = render(
      <AdminPanel
        lang="EN"
        authenticatedFetch={authenticatedFetch}
        isAuthenticated={false}
        authChecked={true}
      />
    );

    await waitFor(() => {
      expect(authenticatedFetch).toHaveBeenCalledTimes(1);
    });

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);

    rerender(
      <AdminPanel
        lang="EN"
        authenticatedFetch={authenticatedFetch}
        isAuthenticated={true}
        authChecked={true}
      />
    );

    await waitFor(() => {
      expect(authenticatedFetch).toHaveBeenCalledTimes(2);
    });
  });
});
