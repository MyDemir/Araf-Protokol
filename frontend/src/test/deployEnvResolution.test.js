import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

describe('frontend production env/api resolution guards', () => {
  it('App.jsx uses canonical API resolver + explicit prod warning gate', () => {
    const appSrc = read('src/App.jsx');
    expect(appSrc).toContain("import { buildApiUrl, resolveApiPolicyDiagnostics } from './app/apiConfig';");
    expect(appSrc).toContain("fetch(buildApiUrl(`auth/nonce?wallet=${address}`)");
    expect(appSrc).toContain('resolveApiPolicyDiagnostics(import.meta.env)');
    expect(appSrc).toContain('ENV_ERRORS.push(...API_POLICY_ERRORS)');
    expect(appSrc).not.toContain('VITE_API_URL tanımlı değil');
  });

  it('useAppSessionData uses canonical buildApiUrl instead of raw API_URL', () => {
    const sessionSrc = read('src/app/useAppSessionData.jsx');
    expect(sessionSrc).toContain("import { buildApiUrl } from './apiConfig';");
    expect(sessionSrc).toContain("fetch(buildApiUrl('orders/config')");
    expect(sessionSrc).not.toContain('const API_URL');
  });
});
