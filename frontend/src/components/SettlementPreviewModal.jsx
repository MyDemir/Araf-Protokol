import React from 'react';

function normalizeRawBigInt(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value.trim())) return null;
    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function shortNum(value) {
  const asBigInt = normalizeRawBigInt(value);
  if (asBigInt === null) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return String(value ?? '0');
    return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
  }
  const abs = asBigInt < 0n ? -asBigInt : asBigInt;
  const raw = abs.toString();
  const grouped = raw.length > 3 ? raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : raw;
  return `${asBigInt < 0n ? '-' : ''}${grouped}`;
}

export function getPreviewTotalPool(previewData) {
  // [TR] Backend canonical alanı `pool`; legacy aliaslar geri uyumluluk için korunur.
  // [EN] Backend canonical field is `pool`; legacy aliases are fallback-only for compatibility.
  return previewData?.pool ?? previewData?.totalPool ?? previewData?.total_pool ?? 0;
}

function renderRawAmount(value) {
  const asBigInt = normalizeRawBigInt(value);
  if (asBigInt !== null) return shortNum(asBigInt);
  return String(value ?? '0');
}

export default function SettlementPreviewModal({
  isOpen,
  onClose,
  lang,
  isLoading,
  error,
  makerShareBps,
  takerShareBps,
  previewData,
  onConfirm,
  confirmLabel,
  disableConfirm,
}) {
  if (!isOpen) return null;

  const makerPayout = previewData?.makerPayout ?? previewData?.maker_payout ?? 0;
  const takerPayout = previewData?.takerPayout ?? previewData?.taker_payout ?? 0;
  const totalPool = getPreviewTotalPool(previewData);

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#111113] border border-[#2a2a2e] rounded-2xl p-5 md:p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-2">
          {lang === 'TR' ? 'Settlement Önizleme' : 'Settlement Preview'}
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          {lang === 'TR'
            ? 'Bu önizleme yalnız bilgilendirme amaçlıdır (non-authoritative). On-chain sonucu kontrat belirler.'
            : 'This preview is informational only (non-authoritative). Final on-chain outcome is enforced by contract.'}
        </p>

        <div className="bg-[#0c0c0e] border border-[#222] rounded-xl p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">{lang === 'TR' ? 'Maker alır' : 'Maker receives'}</span><span className="text-white font-bold">{renderRawAmount(makerPayout)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">{lang === 'TR' ? 'Taker alır' : 'Taker receives'}</span><span className="text-white font-bold">{renderRawAmount(takerPayout)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">{lang === 'TR' ? 'Toplam pool' : 'Total pool'}</span><span className="text-white font-bold">{renderRawAmount(totalPool)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">makerShareBps</span><span className="text-emerald-400 font-mono">{makerShareBps}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">takerShareBps</span><span className="text-emerald-400 font-mono">{takerShareBps}</span></div>
        </div>

        <div className="mt-4 p-3 rounded-xl bg-[#1a1a1f] border border-[#2a2a2e] text-xs text-slate-300">
          {lang === 'TR'
            ? 'Araf bu dağılıma senin yerine karar vermez. Karşı taraf kabul ederse işlem bu oranla on-chain kapanır.'
            : 'Araf does not decide this distribution for you. If the counterparty accepts, the trade will close on-chain with this split.'}
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2 rounded-lg border border-[#333] text-slate-300 hover:bg-[#1a1a1f] transition"
          >
            {lang === 'TR' ? 'Kapat' : 'Close'}
          </button>
          <button
            onClick={onConfirm}
            disabled={disableConfirm || isLoading}
            className={`w-full sm:flex-1 px-4 py-2 rounded-lg font-bold transition ${disableConfirm || isLoading ? 'bg-[#1a1a1f] text-slate-500 border border-[#2a2a2e] cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
          >
            {isLoading ? (lang === 'TR' ? '⏳ İşleniyor...' : '⏳ Processing...') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
