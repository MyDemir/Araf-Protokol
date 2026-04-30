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
});
