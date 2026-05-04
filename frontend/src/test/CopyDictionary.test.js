import { describe, expect, it } from 'vitest';
import stateCopy from '../app/copy/states';
import actionCopy from '../app/copy/actions';
import orderSideCopy from '../app/copy/orderSide';
import { getCopy } from '../app/providers/CopyProvider';

describe('copy dictionaries', () => {
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
});
