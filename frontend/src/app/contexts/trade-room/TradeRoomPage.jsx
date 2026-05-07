import React from 'react';
import { buildTradeDecisionModel } from './tradeDecisionModel';
import PrimaryActionPanel from './PrimaryActionPanel';
import SecondaryActionsPanel from './SecondaryActionsPanel';
import { StateGuidancePanel, TechnicalDetailsDisclosure, TimerStack, TradeSummaryCard } from './TradeRoomPanels';

export const TradeRoomPage = ({ decisionInput, actionCallbacks, children }) => {
  const model = React.useMemo(() => buildTradeDecisionModel(decisionInput || {}), [decisionInput]);
  const lang = decisionInput?.lang || 'EN';
  return (
    <>
      <TradeSummaryCard {...model.decisionSummary} stateLabel={model.stateLabel} roleLabel={model.roleLabel} lang={lang} />
      <StateGuidancePanel guidance={model.guidance} riskCopy={model.riskCopy} />
      <PrimaryActionPanel primaryAction={model.primaryAction} disabledReasons={model.disabledReasons} actionCallbacks={actionCallbacks} lang={lang} />
      <SecondaryActionsPanel secondaryActions={model.secondaryActions} disabledReasons={model.globalDisabledReasons || []} actionCallbacks={actionCallbacks} lang={lang} />
      <TimerStack timerCards={model.timerCards} lang={lang} />
      <TechnicalDetailsDisclosure technicalDetails={model.technicalDetails} lang={lang} />
      {children}
    </>
  );
};

export default TradeRoomPage;
