import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('useRewardsContract ABI source', () => {
  it('uses inline parseAbi and does not import generated artifact', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/hooks/useRewardsContract.js'), 'utf8');
    expect(source).toContain('parseAbi([');
    expect(source).not.toContain('/abi/');
    expect(source).not.toContain('ArafRewards.json');
    expect(source).not.toContain('ArafRevenueVault.json');
  });
});
