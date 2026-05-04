import React from 'react';
import { buildTradeDecisionModel } from './tradeDecisionModel';
import StateGuidancePanel from './StateGuidancePanel';
import PrimaryActionPanel from './PrimaryActionPanel';
import SecondaryActionsPanel from './SecondaryActionsPanel';
import TimerStack from './TimerStack';
import TradeSummaryCard from './TradeSummaryCard';
import TechnicalDetailsDisclosure from './TechnicalDetailsDisclosure';
import TradeRoomContextPanel from './TradeRoomContextPanel';

export const TradeRoomPage = ({ decisionInput, actionHandlers = {}, children }) => {
  const model = React.useMemo(() => buildTradeDecisionModel(decisionInput || {}), [decisionInput]);
  return (
    <TradeRoomContextPanel>
      <TradeSummaryCard stateLabel={model.stateLabel} roleLabel={model.roleLabel} />
      <StateGuidancePanel guidance={model.guidance} />
      <PrimaryActionPanel primaryAction={model.primaryAction} actionHandlers={actionHandlers} disabledReason={model.actionDisabledReason} lang={decisionInput?.lang || 'EN'} />
      <SecondaryActionsPanel secondaryActions={model.secondaryActions} actionHandlers={actionHandlers} disabledReason={model.actionDisabledReason} lang={decisionInput?.lang || 'EN'} />
      <TimerStack timerCards={model.timerCards} />
      <TechnicalDetailsDisclosure technicalDetails={model.technicalDetails} />
      {children}
    </TradeRoomContextPanel>
  );
};

export default TradeRoomPage;
