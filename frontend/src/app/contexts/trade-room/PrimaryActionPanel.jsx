import React from 'react';

const ACTION_LABELS = {
  report_payment: { TR: '✅ Ödemeyi Bildirdim', EN: '✅ Report Payment' },
  release_funds: { TR: 'Serbest Bırak', EN: 'Release Funds' },
  start_challenge: { TR: '⚔️ İtiraz Başlat', EN: '⚔️ Start Challenge' },
  ping_maker: { TR: '🔔 Maker’ı Uyar', EN: '🔔 Ping Maker' },
  auto_release: { TR: '✅ Otomatik Serbest Bırak', EN: '✅ Auto Release' },
  propose_cancel: { TR: '↩️ İptal Teklif Et', EN: '↩️ Propose Cancel' },
  chargeback_ack: { TR: 'Chargeback Onayı', EN: 'Chargeback Ack' },
  propose_settlement: { TR: '🧩 Settlement Öner', EN: '🧩 Propose Settlement' },
  reject_settlement: { TR: 'Reddet', EN: 'Reject Settlement' },
  withdraw_settlement: { TR: 'Geri Çek', EN: 'Withdraw Settlement' },
  expire_settlement: { TR: 'Süreyi Doldur', EN: 'Expire Settlement' },
  accept_settlement: { TR: 'Kabul Et', EN: 'Accept Settlement' },
  burn_expired: { TR: '🔥 Süresi Dolanı Yak', EN: '🔥 Burn Expired' },
};

export const PrimaryActionPanel = ({ primaryAction, actionHandlers = {}, disabledReason = null, lang = 'EN' }) => {
  if (!primaryAction) return null;
  if (primaryAction.type === 'waiting') {
    return <div className="mb-2 text-[11px] text-slate-500">{primaryAction.key}</div>;
  }
  const label = ACTION_LABELS[primaryAction.key]?.[lang === 'TR' ? 'TR' : 'EN'] || primaryAction.key;
  const onClick = actionHandlers?.[primaryAction.key];
  const disabled = Boolean(disabledReason) || typeof onClick !== 'function';
  return (
    <div className="mb-3">
      <button onClick={disabled ? undefined : onClick} disabled={disabled} className={`w-full py-3 rounded-xl font-bold transition ${disabled ? 'bg-[#1a1a1f] text-slate-500 cursor-not-allowed border border-[#2a2a2e]' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
        {label}
      </button>
      {disabledReason && <p className="text-[11px] text-orange-400 mt-2">{disabledReason}</p>}
    </div>
  );
};

export default PrimaryActionPanel;
