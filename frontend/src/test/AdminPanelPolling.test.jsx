import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, screen, act, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import AdminPanel from '../AdminPanel';

describe('AdminPanel polling auth behavior', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stops polling after unauthorized and resumes when auth becomes valid again', async () => {
    vi.useFakeTimers();
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
        showToast={vi.fn()}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);

    rerender(
      <AdminPanel
        lang="EN"
        authenticatedFetch={authenticatedFetch}
        isAuthenticated={true}
        authChecked={true}
        showToast={vi.fn()}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps manual refresh showToast contract wired (no dead reference)', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/AdminPanel.jsx'), 'utf8');
    expect(source).toContain('function AdminPanel({ lang, authenticatedFetch, isAuthenticated, authChecked, showToast })');
    expect(source).toContain("if (typeof showToast === 'function')");
    expect(source).toContain("showToast(lang === 'TR' ? 'Özet yenilendi.' : 'Summary refreshed.', 'info')");
  });

  it('includes explicit UI hint for windowed pagination scope', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/AdminPanel.jsx'), 'utf8');
    expect(source).toContain('const isWindowedTradeTotal = tradesPaginationScope?.isWindowed === true;');
    expect(source).toContain('Window total (not global)');
  });

  it('shows trades tab as read-only observability surface (behavioral regression)', async () => {
    const authenticatedFetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ readiness: {}, stats: {}, tradeCounts: {}, dlq: {} }),
    }));

    render(
      <AdminPanel
        lang="EN"
        authenticatedFetch={authenticatedFetch}
        isAuthenticated={true}
        authChecked={true}
        showToast={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Trades' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Admin trades surface is observability-only; no actions/authority are exposed.')).toBeInTheDocument();
      expect(screen.getAllByText('Status').length).toBeGreaterThan(0);
      expect(screen.getByText('Risk Only')).toBeInTheDocument();
    });

    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/AdminPanel.jsx'), 'utf8');
    expect(source).toContain('Contract-authority mirror counters (informational/read-only)');
    expect(source).toContain('reputation_authority_counters?.burn_count');
  });
});
