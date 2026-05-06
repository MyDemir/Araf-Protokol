import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { SystemStatusBar } from '../app/shell/SystemStatusBar';
import AppShell from '../app/shell/AppShell';

afterEach(() => cleanup());

describe('SystemStatusBar global warnings', () => {
  it('renders env errors in the shell status bar with technical details collapsed by default', () => {
    render(<SystemStatusBar envErrors={['VITE_ESCROW_ADDRESS missing', 'API policy invalid']} />);

    expect(screen.getByRole('region', { name: /system status/i })).toBeInTheDocument();
    expect(screen.getByText(/System Configuration Warning/i)).toBeInTheDocument();
    const details = screen.getByText(/Technical Details/i).closest('details');
    expect(details).toBeInTheDocument();
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText('VITE_ESCROW_ADDRESS missing')).toBeInTheDocument();
    expect(within(details).getByText('API policy invalid')).toBeInTheDocument();
  });

  it('renders wrong-chain copy with the real supported chain names', () => {
    render(
      <SystemStatusBar
        isConnected
        isSupportedChain={false}
        supportedChains={{ 8453: 'Base', 31337: 'Hardhat Local' }}
      />,
    );

    expect(screen.getByText(/Unsupported Network/i)).toBeInTheDocument();
    expect(screen.getByText(/Wrong Network! Please switch to Base \/ Hardhat Local\./i)).toBeInTheDocument();
  });

  it('renders unregistered wallet CTA and wires it to handleRegisterWallet', () => {
    const handleRegisterWallet = vi.fn();
    render(
      <SystemStatusBar
        isConnected
        isWalletRegistered={false}
        onRegisterWallet={handleRegisterWallet}
      />,
    );

    expect(screen.getByText(/Wallet Not Registered/i)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Register/i });
    fireEvent.click(button);
    expect(handleRegisterWallet).toHaveBeenCalledTimes(1);
  });

  it('respects the wallet registration loading state', () => {
    const handleRegisterWallet = vi.fn();
    render(
      <SystemStatusBar
        isConnected
        isWalletRegistered={false}
        isRegisteringWallet
        onRegisterWallet={handleRegisterWallet}
      />,
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(handleRegisterWallet).not.toHaveBeenCalled();
  });

  it('renders sybil age warning with the remaining days', () => {
    render(
      <SystemStatusBar
        isConnected
        isWalletRegistered
        sybilStatus={{ aged: false }}
        walletAgeRemainingDays={3}
      />,
    );

    expect(screen.getByText(/Wallet Age Pending/i)).toBeInTheDocument();
    expect(screen.getByText(/Remaining: ~3 day\(s\)\./i)).toBeInTheDocument();
  });


  it('renders auth/session required state when the connected wallet is not authenticated', () => {
    render(<SystemStatusBar isConnected authChecked isAuthenticated={false} />);

    expect(screen.getByText(/Session Verification Required/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign in again to access protected areas\./i)).toBeInTheDocument();
  });

  it('renders pending backend sync as an info state', () => {
    render(<SystemStatusBar activeTrade={{ _pendingBackendSync: true }} />);

    const status = screen.getByText(/Trade Sync Pending/i).closest('[data-status-key]');
    expect(status).toHaveAttribute('data-status-key', 'pending_backend_sync');
    expect(status).toHaveTextContent(/Trade is on-chain; backend record is being prepared\./i);
  });

  it('keeps the status bar in normal document flow so outlet content is not hidden by a fixed overlay', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/shell/SystemStatusBar.jsx'), 'utf8');
    expect(source).not.toMatch(/fixed[\s\S]*top-0|top-0[\s\S]*fixed/);
    expect(source).not.toContain('pt-24');

    render(
      <div className="flex flex-col h-screen">
        <AppShell
          status={{ isPaused: true }}
          outlet={<main data-testid="outlet-content">Outlet content</main>}
        />
      </div>,
    );

    const shell = screen.getByTestId('system-status-bar').parentElement;
    expect(shell.firstElementChild).toHaveAttribute('data-testid', 'system-status-bar');
    expect(screen.getByTestId('outlet-content')).toBeInTheDocument();
  });
});
