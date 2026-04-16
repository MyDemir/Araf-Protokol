import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

describe('frontend production env/api resolution guards', () => {
  it('App.jsx uses dev localhost fallback and explicit prod warning gate', () => {
    const appSrc = read('src/App.jsx');
    expect(appSrc).toContain("const API_URL = import.meta.env.VITE_API_URL || (");
    expect(appSrc).toContain("import.meta.env.DEV ? 'http://localhost:4000' : ''");
    expect(appSrc).toContain('VITE_API_URL tanımlı değil');
    expect(appSrc).toContain('/api proxy (frontend/vercel.json)');
  });

  it('useAppSessionData keeps same API base policy as App', () => {
    const sessionSrc = read('src/app/useAppSessionData.jsx');
    expect(sessionSrc).toContain("const API_URL = import.meta.env.VITE_API_URL || (");
    expect(sessionSrc).toContain("import.meta.env.DEV ? 'http://localhost:4000' : ''");
    expect(sessionSrc).toContain('`${API_URL}/api/orders/config`');
  });
});
