import React from 'react';
import { buildApiUrl } from './app/apiConfig';

const TAB_OVERVIEW = 'overview';
const TAB_SYNC = 'sync';
const TAB_FEEDBACK = 'feedback';

const FEEDBACK_CATEGORY_OPTIONS = ['', 'bug', 'suggestion', 'ui/ux', 'other'];
const FEEDBACK_RATING_OPTIONS = ['', '1', '2', '3', '4', '5'];
const FEEDBACK_LIMIT_OPTIONS = [10, 20, 50];

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

  const [feedbackFilters, setFeedbackFilters] = React.useState({
    category: '',
    rating: '',
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

  const refreshFeedbackNow = async () => {
    await fetchFeedback();
    showToast(lang === 'TR' ? 'Feedback yenilendi.' : 'Feedback refreshed.', 'info');
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
        <div className="text-xs text-slate-500">
          {lang === 'TR' ? 'Son yenileme' : 'Last refreshed'}: {formatDate(lastRefreshedAt)}
        </div>
      </div>

      <div className="mb-6 flex gap-2">
        {[TAB_OVERVIEW, TAB_SYNC, TAB_FEEDBACK].map((tab) => {
          const label = tab === TAB_OVERVIEW
            ? (lang === 'TR' ? 'Overview' : 'Overview')
            : tab === TAB_SYNC
              ? (lang === 'TR' ? 'Sync' : 'Sync')
              : (lang === 'TR' ? 'Feedback' : 'Feedback');
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
    </div>
  );
}

export default AdminPanel;
