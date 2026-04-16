import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('useArafContract logging endpoint', () => {
  it('uses canonical /api/logs/client-error builder', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/hooks/useArafContract.js'), 'utf8');
    expect(source).toContain("resolveClientErrorLogUrl");
    expect(source).toContain('CLIENT_ERROR_LOG_URL');
    expect(source).not.toContain("http://localhost:4000/api'\n");
  });
});
