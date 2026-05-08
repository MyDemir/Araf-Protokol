import React from 'react';

const t = (lang, tr, en) => (lang === 'TR' ? tr : en);

export const TradeSummaryCard = ({
  headline,
  subheadline,
  nowLabel,
  nowDescription,
  nextLabel,
  nextDescription,
  stateLabel,
  roleLabel,
  lang = 'EN',
}) => (
  <section className="mb-3 bg-surface border border-borderSubtle rounded-xl p-4 text-textSecondary" data-testid="trade-summary-card">
    <div className="mb-3">
      <p className="text-xs font-bold uppercase tracking-wide text-brand">{t(lang, 'İşlem özeti', 'Trade summary')}</p>
      <h2 className="mt-1 text-lg font-bold text-textPrimary">{headline || t(lang, 'İşlem durumunu kontrol edin', 'Review the trade status')}</h2>
      {subheadline && <p className="mt-1 text-sm leading-relaxed text-textSecondary">{subheadline}</p>}
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="rounded-lg border border-borderSubtle bg-elevated p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-textMuted">{nowLabel || t(lang, 'Şimdi', 'Now')}</p>
        <p className="mt-1 text-sm leading-relaxed text-textPrimary">{nowDescription}</p>
      </div>
      <div className="rounded-lg border border-borderSubtle bg-elevated p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-textMuted">{nextLabel || t(lang, 'Sonraki adım', 'Next')}</p>
        <p className="mt-1 text-sm leading-relaxed text-textPrimary">{nextDescription}</p>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2 text-xs text-textMuted">
      <span className="rounded-full border border-borderSubtle px-2 py-1">{t(lang, 'Durum', 'Status')}: <span className="text-textSecondary">{stateLabel}</span></span>
      <span className="rounded-full border border-borderSubtle px-2 py-1">{t(lang, 'Rol', 'Role')}: <span className="text-textSecondary">{roleLabel}</span></span>
    </div>
  </section>
);

export const StateGuidancePanel = ({ guidance = [], riskCopy }) => {
  if (!guidance.length && !riskCopy) return null;
  return (
    <div className="mb-3 bg-surface border border-borderSubtle rounded-xl p-3 text-sm text-textSecondary space-y-2" data-testid="trade-guidance-panel">
      {guidance.map((g, i) => <p key={i}>{g}</p>)}
      {riskCopy?.chargeback && <p className="text-textMuted">{riskCopy.chargeback}</p>}
      {riskCopy?.settlement && <p className="text-textMuted">{riskCopy.settlement}</p>}
    </div>
  );
};

export const TimerStack = ({ timerCards = [], lang = 'EN' }) => {
  if (!Array.isArray(timerCards) || timerCards.length === 0) return null;
  return (
    <div className="mb-3 bg-surface border border-borderSubtle rounded-xl p-3 text-sm text-textSecondary" data-testid="trade-timer-summaries">
      <p className="text-textMuted font-bold uppercase tracking-wide text-xs mb-2">{t(lang, 'Süreler', 'Timers')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {timerCards.map((timer) => (
          <div key={timer.key} className="flex justify-between gap-3 bg-elevated border border-borderSubtle rounded-lg px-3 py-2">
            <span>{timer.label}</span>
            <span className="font-mono text-textPrimary">{timer.summary}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const TechnicalDetailsDisclosure = ({ technicalDetails, lang = 'EN' }) => {
  if (!technicalDetails) return null;
  return (
    <details className="mb-3 text-xs text-textMuted">
      <summary className="cursor-pointer">{t(lang, 'Teknik detaylar', 'Technical details')}</summary>
      <pre className="mt-2 bg-surface border border-borderSubtle rounded-lg p-2 overflow-auto">{JSON.stringify(technicalDetails, null, 2)}</pre>
    </details>
  );
};
