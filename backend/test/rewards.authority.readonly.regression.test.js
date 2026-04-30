const fs = require('fs');
const path = require('path');

describe('backend rewards authority regression', () => {
  test('backend routes do not define reward authority writes', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../scripts/routes/rewards.js'), 'utf8');
    expect(src).not.toMatch(/setUserWeight|setTotalWeight|setOutcome|setClaimable|setRecipients/i);
  });

  test('backend mirror authority test exists', () => {
    const src = fs.readFileSync(path.resolve(__dirname, './rewards.mirrorAuthority.route.test.js'), 'utf8');
    expect(src).toContain('mirror');
  });

  test('backend env example preserves baseline operational keys and read-only rewards flags', () => {
    const envSample = fs.readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8');
    expect(envSample).toContain('PORT=');
    expect(envSample).toContain('MONGODB_URI=');
    expect(envSample).toContain('REDIS_URL=');
    expect(envSample).toContain('EXPECTED_CHAIN_ID=');
    expect(envSample).toContain('REWARDS_READ_ONLY=true');
    expect(envSample).toContain('REWARDS_SOURCE=ONCHAIN_MIRROR');
  });
});
