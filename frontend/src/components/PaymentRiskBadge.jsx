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

function PaymentRiskSummary({ lang, riskEntry, compact }) {
  const riskLevel = String(riskEntry.riskLevel || 'MEDIUM').toUpperCase();
  const riskLabel = getPaymentRiskLevelLabel(riskLevel, lang);
  const chipClass = RISK_LEVEL_CLASS[riskLevel] || RISK_LEVEL_CLASS.MEDIUM;
  const isGenericSignal = riskEntry?.generic === true;
  const desc = riskEntry?.description?.[lang] || riskEntry?.description?.EN || '';

  return (
    <>
      <div className={compact ? 'flex items-center justify-between gap-2' : 'flex items-center justify-between gap-2 mb-2'}>
        <p className="text-xs text-textSecondary font-semibold">
          {getPaymentRiskSummaryCopy('title', lang)}
        </p>
        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold ${chipClass}`}>{riskLabel}</span>
      </div>
      {!compact && desc && <p className="text-xs text-textSecondary">{desc}</p>}
      {isGenericSignal && <p className={`${compact ? 'text-xs' : 'text-xs'} text-amber-300 mt-1`}>{getPaymentRiskSummaryCopy('genericWarning', lang)}</p>}
      <p className={`${compact ? 'text-xs' : 'text-xs'} text-textMuted mt-1`}>
        {getPaymentRiskSummaryCopy('notTrustScore', lang)}
      </p>
    </>
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
        className="text-xs text-textSecondary underline decoration-dotted underline-offset-4 hover:text-textPrimary"
      >
        {isOpen ? getPaymentRiskSummaryCopy('hideDisclosureButton', lang) : getPaymentRiskSummaryCopy('disclosureButton', lang)}
      </button>
      {isOpen && (
        <div className="mt-2 rounded-lg border border-borderStrong bg-shell p-2" aria-label={getPaymentRiskSummaryCopy('disclosureTitle', lang)}>
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
