import React from 'react';
import { buildApiUrl } from './app/apiConfig';
import { fmtPct, shortAddress as shortenWallet } from './app/copy';
import { mapResolutionTypeLabel } from './app/useAppSessionData';
import AdminRevenuePanel from './app/contexts/admin/AdminRevenuePanel';
// [TR] P5 — Zincir sekmesi yalnız açılınca yüklenir. [EN] Chain tab loads on first open.
const AdminChainPanel = React.lazy(() => import('./app/contexts/admin/AdminChainPanel'));

const TAB_OVERVIEW = 'overview';
const TAB_SYNC = 'sync';
const TAB_FEEDBACK = 'feedback';
const TAB_TRADES = 'trades';
const TAB_SETTLEMENT = 'settlement';
// [TR] Önceden hiç gösterilmeyen backend uçları ve kontrat owner ayarları için sekmeler.
const TAB_REVENUE = 'revenue';
const TAB_CHAIN = 'chain';
const ALL_TABS = [TAB_OVERVIEW, TAB_SYNC, TAB_FEEDBACK, TAB_TRADES, TAB_SETTLEMENT, TAB_REVENUE, TAB_CHAIN];

const FEEDBACK_CATEGORY_OPTIONS = ['', 'bug', 'suggestion', 'ui/ux', 'other'];
const FEEDBACK_RATING_OPTIONS = ['', '1', '2', '3', '4', '5'];
const FEEDBACK_LIMIT_OPTIONS = [10, 20, 50];
const TRADES_STATUS_OPTIONS = ['ALL', 'LOCKED', 'PAID', 'CHALLENGED', 'RESOLVED', 'CANCELED', 'BURNED'];
const TRADES_TIER_OPTIONS = ['', '0', '1', '2', '3', '4'];
const TRADES_ORIGIN_OPTIONS = ['ALL', 'ORDER_CHILD', 'DIRECT_ESCROW'];
const TRADES_SNAPSHOT_OPTIONS = ['ALL', 'true', 'false'];
const TRADES_LIMIT_OPTIONS = [10, 20, 50];
const SETTLEMENT_STATE_OPTIONS = ['ALL', 'PROPOSED', 'EXPIRED', 'FINALIZED', 'REJECTED', 'WITHDRAWN'];
const SETTLEMENT_LIMIT_OPTIONS = [10, 20, 50];
const ADMIN_POLL_INTERVAL_MS = 10 * 60 * 1000;

const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

const toWorkerLagLabel = (lag) => {
  if (lag === null || lag === undefined) return '—';
  return `${lag}`;
};

const toBoolBadgeClass = (value) => (
  value
    ? 'bg-success/10 text-success border border-success/40'
    : 'bg-elevated text-textSecondary border border-borderStrong'
);

function AdminPanel({ lang, authenticatedFetch, isAuthenticated, authChecked, showToast, initialTab = TAB_OVERVIEW, readProtocolConfig = null, tokenSymbols = {} }) {
  const normalizeInitialTab = (tab) => (ALL_TABS.includes(tab) ? tab : TAB_OVERVIEW);
  const [activeTab, setActiveTab] = React.useState(() => normalizeInitialTab(initialTab));

  React.useEffect(() => {
    setActiveTab(normalizeInitialTab(initialTab));
  }, [initialTab]);

  const [summary, setSummary] = React.useState(null);
  const [summaryLoading, setSummaryLoading] = React.useState(false);
  const [summaryError, setSummaryError] = React.useState('');
  const [summaryUnauthorized, setSummaryUnauthorized] = React.useState(false);
  const [summaryPollingEnabled, setSummaryPollingEnabled] = React.useState(true);

  const [feedback, setFeedback] = React.useState([]);
  const [feedbackTotal, setFeedbackTotal] = React.useState(0);
  const [feedbackLoading, setFeedbackLoading] = React.useState(false);
  const [feedbackError, setFeedbackError] = React.useState('');
  const [feedbackUnauthorized, setFeedbackUnauthorized] = React.useState(false);

  const [trades, setTrades] = React.useState([]);
  const [tradesTotal, setTradesTotal] = React.useState(0);
  const [tradesPaginationScope, setTradesPaginationScope] = React.useState(null);
  const [tradesLoading, setTradesLoading] = React.useState(false);
  const [tradesError, setTradesError] = React.useState('');
  const [tradesUnauthorized, setTradesUnauthorized] = React.useState(false);
  const [tradesPollingEnabled, setTradesPollingEnabled] = React.useState(true);
  const [expandedTradeIds, setExpandedTradeIds] = React.useState({});
  const [settlementProposals, setSettlementProposals] = React.useState([]);
  const [settlementTotal, setSettlementTotal] = React.useState(0);
  const [settlementLoading, setSettlementLoading] = React.useState(false);
  const [settlementError, setSettlementError] = React.useState('');
  const [settlementUnauthorized, setSettlementUnauthorized] = React.useState(false);
  const [settlementPollingEnabled, setSettlementPollingEnabled] = React.useState(true);

  const [feedbackFilters, setFeedbackFilters] = React.useState({
    category: '',
    rating: '',
    page: 1,
    limit: 20,
  });

  const [tradesFilters, setTradesFilters] = React.useState({
    status: 'CHALLENGED',
    tier: '',
    origin: 'ALL',
    riskOnly: false,
    snapshotComplete: 'ALL',
    page: 1,
    limit: 20,
  });
  const [settlementFilters, setSettlementFilters] = React.useState({
    state: 'ALL',
    riskOnly: false,
    page: 1,
    limit: 20,
  });

  const [lastRefreshedAt, setLastRefreshedAt] = React.useState(null);
  const authInvalidRef = React.useRef(false);

  // [TR] Admin summary fetch; 403 durumunu net ve görünür şekilde işler.
  // [EN] Admin summary fetch with explicit, visible 403 handling.
  const fetchSummary = React.useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError('');
    setSummaryUnauthorized(false);

    try {
      const res = await authenticatedFetch(buildApiUrl('admin/summary'), {
        skipRefresh: authInvalidRef.current,
        suppressAuthToast: true,
      });

      if (res.status === 403) {
        setSummary(null);
        setSummaryUnauthorized(true);
        setSummaryPollingEnabled(false);
        authInvalidRef.current = true;
        return;
      }

      // [TR] 401/409 sonrası interval'ı durdururuz; tekrar refresh/toast döngüsü oluşmasın.
      // [EN] Stop polling on 401/409 to prevent repeated refresh/toast loops.
      if (res.status === 401 || res.status === 409) {
        setSummary(null);
        setSummaryPollingEnabled(false);
        authInvalidRef.current = true;
        setSummaryError(
          lang === 'TR'
            ? 'Admin oturumu doğrulanamadı. Yeniden giriş yapın.'
            : 'Admin session is no longer valid. Please sign in again.'
        );
        return;
      }

      if (!res.ok) {
        setSummaryError(lang === 'TR' ? 'Admin özet verisi alınamadı.' : 'Failed to load admin summary.');
        return;
      }

      const data = await res.json();
      authInvalidRef.current = false;
      setSummary(data || null);
      setLastRefreshedAt(new Date().toISOString());
    } catch (_err) {
      setSummaryError(lang === 'TR' ? 'Admin özet isteğinde hata oluştu.' : 'Admin summary request failed.');
    } finally {
      setSummaryLoading(false);
    }
  }, [authenticatedFetch, lang]);

  const fetchFeedback = React.useCallback(async () => {
    setFeedbackLoading(true);
    setFeedbackError('');
    setFeedbackUnauthorized(false);

    try {
      const qs = new URLSearchParams();
      if (feedbackFilters.category) qs.set('category', feedbackFilters.category);
      if (feedbackFilters.rating) qs.set('rating', feedbackFilters.rating);
      qs.set('page', String(feedbackFilters.page || 1));
      qs.set('limit', String(feedbackFilters.limit || 20));

      const res = await authenticatedFetch(buildApiUrl(`admin/feedback?${qs.toString()}`), {
        skipRefresh: authInvalidRef.current,
        suppressAuthToast: true,
      });

      if (res.status === 403) {
        setFeedback([]);
        setFeedbackTotal(0);
        setFeedbackUnauthorized(true);
        authInvalidRef.current = true;
        return;
      }

      if (res.status === 401 || res.status === 409) {
        setFeedback([]);
        setFeedbackTotal(0);
        authInvalidRef.current = true;
        setFeedbackError(
          lang === 'TR'
            ? 'Admin feedback oturumu doğrulanamadı. Yeniden giriş yapın.'
            : 'Admin feedback session is no longer valid. Please sign in again.'
        );
        return;
      }

      if (!res.ok) {
        setFeedbackError(lang === 'TR' ? 'Feedback verisi alınamadı.' : 'Failed to load feedback data.');
        return;
      }

      const data = await res.json();
      authInvalidRef.current = false;
      setFeedback(Array.isArray(data.feedback) ? data.feedback : []);
      setFeedbackTotal(Number(data.total) || 0);
      setLastRefreshedAt(new Date().toISOString());
    } catch (_err) {
      setFeedbackError(lang === 'TR' ? 'Feedback isteğinde hata oluştu.' : 'Feedback request failed.');
    } finally {
      setFeedbackLoading(false);
    }
  }, [authenticatedFetch, feedbackFilters, lang]);

  const fetchTrades = React.useCallback(async () => {
    setTradesLoading(true);
    setTradesError('');
    setTradesUnauthorized(false);
    setTradesPaginationScope(null);

    try {
      const qs = new URLSearchParams();
      qs.set('status', tradesFilters.status);
      if (tradesFilters.tier !== '') qs.set('tier', tradesFilters.tier);
      qs.set('origin', tradesFilters.origin);
      qs.set('riskOnly', String(tradesFilters.riskOnly));
      qs.set('snapshotComplete', tradesFilters.snapshotComplete);
      qs.set('page', String(tradesFilters.page || 1));
      qs.set('limit', String(tradesFilters.limit || 20));

      const res = await authenticatedFetch(buildApiUrl(`admin/trades?${qs.toString()}`), {
        skipRefresh: authInvalidRef.current,
        suppressAuthToast: true,
      });

      if (res.status === 403) {
        setTrades([]);
        setTradesTotal(0);
        setTradesUnauthorized(true);
        setTradesPollingEnabled(false);
        authInvalidRef.current = true;
        return;
      }

      if (res.status === 401 || res.status === 409) {
        setTrades([]);
        setTradesTotal(0);
        setTradesPollingEnabled(false);
        authInvalidRef.current = true;
        setTradesError(
          lang === 'TR'
            ? 'Admin trades oturumu doğrulanamadı. Yeniden giriş yapın.'
            : 'Admin trades session is no longer valid. Please sign in again.'
        );
        return;
      }

      if (!res.ok) {
        setTradesError(lang === 'TR' ? 'Trades verisi alınamadı.' : 'Failed to load trades data.');
        return;
      }

      const data = await res.json();
      authInvalidRef.current = false;
      setTrades(Array.isArray(data.trades) ? data.trades : []);
      setTradesTotal(Number(data.total) || 0);
      setTradesPaginationScope(data?.paginationScope || null);
      setLastRefreshedAt(new Date().toISOString());
    } catch (_err) {
      setTradesError(lang === 'TR' ? 'Trades isteğinde hata oluştu.' : 'Trades request failed.');
    } finally {
      setTradesLoading(false);
    }
  }, [authenticatedFetch, lang, tradesFilters]);

  const fetchSettlementProposals = React.useCallback(async () => {
    setSettlementLoading(true);
    setSettlementError('');
    setSettlementUnauthorized(false);

    try {
      const qs = new URLSearchParams();
      qs.set('state', settlementFilters.state);
      qs.set('riskOnly', String(settlementFilters.riskOnly));
      qs.set('page', String(settlementFilters.page || 1));
      qs.set('limit', String(settlementFilters.limit || 20));

      const res = await authenticatedFetch(buildApiUrl(`admin/settlement-proposals?${qs.toString()}`), {
        skipRefresh: authInvalidRef.current,
        suppressAuthToast: true,
      });

      if (res.status === 403) {
        setSettlementProposals([]);
        setSettlementTotal(0);
        setSettlementUnauthorized(true);
        setSettlementPollingEnabled(false);
        authInvalidRef.current = true;
        return;
      }

      if (res.status === 401 || res.status === 409) {
        setSettlementProposals([]);
        setSettlementTotal(0);
        setSettlementPollingEnabled(false);
        authInvalidRef.current = true;
        setSettlementError(
          lang === 'TR'
            ? 'Admin settlement oturumu doğrulanamadı. Yeniden giriş yapın.'
            : 'Admin settlement session is no longer valid. Please sign in again.'
        );
        return;
      }

      if (!res.ok) {
        setSettlementError(lang === 'TR' ? 'Settlement verisi alınamadı.' : 'Failed to load settlement data.');
        return;
      }

      const data = await res.json();
      authInvalidRef.current = false;
      setSettlementProposals(Array.isArray(data.proposals) ? data.proposals : []);
      setSettlementTotal(Number(data.total) || 0);
      setLastRefreshedAt(new Date().toISOString());
    } catch (_err) {
      setSettlementError(lang === 'TR' ? 'Settlement isteğinde hata oluştu.' : 'Settlement request failed.');
    } finally {
      setSettlementLoading(false);
    }
  }, [authenticatedFetch, lang, settlementFilters]);

  React.useEffect(() => {
    if (!summaryPollingEnabled) return undefined;
    fetchSummary();
    const timer = setInterval(fetchSummary, ADMIN_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchSummary, summaryPollingEnabled]);

  React.useEffect(() => {
    if (activeTab !== TAB_FEEDBACK) return;
    fetchFeedback();
  }, [activeTab, fetchFeedback]);

  React.useEffect(() => {
    if (activeTab !== TAB_TRADES) return undefined;
    if (!tradesPollingEnabled) return undefined;
    fetchTrades();
    // [TR] Trades endpoint'inde enrichment maliyeti yüksek olabileceği için polling daha seyrek tutulur.
    // [EN] Keep trades polling less frequent due to heavier enrichment cost on this endpoint.
    const timer = setInterval(fetchTrades, ADMIN_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeTab, fetchTrades, tradesPollingEnabled]);

  React.useEffect(() => {
    if (activeTab !== TAB_SETTLEMENT) return undefined;
    if (!settlementPollingEnabled) return undefined;
    fetchSettlementProposals();
    const timer = setInterval(fetchSettlementProposals, ADMIN_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeTab, fetchSettlementProposals, settlementPollingEnabled]);

  React.useEffect(() => {
    if (!authChecked || !isAuthenticated) return;
    authInvalidRef.current = false;
    setSummaryPollingEnabled(true);
    setTradesPollingEnabled(true);
    setSettlementPollingEnabled(true);
  }, [authChecked, isAuthenticated]);

  const readiness = summary?.readiness || {};
  const checks = readiness?.checks || {};
  const worker = readiness?.worker || {};
  const missingConfig = Array.isArray(readiness?.missingConfig) ? readiness.missingConfig : [];
  const stats = summary?.stats || {};
  const tradeCounts = summary?.tradeCounts || {};
  const dlq = summary?.dlq || {};
  const settlementAnalytics = summary?.settlementAnalytics || {};

  const kpis = [
    { labelTR: 'Readiness', labelEN: 'Readiness', value: readiness?.ok ? 'OK' : 'NOT_READY', tone: readiness?.ok ? 'text-success' : 'text-danger' },
    { labelTR: 'Worker State', labelEN: 'Worker State', value: worker?.state || '—', tone: 'text-textPrimary' },
    { labelTR: 'Worker Lag', labelEN: 'Worker Lag', value: toWorkerLagLabel(worker?.lagBlocks), tone: 'text-warning' },
    { labelTR: 'Eksik Config', labelEN: 'Missing Config', value: `${missingConfig.length}`, tone: missingConfig.length ? 'text-danger' : 'text-success' },
    { labelTR: 'Aktif Child Trade', labelEN: 'Active Child Trades', value: `${stats?.active_child_trades ?? 0}`, tone: 'text-textPrimary' },
    { labelTR: 'Açık Sell', labelEN: 'Open Sell Orders', value: `${stats?.open_sell_orders ?? 0}`, tone: 'text-textPrimary' },
    { labelTR: 'Açık Buy', labelEN: 'Open Buy Orders', value: `${stats?.open_buy_orders ?? 0}`, tone: 'text-textPrimary' },
    { labelTR: 'Tamamlanan İşlem', labelEN: 'Completed Trades', value: `${stats?.completed_trades ?? 0}`, tone: 'text-success' },
    // [TR] HistoricalStat'ta var olup gösterilmeyen emir/hacim alanları.
    { labelTR: 'Gerçekleşen Hacim', labelEN: 'Executed Volume', value: `${stats?.executed_volume_usdt ?? 0}`, tone: 'text-textPrimary' },
    { labelTR: 'Kısmi Dolu Emir', labelEN: 'Partially Filled', value: `${stats?.partially_filled_orders ?? 0}`, tone: 'text-textPrimary' },
    { labelTR: 'Dolan Emir', labelEN: 'Filled Orders', value: `${stats?.filled_orders ?? 0}`, tone: 'text-textPrimary' },
    { labelTR: 'İptal Emir', labelEN: 'Canceled Orders', value: `${stats?.canceled_orders ?? 0}`, tone: 'text-textPrimary' },
    { labelTR: 'Yanan Bond', labelEN: 'Burned Bonds', value: `${stats?.burned_bonds_usdt ?? 0}`, tone: 'text-danger' },
    { labelTR: 'Eksik Snapshot', labelEN: 'Incomplete Snapshot Trades', value: `${tradeCounts?.incompleteSnapshot ?? 0}`, tone: 'text-warning' },
    { labelTR: 'Challenged', labelEN: 'Challenged Trades', value: `${tradeCounts?.challenged ?? 0}`, tone: 'text-warning' },
    { labelTR: 'DLQ Depth', labelEN: 'DLQ Depth', value: `${dlq?.depth ?? 0}`, tone: Number(dlq?.depth || 0) > 0 ? 'text-warning' : 'text-success' },
    { labelTR: 'Aktif Settlement', labelEN: 'Active Settlement Proposals', value: `${settlementAnalytics?.activeSettlementProposals ?? 0}`, tone: 'text-info' },
    { labelTR: 'Expired Settlement', labelEN: 'Expired Settlement Proposals', value: `${settlementAnalytics?.expiredSettlementProposals ?? 0}`, tone: 'text-warning' },
    { labelTR: '24s Finalized', labelEN: 'Finalized 24h', value: `${settlementAnalytics?.finalizedSettlementProposals24h ?? 0}`, tone: 'text-success' },
    { labelTR: 'Ort. Maker Split', labelEN: 'Avg Maker Split Bps', value: `${settlementAnalytics?.avgSettlementSplitMakerBps ?? '—'}`, tone: 'text-textPrimary' },
    { labelTR: 'Finalization Rate', labelEN: 'Settlement Finalization Rate', value: settlementAnalytics?.settlementFinalizationRate === null || settlementAnalytics?.settlementFinalizationRate === undefined ? '—' : `${Number(settlementAnalytics.settlementFinalizationRate * 100).toFixed(2)}%`, tone: 'text-textPrimary' },
  ];

  const updateFeedbackFilter = (key, value) => {
    setFeedbackFilters((prev) => ({
      ...prev,
      [key]: key === 'page' || key === 'limit' ? Number(value) : value,
      ...(key !== 'page' ? { page: 1 } : {}),
    }));
  };

  const updateTradesFilter = (key, value) => {
    setTradesFilters((prev) => ({
      ...prev,
      [key]: key === 'page' || key === 'limit' ? Number(value) : value,
      ...(key !== 'page' ? { page: 1 } : {}),
    }));
    if (key === 'status' || key === 'tier' || key === 'origin' || key === 'riskOnly' || key === 'snapshotComplete') {
      setTradesPollingEnabled(true);
    }
  };

  const updateSettlementFilter = (key, value) => {
    setSettlementFilters((prev) => ({
      ...prev,
      [key]: key === 'page' || key === 'limit' ? Number(value) : value,
      ...(key !== 'page' ? { page: 1 } : {}),
    }));
    if (key === 'state' || key === 'riskOnly') {
      setSettlementPollingEnabled(true);
    }
  };

  const refreshFeedbackNow = async () => {
    await fetchFeedback();
    if (typeof showToast === 'function') {
      showToast(lang === 'TR' ? 'Feedback yenilendi.' : 'Feedback refreshed.', 'info');
    }
  };

  const refreshSummaryNow = async () => {
    setSummaryPollingEnabled(true);
    await fetchSummary();
    if (typeof showToast === 'function') {
      showToast(lang === 'TR' ? 'Özet yenilendi.' : 'Summary refreshed.', 'info');
    }
  };

  const refreshTradesNow = async () => {
    setTradesPollingEnabled(true);
    await fetchTrades();
    if (typeof showToast === 'function') {
      showToast(lang === 'TR' ? 'Trades yenilendi.' : 'Trades refreshed.', 'info');
    }
  };

  const refreshSettlementNow = async () => {
    setSettlementPollingEnabled(true);
    await fetchSettlementProposals();
    if (typeof showToast === 'function') {
      showToast(lang === 'TR' ? 'Settlement görünümü yenilendi.' : 'Settlement observability refreshed.', 'info');
    }
  };

  const toggleTradeExpanded = (tradeId) => {
    setExpandedTradeIds((prev) => ({ ...prev, [tradeId]: !prev[tradeId] }));
  };

  const renderErrorBox = (message) => (
    <div className="bg-danger/10 border border-danger/40 text-danger rounded-xl px-4 py-3 text-sm">
      {message}
    </div>
  );

  const renderUnauthorizedBox = (title, description) => (
    <div className="bg-surface border border-danger/40 rounded-xl p-6">
      <h3 className="text-danger text-lg font-semibold mb-2">{title}</h3>
      <p className="text-textSecondary text-sm">{description}</p>
    </div>
  );

  const isWindowedTradeTotal = tradesPaginationScope?.isWindowed === true;

  return (
    <div className="p-4 md:p-8 max-w-[1200px] w-full">
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-textPrimary">{lang === 'TR' ? 'Admin Paneli' : 'Admin Panel'}</h1>
          <p className="text-textSecondary text-sm mt-1">{lang === 'TR' ? 'Salt okunur gözlem: sistem, işlemler, gelir ve kontrat ayarları' : 'Read-only observability: system, trades, revenue and contract settings'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-textMuted">
            {lang === 'TR' ? 'Son yenileme' : 'Last refreshed'}: {formatDate(lastRefreshedAt)}
          </div>
          <button onClick={refreshSummaryNow} disabled={summaryLoading} className="bg-success/15 hover:bg-success/25 disabled:opacity-60 border border-success/40 text-success rounded-lg px-3 py-1.5 text-xs font-semibold">
            {summaryLoading ? '…' : (lang === 'TR' ? 'Özet Yenile' : 'Refresh Summary')}
          </button>
        </div>
      </div>

      <div className="mb-6 -mx-4 px-4 md:mx-0 md:px-0 flex gap-2 overflow-x-auto no-scrollbar">
        {ALL_TABS.map((tab) => {
          const label = tab === TAB_OVERVIEW
            ? (lang === 'TR' ? 'Overview' : 'Overview')
            : tab === TAB_SYNC
              ? (lang === 'TR' ? 'Sync' : 'Sync')
              : tab === TAB_FEEDBACK
                ? (lang === 'TR' ? 'Feedback' : 'Feedback')
                : tab === TAB_TRADES
                  ? (lang === 'TR' ? 'Trades' : 'Trades')
                  : tab === TAB_SETTLEMENT
                    ? (lang === 'TR' ? 'Settlement' : 'Settlement')
                    : tab === TAB_REVENUE
                      ? (lang === 'TR' ? 'Gelir & Ödül' : 'Revenue & Rewards')
                      : (lang === 'TR' ? 'Kontrat' : 'On-chain');
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`shrink-0 px-4 py-2 rounded-lg border text-sm font-semibold transition ${active ? 'bg-success/10 border-success/40 text-success' : 'bg-surface border-borderSubtle text-textSecondary hover:text-textPrimary hover:border-borderStrong'}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {activeTab === TAB_OVERVIEW && (
        <section className="space-y-4">
          {summaryUnauthorized && renderUnauthorizedBox(
            lang === 'TR' ? 'Yetkisiz Erişim' : 'Unauthorized Access',
            lang === 'TR'
              ? 'Bu admin özet ekranını görüntüleme yetkiniz bulunmuyor.'
              : 'You are not authorized to view this admin summary screen.'
          )}
          {!summaryUnauthorized && summaryError && renderErrorBox(summaryError)}
          {summaryLoading && <div className="text-textSecondary text-sm">{lang === 'TR' ? 'Özet yükleniyor...' : 'Loading summary...'}</div>}
          {!summaryUnauthorized && !summaryLoading && !summaryError && !summary && (
            <div className="text-textMuted text-sm">{lang === 'TR' ? 'Özet verisi henüz yok.' : 'No summary data yet.'}</div>
          )}

          {/* [TR] Veri yokken (401/hata) sıfırlarla dolu sahte KPI ızgarası gösterilmez. */}
          {!summaryUnauthorized && summary && (
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 md:gap-3">
              {kpis.map((kpi) => (
                <div key={kpi.labelEN} className="bg-surface border border-borderSubtle rounded-xl px-3 py-2.5 md:px-4 md:py-3">
                  <div className="text-[11px] uppercase tracking-wider text-textMuted mb-1">{lang === 'TR' ? kpi.labelTR : kpi.labelEN}</div>
                  <div className={`text-xl font-bold ${kpi.tone}`}>{kpi.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* [TR] Kontratın TerminalOutcome dağılımı (backend resolutionAnalytics) ve zamanlanmış işler — daha önce hiç gösterilmiyordu. */}
          {!summaryUnauthorized && summary && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="bg-surface border border-borderSubtle rounded-xl p-4" data-testid="admin-resolution-breakdown">
                <p className="text-xs font-bold uppercase tracking-wide text-textMuted mb-2">{lang === 'TR' ? 'Kapanış türleri (kontrat sonucu)' : 'Resolution outcomes (contract)'}</p>
                {(() => {
                  const ra = summary?.resolutionAnalytics || {};
                  const rows = [
                    ['manualReleaseCount', 'Manuel onay', 'Manual release', 'text-success'],
                    ['autoReleaseCount', 'Otomatik serbest bırakma', 'Auto-release', 'text-info'],
                    ['partialSettlementCount', 'Kısmi uzlaşma', 'Partial settlement', 'text-info'],
                    ['mutualCancelCount', 'Karşılıklı iptal', 'Mutual cancel', 'text-textPrimary'],
                    ['paymentWindowExpiredCount', 'Ödeme süresi doldu (48s)', 'Payment window expired (48h)', 'text-warning'],
                    ['disputedResolutionCount', 'İtirazlı onay', 'Disputed release', 'text-warning'],
                    ['burnedCount', 'Yakıldı', 'Burned', 'text-danger'],
                    ['unknownResolvedCount', 'Bilinmeyen', 'Unknown', 'text-textMuted'],
                  ];
                  const total = rows.reduce((acc, [k]) => acc + Number(ra[k] || 0), 0);
                  return (
                    <div className="divide-y divide-borderSubtle text-sm">
                      {rows.map(([k, tr, en, tone]) => {
                        const v = Number(ra[k] || 0);
                        const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                        return (
                          <div key={k} className="flex items-center justify-between gap-3 py-1.5">
                            <span className="text-textSecondary">{lang === 'TR' ? tr : en}</span>
                            <span className={`tabular-nums font-semibold ${tone}`}>{v}<span className="ml-1 text-xs font-normal text-textMuted">{fmtPct(pct, lang)}</span></span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
              <div className="bg-surface border border-borderSubtle rounded-xl p-4" data-testid="admin-scheduler">
                <p className="text-xs font-bold uppercase tracking-wide text-textMuted mb-2">{lang === 'TR' ? 'Zamanlanmış işler (son çalışma)' : 'Scheduled jobs (last run)'}</p>
                <div className="divide-y divide-borderSubtle text-sm">
                  {[
                    ['reputationDecayLastRunAt', 'İtibar sönümleme', 'Reputation decay'],
                    ['statsSnapshotLastRunAt', 'İstatistik anlık görüntüsü', 'Stats snapshot'],
                    ['sensitiveCleanupLastRunAt', 'Hassas veri temizliği', 'Sensitive data cleanup'],
                    ['userBankRiskCleanupLastRunAt', 'Banka risk temizliği', 'Bank risk cleanup'],
                  ].map(([k, tr, en]) => (
                    <div key={k} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-textSecondary">{lang === 'TR' ? tr : en}</span>
                      <span className={`tabular-nums ${summary?.scheduler?.[k] ? 'text-textPrimary' : 'text-warning'}`}>{summary?.scheduler?.[k] ? formatDate(summary.scheduler[k]) : (lang === 'TR' ? 'Hiç çalışmadı' : 'Never ran')}</span>
                    </div>
                  ))}
                  {summary?.degraded?.isDegraded && (
                    <div className="py-1.5 text-xs text-warning">{lang === 'TR' ? 'Kısmi veri: ' : 'Partial data: '}{(summary.degraded.errors || []).map((e) => e.source).join(', ')}</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === TAB_SYNC && (
        <section className="space-y-4">
          {summaryUnauthorized && renderUnauthorizedBox(
            lang === 'TR' ? 'Yetkisiz Erişim' : 'Unauthorized Access',
            lang === 'TR'
              ? 'Bu admin senkronizasyon ekranını görüntüleme yetkiniz bulunmuyor.'
              : 'You are not authorized to view this admin sync screen.'
          )}
          {!summaryUnauthorized && summaryError && renderErrorBox(summaryError)}
          {!summaryUnauthorized && summaryLoading && <div className="text-textSecondary text-sm">{lang === 'TR' ? 'Sync verisi yükleniyor...' : 'Loading sync data...'}</div>}
          {!summaryUnauthorized && !summaryLoading && !summaryError && !summary && (
            <div className="text-textMuted text-sm">{lang === 'TR' ? 'Sync verisi henüz yok.' : 'No sync data yet.'}</div>
          )}
          {summaryUnauthorized ? null : (
            <>
          <div className="bg-surface border border-borderSubtle rounded-xl p-4">
            <h2 className="text-sm font-bold text-textPrimary mb-3">{lang === 'TR' ? 'Health Checklist' : 'Health Checklist'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {Object.entries(checks).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-sm">
                  <span className="text-textSecondary">{key}</span>
                  <span className={value ? 'text-success font-semibold' : 'text-danger font-semibold'}>{String(value)}</span>
                </div>
              ))}
              {Object.keys(checks).length === 0 && <div className="text-textMuted text-sm">—</div>}
            </div>
          </div>

          <div className="bg-surface border border-borderSubtle rounded-xl p-4">
            <h2 className="text-sm font-bold text-textPrimary mb-3">{lang === 'TR' ? 'Worker Snapshot' : 'Worker Snapshot'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {[
                ['state', worker?.state],
                ['currentBlock', worker?.currentBlock],
                ['lastSeenBlock', worker?.lastSeenBlock],
                ['lastSafeBlock', worker?.lastSafeBlock],
                ['lagBlocks', worker?.lagBlocks],
                ['maxAllowedLagBlocks', worker?.maxAllowedLagBlocks],
                ['livePollInProgress', worker?.livePollInProgress],
              ].map(([label, value]) => (
                <div key={label} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 flex items-center justify-between">
                  <span className="text-textSecondary">{label}</span>
                  <span className="text-textPrimary font-medium">{value === null || value === undefined ? '—' : String(value)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-borderSubtle rounded-xl p-4">
            <h2 className="text-sm font-bold text-textPrimary mb-3">{lang === 'TR' ? 'Missing Config' : 'Missing Config'}</h2>
            {missingConfig.length === 0 ? (
              <div className="text-success text-sm">{lang === 'TR' ? 'Eksik config yok.' : 'No missing config.'}</div>
            ) : (
              <ul className="space-y-2">
                {missingConfig.map((item) => (
                  <li key={item} className="text-danger text-sm bg-danger/10 border border-danger/40 rounded-lg px-3 py-2">{item}</li>
                ))}
              </ul>
            )}
          </div>
            </>
          )}
        </section>
      )}

      {activeTab === TAB_FEEDBACK && (
        <section className="space-y-4">
          {feedbackUnauthorized && renderUnauthorizedBox(
            lang === 'TR' ? 'Yetkisiz Erişim' : 'Unauthorized Access',
            lang === 'TR'
              ? 'Bu admin feedback ekranını görüntüleme yetkiniz bulunmuyor.'
              : 'You are not authorized to view this admin feedback screen.'
          )}
          {!feedbackUnauthorized && feedbackError && renderErrorBox(feedbackError)}
          {!feedbackUnauthorized && feedbackLoading && <div className="text-textSecondary text-sm">{lang === 'TR' ? 'Feedback yükleniyor...' : 'Loading feedback...'}</div>}

          {!feedbackUnauthorized && <div className="bg-surface border border-borderSubtle rounded-xl p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <label className="text-sm text-textSecondary flex flex-col gap-1">
                <span>{lang === 'TR' ? 'Kategori' : 'Category'}</span>
                <select value={feedbackFilters.category} onChange={(e) => updateFeedbackFilter('category', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary">
                  {FEEDBACK_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt || 'all'} value={opt}>{opt || (lang === 'TR' ? 'Tümü' : 'All')}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-textSecondary flex flex-col gap-1">
                <span>{lang === 'TR' ? 'Puan' : 'Rating'}</span>
                <select value={feedbackFilters.rating} onChange={(e) => updateFeedbackFilter('rating', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary">
                  {FEEDBACK_RATING_OPTIONS.map((opt) => (
                    <option key={opt || 'all'} value={opt}>{opt || (lang === 'TR' ? 'Tümü' : 'All')}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-textSecondary flex flex-col gap-1">
                <span>Page</span>
                <input type="number" min="1" value={feedbackFilters.page} onChange={(e) => updateFeedbackFilter('page', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary" />
              </label>

              <label className="text-sm text-textSecondary flex flex-col gap-1">
                <span>Limit</span>
                <select value={feedbackFilters.limit} onChange={(e) => updateFeedbackFilter('limit', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary">
                  {FEEDBACK_LIMIT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>

              <div className="flex items-end">
                <button onClick={refreshFeedbackNow} disabled={feedbackLoading} className="w-full bg-success/15 hover:bg-success/25 disabled:opacity-60 border border-success/40 text-success rounded-lg px-3 py-2 text-sm font-semibold">
                  {feedbackLoading ? (lang === 'TR' ? 'Yükleniyor...' : 'Loading...') : (lang === 'TR' ? 'Yenile' : 'Refresh')}
                </button>
              </div>
            </div>
          </div>}

          {!feedbackUnauthorized && <div className="bg-surface border border-borderSubtle rounded-xl overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="bg-elevated border-b border-borderSubtle text-textSecondary">
                  <th className="text-left px-3 py-2">{lang === 'TR' ? 'Tarih' : 'Date'}</th>
                  <th className="text-left px-3 py-2">Wallet</th>
                  <th className="text-left px-3 py-2">Rating</th>
                  <th className="text-left px-3 py-2">Category</th>
                  <th className="text-left px-3 py-2">Comment</th>
                </tr>
              </thead>
              <tbody>
                {feedback.map((row) => (
                  <tr key={row._id} className="border-b border-borderSubtle">
                    <td className="px-3 py-2 text-textSecondary">{formatDate(row.created_at)}</td>
                    <td className="px-3 py-2 text-textSecondary font-mono">{shortenWallet(row.wallet_address)}</td>
                    <td className="px-3 py-2 text-textPrimary">{row.rating ?? '—'}</td>
                    <td className="px-3 py-2 text-textSecondary">{row.category || '—'}</td>
                    <td className="px-3 py-2 text-textSecondary max-w-[420px]">
                      <div className="truncate" title={row.comment || ''}>{row.comment || '—'}</div>
                    </td>
                  </tr>
                ))}
                {!feedbackLoading && feedback.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-center text-textMuted">{lang === 'TR' ? 'Kayıt bulunamadı.' : 'No records found.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>}

          {!feedbackUnauthorized && <div className="text-xs text-textMuted">
            {lang === 'TR' ? 'Toplam kayıt' : 'Total records'}: {feedbackTotal}
          </div>}
        </section>
      )}

      {activeTab === TAB_TRADES && (
        <section className="space-y-4">
          {tradesUnauthorized && renderUnauthorizedBox(
            lang === 'TR' ? 'Yetkisiz Erişim' : 'Unauthorized Access',
            lang === 'TR'
              ? 'Bu admin trades ekranını görüntüleme yetkiniz bulunmuyor.'
              : 'You are not authorized to view this admin trades screen.'
          )}
          {!tradesUnauthorized && tradesError && renderErrorBox(tradesError)}
          {!tradesUnauthorized && tradesLoading && <div className="text-textSecondary text-sm">{lang === 'TR' ? 'Trades yükleniyor...' : 'Loading trades...'}</div>}

          {!tradesUnauthorized && (
            <div className="bg-surface border border-borderSubtle rounded-xl p-4 space-y-3">
              <p className="text-xs text-textSecondary">
                {lang === 'TR'
                  ? 'Admin trades yüzeyi yalnız gözlem amaçlıdır; hiçbir aksiyon/authority içermez.'
                  : 'Admin trades surface is observability-only; no actions/authority are exposed.'}
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                <label className="text-sm text-textSecondary flex flex-col gap-1">
                  <span>Status</span>
                  <select value={tradesFilters.status} onChange={(e) => updateTradesFilter('status', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary">
                    {TRADES_STATUS_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>

                <label className="text-sm text-textSecondary flex flex-col gap-1">
                  <span>Tier</span>
                  <select value={tradesFilters.tier} onChange={(e) => updateTradesFilter('tier', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary">
                    {TRADES_TIER_OPTIONS.map((opt) => <option key={opt || 'all'} value={opt}>{opt === '' ? 'ALL' : opt}</option>)}
                  </select>
                </label>

                <label className="text-sm text-textSecondary flex flex-col gap-1">
                  <span>Origin</span>
                  <select value={tradesFilters.origin} onChange={(e) => updateTradesFilter('origin', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary">
                    {TRADES_ORIGIN_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>

                <label className="text-sm text-textSecondary flex flex-col gap-1">
                  <span>Snapshot</span>
                  <select value={tradesFilters.snapshotComplete} onChange={(e) => updateTradesFilter('snapshotComplete', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary">
                    {TRADES_SNAPSHOT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt === 'ALL' ? 'ALL' : opt === 'true' ? 'Complete' : 'Incomplete'}</option>)}
                  </select>
                </label>

                <label className="text-sm text-textSecondary flex flex-col gap-1">
                  <span>Page</span>
                  <input type="number" min="1" value={tradesFilters.page} onChange={(e) => updateTradesFilter('page', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary" />
                </label>

                <label className="text-sm text-textSecondary flex flex-col gap-1">
                  <span>Limit</span>
                  <select value={tradesFilters.limit} onChange={(e) => updateTradesFilter('limit', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary">
                    {TRADES_LIMIT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>

                <div className="flex flex-col justify-end gap-2">
                  <label className="text-sm text-textSecondary flex items-center gap-2">
                    <input type="checkbox" checked={tradesFilters.riskOnly} onChange={(e) => updateTradesFilter('riskOnly', e.target.checked)} />
                    Risk Only
                  </label>
                  <button onClick={refreshTradesNow} disabled={tradesLoading} className="bg-success/15 hover:bg-success/25 disabled:opacity-60 border border-success/40 text-success rounded-lg px-3 py-2 text-sm font-semibold">
                    {tradesLoading ? (lang === 'TR' ? 'Yükleniyor...' : 'Loading...') : (lang === 'TR' ? 'Yenile' : 'Refresh')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!tradesUnauthorized && (
            <div className="bg-surface border border-borderSubtle rounded-xl overflow-x-auto">
              <table className="w-full min-w-[1700px] text-sm">
                <thead>
                  <tr className="bg-elevated border-b border-borderSubtle text-textSecondary">
                    <th className="text-left px-3 py-2">Escrow ID</th>
                    <th className="text-left px-3 py-2">Parent Order ID</th>
                    <th className="text-left px-3 py-2">Maker</th>
                    <th className="text-left px-3 py-2">Taker</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Tier</th>
                    <th className="text-left px-3 py-2">Origin</th>
                    <th className="text-left px-3 py-2">Token</th>
                    <th className="text-left px-3 py-2">Snapshot Complete</th>
                    <th className="text-left px-3 py-2">Incomplete Reason</th>
                    <th className="text-left px-3 py-2">High Risk</th>
                    <th className="text-left px-3 py-2">Changed After Lock</th>
                    <th className="text-left px-3 py-2">Frequent Recent Changes</th>
                    <th className="text-left px-3 py-2">Explainable Reasons</th>
                    <th className="text-left px-3 py-2">Captured At</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((row) => {
                    const id = row._id;
                    const reasons = Array.isArray(row?.offchain_health_score_input?.explainableReasons)
                      ? row.offchain_health_score_input.explainableReasons
                      : [];
                    const shownReasons = reasons.slice(0, 2);
                    const hiddenCount = Math.max(reasons.length - shownReasons.length, 0);
                    const expanded = Boolean(expandedTradeIds[id]);

                    return (
                      <React.Fragment key={id}>
                        <tr className="border-b border-borderSubtle cursor-pointer hover:bg-surface" onClick={() => toggleTradeExpanded(id)}>
                          <td className="px-3 py-2 text-success font-mono">{row.onchain_escrow_id || '—'}</td>
                          <td className="px-3 py-2 text-textSecondary font-mono">{row.parent_order_id || '—'}</td>
                          <td className="px-3 py-2 text-textSecondary font-mono">{shortenWallet(row.maker_address)}</td>
                          <td className="px-3 py-2 text-textSecondary font-mono">{shortenWallet(row.taker_address)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-1 items-start">
                              <span className={`px-2 py-1 rounded text-xs ${row.status === 'CHALLENGED' ? 'bg-danger/10 text-danger border border-danger/40' : 'bg-elevated text-textPrimary border border-borderStrong'}`}>{row.status || '—'}</span>
                              {['RESOLVED', 'CANCELED', 'BURNED'].includes(row.status) && (
                                <span className="text-[10px] text-textSecondary">{mapResolutionTypeLabel(row?.resolution_type, lang)}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-textPrimary">{row.tier ?? '—'}</td>
                          <td className="px-3 py-2 text-textSecondary">{row.trade_origin || '—'}</td>
                          <td className="px-3 py-2 text-textSecondary font-mono">{row.token_address ? shortenWallet(row.token_address) : '—'}</td>
                          <td className="px-3 py-2"><span className={`px-2 py-1 rounded text-xs ${toBoolBadgeClass(row?.payout_snapshot?.is_complete === true)}`}>{row?.payout_snapshot?.is_complete === true ? 'true' : 'false'}</span></td>
                          <td className="px-3 py-2 text-textSecondary">{row?.payout_snapshot?.incomplete_reason || '—'}</td>
                          <td className="px-3 py-2"><span className={`px-2 py-1 rounded text-xs ${toBoolBadgeClass(row?.bank_profile_risk?.highRiskBankProfile === true)}`}>{row?.bank_profile_risk?.highRiskBankProfile ? 'true' : 'false'}</span></td>
                          <td className="px-3 py-2"><span className={`px-2 py-1 rounded text-xs ${toBoolBadgeClass(row?.bank_profile_risk?.changedAfterLock === true)}`}>{row?.bank_profile_risk?.changedAfterLock ? 'true' : 'false'}</span></td>
                          <td className="px-3 py-2"><span className={`px-2 py-1 rounded text-xs ${toBoolBadgeClass(row?.bank_profile_risk?.frequentRecentChanges === true)}`}>{row?.bank_profile_risk?.frequentRecentChanges ? 'true' : 'false'}</span></td>
                          <td className="px-3 py-2 text-textSecondary">
                            <div className="flex items-center gap-1 flex-wrap">
                              {shownReasons.map((reason) => (
                                <span key={reason} className="px-2 py-0.5 rounded bg-elevated border border-borderStrong text-xs">{reason}</span>
                              ))}
                              {hiddenCount > 0 && <span className="px-2 py-0.5 rounded bg-elevated border border-borderStrong text-xs">+{hiddenCount}</span>}
                              {reasons.length === 0 && '—'}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-textSecondary">{formatDate(row?.offchain_health_score_input?.snapshot?.capturedAt || row?.payout_snapshot?.captured_at)}</td>
                        </tr>
                        {expanded && (
                          <tr className="bg-app border-b border-borderSubtle">
                            <td colSpan={15} className="px-4 py-3">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                                <div className="bg-surface border border-borderSubtle rounded p-2"><span className="text-textMuted">railAtLock:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.railAtLock || '—'}</span></div>
                                <div className="bg-surface border border-borderSubtle rounded p-2"><span className="text-textMuted">countryAtLock:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.countryAtLock || '—'}</span></div>
                                <div className="bg-surface border border-borderSubtle rounded p-2"><span className="text-textMuted">profileVersionAtLock:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.profileVersionAtLock ?? '—'}</span></div>
                                <div className="bg-surface border border-borderSubtle rounded p-2"><span className="text-textMuted">currentProfileVersion:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.currentProfileVersion ?? '—'}</span></div>
                                <div className="bg-surface border border-borderSubtle rounded p-2"><span className="text-textMuted">bankChangeCount7dAtLock:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.bankChangeCount7dAtLock ?? '—'}</span></div>
                                <div className="bg-surface border border-borderSubtle rounded p-2"><span className="text-textMuted">bankChangeCount30dAtLock:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.bankChangeCount30dAtLock ?? '—'}</span></div>
                                <div className="bg-surface border border-borderSubtle rounded p-2"><span className="text-textMuted">lastBankChangeAtAtLock:</span> <span className="text-textPrimary">{formatDate(row?.offchain_health_score_input?.maker?.lastBankChangeAtAtLock)}</span></div>
                                <div className="bg-surface border border-borderSubtle rounded p-2"><span className="text-textMuted">snapshot.capturedAt:</span> <span className="text-textPrimary">{formatDate(row?.offchain_health_score_input?.snapshot?.capturedAt)}</span></div>
                                <div className="bg-surface border border-borderSubtle rounded p-2"><span className="text-textMuted">snapshot.isComplete:</span> <span className="text-textPrimary">{String(row?.offchain_health_score_input?.snapshot?.isComplete ?? false)}</span></div>
                                <div className="bg-surface border border-borderSubtle rounded p-2 md:col-span-3"><span className="text-textMuted">snapshot.incompleteReason:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.snapshot?.incompleteReason || '—'}</span></div>
                                <div className="bg-surface border border-borderStrong rounded p-2 md:col-span-3">
                                  <div className="text-textSecondary mb-1">
                                    {lang === 'TR'
                                      ? 'Kontrat-authority mirror sayaçları (bilgilendirme/read-only)'
                                      : 'Contract-authority mirror counters (informational/read-only)'}
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <div><span className="text-textMuted">burn_count:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.reputationBanMirrorContext?.reputation_authority_counters?.burn_count ?? '—'}</span></div>
                                    <div><span className="text-textMuted">auto_release_count:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.reputationBanMirrorContext?.reputation_authority_counters?.auto_release_count ?? '—'}</span></div>
                                    <div><span className="text-textMuted">mutual_cancel_count:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.reputationBanMirrorContext?.reputation_authority_counters?.mutual_cancel_count ?? '—'}</span></div>
                                    <div><span className="text-textMuted">disputed_resolved_count:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.reputationBanMirrorContext?.reputation_authority_counters?.disputed_resolved_count ?? '—'}</span></div>
                                    <div><span className="text-textMuted">partial_settlement_count:</span> <span className="text-textPrimary">{row?.offchain_health_score_input?.maker?.reputationBanMirrorContext?.reputation_authority_counters?.partial_settlement_count ?? '—'}</span></div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {!tradesLoading && trades.length === 0 && (
                    <tr>
                      <td colSpan={15} className="px-3 py-5 text-center text-textMuted">{lang === 'TR' ? 'Trade kaydı bulunamadı.' : 'No trade records found.'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!tradesUnauthorized && (
            <div className="text-xs text-textMuted">
              {lang === 'TR' ? 'Toplam trade kaydı' : 'Total trade records'}: {tradesTotal}
              {isWindowedTradeTotal && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded border border-warning/40 text-warning">
                  {lang === 'TR'
                    ? 'Pencere toplamı (global değil)'
                    : 'Window total (not global)'}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {activeTab === TAB_SETTLEMENT && (
        <section className="space-y-4">
          {settlementUnauthorized && renderUnauthorizedBox(
            lang === 'TR' ? 'Yetkisiz Erişim' : 'Unauthorized Access',
            lang === 'TR'
              ? 'Bu admin settlement ekranını görüntüleme yetkiniz bulunmuyor.'
              : 'You are not authorized to view this admin settlement screen.'
          )}
          {!settlementUnauthorized && settlementError && renderErrorBox(settlementError)}
          {!settlementUnauthorized && settlementLoading && <div className="text-textSecondary text-sm">{lang === 'TR' ? 'Settlement verisi yükleniyor...' : 'Loading settlement data...'}</div>}

          {!settlementUnauthorized && (
            <div className="bg-surface border border-borderSubtle rounded-xl p-4 space-y-3">
              <p className="text-xs text-warning border border-warning/40 bg-warning/10 rounded px-3 py-2">
                {lang === 'TR'
                  ? 'Admin panel yalnız gözlem içindir. Settlement sonucunu değiştiremez.'
                  : 'Admin panel is observability-only. It cannot change settlement outcomes.'}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <label className="text-sm text-textSecondary flex flex-col gap-1">
                  <span>State</span>
                  <select value={settlementFilters.state} onChange={(e) => updateSettlementFilter('state', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary">
                    {SETTLEMENT_STATE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>
                <label className="text-sm text-textSecondary flex flex-col gap-1">
                  <span>Page</span>
                  <input type="number" min="1" value={settlementFilters.page} onChange={(e) => updateSettlementFilter('page', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary" />
                </label>
                <label className="text-sm text-textSecondary flex flex-col gap-1">
                  <span>Limit</span>
                  <select value={settlementFilters.limit} onChange={(e) => updateSettlementFilter('limit', e.target.value)} className="bg-elevated border border-borderSubtle rounded-lg px-3 py-2 text-textPrimary">
                    {SETTLEMENT_LIMIT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>
                <div className="flex items-end">
                  <label className="text-sm text-textSecondary flex items-center gap-2">
                    <input type="checkbox" checked={settlementFilters.riskOnly} onChange={(e) => updateSettlementFilter('riskOnly', e.target.checked)} />
                    Risk Only
                  </label>
                </div>
                <div className="flex items-end">
                  <button onClick={refreshSettlementNow} disabled={settlementLoading} className="w-full bg-success/15 hover:bg-success/25 disabled:opacity-60 border border-success/40 text-success rounded-lg px-3 py-2 text-sm font-semibold">
                    {settlementLoading ? (lang === 'TR' ? 'Yükleniyor...' : 'Loading...') : (lang === 'TR' ? 'Yenile' : 'Refresh')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!settlementUnauthorized && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {[
                {
                  key: 'active',
                  title: lang === 'TR' ? 'Aktif Proposals' : 'Active proposals',
                  rows: settlementProposals.filter((row) => row?.state === 'PROPOSED' && row?.is_expired !== true),
                },
                {
                  key: 'expired',
                  title: lang === 'TR' ? 'Expired Proposals' : 'Expired proposals',
                  rows: settlementProposals.filter((row) => row?.is_expired === true),
                },
                {
                  key: 'finalized',
                  title: lang === 'TR' ? 'Sonuçlanan (Yakın)' : 'Finalized (recent)',
                  rows: settlementProposals.filter((row) => row?.state === 'FINALIZED').slice(0, 10),
                },
              ].map((group) => (
                <div key={group.key} className="bg-surface border border-borderSubtle rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-textPrimary">{group.title}</h3>
                    <span className="text-xs text-textSecondary">{group.rows.length}</span>
                  </div>
                  <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                    {group.rows.map((row) => (
                      <div key={`${group.key}-${row?.proposal_id}-${row?.trade_id}`} className="bg-elevated border border-borderSubtle rounded-lg p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-success font-mono">#{row?.onchain_escrow_id || '—'}</span>
                          <span className="text-textSecondary">{row?.state || '—'}</span>
                        </div>
                        <div className="text-textSecondary mt-1 font-mono">p:{row?.proposal_id || '—'} · age:{row?.proposal_age_seconds ?? '—'}s</div>
                        <div className="text-textSecondary mt-1">maker:{shortenWallet(row?.maker_address)} · taker:{shortenWallet(row?.taker_address)}</div>
                        <div className="text-textSecondary mt-1">split:{row?.maker_share_bps ?? '—'} / {row?.taker_share_bps ?? '—'}</div>
                        <div className="text-textMuted mt-1 truncate" title={row?.tx_hash || ''}>tx:{row?.tx_hash || '—'}</div>
                      </div>
                    ))}
                    {!settlementLoading && group.rows.length === 0 && (
                      <div className="text-textMuted text-xs">{lang === 'TR' ? 'Kayıt yok.' : 'No records.'}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!settlementUnauthorized && (
            <div className="bg-surface border border-borderSubtle rounded-xl overflow-x-auto">
              <table className="w-full min-w-[1500px] text-sm">
                <thead>
                  <tr className="bg-elevated border-b border-borderSubtle text-textSecondary">
                    <th className="text-left px-3 py-2">Proposal</th>
                    <th className="text-left px-3 py-2">Escrow</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Maker</th>
                    <th className="text-left px-3 py-2">Taker</th>
                    <th className="text-left px-3 py-2">Proposed By</th>
                    <th className="text-left px-3 py-2">Split</th>
                    <th className="text-left px-3 py-2">Proposed At</th>
                    <th className="text-left px-3 py-2">Expires At</th>
                    <th className="text-left px-3 py-2">Finalized At</th>
                    <th className="text-left px-3 py-2">Derived</th>
                    <th className="text-left px-3 py-2">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {settlementProposals.map((row) => (
                    <tr key={`${row?.proposal_id}-${row?.trade_id}`} className="border-b border-borderSubtle">
                      <td className="px-3 py-2 text-success font-mono">{row?.proposal_id || '—'}</td>
                      <td className="px-3 py-2 text-textSecondary font-mono">{row?.onchain_escrow_id || '—'}</td>
                      <td className="px-3 py-2 text-textPrimary">
                        <div className="flex flex-col gap-1 items-start">
                          <span>{row?.status || '—'} / {row?.state || '—'}</span>
                          {['RESOLVED', 'CANCELED', 'BURNED'].includes(row?.status) && (
                            <span className="text-[10px] text-textSecondary">{mapResolutionTypeLabel(row?.resolution_type, lang)}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-textSecondary font-mono">{shortenWallet(row?.maker_address)}</td>
                      <td className="px-3 py-2 text-textSecondary font-mono">{shortenWallet(row?.taker_address)}</td>
                      <td className="px-3 py-2 text-textSecondary font-mono">{shortenWallet(row?.proposed_by)}</td>
                      <td className="px-3 py-2 text-textSecondary">{row?.maker_share_bps ?? '—'} / {row?.taker_share_bps ?? '—'}</td>
                      <td className="px-3 py-2 text-textSecondary">{formatDate(row?.proposed_at)}</td>
                      <td className="px-3 py-2 text-textSecondary">{formatDate(row?.expires_at)}</td>
                      <td className="px-3 py-2 text-textSecondary">{formatDate(row?.finalized_at)}</td>
                      <td className="px-3 py-2 text-textSecondary">
                        <div className="flex flex-wrap gap-1">
                          <span className={`px-2 py-0.5 rounded text-xs ${toBoolBadgeClass(row?.is_expired === true)}`}>expired:{String(row?.is_expired === true)}</span>
                          <span className={`px-2 py-0.5 rounded text-xs ${toBoolBadgeClass(row?.requires_counterparty_action === true)}`}>counterparty_action:{String(row?.requires_counterparty_action === true)}</span>
                          <span className="px-2 py-0.5 rounded text-xs bg-elevated border border-borderStrong">age:{row?.proposal_age_seconds ?? '—'}s</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-textSecondary font-mono truncate max-w-[220px]" title={row?.tx_hash || ''}>{row?.tx_hash || '—'}</td>
                    </tr>
                  ))}
                  {!settlementLoading && settlementProposals.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-5 text-center text-textMuted">{lang === 'TR' ? 'Settlement kaydı bulunamadı.' : 'No settlement records found.'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!settlementUnauthorized && (
            <div className="text-xs text-textMuted">
              {lang === 'TR' ? 'Toplam settlement kaydı' : 'Total settlement records'}: {settlementTotal}
            </div>
          )}
        </section>
      )}

      {activeTab === TAB_REVENUE && (
        <AdminRevenuePanel lang={lang} authenticatedFetch={authenticatedFetch} tokenSymbols={tokenSymbols} />
      )}

      {activeTab === TAB_CHAIN && (
        <React.Suspense fallback={<div className="p-4 text-sm text-textMuted" role="status">{lang === 'TR' ? 'Yükleniyor…' : 'Loading…'}</div>}>
          <AdminChainPanel lang={lang} readProtocolConfig={readProtocolConfig} />
        </React.Suspense>
      )}
    </div>
  );
}

export default AdminPanel;
