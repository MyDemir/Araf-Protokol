import { describe, it, expect } from 'vitest';
import { resolveApiBaseUrl, buildApiUrl, resolveClientErrorLogUrl } from '../app/apiConfig';

describe('apiConfig', () => {
  it('uses localhost fallback only in dev', () => {
    expect(resolveApiBaseUrl({ DEV: true, PROD: false, VITE_API_URL: '' })).toBe('http://localhost:4000');
    expect(resolveApiBaseUrl({ DEV: false, PROD: true, VITE_API_URL: '' })).toBe('');
  });

  it('normalizes base URL and avoids duplicate /api', () => {
    expect(buildApiUrl('/api/orders', { DEV: false, VITE_API_URL: 'https://api.example.com/' }))
      .toBe('https://api.example.com/api/orders');
    expect(buildApiUrl('/api/orders', { DEV: false, VITE_API_URL: 'https://api.example.com/api' }))
      .toBe('https://api.example.com/api/orders');
  });

  it('builds canonical client log endpoint', () => {
    expect(resolveClientErrorLogUrl({ DEV: true, VITE_API_URL: '' })).toBe('http://localhost:4000/api/logs/client-error');
    expect(resolveClientErrorLogUrl({ DEV: false, VITE_API_URL: 'https://backend.example.com' }))
      .toBe('https://backend.example.com/api/logs/client-error');
  });
});
