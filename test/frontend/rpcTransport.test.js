import { describe, it, expect } from 'vitest';
import { base } from 'wagmi/chains';
import { buildRpcTransport, resolveRpcUrl } from '../../frontend/src/app/rpcTransport';

describe('P4: RPC transport with public fallback', () => {
  it('accepts only http(s) URLs', () => {
    expect(resolveRpcUrl('https://rpc.example.org/key')).toBe('https://rpc.example.org/key');
    expect(resolveRpcUrl('  ')).toBeNull();
    expect(resolveRpcUrl(undefined)).toBeNull();
    expect(resolveRpcUrl('javascript:alert(1)')).toBeNull();
    expect(resolveRpcUrl('not a url')).toBeNull();
  });

  it('uses fallback([custom, public]) when VITE_RPC_URL is set', () => {
    const t = buildRpcTransport('https://rpc.example.org/key')({ chain: base });
    expect(t.config.type).toBe('fallback');
    const inner = t.value.transports;
    expect(inner).toHaveLength(2);
    expect(inner[0].value.url).toBe('https://rpc.example.org/key');
  });

  it('is a plain public http transport when unset or invalid', () => {
    expect(buildRpcTransport(undefined)({ chain: base }).config.type).toBe('http');
    expect(buildRpcTransport('ftp://x')({ chain: base }).config.type).toBe('http');
  });
});

describe('P5: main.jsx loads connectors lazily', () => {
  it('imports wagmi/connectors dynamically, not statically', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/main.jsx'), 'utf8');
    expect(src).not.toMatch(/import\s+\{[^}]*\}\s+from\s+'wagmi\/connectors'/);
    expect(src).toContain("import('wagmi/connectors')");
  });
});
