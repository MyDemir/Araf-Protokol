import { Handshake } from 'lucide-react';
import React from 'react';
import { buildSettlementPreviewUrl } from '../app/apiConfig';
import SettlementPreviewModal from './SettlementPreviewModal';
import { useSettlementActions } from '../app/contexts/settlement/useSettlementActions';
import { normalizeSettlementState, toUnixSeconds } from '../app/contexts/settlement/settlementActionModel';
import { fmtBps } from '../app/copy';

const ACTIVE_ROOM_STATES = ['CHALLENGED'];
const TERMINAL_ROOM_STATES = ['RESOLVED', 'CANCELED', 'BURNED'];
const MIN_CUSTOM_EXPIRY_MINUTES = 10;
const MAX_CUSTOM_EXPIRY_MINUTES = 7 * 24 * 60;
// [TR] F18 — ArafEscrow.MIN_SETTLEMENT_EXPIRY (10 dk) aynası: `expiresAt >= blockNow + 10 dk` şartı. Tx onay bekleme,
//      blok gecikmesi ve saat kayması için küçük güvenlik payı eklenir; pay yalnız bitişi uzatır.
// [EN] F18 — mirror of ArafEscrow.MIN_SETTLEMENT_EXPIRY (10 min): `expiresAt >= blockNow + 10 min`. A small safety margin
//      covers wallet-confirm delay, block latency and clock skew; it can only extend the deadline.
export const SETTLEMENT_MIN_EXPIRY_SEC = 10 * 60;
export const SETTLEMENT_EXPIRY_SAFETY_SEC = 90;

// [TR] Bitiş anını TX ANINDAKİ zincir saatine göre hesaplar (render anındaki değer bayatlar).
// [EN] Computes the deadline from chain time at TX time (a render-time value goes stale).
export const computeSettlementExpiresAt = (chainNowSec, expiryMinutes) => {
  const minutes = Number.isFinite(Number(expiryMinutes)) ? Number(expiryMinutes) : 0;
  const floor = chainNowSec + SETTLEMENT_MIN_EXPIRY_SEC + SETTLEMENT_EXPIRY_SAFETY_SEC;
  return Math.max(chainNowSec + Math.floor(minutes * 60), floor);
};
export const SETTLEMENT_NEUTRALITY_COPY = {
  TR: 'Araf karar vermez; teklif ancak iki taraf onaylarsa geçerli olur.',
  EN: 'Araf does not decide who is right; settlement is available only in the CHALLENGED dispute phase with both parties’ signatures.',
};

const shortHash = (hash) => (hash && hash.length > 12 ? `${hash.slice(0, 8)}...${hash.slice(-4)}` : hash || '—');
export const safeDate = (v) => {
  const ts = toUnixSeconds(v);
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const CLOSED_PROPOSAL_STATES = ['REJECTED', 'WITHDRAWN', 'EXPIRED'];
const CLOSED_PROPOSAL_COPY = {
  REJECTED: { TR: 'Son teklif reddedildi.', EN: 'The last offer was rejected.' },
  WITHDRAWN: { TR: 'Son teklif geri çekildi.', EN: 'The last offer was withdrawn.' },
  EXPIRED: { TR: 'Son teklifin süresi doldu.', EN: 'The last offer expired.' },
};

export default function SettlementProposalCard({
  activeTrade,
  userRole,
  address,
  lang,
  authenticatedFetch,
  settlementContractFns,
  proposeSettlement,
  acceptSettlement,
  rejectSettlement,
  withdrawSettlement,
  expireSettlement,
  fetchMyTrades,
  showToast,
  isContractLoading,
  setIsContractLoading,
  nowOffsetMs = 0,
}) {
  const [makerShareBps, setMakerShareBps] = React.useState(5000);
  const [expiryPreset, setExpiryPreset] = React.useState('2h');
  const [customMinutes, setCustomMinutes] = React.useState('120');
  const [validationError, setValidationError] = React.useState('');
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState('');
  const [previewData, setPreviewData] = React.useState(null);
  const [previewMode, setPreviewMode] = React.useState('create');
  // [TR] Zincir saati farkı (işlem odasından). [EN] Chain-time offset supplied by the trade room.
  const chainNowSec = React.useCallback(() => Math.floor((Date.now() + (Number(nowOffsetMs) || 0)) / 1000), [nowOffsetMs]);
  const [nowTs, setNowTs] = React.useState(chainNowSec);

  const proposal = activeTrade?.settlementProposal || null;
  const proposalState = normalizeSettlementState(proposal?.state);
  const proposalIsRenderable = proposal && !['NONE', 'UNKNOWN', null].includes(proposalState);
  const roomState = activeTrade?.state || 'LOCKED';
  const isActionableRoom = ACTIVE_ROOM_STATES.includes(roomState);
  const isTerminalRoom = TERMINAL_ROOM_STATES.includes(roomState);
  const hasBackendTradeId = Boolean(activeTrade?.id);
  const onchainTradeId = activeTrade?.onchainId ?? activeTrade?.rawTrade?.onchainId ?? null;
  const hasOnchainTradeId = onchainTradeId !== null && onchainTradeId !== undefined && onchainTradeId !== '';

  const makerAddress = (activeTrade?.makerFull || activeTrade?.rawTrade?.maker_address || null)?.toLowerCase?.() || null;
  const takerAddress = (activeTrade?.takerFull || activeTrade?.rawTrade?.taker_address || null)?.toLowerCase?.() || null;
  const userAddress = address?.toLowerCase?.() || null;
  const isTradeParty = Boolean(userAddress && (userAddress === makerAddress || userAddress === takerAddress));
  const proposer = (proposal?.proposer ?? proposal?.proposed_by)?.toLowerCase?.() || null;
  const isProposer = Boolean(isTradeParty && userAddress && proposer && userAddress === proposer);
  const isCounterparty = Boolean(isTradeParty && userAddress && proposer && userAddress !== proposer);
  const previewUnavailableMessage = lang === 'TR'
    ? 'Backend trade kaydı hazır olmadığı için settlement önizleme açılamıyor.'
    : 'Settlement preview is unavailable until backend trade record is ready.';
  const missingOnchainIdMessage = lang === 'TR' ? 'On-chain trade ID bulunamadı.' : 'Missing on-chain trade ID.';
  const contractFns = settlementContractFns || {
    proposeSettlement,
    acceptSettlement,
    rejectSettlement,
    withdrawSettlement,
    expireSettlement,
  };
  const settlementActions = useSettlementActions({
    activeTrade,
    userRole,
    address,
    lang,
    contractFns,
    fetchMyTrades,
    showToast,
    isContractLoading,
    setIsContractLoading,
    nowTs,
  });

  const normalizedMakerShareBps = Number(makerShareBps);
  const normalizedTakerShareBps = 10000 - normalizedMakerShareBps;
  const computedExpiryMinutes = expiryPreset === 'custom'
    ? Number(customMinutes)
    : (expiryPreset === '30m' ? 30 : expiryPreset === '2h' ? 120 : 24 * 60);
  const expiresAt = toUnixSeconds(proposal?.expiresAt ?? proposal?.expires_at ?? 0);
  // [TR] Kontratla birebir: `now > expiresAt` dolmuş sayılır. [EN] Mirrors the contract: expired once now > expiresAt.
  const isExpired = expiresAt > 0 && nowTs > expiresAt;
  const isProposedState = proposalState === 'PROPOSED';
  // [TR] Canonical kural: settlement aksiyonları yalnız CHALLENGED dispute safhasında görünür.
  // [EN] Canonical rule: settlement actions render only in CHALLENGED dispute phase.
  const showActionableProposedControls = proposalIsRenderable && isProposedState && isActionableRoom;
  const showTerminalProposedHistory = proposalIsRenderable && isProposedState && isTerminalRoom;
  // [TR] Reddedilen, geri çekilen ya da süresi dolan tekliften sonra yeni teklif formu açılır (kontrat izin verir).
  // [EN] A new offer form opens after a rejected/withdrawn/expired offer (the contract allows overwriting it).
  const canOpenNewOffer = isActionableRoom && (!proposalIsRenderable || CLOSED_PROPOSAL_STATES.includes(proposalState) || (isProposedState && isExpired));

  React.useEffect(() => {
    if (!proposal || proposalState !== 'PROPOSED' || !expiresAt) return undefined;
    setNowTs(chainNowSec());
    const timer = setInterval(() => setNowTs(chainNowSec()), 1000);
    return () => clearInterval(timer);
  }, [proposal, proposalState, expiresAt, chainNowSec]);

  const validateInput = React.useCallback(() => {
    if (!Number.isInteger(normalizedMakerShareBps) || normalizedMakerShareBps < 0 || normalizedMakerShareBps > 10000) {
      setValidationError(lang === 'TR' ? 'makerShareBps 0..10000 aralığında olmalı.' : 'makerShareBps must be in range 0..10000.');
      return false;
    }
    if (!Number.isInteger(computedExpiryMinutes)) {
      setValidationError(lang === 'TR' ? 'Geçerli bir süre girin.' : 'Enter a valid expiry duration.');
      return false;
    }
    if (computedExpiryMinutes < MIN_CUSTOM_EXPIRY_MINUTES || computedExpiryMinutes > MAX_CUSTOM_EXPIRY_MINUTES) {
      setValidationError(
        lang === 'TR'
          ? 'Özel süre 10 dakika ile 7 gün arasında olmalı.'
          : 'Custom expiry must be between 10 minutes and 7 days.'
      );
      return false;
    }
    setValidationError('');
    return true;
  }, [normalizedMakerShareBps, computedExpiryMinutes, lang]);

  const loadPreview = React.useCallback(async (makerBpsOverride = normalizedMakerShareBps) => {
    if (!hasBackendTradeId) {
      setPreviewError(previewUnavailableMessage);
      return false;
    }
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await authenticatedFetch(buildSettlementPreviewUrl(activeTrade.id), {
        method: 'POST',
        body: JSON.stringify({ makerShareBps: makerBpsOverride }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || (lang === 'TR' ? 'Settlement önizleme alınamadı.' : 'Failed to fetch settlement preview.'));
      }
      setPreviewData(data?.preview || data || null);
      return true;
    } catch (err) {
      setPreviewError(err?.message || (lang === 'TR' ? 'Önizleme hatası.' : 'Preview failed.'));
      return false;
    } finally {
      setPreviewLoading(false);
    }
  }, [activeTrade?.id, authenticatedFetch, hasBackendTradeId, lang, normalizedMakerShareBps, previewUnavailableMessage]);

  const onPreviewCreate = async () => {
    if (!validateInput()) return;
    if (!hasBackendTradeId) {
      setPreviewError(previewUnavailableMessage);
      return;
    }
    setPreviewMode('create');
    const ok = await loadPreview(normalizedMakerShareBps);
    if (ok) setPreviewOpen(true);
  };

  const onConfirmCreate = async () => {
    // [TR] F18 — Bitiş, önizleme modalında beklenen süre dahil TX anında yeniden hesaplanır.
    const ok = await settlementActions.propose({
      makerShareBps: normalizedMakerShareBps,
      expiresAt: computeSettlementExpiresAt(chainNowSec(), computedExpiryMinutes),
    });
    if (ok) setPreviewOpen(false);
  };

  const onPreviewAccept = async () => {
    const makerBps = Number(proposal?.makerShareBps ?? proposal?.maker_share_bps ?? 0);
    setPreviewMode('accept');
    const ok = await loadPreview(makerBps);
    if (ok) setPreviewOpen(true);
  };

  if (!activeTrade) return null;

  // [TR] Kontrat maker payını (bps) ister; kullanıcı ise "bana / karşı tarafa yüzde kaç" diye düşünür.
  // [EN] The contract takes the maker share (bps); users think in "me / counterparty percent".
  const isMakerView = String(userRole || '').toLowerCase() === 'maker';
  const myShareBps = Number.isFinite(normalizedMakerShareBps) ? (isMakerView ? normalizedMakerShareBps : 10000 - normalizedMakerShareBps) : 5000;
  const setMyShareBps = (bps) => setMakerShareBps(String(isMakerView ? bps : 10000 - Number(bps)));
  const pct = (bps) => fmtBps(bps, lang);
  const inputClass = 'mt-1 w-full bg-elevated border border-borderStrong rounded-lg px-3 py-2 text-sm text-textPrimary';

  return (
    <div className="mt-2 mb-2 bg-surface border border-borderStrong rounded-xl p-4" data-testid="settlement-proposal-card">
      <div className="mb-3">
        {/* [TR] Tarafsızlık notu işlem özetinde zaten var; kartta tekrar edilmez. */}
        <h3 className="text-sm font-bold text-textPrimary flex items-center gap-2" title={lang === 'TR' ? SETTLEMENT_NEUTRALITY_COPY.TR : SETTLEMENT_NEUTRALITY_COPY.EN}><Handshake className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />{lang === 'TR' ? 'Uzlaşma teklifi' : 'Settlement offer'}</h3>
      </div>

      {!isActionableRoom && !isTerminalRoom && (
        <p className="text-xs text-textMuted">
          {lang === 'TR'
            ? 'Uzlaşma yalnız itiraz sürecinde kullanılabilir.'
            : 'Settlement is available only during CHALLENGED disputes.'}
        </p>
      )}

      {isTerminalRoom && !proposalIsRenderable && (
        <p className="text-xs text-textMuted">{lang === 'TR' ? 'İşlem sonlandı. Uzlaşma yalnız geçmiş bilgi olarak gösterilir.' : 'Trade is terminal. Settlement is shown only as history.'}</p>
      )}

      {proposalIsRenderable && proposalState === 'PROPOSED' && (
        <div className="space-y-3">
          {(() => {
            const offerMakerBps = Number(proposal?.makerShareBps ?? proposal?.maker_share_bps);
            const offerMine = Number.isFinite(offerMakerBps) ? (isMakerView ? offerMakerBps : 10000 - offerMakerBps) : null;
            return (
              <div className="rounded-lg bg-elevated border border-borderSubtle p-3">
                <p className="text-xs text-textMuted">{isProposer ? (lang === 'TR' ? 'Gönderdiğiniz teklif' : 'Your offer') : (lang === 'TR' ? 'Karşı tarafın teklifi' : 'Counterparty offer')}</p>
                <p className="mt-1 text-sm text-textPrimary">
                  {lang === 'TR' ? 'Size' : 'You'} <strong>{offerMine == null ? '—' : pct(offerMine)}</strong>
                  <span className="text-textMuted"> · </span>
                  {lang === 'TR' ? 'Karşı tarafa' : 'Counterparty'} <strong>{offerMine == null ? '—' : pct(10000 - offerMine)}</strong>
                </p>
                <p className={`mt-1 text-xs ${isExpired ? 'text-danger' : 'text-textMuted'}`}>
                  {isExpired
                    ? (lang === 'TR' ? 'Teklif süresi doldu.' : 'Proposal is expired.')
                    : `${lang === 'TR' ? 'Kalan' : 'Time left'}: ${Math.floor(Math.max(0, expiresAt - nowTs) / 60)} ${lang === 'TR' ? 'dk' : 'min'} · ${safeDate(expiresAt)}`}
                </p>
              </div>
            );
          })()}

          {showTerminalProposedHistory && (
            <p className="text-xs text-textMuted">
              {lang === 'TR'
                ? 'Bu işlem terminal duruma ulaştı. Bu settlement teklifi artık işleme alınamaz.'
                : 'This trade already reached a terminal state. This settlement proposal can no longer be acted on.'}
            </p>
          )}

          {showActionableProposedControls && (
            <div className="flex flex-wrap gap-2">
              {!hasOnchainTradeId && (
                <p className="text-xs text-warning">{missingOnchainIdMessage}</p>
              )}
              {!isExpired && isProposer && (
                <button
                  onClick={settlementActions.withdraw}
                  disabled={isContractLoading || !hasOnchainTradeId || !settlementActions.canWithdraw}
                  className="px-3 py-2 text-sm rounded-lg border border-warning/50 text-warning hover:bg-warning hover:text-white transition disabled:opacity-50"
                >
                  {lang === 'TR' ? 'Geri Çek' : 'Withdraw'}
                </button>
              )}
              {!isExpired && isCounterparty && (
                <>
                  <button
                    onClick={onPreviewAccept}
                    disabled={isContractLoading || !hasOnchainTradeId || !hasBackendTradeId || !settlementActions.canAccept}
                    className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition disabled:opacity-50"
                  >
                    {lang === 'TR' ? 'Kabul Et (Önizleme)' : 'Accept (Preview)'}
                  </button>
                  <button
                    onClick={settlementActions.reject}
                    disabled={isContractLoading || !hasOnchainTradeId || !settlementActions.canReject}
                    className="px-3 py-2 text-sm rounded-lg border border-danger/50 text-danger hover:bg-danger hover:text-white transition disabled:opacity-50"
                  >
                    {lang === 'TR' ? 'Reddet' : 'Reject'}
                  </button>
                </>
              )}
              {isExpired && isTradeParty && (
                <button
                  onClick={settlementActions.expire}
                  disabled={isContractLoading || !hasOnchainTradeId || !settlementActions.canExpire}
                  className="px-3 py-2 text-sm rounded-lg border border-warning/50 text-warning hover:bg-warning hover:text-white transition disabled:opacity-50"
                >
                  {lang === 'TR' ? 'Süresi Doldu Olarak İşaretle' : 'Mark as Expired'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {proposalIsRenderable && proposalState === 'FINALIZED' && (
        <div className="space-y-2 text-xs">
          <p className="text-success font-bold">{lang === 'TR' ? 'Uzlaşma tamamlandı' : 'Settlement finalized'}</p>
          <p className="text-textSecondary">{lang === 'TR' ? 'Satıcıya' : 'Maker payout'}: <span className="font-mono">{proposal?.makerPayout ?? proposal?.maker_payout ?? '—'}</span></p>
          <p className="text-textSecondary">{lang === 'TR' ? 'Alıcıya' : 'Taker payout'}: <span className="font-mono">{proposal?.takerPayout ?? proposal?.taker_payout ?? '—'}</span></p>
          <p className="text-textMuted">{lang === 'TR' ? 'Tarih' : 'Finalized at'}: {safeDate(proposal?.finalizedAt ?? proposal?.finalized_at)}</p>
          <p className="text-textMuted">txHash: <span className="font-mono text-textPrimary">{shortHash(proposal?.txHash ?? proposal?.tx_hash)}</span></p>
        </div>
      )}

      {proposalIsRenderable && CLOSED_PROPOSAL_STATES.includes(proposalState) && (
        <p className="text-xs text-textMuted">{CLOSED_PROPOSAL_COPY[proposalState][lang === 'TR' ? 'TR' : 'EN']}</p>
      )}

      {canOpenNewOffer && (
        <div className={`space-y-3${proposalIsRenderable ? ' mt-4 pt-3 border-t border-borderSubtle' : ''}`}>
          {proposalIsRenderable && (
            <p className="text-xs font-semibold text-textPrimary">{lang === 'TR' ? 'Yeni teklif verebilirsiniz' : 'You can make a new offer'}</p>
          )}
          <div>
            <div className="flex items-end justify-between text-sm">
              <span className="text-textSecondary">{lang === 'TR' ? 'Size' : 'You'} <strong className="text-textPrimary text-lg">{pct(myShareBps)}</strong></span>
              <span className="text-textSecondary">{lang === 'TR' ? 'Karşı tarafa' : 'Counterparty'} <strong className="text-textPrimary text-lg">{pct(10000 - myShareBps)}</strong></span>
            </div>
            <input
              type="range"
              min="0"
              max="10000"
              step="100"
              value={myShareBps}
              onChange={(e) => setMyShareBps(e.target.value)}
              aria-label={lang === 'TR' ? 'Sizin payınız' : 'Your share'}
              className="mt-2 w-full accent-emerald-500"
            />
            <div className="mt-2 flex gap-2">
              {[2500, 5000, 7500].map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => setMyShareBps(bps)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${myShareBps === bps ? 'bg-brand/10 border-brand text-brand' : 'bg-elevated border-borderSubtle text-textSecondary hover:text-textPrimary'}`}
                >
                  {pct(bps)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-textSecondary">
              {lang === 'TR' ? 'Teklif geçerliliği' : 'Offer valid for'}
              <select
                value={expiryPreset}
                onChange={(e) => setExpiryPreset(e.target.value)}
                className={inputClass}
              >
                <option value="30m">{lang === 'TR' ? '30 dakika' : '30 minutes'}</option>
                <option value="2h">{lang === 'TR' ? '2 saat' : '2 hours'}</option>
                <option value="24h">{lang === 'TR' ? '24 saat' : '24 hours'}</option>
                <option value="custom">{lang === 'TR' ? 'Özel' : 'Custom'}</option>
              </select>
            </label>
            {expiryPreset === 'custom' && (
              <label className="text-xs text-textSecondary">
                {lang === 'TR' ? 'Özel dakika' : 'Custom minutes'}
                <input
                  type="number"
                  min={String(MIN_CUSTOM_EXPIRY_MINUTES)}
                  max={String(MAX_CUSTOM_EXPIRY_MINUTES)}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  className={inputClass}
                />
              </label>
            )}
          </div>

          {validationError && <p className="text-xs text-danger">{validationError}</p>}
          {!hasBackendTradeId && <p className="text-xs text-warning">{previewUnavailableMessage}</p>}
          {!hasOnchainTradeId && <p className="text-xs text-warning">{missingOnchainIdMessage}</p>}

          <button
            onClick={onPreviewCreate}
            disabled={isContractLoading || !hasBackendTradeId || !hasOnchainTradeId}
            className={`w-full py-2.5 rounded-lg text-sm font-bold transition ${isContractLoading ? 'bg-elevated text-textMuted border border-borderStrong cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50'}`}
          >
            {lang === 'TR' ? 'Teklifi önizle' : 'Preview offer'}
          </button>
        </div>
      )}


      <SettlementPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        lang={lang}
        isLoading={isContractLoading || previewLoading}
        error={previewError}
        makerShareBps={previewMode === 'accept' ? (proposal?.makerShareBps ?? proposal?.maker_share_bps ?? '—') : normalizedMakerShareBps}
        takerShareBps={previewMode === 'accept' ? (proposal?.takerShareBps ?? proposal?.taker_share_bps ?? '—') : normalizedTakerShareBps}
        previewData={previewData}
        onConfirm={previewMode === 'accept'
          ? settlementActions.accept
          : onConfirmCreate}
        confirmLabel={previewMode === 'accept'
          ? (lang === 'TR' ? 'Kabul et ve zincire gönder' : 'Accept and submit on-chain')
          : (lang === 'TR' ? 'Teklifi zincire gönder' : 'Submit proposal on-chain')}
        disableConfirm={previewLoading || Boolean(previewError) || !hasOnchainTradeId}
        userRole={userRole}
        tokenSymbol={activeTrade?.crypto || 'USDT'}
        decimals={activeTrade?.tokenDecimals ?? 6}
      />
    </div>
  );
}
