import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PIIDisplay, { buildContactHref } from '../../frontend/src/components/PIIDisplay';

const profile = (contact, holder = 'Ada') => ({
  payoutProfile: { rail: 'TR_IBAN', fields: { account_holder_name: holder, iban: 'TR00 1111' }, contact },
});

const mockFetchSequence = (...payloads) => {
  const fn = vi.fn();
  payloads.forEach((p) => {
    fn.mockResolvedValueOnce({ ok: true, json: async () => ({ piiToken: 't' }) });
    fn.mockResolvedValueOnce({ ok: true, json: async () => p });
  });
  global.fetch = fn;
};

const reveal = async (user) => {
  await user.click(screen.getByRole('button', { name: /Reveal|göster/i }));
};

describe('buildContactHref (F19.2)', () => {
  it('builds safe mailto/tel/telegram links', () => {
    expect(buildContactHref('email', 'alice@example.com')).toBe('mailto:alice@example.com');
    expect(buildContactHref('phone', '+90 532 123 45 67')).toBe('tel:+905321234567');
    expect(buildContactHref('telegram', '@ada_lovelace')).toBe('https://t.me/ada_lovelace');
  });

  it('rejects malformed or injected email values', () => {
    expect(buildContactHref('email', 'not-an-email')).toBeNull();
    expect(buildContactHref('email', 'a@b.com?cc=evil@x.com&body=send%20funds')).toBeNull();
    expect(buildContactHref('email', 'a@b.com,evil@x.com')).toBeNull();
    expect(buildContactHref('email', 'javascript:alert(1)//@x.io')).toBeNull();
  });

  it('rejects malformed phone values', () => {
    expect(buildContactHref('phone', 'javascript:alert(1)')).toBeNull();
    expect(buildContactHref('phone', '12')).toBeNull();
    expect(buildContactHref('phone', '+90 532;ext=1 123 45 67 89 01 22 33')).toBeNull();
  });

  it('gives no link for empty telegram handle or unknown channel', () => {
    expect(buildContactHref('telegram', '@@@')).toBeNull();
    expect(buildContactHref('signal', 'x')).toBeNull();
    expect(buildContactHref('email', '')).toBeNull();
  });
});

describe('PIIDisplay contact rendering and trade switch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });
  afterEach(() => cleanup());

  it('renders no link (only the no-contact notice) for an invalid email', async () => {
    mockFetchSequence(profile({ channel: 'email', value: 'x@y.com?bcc=evil@z.com' }));
    const user = userEvent.setup();
    render(<PIIDisplay tradeId="t1" lang="EN" />);
    await reveal(user);
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('renders a valid mailto link', async () => {
    mockFetchSequence(profile({ channel: 'email', value: 'alice@example.com' }));
    const user = userEvent.setup();
    render(<PIIDisplay tradeId="t1" lang="EN" />);
    await reveal(user);
    await waitFor(() => expect(document.querySelector('a[href="mailto:alice@example.com"]')).not.toBeNull());
  });

  it('re-locks the view when tradeId changes (F19.3)', async () => {
    mockFetchSequence(profile(null, 'Ada'));
    const user = userEvent.setup();
    const { rerender } = render(<PIIDisplay tradeId="trade-A" lang="EN" />);
    await reveal(user);
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());

    rerender(<PIIDisplay tradeId="trade-B" lang="EN" />);

    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reveal|göster/i })).toBeInTheDocument();
  });

  it('does not restore the revealed state when switching A -> B -> A', async () => {
    mockFetchSequence(profile(null, 'Ada'));
    const user = userEvent.setup();
    const { rerender } = render(<PIIDisplay tradeId="trade-A" lang="EN" />);
    await reveal(user);
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument());

    rerender(<PIIDisplay tradeId="trade-B" lang="EN" />);
    rerender(<PIIDisplay tradeId="trade-A" lang="EN" />);

    expect(screen.getByRole('button', { name: /Reveal|göster/i })).toBeInTheDocument();
  });
});
