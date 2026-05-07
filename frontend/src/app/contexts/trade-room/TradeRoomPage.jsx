import React from 'react';
import { buildTradeDecisionModel } from './tradeDecisionModel';
import PrimaryActionPanel from './PrimaryActionPanel';
import SecondaryActionsPanel from './SecondaryActionsPanel';
import { StateGuidancePanel, TechnicalDetailsDisclosure, TimerStack, TradeSummaryCard } from './TradeRoomPanels';

export const TradeRoomPage = ({ decisionInput, actionCallbacks, children }) => {
  const model = React.useMemo(() => buildTradeDecisionModel(decisionInput || {}), [decisionInput]);
  return (
    <>
      <TradeSummaryCard stateLabel={model.stateLabel} roleLabel={model.roleLabel} />
      <StateGuidancePanel guidance={model.guidance} riskCopy={model.riskCopy} />
      <PrimaryActionPanel primaryAction={model.primaryAction} disabledReasons={model.disabledReasons} actionCallbacks={actionCallbacks} />
      <SecondaryActionsPanel secondaryActions={model.secondaryActions} disabledReasons={model.globalDisabledReasons || []} actionCallbacks={actionCallbacks} />
      <TimerStack timerCards={model.timerCards} />
      <TechnicalDetailsDisclosure technicalDetails={model.technicalDetails} />
      {children}
    </>
  );
};

export default TradeRoomPage;
