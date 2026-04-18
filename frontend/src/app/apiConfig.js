/**
 * API config resolver helpers used by frontend runtime error logging and data fetches.
 *
 * Canonical backend route contract:
 *   /api/logs/client-error
 *
 * Supported VITE_API_URL inputs:
 * 1) (prod, empty)                -> /api (same-origin rewrite/proxy)
 * 2) (dev, empty)                 -> http://localhost:4000/api
 * 3) (dev, explicit absolute)     -> https://api.example.com/api
 *
 * Dev fallback (empty VITE_API_URL):
 *   http://localhost:4000/api
 */

const trimTrailingSlashes = (value = '') => value.replace(/\/+$/, '');

/**
 * [TR] API base URL'sini canonical /api tabanına normalize eder.
 * [EN] Normalizes API base URL to canonical /api base.
 */
export const resolveApiBaseUrl = (env = import.meta.env) => {
  const raw = trimTrailingSlashes((env.VITE_API_URL || '').trim());
  const isAbsoluteUrl = /^https?:\/\//i.test(raw);

  if (env.PROD && isAbsoluteUrl) {
    // [TR] Fail-closed: production'da cross-origin API kullanımını bilinçli olarak reddediyoruz.
    //      Auth cookie modeli same-origin /api rewrite ile uyumludur.
    // [EN] Fail-closed: reject cross-origin API base in production.
    throw new Error(
      'Production API policy violation: external VITE_API_URL is disabled. Use same-origin /api rewrite.'
    );
  }

  if (raw) {
    return raw.endsWith('/api') ? raw : `${raw}/api`;
  }

  // [TR] Production'da VITE_API_URL yoksa same-origin /api rewrite'i kullan.
  // [EN] In production, fallback to same-origin /api rewrite when VITE_API_URL is missing.
  if (env.PROD) {
    return '/api';
  }

  // [TR] Geliştirme fallback'i.
  // [EN] Development fallback.
  return 'http://localhost:4000/api';
};

/**
 * [TR] API path'ini canonical base URL üstünden birleştirir.
 *      Path başında / olsa da olmasa da tek slash üretir.
 * [EN] Builds full API URL from canonical base URL with normalized slashes.
 */
export const buildApiUrl = (path = '', env = import.meta.env) => {
  const base = resolveApiBaseUrl(env).replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  return normalizedPath ? `${base}/${normalizedPath}` : base;
};

/**
 * [TR] Client error log endpoint'ini tek bir canonical noktadan üretir.
 * [EN] Builds client error log endpoint from a single canonical resolver.
 */
export const resolveClientErrorLogUrl = (env = import.meta.env) => buildApiUrl('logs/client-error', env);
