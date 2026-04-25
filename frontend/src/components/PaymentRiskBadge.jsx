import React from 'react';

const RISK_LEVEL_CLASS = {
  LOW: 'text-emerald-400 border-emerald-500/30 bg-emerald-900/20',
  MEDIUM: 'text-amber-400 border-amber-500/30 bg-amber-900/20',
  HIGH: 'text-orange-400 border-orange-500/30 bg-orange-900/20',
  RESTRICTED: 'text-red-400 border-red-500/40 bg-red-900/20',
};

export default function PaymentRiskBadge({
  lang = 'TR',
  riskEntry,
  compact = false,
}) {
  if (!riskEntry) return null;
  const riskLevel = String(riskEntry.riskLevel || 'MEDIUM').toUpperCase();
  const warningText = lang === 'TR'
    ? 'Bu ödeme yöntemi karşı taraf hakkında kesin hüküm vermez. Yalnızca işlem karmaşıklığı sinyalidir.'
    : 'This payment method does not judge the counterparty. It is only a transaction-complexity signal.';
  const genericWarning = lang === 'TR'
    ? 'Genel payment config; bu order’a özel rail sinyali değildir.'
    : 'Generic payment config; this is not an order-specific rail signal.';
  const desc = riskEntry?.description?.[lang] || riskEntry?.description?.EN || '';
  const chipClass = RISK_LEVEL_CLASS[riskLevel] || RISK_LEVEL_CLASS.MEDIUM;
  const isGenericSignal = riskEntry?.generic === true;

  if (compact) {
    return (
      <div className="mt-2 p-2 rounded-lg border border-[#2a2a2e] bg-[#101014]">
        <p className="text-[11px] text-slate-300">
          {lang === 'TR' ? 'Payment method complexity' : 'Payment method complexity'}: <span className="font-bold text-amber-300">{riskLevel}</span>
        </p>
        {isGenericSignal && <p className="text-[10px] text-amber-300 mt-1">{genericWarning}</p>}
        <p className="text-[10px] text-slate-500 mt-1">{warningText}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 p-3 rounded-xl border border-[#2a2a2e] bg-[#101014]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs text-slate-300 font-semibold">
          {lang === 'TR' ? 'Payment Risk Class (Config)' : 'Payment Risk Class (Config)'}
        </p>
        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold ${chipClass}`}>{riskLevel}</span>
      </div>
      <p className="text-[11px] text-slate-400">{desc}</p>
      {isGenericSignal && <p className="text-[11px] text-amber-300 mt-1">{genericWarning}</p>}
      <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
        <p className="text-slate-400">minBondSurchargeBps: <span className="text-white font-mono">{riskEntry.minBondSurchargeBps ?? 0}</span></p>
        <p className="text-slate-400">feeSurchargeBps: <span className="text-white font-mono">{riskEntry.feeSurchargeBps ?? 0}</span></p>
      </div>
      <p className="text-[11px] text-slate-400 mt-1">warningKey: <span className="text-slate-200 font-mono">{riskEntry.warningKey || '—'}</span></p>
      <p className="text-[10px] text-slate-500 mt-2">
        {lang === 'TR'
          ? 'Preview/config only: Bu değerler kontrat hükmü değildir; nihai authority on-chain kurallardır.'
          : 'Preview/config only: These values are not contract authority; final authority remains on-chain rules.'}
      </p>
      <p className="text-[10px] text-slate-500 mt-1">{warningText}</p>
      {(riskLevel === 'RESTRICTED' || riskEntry.enabled === false) && (
        <p className="text-[10px] text-red-400 mt-2">
          {lang === 'TR'
            ? 'Bu durum frontend/backend availability config sinyalidir; settlement/release authority kontratta kalır.'
            : 'This is a frontend/backend availability config signal; settlement/release authority remains on-chain.'}
        </p>
      )}
    </div>
  );
}
