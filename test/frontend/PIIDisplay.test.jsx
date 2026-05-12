import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PIIDisplay from '../../frontend/src/components/PIIDisplay';

describe('PIIDisplay', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => {} },
        configurable: true,
      });
    }
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    global.fetch = vi.fn()
      // request-token
      .mockResolvedValueOnce({ ok: true, json: async () => ({ piiToken: 'token-1' }) })
      // pii payload
      .mockResolvedValueOnce({ ok: true, json: async () => ({ payoutProfile: { rail: 'TR_IBAN', fields: { account_holder_name: 'Alice', iban: 'TR00 1111' } } }) });
  });

  afterEach(() => {
    cleanup();
  });

  it('reveal renders payload and hide clears UI', async () => {
    const user = userEvent.setup();
    render(<PIIDisplay tradeId="trade-1" lang="EN" />);

    expect(screen.getByText(/securely locked/i)).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.queryByText('TR00 1111')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reveal/i }));

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText('TR00 1111')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: /Hide/i }));
    expect(screen.getByRole('button', { name: /Reveal/i })).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.queryByText('TR00 1111')).not.toBeInTheDocument();
  });

  it('insecure context copy fallback works', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });

    render(<PIIDisplay tradeId="trade-1" lang="EN" />);
    await user.click(screen.getByRole('button', { name: /Reveal/i }));
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Copy IBAN/i }));
    expect(screen.getByText(/Copy failed/i)).toBeInTheDocument();
  });

  it('secure context copy writes the sanitized field value to clipboard', async () => {
    const user = userEvent.setup();

    render(<PIIDisplay tradeId="trade-1" lang="EN" />);
    await user.click(screen.getByRole('button', { name: /Reveal/i }));
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Copy IBAN/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('TR001111');
    expect(screen.getByRole('button', { name: /Copied/i })).toBeInTheDocument();
  });

  it('shows routing/account copy actions for US_ACH payload', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ piiToken: 'token-us' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payoutProfile: {
            rail: 'US_ACH',
            contact: { channel: 'email', value: 'ops@example.com' },
            fields: {
              account_holder_name: 'John Doe',
              routing_number: '021000021',
              account_number: '000123456789',
              account_type: 'checking',
              bank_name: 'Chase',
            },
          },
        }),
      });

    render(<PIIDisplay tradeId="trade-us" lang="EN" />);
    await user.click(screen.getByRole('button', { name: /Reveal/i }));
    await waitFor(() => expect(screen.getByText('John Doe')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Copy Routing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy Account/i })).toBeInTheDocument();
  });
});
