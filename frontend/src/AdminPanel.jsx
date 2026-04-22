import React from 'react';
import { buildApiUrl } from './app/apiConfig';

const TAB_OVERVIEW = 'overview';
const TAB_SYNC = 'sync';
const TAB_FEEDBACK = 'feedback';
const TAB_TRADES = 'trades';

const FEEDBACK_CATEGORY_OPTIONS = ['', 'bug', 'suggestion', 'ui/ux', 'other'];
const FEEDBACK_RATING_OPTIONS = ['', '1', '2', '3', '4', '5'];
const FEEDBACK_LIMIT_OPTIONS = [10, 20, 50];
const TRADES_STATUS_OPTIONS = ['ALL', 'LOCKED', 'PAID', 'CHALLENGED', 'RESOLVED', 'CANCELED', 'BURNED'];
const TRADES_TIER_OPTIONS = ['', '0', '1', '2', '3', '4'];
const TRADES_ORIGIN_OPTIONS = ['ALL', 'ORDER_CHILD', 'DIRECT_ESCROW'];
const TRADES_SNAPSHOT_OPTIONS = ['ALL', 'true', 'false'];
const TRADES_LIMIT_OPTIONS = [10, 20, 50];

const shortenWallet = (wallet) => {
  const value = String(wallet || '').trim();
  if (!value || value.length < 10) return value || '—';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

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
    ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-700/40'
    : 'bg-[#1a1a1f] text-slate-300 border border-[#333]'
);

function AdminPanel({ lang, authenticatedFetch, showToast }) {
  const [activeTab, setActiveTab] = React.useState(TAB_OVERVIEW);

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
  const [tradesLoading, setTradesLoading] = React.useState(false);
  const [tradesError, setTradesError] = React.useState('');
  const [tradesUnauthorized, setTradesUnauthorized] = React.useState(false);
  const [tradesPollingEnabled, setTradesPollingEnabled] = React.useState(true);
  const [expandedTradeIds, setExpandedTradeIds] = React.useState({});

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

  const [lastRefreshedAt, setLastRefreshedAt] = React.useState(null);

  // [TR] Admin summary fetch; 403 durumunu net ve görünür şekilde işler.
  // [EN] Admin summary fetch with explicit, visible 403 handling.
  const fetchSummary = React.useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError('');
    setSummaryUnauthorized(false);

    try {
      const res = await authenticatedFetch(buildApiUrl('admin/summary'));

      if (res.status === 403) {
        setSummary(null);
        setSummaryUnauthorized(true);
        setSummaryPollingEnabled(false);
        return;
      }

      // [TR] 401/409 sonrası interval'ı durdururuz; tekrar refresh/toast döngüsü oluşmasın.
      // [EN] Stop polling on 401/409 to prevent repeated refresh/toast loops.
      if (res.status === 401 || res.status === 409) {
        setSummary(null);
        setSummaryPollingEnabled(false);
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

      const res = await authenticatedFetch(buildApiUrl(`admin/feedback?${qs.toString()}`));

      if (res.status === 403) {
        setFeedback([]);
        setFeedbackTotal(0);
        setFeedbackUnauthorized(true);
        return;
      }

      if (res.status === 401 || res.status === 409) {
        setFeedback([]);
        setFeedbackTotal(0);
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

    try {
      const qs = new URLSearchParams();
      qs.set('status', tradesFilters.status);
      if (tradesFilters.tier !== '') qs.set('tier', tradesFilters.tier);
      qs.set('origin', tradesFilters.origin);
      qs.set('riskOnly', String(tradesFilters.riskOnly));
      qs.set('snapshotComplete', tradesFilters.snapshotComplete);
      qs.set('page', String(tradesFilters.page || 1));
      qs.set('limit', String(tradesFilters.limit || 20));

      const res = await authenticatedFetch(buildApiUrl(`admin/trades?${qs.toString()}`));

      if (res.status === 403) {
        setTrades([]);
        setTradesTotal(0);
        setTradesUnauthorized(true);
        setTradesPollingEnabled(false);
        return;
      }

      if (res.status === 401 || res.status === 409) {
        setTrades([]);
        setTradesTotal(0);
        setTradesPollingEnabled(false);
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
      setTrades(Array.isArray(data.trades) ? data.trades : []);
      setTradesTotal(Number(data.total) || 0);
      setLastRefreshedAt(new Date().toISOString());
    } catch (_err) {
      setTradesError(lang === 'TR' ? 'Trades isteğinde hata oluştu.' : 'Trades request failed.');
    } finally {
      setTradesLoading(false);
    }
  }, [authenticatedFetch, lang, tradesFilters]);

  React.useEffect(() => {
    if (!summaryPollingEnabled) return undefined;
    fetchSummary();
    const timer = setInterval(fetchSummary, 15_000);
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
    const timer = setInterval(fetchTrades, 30_000);
    return () => clearInterval(timer);
  }, [activeTab, fetchTrades, tradesPollingEnabled]);

  const readiness = summary?.readiness || {};
  const checks = readiness?.checks || {};
  const worker = readiness?.worker || {};
  const missingConfig = Array.isArray(readiness?.missingConfig) ? readiness.missingConfig : [];
  const stats = summary?.stats || {};
  const tradeCounts = summary?.tradeCounts || {};
  const dlq = summary?.dlq || {};

  const kpis = [
    { labelTR: 'Readiness', labelEN: 'Readiness', value: readiness?.ok ? 'OK' : 'NOT_READY', tone: readiness?.ok ? 'text-emerald-400' : 'text-red-400' },
    { labelTR: 'Worker State', labelEN: 'Worker State', value: worker?.state || '—', tone: 'text-slate-100' },
    { labelTR: 'Worker Lag', labelEN: 'Worker Lag', value: toWorkerLagLabel(worker?.lagBlocks), tone: 'text-orange-400' },
    { labelTR: 'Eksik Config', labelEN: 'Missing Config', value: `${missingConfig.length}`, tone: missingConfig.length ? 'text-red-400' : 'text-emerald-400' },
    { labelTR: 'Aktif Child Trade', labelEN: 'Active Child Trades', value: `${stats?.active_child_trades ?? 0}`, tone: 'text-white' },
    { labelTR: 'Açık Sell', labelEN: 'Open Sell Orders', value: `${stats?.open_sell_orders ?? 0}`, tone: 'text-white' },
    { labelTR: 'Açık Buy', labelEN: 'Open Buy Orders', value: `${stats?.open_buy_orders ?? 0}`, tone: 'text-white' },
    { labelTR: 'Tamamlanan İşlem', labelEN: 'Completed Trades', value: `${stats?.completed_trades ?? 0}`, tone: 'text-emerald-400' },
    { labelTR: 'Yanan Bond', labelEN: 'Burned Bonds', value: `${stats?.burned_bonds_usdt ?? 0}`, tone: 'text-red-400' },
    { labelTR: 'Eksik Snapshot', labelEN: 'Incomplete Snapshot Trades', value: `${tradeCounts?.incompleteSnapshot ?? 0}`, tone: 'text-orange-400' },
    { labelTR: 'Challenged', labelEN: 'Challenged Trades', value: `${tradeCounts?.challenged ?? 0}`, tone: 'text-orange-400' },
    { labelTR: 'DLQ Depth', labelEN: 'DLQ Depth', value: `${dlq?.depth ?? 0}`, tone: Number(dlq?.depth || 0) > 0 ? 'text-orange-400' : 'text-emerald-400' },
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

  const refreshFeedbackNow = async () => {
    await fetchFeedback();
    showToast(lang === 'TR' ? 'Feedback yenilendi.' : 'Feedback refreshed.', 'info');
  };

  const refreshSummaryNow = async () => {
    setSummaryPollingEnabled(true);
    await fetchSummary();
    showToast(lang === 'TR' ? 'Özet yenilendi.' : 'Summary refreshed.', 'info');
  };

  const refreshTradesNow = async () => {
    setTradesPollingEnabled(true);
    await fetchTrades();
    showToast(lang === 'TR' ? 'Trades yenilendi.' : 'Trades refreshed.', 'info');
  };

  const toggleTradeExpanded = (tradeId) => {
    setExpandedTradeIds((prev) => ({ ...prev, [tradeId]: !prev[tradeId] }));
  };

  const renderErrorBox = (message) => (
    <div className="bg-[#1b1010] border border-red-800/40 text-red-300 rounded-xl px-4 py-3 text-sm">
      {message}
    </div>
  );

  const renderUnauthorizedBox = (title, description) => (
    <div className="bg-[#111113] border border-red-800/40 rounded-xl p-6">
      <h3 className="text-red-300 text-lg font-semibold mb-2">{title}</h3>
      <p className="text-slate-300 text-sm">{description}</p>
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-[1200px] w-full">
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">{lang === 'TR' ? 'Admin Paneli' : 'Admin Panel'}</h1>
          <p className="text-slate-400 text-sm mt-1">{lang === 'TR' ? 'Read-only gözlem: Overview + Sync + Feedback' : 'Read-only observability: Overview + Sync + Feedback'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-500">
            {lang === 'TR' ? 'Son yenileme' : 'Last refreshed'}: {formatDate(lastRefreshedAt)}
          </div>
          <button onClick={refreshSummaryNow} disabled={summaryLoading} className="bg-[#173428] hover:bg-[#1b3d2e] disabled:opacity-60 border border-emerald-800/50 text-emerald-300 rounded-lg px-3 py-1.5 text-xs font-semibold">
            {summaryLoading ? '…' : (lang === 'TR' ? 'Özet Yenile' : 'Refresh Summary')}
          </button>
        </div>
      </div>

      <div className="mb-6 flex gap-2">
        {[TAB_OVERVIEW, TAB_SYNC, TAB_FEEDBACK, TAB_TRADES].map((tab) => {
          const label = tab === TAB_OVERVIEW
            ? (lang === 'TR' ? 'Overview' : 'Overview')
            : tab === TAB_SYNC
              ? (lang === 'TR' ? 'Sync' : 'Sync')
              : tab === TAB_FEEDBACK
                ? (lang === 'TR' ? 'Feedback' : 'Feedback')
                : (lang === 'TR' ? 'Trades' : 'Trades');
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg border text-sm font-semibold transition ${active ? 'bg-[#1b1f1c] border-emerald-700 text-emerald-300' : 'bg-[#111113] border-[#222] text-slate-300 hover:text-white hover:border-[#333]'}`}
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
          {summaryLoading && <div className="text-slate-400 text-sm">{lang === 'TR' ? 'Özet yükleniyor...' : 'Loading summary...'}</div>}
          {!summaryUnauthorized && !summaryLoading && !summaryError && !summary && (
            <div className="text-slate-500 text-sm">{lang === 'TR' ? 'Özet verisi henüz yok.' : 'No summary data yet.'}</div>
          )}

          {!summaryUnauthorized && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {kpis.map((kpi) => (
                <div key={kpi.labelEN} className="bg-[#111113] border border-[#222] rounded-xl px-4 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">{lang === 'TR' ? kpi.labelTR : kpi.labelEN}</div>
                  <div className={`text-xl font-bold ${kpi.tone}`}>{kpi.value}</div>
                </div>
              ))}
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
          {!summaryUnauthorized && summaryLoading && <div className="text-slate-400 text-sm">{lang === 'TR' ? 'Sync verisi yükleniyor...' : 'Loading sync data...'}</div>}
          {!summaryUnauthorized && !summaryLoading && !summaryError && !summary && (
            <div className="text-slate-500 text-sm">{lang === 'TR' ? 'Sync verisi henüz yok.' : 'No sync data yet.'}</div>
          )}
          {summaryUnauthorized ? null : (
            <>
          <div className="bg-[#111113] border border-[#222] rounded-xl p-4">
            <h2 className="text-sm font-bold text-white mb-3">{lang === 'TR' ? 'Health Checklist' : 'Health Checklist'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {Object.entries(checks).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between bg-[#0d0d0f] border border-[#1d1d1f] rounded-lg px-3 py-2 text-sm">
                  <span className="text-slate-300">{key}</span>
                  <span className={value ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{String(value)}</span>
                </div>
              ))}
              {Object.keys(checks).length === 0 && <div className="text-slate-500 text-sm">—</div>}
            </div>
          </div>

          <div className="bg-[#111113] border border-[#222] rounded-xl p-4">
            <h2 className="text-sm font-bold text-white mb-3">{lang === 'TR' ? 'Worker Snapshot' : 'Worker Snapshot'}</h2>
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
                <div key={label} className="bg-[#0d0d0f] border border-[#1d1d1f] rounded-lg px-3 py-2 flex items-center justify-between">
                  <span className="text-slate-300">{label}</span>
                  <span className="text-white font-medium">{value === null || value === undefined ? '—' : String(value)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#111113] border border-[#222] rounded-xl p-4">
            <h2 className="text-sm font-bold text-white mb-3">{lang === 'TR' ? 'Missing Config' : 'Missing Config'}</h2>
            {missingConfig.length === 0 ? (
              <div className="text-emerald-400 text-sm">{lang === 'TR' ? 'Eksik config yok.' : 'No missing config.'}</div>
            ) : (
              <ul className="space-y-2">
                {missingConfig.map((item) => (
                  <li key={item} className="text-red-300 text-sm bg-[#1b1010] border border-red-800/30 rounded-lg px-3 py-2">{item}</li>
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
          {!feedbackUnauthorized && feedbackLoading && <div className="text-slate-400 text-sm">{lang === 'TR' ? 'Feedback yükleniyor...' : 'Loading feedback...'}</div>}

          {!feedbackUnauthorized && <div className="bg-[#111113] border border-[#222] rounded-xl p-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <label className="text-sm text-slate-300 flex flex-col gap-1">
                <span>{lang === 'TR' ? 'Kategori' : 'Category'}</span>
                <select value={feedbackFilters.category} onChange={(e) => updateFeedbackFilter('category', e.target.value)} className="bg-[#0d0d0f] border border-[#222] rounded-lg px-3 py-2 text-white">
                  {FEEDBACK_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt || 'all'} value={opt}>{opt || (lang === 'TR' ? 'Tümü' : 'All')}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-300 flex flex-col gap-1">
                <span>{lang === 'TR' ? 'Puan' : 'Rating'}</span>
                <select value={feedbackFilters.rating} onChange={(e) => updateFeedbackFilter('rating', e.target.value)} className="bg-[#0d0d0f] border border-[#222] rounded-lg px-3 py-2 text-white">
                  {FEEDBACK_RATING_OPTIONS.map((opt) => (
                    <option key={opt || 'all'} value={opt}>{opt || (lang === 'TR' ? 'Tümü' : 'All')}</option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-300 flex flex-col gap-1">
                <span>Page</span>
                <input type="number" min="1" value={feedbackFilters.page} onChange={(e) => updateFeedbackFilter('page', e.target.value)} className="bg-[#0d0d0f] border border-[#222] rounded-lg px-3 py-2 text-white" />
              </label>

              <label className="text-sm text-slate-300 flex flex-col gap-1">
                <span>Limit</span>
                <select value={feedbackFilters.limit} onChange={(e) => updateFeedbackFilter('limit', e.target.value)} className="bg-[#0d0d0f] border border-[#222] rounded-lg px-3 py-2 text-white">
                  {FEEDBACK_LIMIT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>

              <div className="flex items-end">
                <button onClick={refreshFeedbackNow} disabled={feedbackLoading} className="w-full bg-[#173428] hover:bg-[#1b3d2e] disabled:opacity-60 border border-emerald-800/50 text-emerald-300 rounded-lg px-3 py-2 text-sm font-semibold">
                  {feedbackLoading ? (lang === 'TR' ? 'Yükleniyor...' : 'Loading...') : (lang === 'TR' ? 'Yenile' : 'Refresh')}
                </button>
              </div>
            </div>
          </div>}

          {!feedbackUnauthorized && <div className="bg-[#111113] border border-[#222] rounded-xl overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="bg-[#0d0d0f] border-b border-[#222] text-slate-300">
                  <th className="text-left px-3 py-2">{lang === 'TR' ? 'Tarih' : 'Date'}</th>
                  <th className="text-left px-3 py-2">Wallet</th>
                  <th className="text-left px-3 py-2">Rating</th>
                  <th className="text-left px-3 py-2">Category</th>
                  <th className="text-left px-3 py-2">Comment</th>
                </tr>
              </thead>
              <tbody>
                {feedback.map((row) => (
                  <tr key={row._id} className="border-b border-[#1c1c1f]">
                    <td className="px-3 py-2 text-slate-300">{formatDate(row.created_at)}</td>
                    <td className="px-3 py-2 text-slate-400 font-mono">{shortenWallet(row.wallet_address)}</td>
                    <td className="px-3 py-2 text-white">{row.rating ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-300">{row.category || '—'}</td>
                    <td className="px-3 py-2 text-slate-300 max-w-[420px]">
                      <div className="truncate" title={row.comment || ''}>{row.comment || '—'}</div>
                    </td>
                  </tr>
                ))}
                {!feedbackLoading && feedback.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-center text-slate-500">{lang === 'TR' ? 'Kayıt bulunamadı.' : 'No records found.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>}

          {!feedbackUnauthorized && <div className="text-xs text-slate-500">
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
          {!tradesUnauthorized && tradesLoading && <div className="text-slate-400 text-sm">{lang === 'TR' ? 'Trades yükleniyor...' : 'Loading trades...'}</div>}

          {!tradesUnauthorized && (
            <div className="bg-[#111113] border border-[#222] rounded-xl p-4 space-y-3">
              <p className="text-xs text-slate-400">
                {lang === 'TR'
                  ? 'Admin trades yüzeyi yalnız gözlem amaçlıdır; hiçbir aksiyon/authority içermez.'
                  : 'Admin trades surface is observability-only; no actions/authority are exposed.'}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-3">
                <label className="text-sm text-slate-300 flex flex-col gap-1">
                  <span>Status</span>
                  <select value={tradesFilters.status} onChange={(e) => updateTradesFilter('status', e.target.value)} className="bg-[#0d0d0f] border border-[#222] rounded-lg px-3 py-2 text-white">
                    {TRADES_STATUS_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>

                <label className="text-sm text-slate-300 flex flex-col gap-1">
                  <span>Tier</span>
                  <select value={tradesFilters.tier} onChange={(e) => updateTradesFilter('tier', e.target.value)} className="bg-[#0d0d0f] border border-[#222] rounded-lg px-3 py-2 text-white">
                    {TRADES_TIER_OPTIONS.map((opt) => <option key={opt || 'all'} value={opt}>{opt === '' ? 'ALL' : opt}</option>)}
                  </select>
                </label>

                <label className="text-sm text-slate-300 flex flex-col gap-1">
                  <span>Origin</span>
                  <select value={tradesFilters.origin} onChange={(e) => updateTradesFilter('origin', e.target.value)} className="bg-[#0d0d0f] border border-[#222] rounded-lg px-3 py-2 text-white">
                    {TRADES_ORIGIN_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>

                <label className="text-sm text-slate-300 flex flex-col gap-1">
                  <span>Snapshot</span>
                  <select value={tradesFilters.snapshotComplete} onChange={(e) => updateTradesFilter('snapshotComplete', e.target.value)} className="bg-[#0d0d0f] border border-[#222] rounded-lg px-3 py-2 text-white">
                    {TRADES_SNAPSHOT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt === 'ALL' ? 'ALL' : opt === 'true' ? 'Complete' : 'Incomplete'}</option>)}
                  </select>
                </label>

                <label className="text-sm text-slate-300 flex flex-col gap-1">
                  <span>Page</span>
                  <input type="number" min="1" value={tradesFilters.page} onChange={(e) => updateTradesFilter('page', e.target.value)} className="bg-[#0d0d0f] border border-[#222] rounded-lg px-3 py-2 text-white" />
                </label>

                <label className="text-sm text-slate-300 flex flex-col gap-1">
                  <span>Limit</span>
                  <select value={tradesFilters.limit} onChange={(e) => updateTradesFilter('limit', e.target.value)} className="bg-[#0d0d0f] border border-[#222] rounded-lg px-3 py-2 text-white">
                    {TRADES_LIMIT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>

                <div className="flex flex-col justify-end gap-2">
                  <label className="text-sm text-slate-300 flex items-center gap-2">
                    <input type="checkbox" checked={tradesFilters.riskOnly} onChange={(e) => updateTradesFilter('riskOnly', e.target.checked)} />
                    Risk Only
                  </label>
                  <button onClick={refreshTradesNow} disabled={tradesLoading} className="bg-[#173428] hover:bg-[#1b3d2e] disabled:opacity-60 border border-emerald-800/50 text-emerald-300 rounded-lg px-3 py-2 text-sm font-semibold">
                    {tradesLoading ? (lang === 'TR' ? 'Yükleniyor...' : 'Loading...') : (lang === 'TR' ? 'Yenile' : 'Refresh')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!tradesUnauthorized && (
            <div className="bg-[#111113] border border-[#222] rounded-xl overflow-x-auto">
              <table className="w-full min-w-[1700px] text-sm">
                <thead>
                  <tr className="bg-[#0d0d0f] border-b border-[#222] text-slate-300">
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
                        <tr className="border-b border-[#1c1c1f] cursor-pointer hover:bg-[#121217]" onClick={() => toggleTradeExpanded(id)}>
                          <td className="px-3 py-2 text-emerald-300 font-mono">{row.onchain_escrow_id || '—'}</td>
                          <td className="px-3 py-2 text-slate-300 font-mono">{row.parent_order_id || '—'}</td>
                          <td className="px-3 py-2 text-slate-300 font-mono">{shortenWallet(row.maker_address)}</td>
                          <td className="px-3 py-2 text-slate-300 font-mono">{shortenWallet(row.taker_address)}</td>
                          <td className="px-3 py-2"><span className={`px-2 py-1 rounded text-xs ${row.status === 'CHALLENGED' ? 'bg-red-900/40 text-red-300 border border-red-700/40' : 'bg-[#1a1a1f] text-slate-200 border border-[#333]'}`}>{row.status || '—'}</span></td>
                          <td className="px-3 py-2 text-white">{row.tier ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-300">{row.trade_origin || '—'}</td>
                          <td className="px-3 py-2 text-slate-300 font-mono">{row.token_address ? shortenWallet(row.token_address) : '—'}</td>
                          <td className="px-3 py-2"><span className={`px-2 py-1 rounded text-xs ${toBoolBadgeClass(row?.payout_snapshot?.is_complete === true)}`}>{row?.payout_snapshot?.is_complete === true ? 'true' : 'false'}</span></td>
                          <td className="px-3 py-2 text-slate-300">{row?.payout_snapshot?.incomplete_reason || '—'}</td>
                          <td className="px-3 py-2"><span className={`px-2 py-1 rounded text-xs ${toBoolBadgeClass(row?.bank_profile_risk?.highRiskBankProfile === true)}`}>{row?.bank_profile_risk?.highRiskBankProfile ? 'true' : 'false'}</span></td>
                          <td className="px-3 py-2"><span className={`px-2 py-1 rounded text-xs ${toBoolBadgeClass(row?.bank_profile_risk?.changedAfterLock === true)}`}>{row?.bank_profile_risk?.changedAfterLock ? 'true' : 'false'}</span></td>
                          <td className="px-3 py-2"><span className={`px-2 py-1 rounded text-xs ${toBoolBadgeClass(row?.bank_profile_risk?.frequentRecentChanges === true)}`}>{row?.bank_profile_risk?.frequentRecentChanges ? 'true' : 'false'}</span></td>
                          <td className="px-3 py-2 text-slate-300">
                            <div className="flex items-center gap-1 flex-wrap">
                              {shownReasons.map((reason) => (
                                <span key={reason} className="px-2 py-0.5 rounded bg-[#1a1a1f] border border-[#333] text-xs">{reason}</span>
                              ))}
                              {hiddenCount > 0 && <span className="px-2 py-0.5 rounded bg-[#1a1a1f] border border-[#333] text-xs">+{hiddenCount}</span>}
                              {reasons.length === 0 && '—'}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-300">{formatDate(row?.offchain_health_score_input?.snapshot?.capturedAt || row?.payout_snapshot?.captured_at)}</td>
                        </tr>
                        {expanded && (
                          <tr className="bg-[#0c0c0f] border-b border-[#1c1c1f]">
                            <td colSpan={15} className="px-4 py-3">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                                <div className="bg-[#111113] border border-[#222] rounded p-2"><span className="text-slate-500">railAtLock:</span> <span className="text-white">{row?.offchain_health_score_input?.maker?.railAtLock || '—'}</span></div>
                                <div className="bg-[#111113] border border-[#222] rounded p-2"><span className="text-slate-500">countryAtLock:</span> <span className="text-white">{row?.offchain_health_score_input?.maker?.countryAtLock || '—'}</span></div>
                                <div className="bg-[#111113] border border-[#222] rounded p-2"><span className="text-slate-500">profileVersionAtLock:</span> <span className="text-white">{row?.offchain_health_score_input?.maker?.profileVersionAtLock ?? '—'}</span></div>
                                <div className="bg-[#111113] border border-[#222] rounded p-2"><span className="text-slate-500">currentProfileVersion:</span> <span className="text-white">{row?.offchain_health_score_input?.maker?.currentProfileVersion ?? '—'}</span></div>
                                <div className="bg-[#111113] border border-[#222] rounded p-2"><span className="text-slate-500">bankChangeCount7dAtLock:</span> <span className="text-white">{row?.offchain_health_score_input?.maker?.bankChangeCount7dAtLock ?? '—'}</span></div>
                                <div className="bg-[#111113] border border-[#222] rounded p-2"><span className="text-slate-500">bankChangeCount30dAtLock:</span> <span className="text-white">{row?.offchain_health_score_input?.maker?.bankChangeCount30dAtLock ?? '—'}</span></div>
                                <div className="bg-[#111113] border border-[#222] rounded p-2"><span className="text-slate-500">lastBankChangeAtAtLock:</span> <span className="text-white">{formatDate(row?.offchain_health_score_input?.maker?.lastBankChangeAtAtLock)}</span></div>
                                <div className="bg-[#111113] border border-[#222] rounded p-2"><span className="text-slate-500">snapshot.capturedAt:</span> <span className="text-white">{formatDate(row?.offchain_health_score_input?.snapshot?.capturedAt)}</span></div>
                                <div className="bg-[#111113] border border-[#222] rounded p-2"><span className="text-slate-500">snapshot.isComplete:</span> <span className="text-white">{String(row?.offchain_health_score_input?.snapshot?.isComplete ?? false)}</span></div>
                                <div className="bg-[#111113] border border-[#222] rounded p-2 md:col-span-3"><span className="text-slate-500">snapshot.incompleteReason:</span> <span className="text-white">{row?.offchain_health_score_input?.snapshot?.incompleteReason || '—'}</span></div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {!tradesLoading && trades.length === 0 && (
                    <tr>
                      <td colSpan={15} className="px-3 py-5 text-center text-slate-500">{lang === 'TR' ? 'Trade kaydı bulunamadı.' : 'No trade records found.'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!tradesUnauthorized && (
            <div className="text-xs text-slate-500">
              {lang === 'TR' ? 'Toplam trade kaydı' : 'Total trade records'}: {tradesTotal}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default AdminPanel;
