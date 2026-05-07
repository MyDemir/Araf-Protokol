import React from 'react';
import { getStateLabel } from '../../copy/states';
import OperationTradeCard from './OperationTradeCard';

export const OperationsSummaryBar = ({ summary, lang = 'EN' }) => {
  const items = [
    { key: 'totalActive', label: lang === 'TR' ? 'Toplam Aktif' : 'Total Active' },
    { key: 'locked', label: getStateLabel('LOCKED', lang) },
    { key: 'paid', label: getStateLabel('PAID', lang) },
    { key: 'challenged', label: getStateLabel('CHALLENGED', lang) },
    { key: 'settlementActionRequired', label: lang === 'TR' ? 'Settlement Aksiyon' : 'Settlement Action' },
    { key: 'settlementWaiting', label: lang === 'TR' ? 'Settlement Bekleme' : 'Settlement Waiting' },
    { key: 'pendingBackendSync', label: lang === 'TR' ? 'Backend Senkron' : 'Backend Sync' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2 mb-4">
      {items.map((item) => (
        <div key={item.key} className="bg-surface border border-borderSubtle rounded-lg px-3 py-2">
          <p className="text-xs text-textMuted uppercase tracking-wide">{item.label}</p>
          <p className="text-sm font-bold text-textPrimary">{summary?.[item.key] ?? 0}</p>
        </div>
      ))}
    </div>
  );
};

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
      <p className="mb-2 text-xs font-bold uppercase tracking-widest">{title}</p>
      <OperationTradeCard escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />
    </div>
  );
};

export const PendingSyncCard = ({ escrow, lang, onGoToRoom }) => {
  return (
    <div className="rounded-xl border border-sky-500/40 bg-sky-950/10 p-2" data-testid="pending-sync-card">
      <p className="mb-2 text-xs font-bold uppercase tracking-widest text-sky-300">
        {lang === 'TR' ? 'Backend senkron bekliyor' : 'Pending backend sync'}
      </p>
      <OperationTradeCard escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />
    </div>
  );
};

export const OperationsContextPanel = ({ lane, lang = 'EN', onGoToRoomForEscrow }) => {
  if (!lane) return null;
  return (
    <div className="space-y-2">
      {lane.items.map((item, idx) => {
        const escrow = item.escrow;
        const onGoToRoom = onGoToRoomForEscrow(escrow);
        if (lane.key === 'settlement_action_required' || lane.key === 'settlement_waiting') {
          return <SettlementQueueCard key={`${lane.key}-${idx}`} escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />;
        }
        if (lane.key === 'pending_backend_sync') {
          return <PendingSyncCard key={`${lane.key}-${idx}`} escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />;
        }
        return <OperationTradeCard key={`${lane.key}-${idx}`} escrow={escrow} lang={lang} onGoToRoom={onGoToRoom} />;
      })}
    </div>
  );
};
