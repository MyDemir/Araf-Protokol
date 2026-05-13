import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PIIDisplay from '../../frontend/src/components/PIIDisplay';

const mockPiiFetch = (payoutProfile) => {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ piiToken: 'pii-token' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ payoutProfile }) });
};

const reveal = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Reveal|göster/i }));
  return user;
};

describe('PIIDisplay role-aware and rail-aware copy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('uses neutral secure payment details copy instead of seller-only copy', () => {
    mockPiiFetch({ rail: 'TR_IBAN', fields: { account_holder_name: 'Ada', iban: 'TR00' } });

    render(<PIIDisplay tradeId="trade-copy" lang="EN" />);

    expect(screen.getAllByText(/Secure payment details/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Payment profile and contact/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reveal secure payment details/i })).toBeInTheDocument();
    expect(screen.queryByText(/seller/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/seller payout/i)).not.toBeInTheDocument();
  });

  it.each([
    ['TR_IBAN', { account_holder_name: 'Ada TR', iban: 'TR00 1111' }, /Copy IBAN/i],
    ['SEPA_IBAN', { account_holder_name: 'Ada SEPA', iban: 'DE89 3704', bic: 'COBADEFF' }, /Copy IBAN/i],
    ['US_ACH', { account_holder_name: 'Ada ACH', routing_number: '021000021', account_number: '000123456789', account_type: 'checking', bank_name: 'Chase' }, /Copy Routing/i],
  ])('renders %s rail payment fields after secure reveal', async (rail, fields, primaryCopyAction) => {
    mockPiiFetch({ rail, fields });

    render(<PIIDisplay tradeId={`trade-${rail}`} lang="EN" />);
    await reveal();

    await waitFor(() => expect(screen.getByText(fields.account_holder_name)).toBeInTheDocument());
    expect(screen.getByText(rail)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: primaryCopyAction })).toBeInTheDocument();

    if (rail === 'TR_IBAN' || rail === 'SEPA_IBAN') {
      expect(screen.getByText(fields.iban)).toBeInTheDocument();
    }
    if (rail === 'SEPA_IBAN') {
      expect(screen.getByText(/COBADEFF/i)).toBeInTheDocument();
    }
    if (rail === 'US_ACH') {
      expect(screen.getByRole('button', { name: /Copy Account/i })).toBeInTheDocument();
      expect(screen.getByText(/021000021/i)).toBeInTheDocument();
      expect(screen.getByText(/000123456789/i)).toBeInTheDocument();
    }
  });

  it.each([
    ['telegram', 'araf_user', /Open Telegram/i, /^https:\/\/t\.me\/araf_user$/],
    ['email', 'ops@example.com', /Send Email/i, /^mailto:ops@example\.com$/],
    ['phone', '+15551234567', /Call \/ Open Dialer/i, /^tel:\+15551234567$/],
  ])('preserves %s contact action support', async (channel, value, label, hrefPattern) => {
    mockPiiFetch({
      rail: 'TR_IBAN',
      contact: { channel, value },
      fields: { account_holder_name: 'Contact User', iban: 'TR00 1111' },
    });

    render(<PIIDisplay tradeId={`trade-${channel}`} lang="EN" getSafeTelegramUrl={(handle) => `https://t.me/${handle}`} />);
    await reveal();

    await waitFor(() => expect(screen.getByText('Contact User')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', expect.stringMatching(hrefPattern));
  });

  it('preserves reveal, visible hide, clipboard guard, and insecure-context warning', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    mockPiiFetch({ rail: 'TR_IBAN', fields: { account_holder_name: 'Hidden User', iban: 'TR00 1111' } });

    render(<PIIDisplay tradeId="trade-hide" lang="EN" />);

    expect(screen.getByText(/HTTP connection/i)).toBeInTheDocument();
    const user = await reveal();
    await waitFor(() => expect(screen.getByText('Hidden User')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Copy IBAN/i }));
    expect(screen.getByRole('button', { name: /Copy failed/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Hide/i }));
    expect(screen.queryByText('Hidden User')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reveal secure payment details/i })).toBeInTheDocument();
  });

  it('aborts an in-flight PII reveal request on unmount without persisting visible PII', async () => {
    const user = userEvent.setup();
    let firstSignal;
    const authenticatedFetch = vi.fn((url, opts = {}) => {
      firstSignal = firstSignal || opts.signal;
      return new Promise(() => {});
    });

    const { unmount } = render(<PIIDisplay tradeId="trade-abort" lang="EN" authenticatedFetch={authenticatedFetch} />);
    await user.click(screen.getByRole('button', { name: /Reveal secure payment details/i }));
    await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));

    unmount();

    expect(firstSignal?.aborted).toBe(true);
    expect(screen.queryByText(/Secure payment details/i)).not.toBeInTheDocument();
  });
});
