import React, { useState } from 'react';
import { getPaymentRiskLevelLabel, getPaymentRiskSummaryCopy } from '../app/copy';

const RISK_LEVEL_CLASS = {
  LOW: 'text-emerald-400 border-emerald-500/30 bg-emerald-900/20',
  MEDIUM: 'text-amber-400 border-amber-500/30 bg-amber-900/20',
  HIGH: 'text-orange-400 border-orange-500/30 bg-orange-900/20',
  RESTRICTED: 'text-red-400 border-red-500/40 bg-red-900/20',
};

const TECHNICAL_FIELDS = [
  ['minBondSurchargeBps', (riskEntry) => riskEntry.minBondSurchargeBps ?? 0],
  ['feeSurchargeBps', (riskEntry) => riskEntry.feeSurchargeBps ?? 0],
  ['warningKey', (riskEntry) => riskEntry.warningKey || '—'],
  ['source', (riskEntry) => riskEntry.source || (riskEntry?.generic === true ? 'config' : '—')],
  ['config', (riskEntry) => riskEntry.config || riskEntry.configKey || riskEntry.configVersion || null],
  ['snapshot', (riskEntry) => riskEntry.snapshot || riskEntry.snapshotId || riskEntry.snapshotBlock || null],
];

const formatTechnicalValue = (value) => {
  if (value == null || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

function PaymentRiskHeader({ lang, riskLevel, chipClass, compact }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-textPrimary leading-snug">
          {getPaymentRiskSummaryCopy(compact ? 'compactTitle' : 'title', lang)}
        </p>
        {!compact && (
          <p className="mt-0.5 text-xs text-textMuted leading-snug">
            {getPaymentRiskSummaryCopy('subtitle', lang)}
          </p>
        )}
      </div>
      <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded border font-bold ${chipClass}`}>
        {getPaymentRiskLevelLabel(riskLevel, lang)}
      </span>
    </div>
  );
}

function PaymentRiskSummary({ lang, riskEntry, compact }) {
  const riskLevel = String(riskEntry.riskLevel || 'MEDIUM').toUpperCase();
  const chipClass = RISK_LEVEL_CLASS[riskLevel] || RISK_LEVEL_CLASS.MEDIUM;
  const isGenericSignal = riskEntry?.generic === true;
  const isRestrictedSignal = riskLevel === 'RESTRICTED' || riskEntry.enabled === false;
  const desc = riskEntry?.description?.[lang] || riskEntry?.description?.EN || '';
  const mainExplanation = compact
    ? getPaymentRiskSummaryCopy('subtitle', lang)
    : desc || getPaymentRiskSummaryCopy('operationalExplanation', lang);

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <PaymentRiskHeader lang={lang} riskLevel={riskLevel} chipClass={chipClass} compact={compact} />
      {mainExplanation && (
        <p className="text-sm leading-relaxed text-textSecondary">
          {mainExplanation}
        </p>
      )}
      {isGenericSignal && (
        <p className="text-xs text-amber-300 leading-snug">
          {getPaymentRiskSummaryCopy('genericWarning', lang)}
        </p>
      )}
      {isRestrictedSignal && (
        <p className="text-xs text-red-400 leading-snug">
          {getPaymentRiskSummaryCopy('restrictedAvailability', lang)}
        </p>
      )}
      <p className="text-xs text-textMuted leading-snug">
        {getPaymentRiskSummaryCopy('notTrustScore', lang)}
      </p>
    </div>
  );
}

function PaymentRiskTechnicalDisclosure({ lang, riskEntry, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const riskLevel = String(riskEntry.riskLevel || 'MEDIUM').toUpperCase();

  return (
    <div className="mt-3 border-t border-borderStrong pt-3">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="text-xs font-medium text-textSecondary underline decoration-dotted underline-offset-4 hover:text-textPrimary"
      >
        {isOpen ? getPaymentRiskSummaryCopy('hideDisclosureButton', lang) : getPaymentRiskSummaryCopy('disclosureButton', lang)}
      </button>
      {isOpen && (
        <div className="mt-2 rounded-lg border border-borderStrong bg-shell p-3" aria-label={getPaymentRiskSummaryCopy('disclosureTitle', lang)}>
          <p className="mb-2 text-xs text-textMuted leading-snug">
            {getPaymentRiskSummaryCopy('disclosureIntro', lang)}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {TECHNICAL_FIELDS.map(([label, readValue]) => (
              <p key={label} className="text-textSecondary">
                {label}: <span className="text-textPrimary font-mono break-all">{formatTechnicalValue(readValue(riskEntry))}</span>
              </p>
            ))}
          </div>
          <p className="text-xs text-textMuted mt-2">
            {getPaymentRiskSummaryCopy('previewOnly', lang)}
          </p>
          {(riskLevel === 'RESTRICTED' || riskEntry.enabled === false) && (
            <p className="text-xs text-red-400 mt-2">
              {getPaymentRiskSummaryCopy('restrictedAvailability', lang)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function PaymentRiskBadge({
  lang = 'TR',
  riskEntry,
  compact = false,
  defaultTechnicalOpen = false,
}) {
  if (!riskEntry) return null;

  if (compact) {
    return (
      <div className="mt-2 p-2 rounded-lg border border-borderStrong bg-surface">
        <PaymentRiskSummary lang={lang} riskEntry={riskEntry} compact />
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 rounded-xl border border-borderStrong bg-surface">
      <PaymentRiskSummary lang={lang} riskEntry={riskEntry} compact={false} />
      <PaymentRiskTechnicalDisclosure lang={lang} riskEntry={riskEntry} defaultOpen={defaultTechnicalOpen} />
    </div>
  );
}
