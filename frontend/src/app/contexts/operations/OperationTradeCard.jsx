import React from 'react';
import { getStateLabel } from '../../copy/states';

const roleCopy = {
  maker: { TR: 'İlan Sahibi', EN: 'Listing owner' },
  taker: { TR: 'Alıcı', EN: 'Taker' },
};

const getRoleLabel = (role, lang = 'EN') => {
  const normalized = String(role || '').toLowerCase();
  const row = roleCopy[normalized];
  if (!row) return role || '—';
  return row[lang === 'TR' ? 'TR' : 'EN'] || row.EN || row.TR || role;
};

const normalizeSettlementState = (state) => {
  const normalized = String(state || '').toUpperCase();
  return normalized || 'NONE';
};

const safeFiatEstimate = (rawTrade) => {
  const max = Number(rawTrade?.max);
  if (!Number.isFinite(max)) return null;
  const fiat = rawTrade?.fiat || rawTrade?.financials?.fiat_currency || null;
  return `${max.toFixed(0)}${fiat ? ` ${fiat}` : ''}`;
};

const resolveCardModel = (escrow = {}, lang = 'EN') => {
  const rawTrade = escrow?.rawTrade || {};
  const displayId = escrow?.id || (escrow?.onchainId != null ? `#${escrow.onchainId}` : (rawTrade?.onchainId != null ? `#${rawTrade.onchainId}` : '—'));
  const role = escrow?.role || rawTrade?.role || '—';
  const state = escrow?.state || rawTrade?.state || rawTrade?.status || '—';
  const amount = escrow?.amount || rawTrade?.amount || (rawTrade?.cryptoAmountUi != null && rawTrade?.crypto ? `${rawTrade.cryptoAmountUi} ${rawTrade.crypto}` : null);
  const fiatEstimate = safeFiatEstimate(rawTrade);
  const settlementProposal = rawTrade?.settlementProposal || escrow?.settlementProposal || null;
  const settlementState = normalizeSettlementState(settlementProposal?.state);
  const hasSettlementProposal = settlementProposal && !['NONE', 'UNKNOWN'].includes(settlementState);
  const proposer = settlementProposal?.proposer || settlementProposal?.proposed_by || null;
  const viewer = escrow?.viewerAddress || null;
  const pendingSync = Boolean(rawTrade?._pendingBackendSync || escrow?._pendingBackendSync);

  let settlementCopy = null;
  if (hasSettlementProposal) {
    const waitingForViewer = proposer && viewer && String(proposer).toLowerCase() !== String(viewer).toLowerCase();
    settlementCopy = waitingForViewer
      ? (lang === 'TR' ? 'Settlement yanıtı gerekiyor' : 'Settlement needs your response')
      : (lang === 'TR' ? 'Settlement yanıtı bekleniyor' : 'Waiting on settlement response');
  }

  return {
    displayId,
    roleLabel: getRoleLabel(role, lang),
    state,
    stateLabel: getStateLabel(state, lang),
    amount,
    fiatEstimate,
    settlementCopy,
    pendingSyncCopy: pendingSync ? (lang === 'TR' ? 'Oda senkronu sürüyor' : 'Room sync in progress') : null,
  };
};

export const OperationTradeCard = ({ escrow, lang = 'EN', onGoToRoom }) => {
  if (!escrow) return null;
  const model = resolveCardModel(escrow, lang);
  return (
    <div className="bg-surface border border-borderSubtle rounded-xl p-3" data-testid="operation-trade-card">
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="font-mono text-emerald-400 text-sm truncate">{model.displayId}</span>
        <span className="text-xs border border-borderStrong rounded px-2 py-0.5 text-textSecondary shrink-0">{model.roleLabel}</span>
      </div>
      <p className="text-sm font-semibold text-textPrimary mb-1">{model.stateLabel}</p>
      {model.amount && (
        <p className="text-xs text-textSecondary mb-1 truncate">
          {model.amount}{model.fiatEstimate && <span className="text-textMuted ml-1">({model.fiatEstimate})</span>}
        </p>
      )}
      {model.settlementCopy && <p className="text-sm text-orange-300 mb-1">{model.settlementCopy}</p>}
      {model.pendingSyncCopy && <p className="text-sm text-sky-300 mb-1">{model.pendingSyncCopy}</p>}
      <button onClick={onGoToRoom} className="w-full bg-elevated hover:bg-surface text-textPrimary text-xs font-bold py-2 rounded-lg border border-borderStrong">
        {lang === 'TR' ? 'Odaya Git →' : 'Go to Room →'}
      </button>
    </div>
  );
};

export default OperationTradeCard;
