import React from 'react';

export default function RewardsDashboard({
  wallet,
  currentEpoch,
  claimableAmount,
  onClaim,
  onFundGlobal,
  onFundProduct,
  onRecordOutcome,
}) {
  return (
    <section className="bg-slate-900/60 rounded-xl p-4 border border-slate-700 space-y-3">
      <h2 className="text-lg font-semibold text-white">Proof of Peace Rewards</h2>
      <p className="text-xs text-slate-300">
        Rewards are epoch-based and derived only from ArafEscrow terminal outcomes. Sponsors cannot select recipients, weights, outcomes, multipliers, or claim lists.
      </p>
      <p className="text-sm text-slate-200">Current Epoch: {String(currentEpoch ?? '—')}</p>
      {!wallet ? (
        <p className="text-sm text-amber-300">Connect wallet to view claimable rewards.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-slate-200">My Claimable: {String(claimableAmount ?? '0')}</p>
          <button
            className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-40"
            disabled={!claimableAmount || BigInt(claimableAmount) === 0n}
            onClick={onClaim}
          >
            Claim
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="px-2 py-1 rounded bg-sky-700 text-white" onClick={onRecordOutcome}>Record outcome</button>
        <button className="px-2 py-1 rounded bg-indigo-700 text-white" onClick={onFundGlobal}>Fund global rewards</button>
        <button className="px-2 py-1 rounded bg-violet-700 text-white" onClick={onFundProduct}>Fund product rewards</button>
      </div>
    </section>
  );
}
