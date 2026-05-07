import React from 'react';
import OperationTradeCard from './OperationTradeCard';

const normalizeAddress = (value) => String(value || '').toLowerCase();

const resolveSettlementMode = (escrow) => {
  const proposal = escrow?.rawTrade?.settlementProposal || escrow?.settlementProposal || null;
  const proposer = proposal?.proposer || proposal?.proposed_by || proposal?.proposedBy || null;
  const viewer = escrow?.viewerAddress || null;
  if (proposer && viewer && normalizeAddress(proposer) !== normalizeAddress(viewer)) return 'action_required';
  if (proposer && viewer && normalizeAddress(proposer) === normalizeAddress(viewer)) return 'waiting';
  return 'info';
};

export const SettlementQueueCard = ({ escrow, lang, onGoToRoom }) => {
  const mode = resolveSettlementMode(escrow);
  const isActionRequired = mode === 'action_required';
  const title = isActionRequired
    ? (lang === 'TR' ? 'Settlement aksiyonu gerekli' : 'Settlement action required')
    : (lang === 'TR' ? 'Karşı taraf yanıtı bekleniyor' : 'Waiting for counterparty');
  const accentClass = isActionRequired
    ? 'border-red-500/40 bg-red-950/10 text-red-300'
    : 'border-amber-500/40 bg-amber-950/10 text-amber-300';

  return (
    <div className={`rounded-xl border p-2 ${accentClass}`} data-testid="settlement-queue-card">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest">{title}</p>
      <OperationTradeCard escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />
    </div>
  );
};

export default SettlementQueueCard;
