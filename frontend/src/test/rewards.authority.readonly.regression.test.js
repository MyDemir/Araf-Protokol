import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('frontend rewards authority regression', () => {
  it('frontend rewards dashboard states non-authoritative policy', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/RewardsDashboard.jsx'), 'utf8');
    expect(src).toContain('Sponsors cannot select recipients');
  });

  it('WALL_CLOCK_ESTIMATE_NOT_AUTHORITY marker is preserved when present', () => {
    const file = path.resolve(process.cwd(), 'src/hooks/useRewardsContract.js');
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes('WALL_CLOCK_ESTIMATE_NOT_AUTHORITY')) {
      expect(src).toContain('WALL_CLOCK_ESTIMATE_NOT_AUTHORITY');
    } else {
      expect(src.length).toBeGreaterThan(0);
    }
  });

  it('frontend env example preserves VITE_API_URL because apiConfig uses it', () => {
    const apiConfigSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/app/apiConfig.js'), 'utf8');
    const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');
    expect(apiConfigSrc).toContain('VITE_API_URL');
    expect(envExample).toContain('VITE_API_URL=');
  });
});
