import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaymentRiskBadge from '../components/PaymentRiskBadge';

describe('PaymentRiskBadge non-authoritative complexity copy', () => {
  it('renders compact complexity warning without trust-user semantics', () => {
    render(<PaymentRiskBadge lang="EN" compact riskEntry={{ riskLevel: 'MEDIUM' }} />);
    expect(screen.getByText(/Payment method complexity/i)).toBeInTheDocument();
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
    expect(screen.getByText(/does not judge the counterparty/i)).toBeInTheDocument();
  });

  it('renders preview/config-only warning for detailed card', () => {
    render(
      <PaymentRiskBadge
        lang="EN"
        riskEntry={{
          riskLevel: 'RESTRICTED',
          minBondSurchargeBps: 50,
          feeSurchargeBps: 0,
          warningKey: 'RESTRICTED',
          enabled: false,
          description: { EN: 'config', TR: 'config' },
        }}
      />
    );
    expect(screen.getByText(/Preview\/config only/i)).toBeInTheDocument();
    expect(screen.getByText(/availability config signal/i)).toBeInTheDocument();
  });

  it('renders generic config warning when payload is generic in compact mode', () => {
    render(<PaymentRiskBadge lang="EN" compact riskEntry={{ riskLevel: 'LOW', generic: true }} />);
    expect(screen.getByText(/Generic payment config; this is not an order-specific rail signal/i)).toBeInTheDocument();
  });
});
