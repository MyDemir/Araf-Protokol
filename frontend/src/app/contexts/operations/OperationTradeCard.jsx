import React from 'react';
import { getStateLabel } from '../../copy/states';

const roleCopy = {
  maker: { TR: 'Order sahibi', EN: 'Order owner' },
  taker: { TR: 'Alıcı', EN: 'Taker' },
};

const fieldCopy = {
  counterparty: { TR: 'Karşı taraf', EN: 'Counterparty' },
  role: { TR: 'Rol', EN: 'Role' },
  state: { TR: 'Durum', EN: 'State' },
  amount: { TR: 'Tutar', EN: 'Amount' },
  goToRoom: { TR: 'Odaya Git', EN: 'Go to Room' },
};

export const ACTIVE_TRADE_STATE_PRIORITY = {
  CHALLENGED: 0,
  PAID: 1,
  LOCKED: 2,
};

const pickLang = (lang) => (lang === 'TR' ? 'TR' : 'EN');

const t = (key, lang = 'EN') => fieldCopy[key]?.[pickLang(lang)] || fieldCopy[key]?.EN || key;

const getRoleLabel = (role, lang = 'EN') => {
  const normalized = String(role || '').toLowerCase();
  const row = roleCopy[normalized];
  if (!row) return role || '—';
  return row[pickLang(lang)] || row.EN || row.TR || role;
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

const shortenAddress = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
  return raw;
};

const resolveCounterparty = (escrow = {}, rawTrade = {}) => {
  if (escrow?.counterparty) return escrow.counterparty;

  const role = String(escrow?.role || rawTrade?.role || '').toLowerCase();
  const maker = rawTrade?.makerFull || rawTrade?.maker_address || rawTrade?.maker;
  const taker = rawTrade?.takerFull || rawTrade?.taker_address || rawTrade?.taker;
  if (role === 'maker') return shortenAddress(taker);
  if (role === 'taker') return shortenAddress(maker);

  return shortenAddress(rawTrade?.counterparty || rawTrade?.counterparty_address || rawTrade?.counterpartyAddress);
};

export const compareActiveTradePriority = (a = {}, b = {}) => {
  const stateA = String(a?.state || a?.rawTrade?.state || a?.rawTrade?.status || '').toUpperCase();
  const stateB = String(b?.state || b?.rawTrade?.state || b?.rawTrade?.status || '').toUpperCase();
  const priorityA = ACTIVE_TRADE_STATE_PRIORITY[stateA] ?? 99;
  const priorityB = ACTIVE_TRADE_STATE_PRIORITY[stateB] ?? 99;
  if (priorityA !== priorityB) return priorityA - priorityB;
  return String(a?.id || a?.onchainId || '').localeCompare(String(b?.id || b?.onchainId || ''));
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
  const counterparty = resolveCounterparty(escrow, rawTrade);

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
    counterparty: counterparty || '—',
    settlementCopy,
    pendingSyncCopy: pendingSync ? (lang === 'TR' ? 'Oda senkronu sürüyor' : 'Room sync in progress') : null,
  };
};

export const OperationTradeCard = ({ escrow, lang = 'EN', onGoToRoom }) => {
  if (!escrow) return null;
  const model = resolveCardModel(escrow, lang);
  const ctaLabel = t('goToRoom', lang);
  const goToRoomA11y = `${ctaLabel}: ${model.displayId}`;
  return (
    <div className="bg-surface border border-borderSubtle rounded-xl p-3" data-testid="operation-trade-card">
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="font-mono text-emerald-400 text-sm truncate">{model.displayId}</span>
        <span className="text-xs border border-borderStrong rounded px-2 py-0.5 text-textSecondary shrink-0">{model.roleLabel}</span>
      </div>
      <dl className="grid grid-cols-1 gap-1 text-xs text-textSecondary mb-2">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-textMuted">{t('state', lang)}</dt>
          <dd className="font-semibold text-textPrimary text-right">{model.stateLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-textMuted">{t('counterparty', lang)}</dt>
          <dd className="font-mono text-textPrimary text-right truncate">{model.counterparty}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-textMuted">{t('role', lang)}</dt>
          <dd className="text-textPrimary text-right">{model.roleLabel}</dd>
        </div>
        {model.amount && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-textMuted">{t('amount', lang)}</dt>
            <dd className="text-textPrimary text-right truncate">
              {model.amount}{model.fiatEstimate && <span className="text-textMuted ml-1">({model.fiatEstimate})</span>}
            </dd>
          </div>
        )}
      </dl>
      {model.settlementCopy && <p className="text-sm text-orange-300 mb-1">{model.settlementCopy}</p>}
      {model.pendingSyncCopy && <p className="text-sm text-sky-300 mb-1">{model.pendingSyncCopy}</p>}
      <button
        onClick={onGoToRoom}
        className="w-full bg-elevated hover:bg-surface text-textPrimary text-xs font-bold py-2 rounded-lg border border-borderStrong"
        title={goToRoomA11y}
        aria-label={goToRoomA11y}
      >
        {ctaLabel} →
      </button>
    </div>
  );
};

export default OperationTradeCard;
