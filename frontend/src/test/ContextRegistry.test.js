import { describe, expect, it } from 'vitest';
import { contextRegistry } from '../app/contexts/registry/contextRegistry';

describe('contextRegistry', () => {
  it('every item has key, label.TR, label.EN, icon, layout', () => {
    for (const item of contextRegistry) {
      expect(item.key).toBeTruthy();
      expect(item.label?.TR).toBeTruthy();
      expect(item.label?.EN).toBeTruthy();
      expect(item.icon).toBeTruthy();
      expect(item.layout).toBeTruthy();
    }
  });

  it('contains required contexts', () => {
    const keys = new Set(contextRegistry.map((item) => item.key));
    for (const required of ['home', 'market', 'operations', 'tradeRoom', 'profile', 'rewards', 'help', 'admin']) {
      expect(keys.has(required)).toBe(true);
    }
  });

  it('order values are unique', () => {
    const orders = contextRegistry.map((item) => item.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
