import React from 'react';

const fmt = (t={}) => t.isFinished ? '00:00:00' : `${String((t.days||0)*24+(t.hours||0)).padStart(2,'0')}:${String(t.minutes||0).padStart(2,'0')}:${String(t.seconds||0).padStart(2,'0')}`;

export const TimerStack = ({ trade, roomState, userRole, bleedingAmounts, tokenDecimals, asset, formatTokenAmountFromRaw, lang, timers = {} }) => {
  if (roomState === 'CHALLENGED') {
    const my = userRole === 'taker' ? Number(bleedingAmounts?.takerBondRemaining ?? 0) : Number(bleedingAmounts?.makerBondRemaining ?? 0);
    const opp = userRole === 'taker' ? Number(bleedingAmounts?.makerBondRemaining ?? 0) : Number(bleedingAmounts?.takerBondRemaining ?? 0);
    const myPct = Math.max(5, Math.min(95, my || 40));
    const oppPct = Math.max(5, Math.min(95, opp || 35));
    const decayedTotal = bleedingAmounts?.totalDecayed ?? 0n;
    return <div className="mb-8 md:mb-10 p-4 md:p-6 bg-[#0a0505] border border-red-950 rounded-xl relative overflow-hidden">
      <div className="flex justify-between text-xs font-bold mb-3"><span className="text-red-500">MAKER BOND</span><span className="text-orange-500">TAKER BOND</span></div>
      <div className="w-full h-3 bg-[#111] rounded-full flex relative border border-[#222]"><div className="h-full bg-gradient-to-r from-red-700 to-red-500 rounded-l-full" style={{width:`${oppPct}%`}} /><div className="flex-1" /><div className="h-full bg-gradient-to-l from-orange-700 to-orange-500 rounded-r-full" style={{width:`${myPct}%`}} /></div>
      <p className="text-red-400 font-bold text-sm mt-4">{lang === 'TR' ? 'Yanan Toplam:' : 'Total Burned:'} {formatTokenAmountFromRaw?.(decayedTotal, tokenDecimals)} {asset} 🔥</p>
      <p className="mt-2 text-xs text-slate-400">🔒 {lang === 'TR' ? 'Ana Para Güvende:' : 'Principal Safe:'} {timers.principalProtectionTimer?.isFinished ? 'Bitti' : `${timers.principalProtectionTimer?.days || 0}g ${timers.principalProtectionTimer?.hours || 0}s`}</p>
    </div>;
  }
  return <div className="w-full max-w-sm bg-[#0a0a0c] border border-[#222] rounded-2xl p-4 mb-6"><p className="text-xs text-slate-500 mb-1 uppercase font-bold">Grace Period</p><div className="text-4xl sm:text-5xl font-mono font-bold text-white tracking-wider">{fmt(timers.gracePeriodTimer)}</div></div>;
};

export default TimerStack;
