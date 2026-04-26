import React from 'react';
import { buildSettlementPreviewUrl } from '../app/apiConfig';
import SettlementPreviewModal from './SettlementPreviewModal';

const ACTIVE_ROOM_STATES = ['CHALLENGED'];
const TERMINAL_ROOM_STATES = ['RESOLVED', 'CANCELED', 'BURNED'];
const MIN_CUSTOM_EXPIRY_MINUTES = 10;
const MAX_CUSTOM_EXPIRY_MINUTES = 7 * 24 * 60;
const SETTLEMENT_STATE_BY_INDEX = ['NONE', 'PROPOSED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'FINALIZED'];
export const SETTLEMENT_NEUTRALITY_COPY = {
  TR: 'Araf kimin haklı olduğuna karar vermez; settlement yalnız CHALLENGED dispute fazında iki taraf imzasıyla mümkündür.',
  EN: 'Araf does not decide who is right; settlement is available only in the CHALLENGED dispute phase with both parties’ signatures.',
};

export function normalizeSettlementState(rawState) {
  if (typeof rawState === 'number') return SETTLEMENT_STATE_BY_INDEX[rawState] || 'UNKNOWN';
  if (typeof rawState === 'bigint') return SETTLEMENT_STATE_BY_INDEX[Number(rawState)] || 'UNKNOWN';
  if (typeof rawState === 'string') return rawState.toUpperCase();
  return 'NONE';
}

export function toUnixSeconds(value) {
  // [TR] Backend hem unix hem ISO tarih dönebildiği için tek normalize kapısı.
  // [EN] Single normalization gate because backend payload may provide unix or ISO time values.
  if (!value) return 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber > 1e12 ? Math.floor(asNumber / 1000) : Math.floor(asNumber);
  const asDateMs = new Date(value).getTime();
  return Number.isFinite(asDateMs) ? Math.floor(asDateMs / 1000) : 0;
}

const shortHash = (hash) => (hash && hash.length > 12 ? `${hash.slice(0, 8)}...${hash.slice(-4)}` : hash || '—');
export const safeDate = (v) => {
  const ts = toUnixSeconds(v);
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

export default function SettlementProposalCard({
  activeTrade,
  userRole,
  address,
  lang,
  authenticatedFetch,
  proposeSettlement,
  acceptSettlement,
  rejectSettlement,
  withdrawSettlement,
  expireSettlement,
  fetchMyTrades,
  showToast,
  isContractLoading,
  setIsContractLoading,
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
  const [nowTs, setNowTs] = React.useState(Math.floor(Date.now() / 1000));

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
  const userIsMaker = userRole === 'maker' || (userAddress && makerAddress === userAddress);
  const isTradeParty = Boolean(userAddress && (userAddress === makerAddress || userAddress === takerAddress));
  const proposer = (proposal?.proposer ?? proposal?.proposed_by)?.toLowerCase?.() || null;
  const isProposer = Boolean(isTradeParty && userAddress && proposer && userAddress === proposer);
  const isCounterparty = Boolean(isTradeParty && userAddress && proposer && userAddress !== proposer);
  const previewUnavailableMessage = lang === 'TR'
    ? 'Backend trade kaydı hazır olmadığı için settlement önizleme açılamıyor.'
    : 'Settlement preview is unavailable until backend trade record is ready.';
  const missingOnchainIdMessage = lang === 'TR' ? 'On-chain trade ID bulunamadı.' : 'Missing on-chain trade ID.';

  const normalizedMakerShareBps = Number(makerShareBps);
  const normalizedTakerShareBps = 10000 - normalizedMakerShareBps;
  const computedExpiryMinutes = expiryPreset === 'custom'
    ? Number(customMinutes)
    : (expiryPreset === '30m' ? 30 : expiryPreset === '2h' ? 120 : 24 * 60);
  const computedExpiresAt = Math.floor(Date.now() / 1000) + (Number.isFinite(computedExpiryMinutes) ? computedExpiryMinutes : 0) * 60;
  const expiresAt = toUnixSeconds(proposal?.expiresAt ?? proposal?.expires_at ?? 0);
  const isExpired = expiresAt > 0 && nowTs >= expiresAt;
  const isProposedState = proposalState === 'PROPOSED';
  // [TR] Canonical kural: settlement aksiyonları yalnız CHALLENGED dispute safhasında görünür.
  // [EN] Canonical rule: settlement actions render only in CHALLENGED dispute phase.
  const showActionableProposedControls = proposalIsRenderable && isProposedState && isActionableRoom;
  const showTerminalProposedHistory = proposalIsRenderable && isProposedState && isTerminalRoom;

  React.useEffect(() => {
    if (!proposal || proposalState !== 'PROPOSED' || !expiresAt) return undefined;
    const timer = setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [proposal, proposalState, expiresAt]);

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

  const refreshTradesAfterTx = React.useCallback(async () => {
    await fetchMyTrades();
  }, [fetchMyTrades]);

  const runTx = React.useCallback(async (fn, successMessage) => {
    try {
      setIsContractLoading(true);
      await fn();
      showToast(successMessage, 'success');
      await refreshTradesAfterTx();
    } catch (err) {
      const msg = err?.shortMessage || err?.reason || err?.message || (lang === 'TR' ? 'Settlement işlemi başarısız.' : 'Settlement transaction failed.');
      showToast(msg, 'error');
    } finally {
      setIsContractLoading(false);
    }
  }, [lang, refreshTradesAfterTx, setIsContractLoading, showToast]);

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
    if (!hasOnchainTradeId) return;
    await runTx(
      () => proposeSettlement(BigInt(onchainTradeId), normalizedMakerShareBps, computedExpiresAt),
      lang === 'TR' ? 'Settlement teklifi zincire gönderildi.' : 'Settlement proposal submitted on-chain.'
    );
    setPreviewOpen(false);
  };

  const onPreviewAccept = async () => {
    const makerBps = Number(proposal?.makerShareBps ?? proposal?.maker_share_bps ?? 0);
    setPreviewMode('accept');
    const ok = await loadPreview(makerBps);
    if (ok) setPreviewOpen(true);
  };

  if (!activeTrade) return null;

  return (
    <div className="mt-2 mb-2 bg-[#0c0c0e] border border-[#222] rounded-xl p-4">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-white">{lang === 'TR' ? 'On-Chain Settlement' : 'On-Chain Settlement'}</h3>
        <p className="text-[11px] text-slate-400">
          {lang === 'TR'
            ? SETTLEMENT_NEUTRALITY_COPY.TR
            : SETTLEMENT_NEUTRALITY_COPY.EN}
        </p>
      </div>

      {!isActionableRoom && !isTerminalRoom && (
        <p className="text-xs text-slate-500">
          {lang === 'TR'
            ? 'Settlement yalnız CHALLENGED dispute safhasında kullanılabilir (LOCKED/PAID durumlarında kapalıdır).'
            : 'Settlement is available only during CHALLENGED disputes (disabled in LOCKED/PAID states).'}
        </p>
      )}

      {isTerminalRoom && !proposalIsRenderable && (
        <p className="text-xs text-slate-500">{lang === 'TR' ? 'İşlem sonlandı. Settlement yalnız geçmiş bilgi olarak gösterilir.' : 'Trade is terminal. Settlement is shown only as history.'}</p>
      )}

      {isActionableRoom && !proposalIsRenderable && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-slate-300">
              makerShareBps
              <input
                type="number"
                min="0"
                max="10000"
                value={makerShareBps}
                onChange={(e) => setMakerShareBps(e.target.value)}
                className="mt-1 w-full bg-[#111113] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-300">
              takerShareBps
              <input disabled value={Number.isFinite(normalizedTakerShareBps) ? normalizedTakerShareBps : '—'} className="mt-1 w-full bg-[#0f0f12] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm text-slate-400" />
            </label>
          </div>
          <input
            type="range"
            min="0"
            max="10000"
            value={Number.isFinite(normalizedMakerShareBps) ? normalizedMakerShareBps : 0}
            onChange={(e) => setMakerShareBps(e.target.value)}
            className="w-full"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-slate-300">
              {lang === 'TR' ? 'Süre' : 'Expiry'}
              <select
                value={expiryPreset}
                onChange={(e) => setExpiryPreset(e.target.value)}
                className="mt-1 w-full bg-[#111113] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="30m">{lang === 'TR' ? '30 dakika' : '30 minutes'}</option>
                <option value="2h">{lang === 'TR' ? '2 saat' : '2 hours'}</option>
                <option value="24h">{lang === 'TR' ? '24 saat' : '24 hours'}</option>
                <option value="custom">{lang === 'TR' ? 'Özel' : 'Custom'}</option>
              </select>
            </label>
            {expiryPreset === 'custom' && (
              <label className="text-xs text-slate-300">
                {lang === 'TR' ? 'Özel dakika' : 'Custom minutes'}
                <input
                  type="number"
                  min={String(MIN_CUSTOM_EXPIRY_MINUTES)}
                  max={String(MAX_CUSTOM_EXPIRY_MINUTES)}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  className="mt-1 w-full bg-[#111113] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm text-white"
                />
              </label>
            )}
          </div>

          {validationError && <p className="text-xs text-red-400">{validationError}</p>}
          {!hasBackendTradeId && <p className="text-xs text-amber-300">{previewUnavailableMessage}</p>}
          {!hasOnchainTradeId && <p className="text-xs text-amber-300">{missingOnchainIdMessage}</p>}

          <div className="flex gap-2">
            <button
              onClick={onPreviewCreate}
              disabled={isContractLoading || !hasBackendTradeId || !hasOnchainTradeId}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition ${isContractLoading ? 'bg-[#1a1a1f] text-slate-500 border border-[#2a2a2e] cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
            >
              {lang === 'TR' ? 'Önizleme' : 'Preview'}
            </button>
            <div className="text-[11px] text-slate-500 self-center">
              {lang === 'TR'
                ? 'Kararı sen ve karşı taraf verirsiniz.'
                : 'You and the counterparty decide the split.'}
            </div>
          </div>
        </div>
      )}

      {proposalIsRenderable && proposalState === 'PROPOSED' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <p className="text-slate-400">{lang === 'TR' ? 'Proposer' : 'Proposer'}: <span className="text-white font-mono">{proposal?.proposer ?? proposal?.proposed_by ?? '—'}</span></p>
            <p className="text-slate-400">makerShareBps: <span className="text-white font-mono">{proposal?.makerShareBps ?? proposal?.maker_share_bps ?? '—'}</span></p>
            <p className="text-slate-400">takerShareBps: <span className="text-white font-mono">{proposal?.takerShareBps ?? proposal?.taker_share_bps ?? '—'}</span></p>
            <p className="text-slate-400">{lang === 'TR' ? 'Sona erme' : 'Expires'}: <span className="text-white font-mono">{safeDate(expiresAt)}</span></p>
          </div>
          <p className={`text-xs ${isExpired ? 'text-red-400' : 'text-slate-400'}`}>
            {isExpired
              ? (lang === 'TR' ? 'Teklif süresi doldu.' : 'Proposal is expired.')
              : (lang === 'TR' ? `Kalan süre: ${Math.max(0, expiresAt - nowTs)} sn` : `Time left: ${Math.max(0, expiresAt - nowTs)} sec`)}
          </p>

          {showTerminalProposedHistory && (
            <p className="text-xs text-slate-500">
              {lang === 'TR'
                ? 'Bu işlem terminal duruma ulaştı. Bu settlement teklifi artık işleme alınamaz.'
                : 'This trade already reached a terminal state. This settlement proposal can no longer be acted on.'}
            </p>
          )}

          {showActionableProposedControls && (
            <div className="flex flex-wrap gap-2">
              {!hasOnchainTradeId && (
                <p className="text-xs text-amber-300">{missingOnchainIdMessage}</p>
              )}
              {!isExpired && isProposer && (
                <button
                  onClick={() => runTx(() => withdrawSettlement(BigInt(onchainTradeId)), lang === 'TR' ? 'Settlement teklifi geri çekildi.' : 'Settlement proposal withdrawn.')}
                  disabled={isContractLoading || !hasOnchainTradeId}
                  className="px-3 py-2 text-sm rounded-lg border border-orange-500/40 text-orange-400 hover:bg-orange-500 hover:text-white transition disabled:opacity-50"
                >
                  {lang === 'TR' ? 'Geri Çek' : 'Withdraw'}
                </button>
              )}
              {!isExpired && isCounterparty && (
                <>
                  <button
                    onClick={onPreviewAccept}
                    disabled={isContractLoading || !hasOnchainTradeId || !hasBackendTradeId}
                    className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition disabled:opacity-50"
                  >
                    {lang === 'TR' ? 'Kabul Et (Önizleme)' : 'Accept (Preview)'}
                  </button>
                  <button
                    onClick={() => runTx(() => rejectSettlement(BigInt(onchainTradeId)), lang === 'TR' ? 'Settlement teklifi reddedildi.' : 'Settlement proposal rejected.')}
                    disabled={isContractLoading || !hasOnchainTradeId}
                    className="px-3 py-2 text-sm rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500 hover:text-white transition disabled:opacity-50"
                  >
                    {lang === 'TR' ? 'Reddet' : 'Reject'}
                  </button>
                </>
              )}
              {isExpired && isTradeParty && (
                <button
                  onClick={() => runTx(() => expireSettlement(BigInt(onchainTradeId)), lang === 'TR' ? 'Settlement teklifi süresi doldu olarak işaretlendi.' : 'Settlement proposal marked expired.')}
                  disabled={isContractLoading || !hasOnchainTradeId}
                  className="px-3 py-2 text-sm rounded-lg border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500 hover:text-black transition disabled:opacity-50"
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
          <p className="text-emerald-400 font-bold">{lang === 'TR' ? 'Settlement Finalized' : 'Settlement Finalized'}</p>
          <p className="text-slate-300">{lang === 'TR' ? 'Maker payout' : 'Maker payout'}: <span className="font-mono">{proposal?.makerPayout ?? proposal?.maker_payout ?? '—'}</span></p>
          <p className="text-slate-300">{lang === 'TR' ? 'Taker payout' : 'Taker payout'}: <span className="font-mono">{proposal?.takerPayout ?? proposal?.taker_payout ?? '—'}</span></p>
          <p className="text-slate-400">{lang === 'TR' ? 'Finalized at' : 'Finalized at'}: {safeDate(proposal?.finalizedAt ?? proposal?.finalized_at)}</p>
          <p className="text-slate-400">txHash: <span className="font-mono text-white">{shortHash(proposal?.txHash ?? proposal?.tx_hash)}</span></p>
        </div>
      )}

      {proposalIsRenderable && !['PROPOSED', 'FINALIZED'].includes(proposalState) && (
        <p className="text-xs text-slate-400">
          {lang === 'TR'
            ? `Settlement geçmiş durumu: ${proposalState}`
            : `Settlement historical state: ${proposalState}`}
        </p>
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
          ? () => runTx(() => acceptSettlement(BigInt(onchainTradeId)), lang === 'TR' ? 'Settlement kabul edildi ve işlem on-chain kapanacak.' : 'Settlement accepted; trade will close on-chain.')
          : onConfirmCreate}
        confirmLabel={previewMode === 'accept'
          ? (lang === 'TR' ? 'Kabul Et ve On-Chain Gönder' : 'Accept and Submit On-Chain')
          : (lang === 'TR' ? 'Teklifi On-Chain Gönder' : 'Submit Proposal On-Chain')}
        disableConfirm={previewLoading || Boolean(previewError) || !hasOnchainTradeId}
      />
    </div>
  );
}
