import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(__dirname, '..', '..', 'frontend', 'src');
const readSrc = (...parts) => fs.readFileSync(path.join(srcRoot, ...parts), 'utf8');

const appSource = readSrc('App.jsx');
const appViewsSource = readSrc('app', 'AppViews.jsx');
const appModalsSource = readSrc('app', 'AppModals.jsx');
const appShellSource = readSrc('app', 'shell', 'AppShell.jsx');
const appProvidersSource = readSrc('app', 'providers', 'AppProviders.jsx');
const contractLifecycleActionsSource = readSrc('app', 'actions', 'contractLifecycleActions.js');
const systemStatusBarSource = readSrc('app', 'shell', 'SystemStatusBar.jsx');
const tradeRoomPageSource = readSrc('app', 'contexts', 'trade-room', 'TradeRoomPage.jsx');
const tradeRoomPanelsSource = readSrc('app', 'contexts', 'trade-room', 'TradeRoomPanels.jsx');
const profileContextPageSource = readSrc('app', 'contexts', 'profile', 'ProfileContextPage.jsx');
const profileContextPanelSource = readSrc('app', 'contexts', 'profile', 'ProfileContextPanel.jsx');
const profilePanelsSource = readSrc('app', 'contexts', 'profile', 'ProfilePanels.jsx');
const operationsCenterPageSource = readSrc('app', 'contexts', 'operations', 'OperationsCenterPage.jsx');
const operationsPanelsSource = readSrc('app', 'contexts', 'operations', 'OperationsPanels.jsx');

const providerSources = {
  SessionProvider: readSrc('app', 'providers', 'SessionProvider.jsx'),
};

const runtimeFiles = [
  'App.jsx',
  'app/AppViews.jsx',
  'app/actions/tradeNavigationActions.js',
  'app/contexts/trade-room/TradeRoomPage.jsx',
  'app/contexts/trade-room/tradeDecisionModel.js',
];

const removedPassThroughFiles = [
  'app/providers/ToastProvider.jsx',
  'app/shell/ContextNavigation.jsx',
  'app/shell/ContextPanel.jsx',
  'app/shell/ContextOutlet.jsx',
  'app/shell/ModalHost.jsx',
  'app/shell/MobileTopBar.jsx',
  'app/shell/MobileBottomNav.jsx',
  'app/providers/ContractActionProvider.jsx',
  // RouteStateProvider was unused outside AppProviders/tests, so it is removed as dead provider scaffold.
  'app/providers/RouteStateProvider.jsx',
];

const removedTradeRoomPanelFiles = [
  'app/contexts/trade-room/TradeRoomContextPanel.jsx',
  'app/contexts/trade-room/TradeSummaryCard.jsx',
  'app/contexts/trade-room/StateGuidancePanel.jsx',
  'app/contexts/trade-room/TimerStack.jsx',
  'app/contexts/trade-room/TechnicalDetailsDisclosure.jsx',
];

const removedProfilePanelFiles = [
  'app/contexts/profile/AccountPanel.jsx',
  'app/contexts/profile/ReputationPanel.jsx',
  'app/contexts/profile/HistoryPanel.jsx',
  'app/contexts/profile/SecurityPanel.jsx',
  'app/contexts/profile/ProfileNav.jsx',
  'app/contexts/profile/profileContextModel.js',
];

const removedOperationsPanelFiles = [
  'app/contexts/operations/OperationsSummaryBar.jsx',
  'app/contexts/operations/OperationsContextPanel.jsx',
  'app/contexts/operations/PendingSyncCard.jsx',
  'app/contexts/operations/SettlementQueueCard.jsx',
];


const listFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const entryPath = path.join(dir, entry.name);
  if (entry.isDirectory()) return listFiles(entryPath);
  return [entryPath];
});

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
      expect(contractLifecycleActionsSource, `${handlerName} should be owned by contract lifecycle actions`).toContain(`const ${handlerName} = async`);
    });
    expect(appSource).not.toContain('const handleStartTrade = async');
    expect(appSource).not.toContain('const handleCreateOrder = async');
    expect(appSource).not.toContain('const loginWithSIWE = async');

    expect(appSource).toContain('} = useSessionActions({');
    expect(appSource).toContain('handleAuthAction,');
    expect(appSource).not.toContain('new SiweMessage');
    expect(providerSources.SessionProvider).toContain('new SiweMessage');
    expect(appSource).toContain("from './app/actions/contractLifecycleActions';");
    expect(appSource).toContain('buildStartTradeAction({');
    expect(appSource).toContain('buildTradeRoomActions({');
    expect(appSource).toContain('buildProfileActions({');
    expect(appSource).toContain('buildOrderActions({');
    expect(contractLifecycleActionsSource).toContain('_pendingBackendSync: true');
    expect(contractLifecycleActionsSource).toContain('setActiveTrade({ ...order, id: realTradeId, onchainId: onchainTradeId })');
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

  it('keeps operations wrapper panels consolidated while preserving model and card boundaries', () => {
    expect(operationsCenterPageSource).toContain("import { OperationsContextPanel, OperationsSummaryBar } from './OperationsPanels';");
    expect(operationsCenterPageSource).toContain("import OperationLaneTabs from './OperationLaneTabs';");
    expect(operationsCenterPageSource).toContain("import { buildOperationsContextModel } from './operationsContextModel';");
    expect(appViewsSource).toContain("import { SettlementQueueCard } from './contexts/operations/OperationsPanels';");

    [
      'OperationsSummaryBar',
      'OperationsContextPanel',
      'PendingSyncCard',
      'SettlementQueueCard',
    ].forEach((exportName) => {
      expect(operationsPanelsSource).toContain(`export const ${exportName}`);
    });

    expect(operationsPanelsSource).toContain("import OperationTradeCard from './OperationTradeCard';");
    expect(operationsPanelsSource).toContain('data-testid="pending-sync-card"');
    expect(operationsPanelsSource).toContain('data-testid="settlement-queue-card"');
    expect(operationsPanelsSource).not.toContain('buildOperationsContextModel');
    expect(operationsPanelsSource).not.toContain('buildGoToTradeRoomAction');

    removedOperationsPanelFiles.forEach((relativePath) => {
      expect(
        fs.existsSync(path.join(srcRoot, ...relativePath.split('/'))),
        `${relativePath} operations wrapper panel should stay consolidated`,
      ).toBe(false);
    });
  });

  it('keeps profile leaf panels consolidated without moving richer profile panels', () => {
    expect(profileContextPageSource).toContain("import { ProfileNav } from './ProfilePanels';");
    expect(profileContextPanelSource).toContain("import { AccountPanel, HistoryPanel, ReputationPanel, SecurityPanel } from './ProfilePanels';");
    expect(profileContextPanelSource).toContain("import PaymentProfilePanel from './PaymentProfilePanel';");
    expect(profileContextPanelSource).toContain("import MyOrdersPanel from './MyOrdersPanel';");
    expect(profileContextPanelSource).toContain("import ActiveTradesPanel from './ActiveTradesPanel';");

    [
      'profileTabs',
      'getProfileTabLabel',
      'ProfileNav',
      'AccountPanel',
      'ReputationPanel',
      'HistoryPanel',
      'SecurityPanel',
    ].forEach((exportName) => {
      expect(profilePanelsSource).toContain(`export const ${exportName}`);
    });

    expect(profilePanelsSource).toContain("{ key: 'payment'");
    expect(profilePanelsSource).toContain("{ key: 'active'");
    expect(profilePanelsSource).toContain("{ key: 'security'");
    expect(profilePanelsSource).not.toContain('PaymentProfilePanel');
    expect(profilePanelsSource).not.toContain('ActiveTradesPanel');
    expect(profilePanelsSource).not.toContain('MyOrdersPanel');

    removedProfilePanelFiles.forEach((relativePath) => {
      expect(
        fs.existsSync(path.join(srcRoot, ...relativePath.split('/'))),
        `${relativePath} tiny profile leaf panel should stay consolidated`,
      ).toBe(false);
    });
  });

  it('keeps trade-room leaf panels consolidated without moving action behavior', () => {
    expect(tradeRoomPageSource).toContain("import { ChallengedDecisionPanel, StateGuidancePanel, TechnicalDetailsDisclosure, TimerStack, TradeSummaryCard } from './TradeRoomPanels';");
    expect(tradeRoomPageSource).toContain("import PrimaryActionPanel from './PrimaryActionPanel';");
    expect(tradeRoomPageSource).toContain("import SecondaryActionsPanel from './SecondaryActionsPanel';");
    expect(tradeRoomPageSource).toContain('<>');
    expect(tradeRoomPageSource).toContain('</>');
    expect(tradeRoomPageSource).not.toContain('TradeRoomContextPanel');

    [
      'TradeSummaryCard',
      'ChallengedDecisionPanel',
      'StateGuidancePanel',
      'TimerStack',
      'TechnicalDetailsDisclosure',
    ].forEach((componentName) => {
      expect(tradeRoomPanelsSource).toContain(`export const ${componentName}`);
    });

    expect(tradeRoomPanelsSource).toContain('data-testid="trade-guidance-panel"');
    expect(tradeRoomPanelsSource).toContain('data-testid="trade-timer-summaries"');
    expect(tradeRoomPanelsSource).not.toContain('ActionGuidanceButton');
    expect(tradeRoomPanelsSource).not.toContain('actionCallbacks');

    removedTradeRoomPanelFiles.forEach((relativePath) => {
      expect(
        fs.existsSync(path.join(srcRoot, ...relativePath.split('/'))),
        `${relativePath} tiny trade-room leaf panel should stay consolidated`,
      ).toBe(false);
    });
  });

  it('keeps AppShell runtime-integrated after inlining pass-through shell scaffolds', () => {
    expect(appShellSource).toContain('export const AppShell');
    expect(appShellSource).toContain('{status ? <SystemStatusBar {...status} /> : null}');
    expect(appShellSource).toContain('{mobileTop}');
    expect(appShellSource).toContain('<div className="flex min-w-0 flex-col md:flex-row min-h-0 flex-1">');
    expect(appShellSource).toContain('{navigation}');
    expect(appShellSource).toContain('{panel}');
    expect(appShellSource).toContain('{outlet || children}');
    expect(appShellSource).toContain('{mobileBottom}');
    expect(appShellSource).toContain('{modals}');

    [
      'ContextNavigation',
      'ContextPanel',
      'ContextOutlet',
      'ModalHost',
      'MobileTopBar',
      'MobileBottomNav',
    ].forEach((componentName) => {
      expect(appShellSource, `${componentName} pass-through shell wrapper should stay removed`).not.toContain(componentName);
    });

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

    expect(appProvidersSource).not.toContain('ToastProvider');
    expect(appProvidersSource).not.toContain('ContractActionProvider');
    expect(appProvidersSource).not.toContain('RouteStateProvider');
    removedPassThroughFiles.forEach((relativePath) => {
      expect(
        fs.existsSync(path.join(srcRoot, ...relativePath.split('/'))),
        `${relativePath} pass-through scaffold should stay deleted`,
      ).toBe(false);
    });

    expect(providerSources.SessionProvider).toContain('export const SessionProvider');
    expect(providerSources.SessionProvider).toContain('<SessionActionsContext.Provider value={value}>{children}</SessionActionsContext.Provider>');
    [
      'buildStartTradeAction',
      'buildMintAction',
      'buildTradeRoomActions',
      'buildProfileActions',
      'buildOrderActions',
    ].forEach((builderName) => {
      expect(contractLifecycleActionsSource).toContain(`export const ${builderName}`);
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


  it('keeps state and active-trade user-facing copy centralized instead of adding duplicate copy modules', () => {
    const appCopyFiles = listFiles(path.join(srcRoot, 'app', 'copy'))
      .map((filePath) => path.relative(path.join(srcRoot, 'app', 'copy'), filePath).replaceAll(path.sep, '/'))
      .filter((relativePath) => /(?:state|active[-_]?trade|trade[-_]?state).*\.(?:js|jsx|ts|tsx)$/.test(relativePath));

    expect(appCopyFiles).toEqual(['states.js']);
    expect(readSrc('app', 'contexts', 'profile', 'ActiveTradesPanel.jsx')).toContain("import { getStateLabel } from '../../copy/states';");
    expect(readSrc('app', 'contexts', 'operations', 'OperationTradeCard.jsx')).toContain("import { getStateLabel } from '../../copy/states';");
  });

  it('does not let a future fixed SystemStatusBar rely only on blind top padding for content safety', () => {
    const statusBarIsFixed = /(?:^|[\s"'`])fixed(?:[\s"'`]|$)/.test(systemStatusBarSource)
      && /(?:^|[\s"'`])top-0(?:[\s"'`]|$)/.test(systemStatusBarSource);

    if (!statusBarIsFixed) {
      expect(systemStatusBarSource).not.toMatch(/fixed[\s\S]*top-0|top-0[\s\S]*fixed/);
      return;
    }

    const combinedOutletLayout = `${appShellSource}\n${appSource}`;
    expect(
      combinedOutletLayout,
      'Fixed SystemStatusBar overlays must use an intentional content offset/spacer, not only hardcoded pt-* padding.',
    ).toMatch(/statusBarOffset|systemStatus|--system-status|data-system-status-spacer|aria-label=['"]System status spacer['"]/);
  });
});
