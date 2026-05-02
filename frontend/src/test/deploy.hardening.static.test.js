import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('frontend deploy hardening static guards', () => {
  it('vite build sourcemap policy is explicit false', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.js'), 'utf8');
    expect(src).toContain('sourcemap: false');
  });

  it('docs explicitly warn VITE vars are public', () => {
    const en = fs.readFileSync(path.resolve(process.cwd(), '../docs/EN/LOCAL_DEVELOPMENT.md'), 'utf8');
    expect(en).toContain('VITE_*');
    expect(en).toContain('public');
  });
});
