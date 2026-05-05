import React from 'react';
import ReferenceRateTicker from '../../../components/ReferenceRateTicker';
import PIIDisplay from '../../../components/PIIDisplay';
import SettlementProposalCard from '../../../components/SettlementProposalCard';
import { buildTradeDecisionModel } from './tradeDecisionModel';
import StateGuidancePanel from './StateGuidancePanel';
import PrimaryActionPanel from './PrimaryActionPanel';
import SecondaryActionsPanel from './SecondaryActionsPanel';
import TimerStack from './TimerStack';
import TradeSummaryCard from './TradeSummaryCard';
import TechnicalDetailsDisclosure from './TechnicalDetailsDisclosure';
import TradeRoomContextPanel from './TradeRoomContextPanel';

export const TradeRoomPage = ({ decisionInput, actionHandlers = {}, viewProps = {} }) => {
  const model = React.useMemo(() => buildTradeDecisionModel(decisionInput || {}), [decisionInput]);
  const { trade: activeTrade, tradeState: roomState, userRole, lang, paymentIpfsHash } = decisionInput || {};
  const isTaker = userRole === 'taker'; const isMaker = userRole === 'maker';
  const tradeTokenDecimals = activeTrade?.tokenDecimals ?? (viewProps.tokenDecimalsMap?.[activeTrade?.crypto || 'USDT'] ?? viewProps.DEFAULT_TOKEN_DECIMALS);
  const rawCryptoAmt = activeTrade?.cryptoAmountRaw ? viewProps.rawTokenToDisplayNumber(activeTrade.cryptoAmountRaw, tradeTokenDecimals) : ((activeTrade?.max || 0) / (activeTrade?.rate || 1));
  const protocolFee = rawCryptoAmt * ((viewProps.takerFeeBps || 10) / 10000); const netAmount = rawCryptoAmt - protocolFee; const asset = activeTrade?.crypto || 'USDT';
  const feeBreakdownText = lang === 'TR' ? `Kilitli: ${rawCryptoAmt.toFixed(2)} ${asset} | Protokol Kesintisi: ${protocolFee.toFixed(4)} ${asset} | Net Alınacak: ${netAmount.toFixed(2)} ${asset}` : `Locked: ${rawCryptoAmt.toFixed(2)} ${asset} | Protocol Fee: ${protocolFee.toFixed(4)} ${asset} | Net to Receive: ${netAmount.toFixed(2)} ${asset}`;
  const showBurn = Boolean(activeTrade?.onchainId && roomState === 'CHALLENGED' && activeTrade?.challengedAt && (Date.now() - new Date(activeTrade.challengedAt).getTime() > 10*24*3600*1000));

  return <TradeRoomContextPanel><div className="p-4 md:p-8 max-w-[900px] w-full mx-auto relative mt-6 md:mt-0">
    <button onClick={() => viewProps.setCurrentView('market')} className="absolute -top-2 md:-top-4 left-4 md:left-8 text-slate-500 hover:text-white text-sm transition">← {lang === 'TR' ? 'Pazar Yerine Dön' : 'Go Back'}</button>
    <ReferenceRateTicker lang={lang} />
    <div className={`border rounded-2xl p-5 md:p-8 shadow-2xl transition-colors duration-700 ${roomState === 'CHALLENGED' ? 'bg-[#1a0f0f] border-red-900/40' : 'bg-[#111113] border-[#222]'}`}>
      <TradeSummaryCard activeTrade={activeTrade} roomState={roomState} userRole={userRole} feeBreakdownText={feeBreakdownText} lang={lang} isChallenged={roomState === 'CHALLENGED'} />
      <SettlementProposalCard activeTrade={activeTrade} userRole={userRole} address={viewProps.address} lang={lang} authenticatedFetch={viewProps.authenticatedFetch} proposeSettlement={actionHandlers.propose_settlement} acceptSettlement={actionHandlers.accept_settlement} rejectSettlement={actionHandlers.reject_settlement} withdrawSettlement={actionHandlers.withdraw_settlement} expireSettlement={actionHandlers.expire_settlement} fetchMyTrades={viewProps.fetchMyTrades} showToast={viewProps.showToast} isContractLoading={viewProps.isContractLoading} setIsContractLoading={viewProps.setIsContractLoading} />
      {roomState === 'LOCKED' && isTaker && <div className="w-full max-w-sm mt-4 space-y-3 mx-auto"><input type="file" onChange={viewProps.handleFileUpload} accept="image/*,.pdf" className="hidden" id="receipt-upload"/><label htmlFor="receipt-upload" className="w-full bg-[#0a0a0c] text-white px-4 py-3 rounded-xl border border-[#333] mb-4 text-sm flex items-center justify-center cursor-pointer hover:border-blue-500/50 transition">{paymentIpfsHash ? (lang === 'TR' ? '✅ Yüklendi (Hash: ' + paymentIpfsHash.slice(0,8) + '...)' : '✅ Uploaded') : (lang === 'TR' ? '📎 Dekont Yükle' : '📎 Upload Receipt')}</label><p className="text-[10px] text-slate-500 mt-1 mb-4 text-center">{lang === 'TR' ? 'Dekontunuz AES-256 ile şifrelenir ve işlem bitince kalıcı olarak silinir.' : 'Receipt is AES-256 encrypted and permanently deleted after trade.'}</p></div>}
      {roomState === 'LOCKED' && isMaker && <div className="flex flex-col items-center"><p className="text-slate-500 mb-6 text-sm animate-pulse">{lang === 'TR' ? 'Alıcının transferi bekleniyor...' : 'Waiting for buyer transfer...'}</p><div className="w-full max-w-md mt-2 mx-auto p-4 bg-[#1a0f0f] border border-red-900/30 rounded-xl text-left"><p className="text-xs text-red-400 font-bold mb-1">⚠️ {lang === 'TR' ? 'ÜÇGEN DOLANDIRICILIK ÖNLEMİ' : 'TRIANGULATION FRAUD PREVENTION'}</p><p className="text-sm text-slate-300 mb-2">{lang === 'TR' ? 'Alıcının Doğrulanmış İsmi:' : "Buyer's Verified Name:"} <span className="font-bold text-white">{viewProps.takerName || (lang === 'TR' ? 'Yükleniyor...' : 'Loading...')}</span></p></div></div>}
      <StateGuidancePanel guidance={model.guidance} />
      {roomState === 'PAID' && <TimerStack trade={activeTrade} roomState={roomState} userRole={userRole} timers={decisionInput.timers || {}} lang={lang} />}
      <PrimaryActionPanel primaryAction={model.primaryAction} actionHandlers={actionHandlers} disabledReason={model.actionDisabledReason} lang={lang || 'EN'} />
      <SecondaryActionsPanel secondaryActions={model.secondaryActions} actionHandlers={actionHandlers} disabledReason={model.actionDisabledReason} lang={lang || 'EN'} />
      {['LOCKED','PAID','CHALLENGED'].includes(roomState) && <div className="mt-6 bg-[#0c0c0e] border border-[#222] rounded-xl p-4"><button onClick={actionHandlers.propose_cancel} className="w-full bg-[#0a0a0c] border border-orange-500/30 text-orange-500 p-3 rounded-xl font-bold text-sm">↩️ {lang === 'TR' ? 'İptal Teklif Et' : 'Propose Cancel'}</button>{viewProps.cancelStatus==='proposed_by_me' && <p className="text-orange-400 font-bold text-sm mt-2">{lang === 'TR' ? 'İptal teklifiniz gönderildi. Karşı tarafın onayı bekleniyor...' : 'Cancel proposal sent. Awaiting counterparty approval...'}</p>}{viewProps.cancelStatus==='proposed_by_other' && <div><p className="text-orange-400 font-bold text-sm mb-2">⚠️ {lang === 'TR' ? 'Karşı taraf iptal teklif etti.' : 'Opponent proposed cancellation.'}</p><button onClick={() => viewProps.setCancelStatus(null)}>{lang==='TR'?'Reddet':'Reject'}</button></div>}</div>}
      {roomState === 'CHALLENGED' && <TimerStack trade={activeTrade} roomState={roomState} userRole={userRole} bleedingAmounts={viewProps.bleedingAmounts} tokenDecimals={tradeTokenDecimals} asset={asset} formatTokenAmountFromRaw={viewProps.formatTokenAmountFromRaw} lang={lang} timers={decisionInput.timers || {}} />}
      {showBurn && <button onClick={actionHandlers.burn_expired} disabled={viewProps.isContractLoading} className="px-6 py-2.5 rounded-xl font-bold text-sm transition bg-red-900/30 text-red-400 border border-red-800/50">🔥 {lang === 'TR' ? 'Süresi Dolan İşlemi Yak' : 'Burn Expired Trade'}</button>}
      {isTaker && !['RESOLVED', 'CANCELED', 'BURNED'].includes(roomState) && <div className="border border-[#222] rounded-xl overflow-hidden mt-6 bg-[#0a0a0c] p-1"><PIIDisplay tradeId={activeTrade?.id} lang={lang} getSafeTelegramUrl={viewProps.getSafeTelegramUrl} authenticatedFetch={viewProps.authenticatedFetch} /></div>}
      {isMaker && !['RESOLVED', 'CANCELED', 'BURNED'].includes(roomState) && <div className="bg-[#0a0a0c] p-6 rounded-xl border border-[#222] text-center mt-6"><p className="text-slate-300 font-medium text-sm">{lang === 'TR' ? 'Banka hesabınıza ödeme bekleniyor.' : 'Waiting for fiat payment.'}</p><p className="text-xs text-slate-500 mt-2">{lang === 'TR' ? 'Alıcı IBAN ve Telegram bilgilerinizi şifreli kanaldan aldı.' : 'Buyer received your IBAN & Telegram via encrypted channel.'}</p></div>}
      <TechnicalDetailsDisclosure technicalDetails={model.technicalDetails} />
    </div></div></TradeRoomContextPanel>;
};

export default TradeRoomPage;
