// [TR] Frontend API çözümleme helper'ları — Vite env'e göre tutarlı base/path üretir.
// [EN] Frontend API resolution helpers — produce consistent base/path from Vite env.

const stripTrailingSlash = (value = '') => value.replace(/\/+$/, '');

export const resolveApiBaseUrl = (env = import.meta.env) => {
  const configured = stripTrailingSlash(env?.VITE_API_URL || '');
  if (configured) return configured;
  if (env?.DEV) return 'http://localhost:4000';
  return '';
};

const normalizeBaseWithoutApiDup = (base) => {
  if (!base) return '';
  return base.endsWith('/api') ? base.slice(0, -4) : base;
};

export const buildApiUrl = (path, env = import.meta.env) => {
  const base = normalizeBaseWithoutApiDup(resolveApiBaseUrl(env));
  const safePath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${safePath}`;
};

export const resolveClientErrorLogUrl = (env = import.meta.env) => buildApiUrl('/api/logs/client-error', env);
