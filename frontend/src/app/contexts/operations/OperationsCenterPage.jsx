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
        <h1 className="text-2xl font-bold text-textPrimary">{lang === 'TR' ? 'İşlem Takip Merkezi' : 'Operations Center'}</h1>
        <p className="mt-1 max-w-3xl text-sm text-textSecondary leading-relaxed">
          {lang === 'TR'
            ? 'Önce settlement veya kullanıcı aksiyonu isteyen işlemleri, ardından ödeme bildirilenleri ve en son kilitli bekleyen işlemleri takip edin.'
            : 'Work the command queue by priority: settlement/action required first, payment reported next, and locked waiting trades after that.'}
        </p>
      </div>
      <OperationsSummaryBar summary={model.summary} lang={lang} />
      <OperationLaneTabs lanes={model.lanes} activeLaneKey={activeLane?.key || null} setActiveLaneKey={setActiveLaneKey} />
      {activeLane ? (
        <OperationsContextPanel lane={activeLane} lang={lang} onGoToRoomForEscrow={onGoToRoomForEscrow} />
      ) : (
        <div className="bg-surface border border-borderSubtle rounded-xl p-5 text-sm text-textSecondary">
          <p className="font-semibold text-textPrimary">{lang === 'TR' ? 'Şu anda takip edilecek aktif işlem yok.' : 'No active trades need attention right now.'}</p>
          <p className="mt-1 text-sm text-textMuted">{lang === 'TR' ? 'Yeni kilit, ödeme bildirimi veya settlement aksiyonu oluştuğunda burada öncelik sırasıyla görünecek.' : 'New locks, payment reports, and settlement actions will appear here in priority order.'}</p>
        </div>
      )}
    </div>
  );
};

export default OperationsCenterPage;
