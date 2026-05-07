import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '..');
const readSrc = (...parts) => fs.readFileSync(path.join(srcRoot, ...parts), 'utf8');

const appSource = readSrc('App.jsx');
const appViewsSource = readSrc('app', 'AppViews.jsx');
const appModalsSource = readSrc('app', 'AppModals.jsx');
const appShellSource = readSrc('app', 'shell', 'AppShell.jsx');
const contextOutletSource = readSrc('app', 'shell', 'ContextOutlet.jsx');
const systemStatusBarSource = readSrc('app', 'shell', 'SystemStatusBar.jsx');

const providerSources = {
  SessionProvider: readSrc('app', 'providers', 'SessionProvider.jsx'),
  ContractActionProvider: readSrc('app', 'providers', 'ContractActionProvider.jsx'),
  ToastProvider: readSrc('app', 'providers', 'ToastProvider.jsx'),
};

const runtimeFiles = [
  'App.jsx',
  'app/AppViews.jsx',
  'app/actions/tradeNavigationActions.js',
  'app/contexts/trade-room/TradeRoomPage.jsx',
  'app/contexts/trade-room/tradeDecisionModel.js',
];

const extractObjectCall = (source, callName) => {
  const start = source.indexOf(`${callName}({`);
  expect(start, `${callName}({ should exist`).toBeGreaterThanOrEqual(0);

  const objectStart = source.indexOf('{', start);
  let depth = 0;
  for (let idx = objectStart; idx < source.length; idx += 1) {
    const char = source[idx];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(objectStart, idx + 1);
  }
  throw new Error(`Could not extract ${callName} object argument`);
};

describe('frontend migration scaffold baseline', () => {
  it('keeps App.jsx as composition wiring while action modules own contract handlers and session orchestration', () => {
    expect(appSource).toMatch(/import\s+\{\s*useAccount,\s*useConnect,\s*useDisconnect,\s*useSignMessage,\s*useChainId,\s*usePublicClient\s*\}\s+from\s+['"]wagmi['"]/);
    expect(appSource).toContain("import { useSessionActions } from './app/providers/SessionProvider';");
    expect(appSource).not.toContain("import { SiweMessage } from 'siwe';");
    expect(appSource).toContain("import { useAppSessionData } from './app/useAppSessionData';");
    const sessionDataBlock = extractObjectCall(appSource, 'useAppSessionData');
    expect(appSource).toMatch(/const\s+\{[\s\S]*setActiveTrade[\s\S]*authenticatedFetch[\s\S]*\}\s*=\s*useAppSessionData\(/);
    expect(sessionDataBlock).toContain('address');
    expect(sessionDataBlock).toContain('isConnected');

    [
      'handleFileUpload',
      'handleReportPayment',
      'handleProposeCancel',
      'handleRelease',
      'handleChallenge',
      'handlePingMaker',
      'handleAutoRelease',
      'handleUpdatePII',
      'handleRegisterWallet',
    ].forEach((handlerName) => {
      expect(appSource, `${handlerName} should no longer be declared inline in App.jsx`).not.toContain(`const ${handlerName} = async`);
      expect(providerSources.ContractActionProvider, `${handlerName} should be owned by ContractActionProvider actions`).toContain(`const ${handlerName} = async`);
    });
    expect(appSource).not.toContain('const handleStartTrade = async');
    expect(appSource).not.toContain('const handleCreateOrder = async');
    expect(appSource).not.toContain('const loginWithSIWE = async');

    expect(appSource).toContain('} = useSessionActions({');
    expect(appSource).toContain('handleAuthAction,');
    expect(appSource).not.toContain('new SiweMessage');
    expect(providerSources.SessionProvider).toContain('new SiweMessage');
    expect(appSource).toContain('buildStartTradeAction({');
    expect(appSource).toContain('buildTradeRoomActions({');
    expect(appSource).toContain('buildProfileActions({');
    expect(appSource).toContain('buildOrderActions({');
    expect(providerSources.ContractActionProvider).toContain('_pendingBackendSync: true');
    expect(providerSources.ContractActionProvider).toContain('setActiveTrade({ ...order, id: realTradeId, onchainId: onchainTradeId })');
  });

  it('keeps all contract methods sourced from the single App.jsx useArafContract instance', () => {
    const requiredContractMethods = [
      'releaseFunds',
      'challengeTrade',
      'autoRelease',
      'pingMaker',
      'pingTakerForChallenge',
      'fillSellOrder',
      'fillBuyOrder',
      'cancelSellOrder',
      'cancelBuyOrder',
      'signCancelProposal',
      'proposeOrApproveCancel',
      'registerWallet',
      'reportPayment',
      'burnExpired',
      'proposeSettlement',
      'rejectSettlement',
      'withdrawSettlement',
      'expireSettlement',
      'acceptSettlement',
      'approveToken',
      'getAllowance',
      'getTokenDecimals',
      'getOrder',
      'getPaused',
      'antiSybilCheck',
    ];

    expect(appSource).toContain('} = useArafContract();');
    requiredContractMethods.forEach((method) => {
      expect(appSource, `${method} must remain destructured in App.jsx`).toMatch(new RegExp(`\\b${method}\\b`));
    });
  });

  it('uses buildAppViews and buildAppModals as extracted render factories with compact action wiring', () => {
    expect(appSource).toContain("import { buildAppViews } from './app/AppViews';");
    expect(appSource).toContain("import { buildAppModals } from './app/AppModals';");
    expect(appSource).toContain('} = buildAppViews({');
    expect(appSource).toContain('} = buildAppModals({');
    expect(appViewsSource).toContain('export const buildAppViews = (ctx) => {');
    expect(appModalsSource).toContain('export const buildAppModals = (ctx) => {');

    const viewsCtx = extractObjectCall(appSource, 'buildAppViews');
    const modalsCtx = extractObjectCall(appSource, 'buildAppModals');

    [
      'handleStartTrade',
      'handleReportPayment',
      'handleRelease',
      'handleChallenge',
      'handlePingMaker',
      'handleAutoRelease',
      'settlementContractFns',
      'activeTrade',
      'setActiveTrade',
      'authenticatedFetch',
      'isSupportedChainId',
    ].forEach((key) => {
      expect(viewsCtx, `${key} should be passed into buildAppViews`).toMatch(new RegExp(`\\b${key}\\b`));
    });

    [
      'handleCreateOrder',
      'handleUpdatePII',
      'handleRegisterWallet',
      'handleDeleteOrder',
      'setActiveTrade',
    ].forEach((key) => {
      expect(modalsCtx, `${key} should be passed into buildAppModals`).toMatch(new RegExp(`\\b${key}\\b`));
    });
  });

  it('keeps AppShell runtime-integrated while provider files stay scaffold-compatible skeletons at this stage', () => {
    expect(appShellSource).toContain('export const AppShell');
    expect(appShellSource).toContain('<ContextNavigation>');
    expect(appShellSource).toContain('<ContextOutlet>{outlet || children}</ContextOutlet>');
    expect(appShellSource).toContain('{status ? <SystemStatusBar {...status} /> : null}');
    expect(appSource).toContain("import AppShell from './app/shell/AppShell';");
    expect(appSource).toContain('<AppShell');
    expect(appSource).toContain('navigation={renderSlimRail()}');
    expect(appSource).toContain('panel={renderContextSidebar()}');
    expect(appSource).toContain('mobileBottom={renderMobileNav()}');
    expect(appSource).toContain('status={systemStatus}');
    expect(appSource).toContain('const systemStatus = React.useMemo(() => ({');
    expect(appSource).toContain('envErrors: ENV_ERRORS');
    expect(appSource).toContain('supportedChains');
    expect(appSource).toContain('onRegisterWallet: handleRegisterWallet');

    expect(providerSources.SessionProvider).toContain('export const SessionProvider');
    expect(providerSources.SessionProvider).toContain('<SessionActionsContext.Provider value={value}>{children}</SessionActionsContext.Provider>');

    Object.entries(providerSources)
      .filter(([providerName]) => providerName !== 'SessionProvider')
      .forEach(([providerName, source]) => {
        expect(source).toContain(`export const ${providerName}`);
        expect(source).toMatch(/return\s+<>\{children\}<\/>;/);
      });
  });
});

describe('PR #94 frontend regression guards', () => {
  it('does not hardcode supported-chain truth in runtime trade decision inputs', () => {
    const hardcodedSupportedChain = /isSupportedChain\s*(?::\s*true|=\{true\})/;

    runtimeFiles.forEach((relativePath) => {
      const source = readSrc(...relativePath.split('/'));
      expect(source, `${relativePath} must pass real chain policy state instead of hardcoding isSupportedChain`).not.toMatch(hardcodedSupportedChain);
    });
  });

  it('keeps sidebar close paths even if the auto-close timer is later removed', () => {
    expect(appSource).not.toContain('sidebarTimerRef');
    expect(appSource).not.toContain('setTimeout(() => setSidebarOpen(false), 5000)');
    expect(appSource).toContain('const toggleSidebar = () => {');
    expect(appViewsSource).toContain('onClick={() => setSidebarOpen(false)}');
    expect(appViewsSource).toContain('onClick={toggleSidebar}');
    expect(appViewsSource).toContain('setSidebarOpen,');
    expect(readSrc('app', 'actions', 'tradeNavigationActions.js')).toContain('setSidebarOpen(false)');
  });

  it('does not let a future fixed SystemStatusBar rely only on blind top padding for content safety', () => {
    const statusBarIsFixed = /(?:^|[\s"'`])fixed(?:[\s"'`]|$)/.test(systemStatusBarSource)
      && /(?:^|[\s"'`])top-0(?:[\s"'`]|$)/.test(systemStatusBarSource);

    if (!statusBarIsFixed) {
      expect(systemStatusBarSource).not.toMatch(/fixed[\s\S]*top-0|top-0[\s\S]*fixed/);
      return;
    }

    const combinedOutletLayout = `${contextOutletSource}\n${appSource}`;
    expect(
      combinedOutletLayout,
      'Fixed SystemStatusBar overlays must use an intentional content offset/spacer, not only hardcoded pt-* padding.',
    ).toMatch(/statusBarOffset|systemStatus|--system-status|data-system-status-spacer|aria-label=['"]System status spacer['"]/);
  });
});
