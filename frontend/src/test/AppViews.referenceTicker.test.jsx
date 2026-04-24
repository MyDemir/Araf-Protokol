import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AppViews reference ticker placement', () => {
  it('mounts ReferenceRateTicker in renderMarket between header and order list', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/AppViews.jsx'), 'utf8');

    const marketStart = source.indexOf('const renderMarket = () => (');
    const headerLine = source.indexOf('<h2 className="text-xl font-bold text-white">', marketStart);
    const tickerLine = source.indexOf('<ReferenceRateTicker lang={lang} />', marketStart);
    const listLine = source.indexOf('<div className="space-y-3">', marketStart);

    expect(marketStart).toBeGreaterThan(-1);
    expect(headerLine).toBeGreaterThan(-1);
    expect(tickerLine).toBeGreaterThan(headerLine);
    expect(listLine).toBeGreaterThan(tickerLine);
  });

  it('mounts ReferenceRateTicker in renderTradeRoom for active transaction context', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app/AppViews.jsx'), 'utf8');

    const tradeRoomStart = source.indexOf('const renderTradeRoom = () => {');
    const tickerLine = source.indexOf('<ReferenceRateTicker lang={lang} />', tradeRoomStart);
    const roomCardLine = source.indexOf('border rounded-2xl p-5 md:p-8 shadow-2xl', tradeRoomStart);

    expect(tradeRoomStart).toBeGreaterThan(-1);
    expect(tickerLine).toBeGreaterThan(tradeRoomStart);
    expect(roomCardLine).toBeGreaterThan(tickerLine);
  });
});
