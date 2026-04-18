import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('session guard regression checks', () => {
  it('gates signed-session checks behind authChecked to avoid flash-close race', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    expect(source).toContain('if (!authChecked) {');
    expect(source).toContain('Session check in progress. Please try again in a moment.');
  });

  it('does not force home navigation on every session clear', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/useAppSessionData.jsx'), 'utf8');
    expect(source).toContain('const { navigateHome = false, closeModals = true } = options;');
    expect(source).toContain('if (navigateHome) {');
  });

  it('guards tradeRoom rendering when activeTrade is missing', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/AppViews.jsx'), 'utf8');
    expect(source).toContain('if (!activeTrade) {');
    expect(source).toContain('No active trade found');
  });
});
