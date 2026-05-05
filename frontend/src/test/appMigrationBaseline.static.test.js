import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '..');

const readSource = (relativePath) => readFileSync(path.join(srcDir, relativePath), 'utf8');

const appSource = readSource('App.jsx');
const appViewsSource = readSource('app/AppViews.jsx');
const appModalsSource = readSource('app/AppModals.jsx');
const appShellSource = readSource('app/shell/AppShell.jsx');
const sessionProviderSource = readSource('app/providers/SessionProvider.jsx');
const contractActionProviderSource = readSource('app/providers/ContractActionProvider.jsx');
const toastProviderSource = readSource('app/providers/ToastProvider.jsx');

const expectAppImportsNamedExport = (exportName, modulePath) => {
  expect(appSource).toMatch(new RegExp(`import\\s*\\{[^}]*\\b${exportName}\\b[^}]*\\}\\s*from\\s*['"]${modulePath}['"]`));
};

const expectIdentifierInBuildContext = (source, buildName, identifier) => {
  const callIndex = source.indexOf(`${buildName}({`);
  expect(callIndex, `${buildName} call should exist`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(callIndex);
  expect(tail, `${identifier} should be wired through ${buildName}`).toMatch(new RegExp(`\\b${identifier}\\b`));
};

const extractUseArafContractDestructure = () => {
  const match = appSource.match(/const\s*\{([\s\S]*?)\}\s*=\s*useArafContract\(\)/);
  expect(match, 'useArafContract destructuring should exist').not.toBeNull();
  return match[1];
};

describe('App migration scaffold static baseline', () => {
  it('keeps App.jsx composed through buildAppViews and buildAppModals', () => {
    expectAppImportsNamedExport('buildAppViews', './app/AppViews');
    expect(appSource).toMatch(/\bbuildAppViews\s*\(\s*\{/);

    expectAppImportsNamedExport('buildAppModals', './app/AppModals');
    expect(appSource).toMatch(/\bbuildAppModals\s*\(\s*\{/);
  });

  it('keeps the important useArafContract methods destructured in App.jsx', () => {
    const contractDestructure = extractUseArafContractDestructure();
    const requiredMethods = [
      'releaseFunds',
      'challengeTrade',
      'autoRelease',
      'pingMaker',
      'pingTakerForChallenge',
      'fillSellOrder',
      'fillBuyOrder',
      'reportPayment',
      'burnExpired',
      'proposeSettlement',
      'rejectSettlement',
      'withdrawSettlement',
      'expireSettlement',
      'acceptSettlement',
    ];

    for (const method of requiredMethods) {
      expect(contractDestructure, `${method} should remain destructured from useArafContract`).toMatch(new RegExp(`\\b${method}\\b`));
    }
  });

  it('keeps the main trade, payment, challenge, PII, SIWE, sync, and navigation handlers defined and wired', () => {
    const handlerDefinitions = [
      'handleStartTrade',
      'handleReportPayment',
      'handleRelease',
      'handleChallenge',
      'handlePingMaker',
      'handleAutoRelease',
      'handleFileUpload',
      'handleUpdatePII',
      'loginWithSIWE',
    ];

    for (const handler of handlerDefinitions) {
      expect(appSource, `${handler} should still be defined in App.jsx`).toMatch(new RegExp(`const\\s+${handler}\\s*=\\s*(?:async\\s*)?\\(`));
    }

    const contractCalls = [
      'fillSellOrder',
      'fillBuyOrder',
      'reportPayment',
      'releaseFunds',
      'challengeTrade',
      'pingMaker',
      'pingTakerForChallenge',
      'autoRelease',
      'burnExpired',
    ];
    for (const contractCall of contractCalls) {
      expect(appSource, `${contractCall} should still be invoked or wired from App.jsx`).toMatch(new RegExp(`\\b${contractCall}\\b`));
    }

    for (const settlementAction of ['proposeSettlement', 'rejectSettlement', 'withdrawSettlement', 'expireSettlement', 'acceptSettlement']) {
      expectIdentifierInBuildContext(appSource, 'buildAppViews', settlementAction);
      expect(appViewsSource, `${settlementAction} should be consumed by AppViews`).toMatch(new RegExp(`\\b${settlementAction}\\b`));
    }

    for (const viewHandler of ['handleStartTrade', 'handleFileUpload', 'handleReportPayment', 'handleRelease', 'handleChallenge', 'handlePingMaker', 'handleAutoRelease']) {
      expectIdentifierInBuildContext(appSource, 'buildAppViews', viewHandler);
      expect(appViewsSource, `${viewHandler} should be consumed by AppViews`).toMatch(new RegExp(`\\b${viewHandler}\\b`));
    }

    expectIdentifierInBuildContext(appSource, 'buildAppViews', 'handleUpdatePII');
    expectIdentifierInBuildContext(appSource, 'buildAppModals', 'handleUpdatePII');
    expect(appModalsSource).toMatch(/onSubmit=\{handleUpdatePII\}/);

    expect(appSource).toMatch(/auth\/nonce\?wallet=\$\{address\}/);
    expect(appSource).toMatch(/auth\/verify/);
    expect(appSource).toMatch(/new\s+SiweMessage\s*\(/);
    expect(appSource).toMatch(/signMessageAsync\s*\(\s*\{\s*message\s*\}\s*\)/);
    expect(appSource).toMatch(/loginWithSIWE\s*\(\s*\)/);

    expect(appSource).toMatch(/_pendingBackendSync\s*:\s*true/);
    expect(appViewsSource).toMatch(/activeTrade\?\._pendingBackendSync/);
    expect(appSource).toMatch(/setActiveTrade\s*\(/);
    expect(appSource).toMatch(/setCurrentView\s*\(\s*['"]tradeRoom['"]\s*\)/);
    expect(appModalsSource).toMatch(/setActiveTrade/);
    expect(appModalsSource).toMatch(/setCurrentView/);

    expect(appSource).toMatch(/formData\.append\(\s*['"]onchainEscrowId['"]\s*,\s*String\(activeTrade\.onchainId\)\s*\)/);
    expect(appViewsSource).toMatch(/<PIIDisplay\b/);
    expect(appViewsSource).toMatch(/<input\s+type=['"]file['"][^>]*onChange=\{handleFileUpload\}/);
  });

  it('keeps AppShell available without requiring App.jsx runtime integration yet', () => {
    expect(appShellSource).toMatch(/export\s+const\s+AppShell\s*=\s*\(/);
    expect(appShellSource).toMatch(/export\s+default\s+AppShell/);
    expect(appSource).not.toMatch(/from\s+['"].*AppShell['"]/);
  });

  it('allows scaffold providers to remain minimal children passthrough wrappers', () => {
    const passthroughProviders = [
      ['SessionProvider', sessionProviderSource],
      ['ContractActionProvider', contractActionProviderSource],
      ['ToastProvider', toastProviderSource],
    ];

    for (const [providerName, source] of passthroughProviders) {
      expect(source).toMatch(new RegExp(`export\\s+const\\s+${providerName}\\s*=\\s*\\(\\s*\\{\\s*children\\s*\\}\\s*\\)\\s*=>\\s*\\{`));
      expect(source).toMatch(/return\s+<>\{children\}<\/>(?:;)?/);
      expect(source).toMatch(new RegExp(`export\\s+default\\s+${providerName}`));
    }
  });
});
