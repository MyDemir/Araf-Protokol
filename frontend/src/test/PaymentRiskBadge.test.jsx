import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaymentRiskBadge from '../components/PaymentRiskBadge';

describe('PaymentRiskBadge user-facing complexity summary', () => {
  it('renders compact payment-method complexity with a display label and no trust-score semantics', () => {
    render(
      <PaymentRiskBadge
        lang="EN"
        compact
        riskEntry={{
          riskLevel: 'MEDIUM',
          minBondSurchargeBps: 50,
          feeSurchargeBps: 25,
          warningKey: 'BANK_TRANSFER_CONFIRMATION_REQUIRED',
        }}
      />
    );

    expect(screen.getByText(/Payment complexity/i)).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.queryByText('MEDIUM')).not.toBeInTheDocument();
    expect(screen.getByText(/not a user trust score.*counterparty trust score/i)).toBeInTheDocument();
    expect(screen.queryByText(/minBondSurchargeBps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/feeSurchargeBps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/warningKey/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/BANK_TRANSFER_CONFIRMATION_REQUIRED/i)).not.toBeInTheDocument();
  });

  it('renders generic config warning when payload is generic in compact mode', () => {
    render(<PaymentRiskBadge lang="EN" compact riskEntry={{ riskLevel: 'LOW', generic: true }} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText(/Generic payment config; this is not an order-specific rail signal/i)).toBeInTheDocument();
  });

  it('keeps restricted availability guidance visible without exposing raw compact fields', () => {
    render(
      <PaymentRiskBadge
        lang="EN"
        compact
        riskEntry={{
          riskLevel: 'RESTRICTED',
          enabled: false,
          minBondSurchargeBps: 100,
          feeSurchargeBps: 50,
          source: 'config',
          warningKey: 'RESTRICTED_RAIL',
        }}
      />
    );

    expect(screen.getByText(/availability config signal/i)).toBeInTheDocument();
    expect(screen.getByText(/settlement\/release authority remains on-chain/i)).toBeInTheDocument();
    expect(screen.queryByText(/minBondSurchargeBps/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/RESTRICTED_RAIL/i)).not.toBeInTheDocument();
  });
});
