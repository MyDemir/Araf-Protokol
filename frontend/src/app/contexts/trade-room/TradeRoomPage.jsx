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
  const { trade: activeTrade, tradeState: roomState, userRole, lang } = decisionInput || {};
  const isChallenged = roomState === 'CHALLENGED';
  const isTaker = userRole === 'taker';
  const tradeTokenDecimals = activeTrade?.tokenDecimals ?? (viewProps.tokenDecimalsMap?.[activeTrade?.crypto || 'USDT'] ?? viewProps.DEFAULT_TOKEN_DECIMALS);
  const rawCryptoAmt = activeTrade?.cryptoAmountRaw
    ? viewProps.rawTokenToDisplayNumber(activeTrade.cryptoAmountRaw, tradeTokenDecimals)
    : ((activeTrade?.max || 0) / (activeTrade?.rate || 1));
  const protocolFee = rawCryptoAmt * ((viewProps.takerFeeBps || 10) / 10000);
  const netAmount = rawCryptoAmt - protocolFee;
  const asset = activeTrade?.crypto || 'USDT';
  const feeBreakdownText = lang === 'TR'
    ? `Kilitli: ${rawCryptoAmt.toFixed(2)} ${asset} | Protokol Kesintisi: ${protocolFee.toFixed(4)} ${asset} | Net Alınacak: ${netAmount.toFixed(2)} ${asset}`
    : `Locked: ${rawCryptoAmt.toFixed(2)} ${asset} | Protocol Fee: ${protocolFee.toFixed(4)} ${asset} | Net to Receive: ${netAmount.toFixed(2)} ${asset}`;
  return (
    <TradeRoomContextPanel>
      <div className="p-4 md:p-8 max-w-[900px] w-full mx-auto relative mt-6 md:mt-0">
        <button onClick={() => viewProps.setCurrentView('market')} className="absolute -top-2 md:-top-4 left-4 md:left-8 text-slate-500 hover:text-white text-sm transition">← {lang === 'TR' ? 'Pazar Yerine Dön' : 'Go Back'}</button>
        <ReferenceRateTicker lang={lang} />
        <div className={`border rounded-2xl p-5 md:p-8 shadow-2xl transition-colors duration-700 ${isChallenged ? 'bg-[#1a0f0f] border-red-900/40' : 'bg-[#111113] border-[#222]'}`}>
          <TradeSummaryCard activeTrade={activeTrade} roomState={roomState} userRole={userRole} feeBreakdownText={feeBreakdownText} lang={lang} isChallenged={isChallenged} />
          <SettlementProposalCard activeTrade={activeTrade} userRole={userRole} address={viewProps.address} lang={lang} authenticatedFetch={viewProps.authenticatedFetch} proposeSettlement={actionHandlers.propose_settlement} acceptSettlement={actionHandlers.accept_settlement} rejectSettlement={actionHandlers.reject_settlement} withdrawSettlement={actionHandlers.withdraw_settlement} expireSettlement={actionHandlers.expire_settlement} fetchMyTrades={viewProps.fetchMyTrades} showToast={viewProps.showToast} isContractLoading={viewProps.isContractLoading} setIsContractLoading={viewProps.setIsContractLoading} />
          <StateGuidancePanel guidance={model.guidance} />
          <PrimaryActionPanel primaryAction={model.primaryAction} actionHandlers={actionHandlers} disabledReason={model.actionDisabledReason} lang={lang || 'EN'} />
          <SecondaryActionsPanel secondaryActions={model.secondaryActions} actionHandlers={actionHandlers} disabledReason={model.actionDisabledReason} lang={lang || 'EN'} />
          <TimerStack timerCards={model.timerCards} />
          {isTaker && !['RESOLVED', 'CANCELED', 'BURNED'].includes(roomState) && (
            <div className="border border-[#222] rounded-xl overflow-hidden mt-6 bg-[#0a0a0c] p-1">
              <PIIDisplay tradeId={activeTrade?.id} lang={lang} getSafeTelegramUrl={viewProps.getSafeTelegramUrl} authenticatedFetch={viewProps.authenticatedFetch} />
            </div>
          )}
          <TechnicalDetailsDisclosure technicalDetails={model.technicalDetails} />
        </div>
      </div>
    </TradeRoomContextPanel>
  );
};

export default TradeRoomPage;
