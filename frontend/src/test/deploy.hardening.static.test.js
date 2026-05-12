import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('frontend deploy hardening static guards', () => {
  it('vite build sourcemap policy is explicit false', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.js'), 'utf8');
    expect(src).toContain('sourcemap: false');
  });

  it('docs explicitly warn VITE vars are public', () => {
    const en = fs.readFileSync(path.resolve(process.cwd(), '../docs/EN/DEPLOYMENT_GUIDE.md'), 'utf8');
    expect(en).toContain('VITE_*');
    expect(en).toContain('public');
  });

  it('frontend static security headers config is present', () => {
    const cfg = fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf8');
    expect(cfg).toContain('Content-Security-Policy');
    expect(cfg).toContain('Strict-Transport-Security');
    expect(cfg).toContain('X-Content-Type-Options');
    expect(cfg).toContain('Referrer-Policy');
    expect(cfg).toContain('Permissions-Policy');
  });

  it('env example does not contain secrets', () => {
    const candidate = path.resolve(process.cwd(), '.env.example');
    if (!fs.existsSync(candidate)) return;
    const env = fs.readFileSync(candidate, 'utf8');
    expect(env).not.toMatch(/JWT_SECRET|PRIVATE_KEY|MASTER_ENCRYPTION_KEY|AWS_ENCRYPTED_DATA_KEY|VAULT_TOKEN/i);
  });
});
