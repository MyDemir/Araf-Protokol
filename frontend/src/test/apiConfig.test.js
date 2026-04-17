import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl, resolveClientErrorLogUrl } from '../app/apiConfig';

describe('apiConfig client-error endpoint resolution', () => {
  it('normalizes VITE_API_URL without /api suffix', () => {
    const env = { PROD: true, VITE_API_URL: 'https://api.example.com' };
    expect(resolveApiBaseUrl(env)).toBe('https://api.example.com/api');
    expect(resolveClientErrorLogUrl(env)).toBe('https://api.example.com/api/logs/client-error');
  });

  it('keeps VITE_API_URL when already ending with /api', () => {
    const env = { PROD: true, VITE_API_URL: 'https://api.example.com/api' };
    expect(resolveApiBaseUrl(env)).toBe('https://api.example.com/api');
    expect(resolveClientErrorLogUrl(env)).toBe('https://api.example.com/api/logs/client-error');
  });

  it('uses same-origin /api in production when VITE_API_URL is empty', () => {
    const env = { PROD: true, VITE_API_URL: '' };
    expect(resolveApiBaseUrl(env)).toBe('/api');
    expect(resolveClientErrorLogUrl(env)).toBe('/api/logs/client-error');
  });

  it('uses localhost fallback in development when VITE_API_URL is empty', () => {
    const env = { PROD: false, VITE_API_URL: '' };
    expect(resolveApiBaseUrl(env)).toBe('http://localhost:4000/api');
    expect(resolveClientErrorLogUrl(env)).toBe('http://localhost:4000/api/logs/client-error');
  });
});
