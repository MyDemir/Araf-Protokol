import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ReferenceRateTicker from '../components/ReferenceRateTicker';

const originalFetch = global.fetch;

describe('ReferenceRateTicker', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('renders null when items are empty', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [],
        generatedAt: new Date().toISOString(),
        informationalOnly: true,
        nonAuthoritative: true,
        canAffectSettlement: false,
      }),
    });

    const { container } = render(<ReferenceRateTicker lang="TR" />);

    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders informational disclaimer and stale badge', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{
          symbol: 'USDT/TRY',
          base: 'USDT',
          quote: 'TRY',
          rate: 35,
          source: 'derived:coinbase+frankfurter',
          sourceKind: 'STABLECOIN_TRY_REFERENCE',
          derived: true,
          stale: true,
          updatedAt: new Date().toISOString(),
        }, {
          symbol: 'USD/TRY',
          base: 'USD',
          quote: 'TRY',
          rate: 34,
          source: 'frankfurter',
          sourceKind: 'FIAT_OFFICIAL_REFERENCE',
          derived: false,
          stale: false,
          updatedAt: new Date().toISOString(),
        }],
        generatedAt: new Date().toISOString(),
        informationalOnly: true,
        nonAuthoritative: true,
        canAffectSettlement: false,
      }),
    });

    render(<ReferenceRateTicker lang="TR" />);

    expect(await screen.findByTestId('reference-rate-ticker')).toBeInTheDocument();
    expect(screen.getByText(/Referans kurlar bilgilendirme amaçlıdır/i)).toBeInTheDocument();
    expect(screen.getAllByText(/gecikmiş/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/bilgilendirici ref\./i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/harici FX ref\./i).length).toBeGreaterThan(0);
  });

  it('does not crash UI on fetch failures', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));

    const { container } = render(<ReferenceRateTicker lang="EN" />);

    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeInTheDocument();
    expect(screen.queryByTestId('reference-rate-ticker')).not.toBeInTheDocument();
  });
});
