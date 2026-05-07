import React from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { actions as actionCopy, orderSide as orderSideCopy, pii, states as stateCopy, getPiiCopy } from '../app/copy';
import { CopyProvider, getCopy, useCopy } from '../app/providers/CopyProvider';

describe('copy dictionaries', () => {
  afterEach(() => cleanup());
  it('every state key has TR and EN', () => {
    Object.keys(stateCopy).forEach((key) => {
      expect(stateCopy[key].TR).toBeTruthy();
      expect(stateCopy[key].EN).toBeTruthy();
    });
  });

  it('every action key has TR and EN', () => {
    Object.keys(actionCopy).forEach((key) => {
      expect(actionCopy[key].TR).toBeTruthy();
      expect(actionCopy[key].EN).toBeTruthy();
    });
  });

  it('orderSide SELL_CRYPTO and BUY_CRYPTO do not return raw enum as user-facing label', () => {
    expect(getCopy(orderSideCopy, 'SELL_CRYPTO', 'EN')).not.toBe('SELL_CRYPTO');
    expect(getCopy(orderSideCopy, 'BUY_CRYPTO', 'EN')).not.toBe('BUY_CRYPTO');
  });

  it('missing key fails safely with fallback', () => {
    expect(getCopy(actionCopy, 'missing_action', 'EN')).toBe('missing_action');
  });

  it('copy index exports PII helper copy without forcing it into row-shaped provider dictionaries', () => {
    expect(pii.en.sectionTitle).toBe('Secure payment details');
    expect(getPiiCopy('EN').revealBtn).toMatch(/Reveal secure payment details/i);
  });

  it('CopyProvider exposes dictionaries and getCopy through context', () => {
    const CopyHarness = () => {
      const { dictionaries, getCopy: getCopyFromContext } = useCopy();
      return React.createElement('div', null,
        React.createElement('span', { 'data-testid': 'state-copy' }, getCopyFromContext(dictionaries.states, 'LOCKED', 'EN')),
        React.createElement('span', { 'data-testid': 'dict-count' }, String(Object.keys(dictionaries).length)),
      );
    };

    render(React.createElement(CopyProvider, null, React.createElement(CopyHarness)));

    expect(screen.getByTestId('state-copy').textContent).not.toBe('LOCKED');
    expect(Number(screen.getByTestId('dict-count').textContent)).toBeGreaterThan(0);
  });

});
