import { describe, expect, it } from 'vitest';
import {
  buildApiUrl,
  resolveApiBaseUrl,
  resolveClientErrorLogUrl,
  buildSettlementPreviewUrl,
} from '../app/apiConfig';

describe('apiConfig client-error endpoint resolution', () => {
  it('uses same-origin /api in production when VITE_API_URL is empty', () => {
    const env = { PROD: true, VITE_API_URL: '' };
    expect(resolveApiBaseUrl(env)).toBe('/api');
    expect(buildApiUrl('auth/me', env)).toBe('/api/auth/me');
    expect(resolveClientErrorLogUrl(env)).toBe('/api/logs/client-error');
  });

  it('uses localhost fallback in development when VITE_API_URL is empty', () => {
    const env = { PROD: false, VITE_API_URL: '' };
    expect(resolveApiBaseUrl(env)).toBe('http://localhost:4000/api');
    expect(buildApiUrl('trades/my', env)).toBe('http://localhost:4000/api/trades/my');
    expect(resolveClientErrorLogUrl(env)).toBe('http://localhost:4000/api/logs/client-error');
  });

  it('fails closed in production when VITE_API_URL is an external absolute URL', () => {
    const env = { PROD: true, VITE_API_URL: 'https://api.example.com' };
    expect(() => resolveApiBaseUrl(env)).toThrow(/external VITE_API_URL is disabled/i);
  });

  it('still allows explicit API URL in development for local integration workflows', () => {
    const env = { PROD: false, VITE_API_URL: 'https://api.example.com' };
    expect(resolveApiBaseUrl(env)).toBe('https://api.example.com/api');
    expect(buildApiUrl('/orders', env)).toBe('https://api.example.com/api/orders');
  });

  it('builds settlement preview endpoint under canonical API base', () => {
    const env = { PROD: true, VITE_API_URL: '' };
    expect(buildSettlementPreviewUrl('trade-123', env)).toBe('/api/trades/trade-123/settlement-proposal/preview');
  });
});
