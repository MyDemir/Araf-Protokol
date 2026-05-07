import React from 'react';
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaymentRiskBadge from '../components/PaymentRiskBadge';

afterEach(() => {
  cleanup();
});

const technicalRiskEntry = {
  riskLevel: 'RESTRICTED',
  minBondSurchargeBps: 50,
  feeSurchargeBps: 15,
  warningKey: 'RESTRICTED',
  enabled: false,
  source: 'onchain_snapshot',
  configVersion: 'risk-config-v3',
  snapshotBlock: 12345,
  description: { EN: 'High-friction rail.', TR: 'Zor rail.' },
};

describe('PaymentRiskBadge technical disclosure', () => {
  it('hides technical values until the disclosure is opened outside admin contexts', async () => {
    const user = userEvent.setup();
    render(<PaymentRiskBadge lang="EN" riskEntry={technicalRiskEntry} />);

    expect(screen.getByText('Restricted')).toBeInTheDocument();
    expect(screen.getByText(/High-friction rail/i)).toBeInTheDocument();
    expect(screen.getByText(/not a user trust score.*counterparty trust score/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show technical disclosure/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/minBondSurchargeBps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/feeSurchargeBps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/warningKey/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/onchain_snapshot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/risk-config-v3/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/12345/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show technical disclosure/i }));

    expect(screen.getByRole('button', { name: /Hide technical disclosure/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/minBondSurchargeBps/i)).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText(/feeSurchargeBps/i)).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText(/warningKey/i)).toBeInTheDocument();
    expect(screen.getByText('RESTRICTED')).toBeInTheDocument();
    expect(screen.getAllByText(/source/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/onchain_snapshot/i)).toBeInTheDocument();
    expect(screen.getAllByText(/config/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/risk-config-v3/i)).toBeInTheDocument();
    expect(screen.getAllByText(/snapshot/i).length).toBeGreaterThan(0);
    expect(screen.getByText('12345')).toBeInTheDocument();
    expect(screen.getByText(/Preview\/config only/i)).toBeInTheDocument();
    expect(screen.getAllByText(/availability config signal/i).length).toBeGreaterThan(0);
  });

  it('opens technical fields by default only when explicitly requested', () => {
    render(<PaymentRiskBadge lang="EN" riskEntry={technicalRiskEntry} defaultTechnicalOpen />);

    expect(screen.getByRole('button', { name: /Hide technical disclosure/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/minBondSurchargeBps/i)).toBeInTheDocument();
    expect(screen.getByText(/feeSurchargeBps/i)).toBeInTheDocument();
    expect(screen.getByText(/warningKey/i)).toBeInTheDocument();
    expect(screen.getByText(/onchain_snapshot/i)).toBeInTheDocument();
  });
});
