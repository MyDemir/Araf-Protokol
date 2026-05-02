import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RewardsDashboard from '../components/RewardsDashboard';

afterEach(() => {
  cleanup();
});

describe('RewardsDashboard', () => {
  it('renders without wallet', () => {
    render(<RewardsDashboard wallet={null} currentEpoch={12} claimableAmount={0n} />);
    expect(screen.getByText(/connect wallet/i)).toBeTruthy();
  });

  it('renders wallet claimable and claim button', () => {
    render(<RewardsDashboard wallet="0xabc" currentEpoch={12} claimableAmount={10n} />);
    expect(screen.getByText(/my claimable/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /claim/i })).toBeTruthy();
  });

  it('claim button disabled when zero claimable', () => {
    render(<RewardsDashboard wallet="0xabc" currentEpoch={12} claimableAmount={0n} />);
    expect(screen.getByRole('button', { name: /claim/i }).hasAttribute('disabled')).toBe(true);
  });
  it('shows unavailable state instead of zero on read error/wrong chain', () => {
    render(<RewardsDashboard wallet="0xabc" currentEpoch={12} claimableAmount={0n} claimableState="error" claimableError="rpc_down" />);
    expect(screen.getByText(/claimable unavailable/i)).toBeTruthy();
    render(<RewardsDashboard wallet="0xabc" currentEpoch={12} claimableAmount={0n} claimableState="blocked" />);
    expect(screen.getByText(/unavailable on current network/i)).toBeTruthy();
  });

  it('click claim invokes handler', () => {
    const onClaim = vi.fn();
    render(<RewardsDashboard wallet="0xabc" currentEpoch={1} claimableAmount={1n} onClaim={onClaim} />);
    fireEvent.click(screen.getByRole('button', { name: /claim/i }));
    expect(onClaim).toHaveBeenCalledTimes(1);
  });

  it('sponsor UI copy states that sponsor cannot select recipients', () => {
    render(<RewardsDashboard wallet={null} currentEpoch={1} claimableAmount={0n} />);
    expect(screen.getByText(/cannot select recipients/i)).toBeTruthy();
  });
});
