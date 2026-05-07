import React from 'react';
import { buildOperationsContextModel } from './operationsContextModel';
import OperationLaneTabs from './OperationLaneTabs';
import { OperationsContextPanel, OperationsSummaryBar } from './OperationsPanels';
import { buildGoToTradeRoomAction } from '../../actions/tradeNavigationActions';

export const OperationsCenterPage = ({
  activeEscrows,
  activeEscrowCounts,
  activeTrade,
  address,
  lang,
  setActiveTrade,
  setUserRole,
  setTradeState,
  setChargebackAccepted,
  setCurrentView,
  setSidebarOpen,
  setShowProfileModal,
}) => {
  const model = React.useMemo(() => buildOperationsContextModel({
    activeEscrows,
    activeEscrowCounts,
    activeTrade,
    address,
    lang,
  }), [activeEscrows, activeEscrowCounts, activeTrade, address, lang]);

  const [activeLaneKey, setActiveLaneKey] = React.useState(model.lanes[0]?.key || null);

  React.useEffect(() => {
    setActiveLaneKey((prev) => {
      if (prev && model.lanes.some((lane) => lane.key === prev)) return prev;
      return model.lanes[0]?.key || null;
    });
  }, [model.lanes]);

  const activeLane = model.lanes.find((lane) => lane.key === activeLaneKey) || model.lanes[0] || null;

  const onGoToRoomForEscrow = React.useCallback((escrow) => buildGoToTradeRoomAction({
    escrow,
    setActiveTrade,
    setUserRole,
    setTradeState,
    setChargebackAccepted,
    setCurrentView,
    setSidebarOpen,
    setShowProfileModal,
  }), [setActiveTrade, setUserRole, setTradeState, setChargebackAccepted, setCurrentView, setSidebarOpen, setShowProfileModal]);

  return (
    <div className="w-full max-w-[1200px] px-4 md:px-8">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white">{lang === 'TR' ? 'İşlem Takip Merkezi' : 'Operations Center'}</h1>
        <p className="text-sm text-slate-400">{lang === 'TR' ? 'Aktif işlemleri öncelik sırasına göre takip edin.' : 'Track active trades by operational priority.'}</p>
      </div>
      <OperationsSummaryBar summary={model.summary} lang={lang} />
      <OperationLaneTabs lanes={model.lanes} activeLaneKey={activeLane?.key || null} setActiveLaneKey={setActiveLaneKey} />
      {activeLane ? (
        <OperationsContextPanel lane={activeLane} lang={lang} onGoToRoomForEscrow={onGoToRoomForEscrow} />
      ) : (
        <div className="bg-[#101014] border border-[#222] rounded-xl p-4 text-sm text-slate-400">{lang === 'TR' ? 'Aktif işlem bulunamadı.' : 'No active trades found.'}</div>
      )}
    </div>
  );
};

export default OperationsCenterPage;
