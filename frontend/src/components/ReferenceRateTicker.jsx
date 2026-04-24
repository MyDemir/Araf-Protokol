import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildApiUrl } from '../app/apiConfig';

const POLL_MS = 60_000;

const sourceLabel = (item, lang) => {
  if (item.sourceKind === 'FIAT_OFFICIAL_REFERENCE') {
    return lang === 'TR' ? 'resmî ref.' : 'official ref.';
  }
  return lang === 'TR' ? 'ref.' : 'ref.';
};

const formatRate = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  const num = Number(value);
  if (num >= 1000) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (num >= 1) return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
};

export default function ReferenceRateTicker({ lang = 'TR' }) {
  const [payload, setPayload] = useState(null);
  const intervalRef = useRef(null);

  const fetchTicker = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const res = await fetch(buildApiUrl('reference-rates/ticker'), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`reference ticker request failed: ${res.status}`);
      const nextPayload = await res.json();
      setPayload((prev) => (nextPayload?.items ? nextPayload : prev));
    } catch {
      // [TR] Network/provider sorunlarında son başarılı payload tutulur.
      // [EN] Keep last successful payload on network/provider failures.
      setPayload((prev) => prev);
    }
  }, []);

  useEffect(() => {
    fetchTicker();

    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchTicker, POLL_MS);
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchTicker();
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchTicker]);

  const items = useMemo(() => payload?.items || [], [payload]);

  if (!items.length) return null;

  const informationalOnly = payload?.informationalOnly === true;

  return (
    <section
      className="mb-4 rounded-xl border border-slate-700/70 bg-[#0f1117] px-3 py-2 overflow-hidden"
      aria-label={lang === 'TR' ? 'Referans kur şeridi' : 'Reference rate ticker'}
      data-testid="reference-rate-ticker"
    >
      <div className="reference-ticker-track-wrap group focus-within:[&_.reference-ticker-track]:[animation-play-state:paused] hover:[&_.reference-ticker-track]:[animation-play-state:paused]">
        <div className="reference-ticker-track">
          {[...items, ...items].map((item, idx) => (
            <div
              key={`${item.symbol}-${idx}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-700/80 bg-[#111827] px-3 py-1 text-xs text-slate-100"
            >
              <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-200">{item.symbol}</span>
              <span className="font-mono text-emerald-300">{formatRate(item.rate)}</span>
              <span className="text-[10px] text-slate-400">{sourceLabel(item, lang)}</span>
              {item.stale && (
                <span className="rounded border border-amber-600/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] text-amber-300">
                  {lang === 'TR' ? 'gecikmiş' : 'stale'}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[10px] text-slate-400">
        {lang === 'TR'
          ? 'Referans kurlar bilgilendirme amaçlıdır; escrow sonucunu etkilemez.'
          : 'Reference rates are informational only and do not affect escrow settlement.'}
      </p>
      {!informationalOnly && (
        <p className="mt-1 text-[10px] text-amber-400">{lang === 'TR' ? 'Bilgilendirme bayrağı doğrulanamadı.' : 'Informational flag could not be verified.'}</p>
      )}
    </section>
  );
}
