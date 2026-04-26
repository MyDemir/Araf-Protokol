import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('useArafContract ABI source guard', () => {
  it('does not import generated ABI JSON artifact at runtime', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/hooks/useArafContract.js'), 'utf8');
    expect(source).not.toContain("../abi/ArafEscrow.json");
    expect(source).toContain('const ArafEscrowABI = parseAbi([');
  });

  it('frontend generated ABI file is not committed', () => {
    const abiPath = path.resolve(process.cwd(), 'src/abi/ArafEscrow.json');
    expect(fs.existsSync(abiPath)).toBe(false);
  });
});
