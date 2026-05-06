import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { removeOrderByOnchainId, resolveOrderActionFns } from '../app/orderUiModel';

describe('App routing side-aware contract selection', () => {
  const fns = {
    createSellOrder: vi.fn(),
    createBuyOrder: vi.fn(),
    cancelSellOrder: vi.fn(),
    cancelBuyOrder: vi.fn(),
    fillSellOrder: vi.fn(),
    fillBuyOrder: vi.fn(),
  };

  it('SELL_CRYPTO routes create/cancel/fill to sell handlers', () => {
    const resolved = resolveOrderActionFns('SELL_CRYPTO', fns);
    expect(resolved.createFn).toBe(fns.createSellOrder);
    expect(resolved.cancelFn).toBe(fns.cancelSellOrder);
    expect(resolved.fillFn).toBe(fns.fillSellOrder);
  });

  it('BUY_CRYPTO routes create/cancel/fill to buy handlers', () => {
    const resolved = resolveOrderActionFns('BUY_CRYPTO', fns);
    expect(resolved.createFn).toBe(fns.createBuyOrder);
    expect(resolved.cancelFn).toBe(fns.cancelBuyOrder);
    expect(resolved.fillFn).toBe(fns.fillBuyOrder);
  });

  it('UNKNOWN side fails closed and no fallback handler is returned', () => {
    expect(() => resolveOrderActionFns('UNKNOWN', fns)).toThrow(/Invalid order side/);
    expect(() => resolveOrderActionFns('MALFORMED', fns)).toThrow(/Invalid order side/);
  });

  it('cancel sync removes canceled order from both market and myOrders collections', () => {
    const market = [{ onchainId: 1 }, { onchainId: 2 }];
    const mine = [{ onchainId: 2 }, { onchainId: 3 }];

    expect(removeOrderByOnchainId(market, 2)).toStrictEqual([{ onchainId: 1 }]);
    expect(removeOrderByOnchainId(mine, 2)).toStrictEqual([{ onchainId: 3 }]);
  });

  it('routes all primary views through the AppShell outlet composition', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    const appShellBlock = source.slice(source.indexOf('<AppShell'), source.indexOf('<button', source.indexOf('<AppShell')));

    expect(source).toContain("import AppShell from './app/shell/AppShell';");
    expect(appShellBlock).toContain('status={{');
    expect(appShellBlock).toContain('envErrors: ENV_ERRORS');
    expect(appShellBlock).toContain('supportedChains');
    expect(appShellBlock).toContain('onRegisterWallet: handleRegisterWallet');
    expect(appShellBlock).toContain('navigation={renderSlimRail()}');
    expect(appShellBlock).toContain('panel={renderContextSidebar()}');
    expect(appShellBlock).toContain('mobileBottom={renderMobileNav()}');
    expect(appShellBlock).toContain('outlet={(');
    expect(appShellBlock).toContain("currentView === 'home'");
    expect(appShellBlock).toContain("currentView === 'market'");
    expect(appShellBlock).toContain("currentView === 'operations'");
    expect(appShellBlock).toContain("currentView === 'profile'");
    expect(appShellBlock).toContain("currentView === 'admin'");
    expect(appShellBlock).toContain('renderTradeRoom()');
    expect(appShellBlock).toContain('renderFooter()');
    expect(appShellBlock).toContain('modals={(');
    expect(appShellBlock).toContain('renderWalletModal()');
    expect(appShellBlock).toContain('renderFeedbackModal()');
    expect(appShellBlock).toContain('renderMakerModal()');
    expect(appShellBlock).toContain('renderProfileModal()');
    expect(appShellBlock).toContain('renderTermsModal()');
  });

});
