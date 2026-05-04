import React from 'react';

export const MyOrdersPanel = ({ myOrders = [], lang = 'EN', setConfirmDeleteId, handleDeleteOrder }) => {
  const [confirmingOrderId, setConfirmingOrderId] = React.useState(null);

  const openConfirmDelete = (orderId) => {
    setConfirmingOrderId(orderId);
    if (typeof setConfirmDeleteId === 'function') setConfirmDeleteId(orderId);
  };

  const closeConfirmDelete = () => {
    setConfirmingOrderId(null);
    if (typeof setConfirmDeleteId === 'function') setConfirmDeleteId(null);
  };

  const confirmDelete = (orderId) => {
    if (typeof handleDeleteOrder === 'function') handleDeleteOrder(orderId);
    closeConfirmDelete();
  };

  return (
    <div className="space-y-2">
      {myOrders.map((order) => {
        const isConfirming = confirmingOrderId === order.id;
        return (
          <div key={order.id} className="bg-[#101014] border border-[#222] rounded-xl p-3">
            <p className="text-sm text-white">#{order.id} · {order.side}</p>
            {!isConfirming ? (
              <button onClick={() => openConfirmDelete(order.id)} className="mt-2 text-xs bg-red-900/20 border border-red-900/40 text-red-400 px-3 py-1 rounded-lg">{lang === 'TR' ? 'Sil' : 'Delete'}</button>
            ) : (
              <div className="mt-2 rounded-lg border border-red-900/40 bg-red-950/20 p-2">
                <p className="text-[11px] text-red-300 mb-2">{lang === 'TR' ? 'Bu order silinsin mi?' : 'Delete this order?'}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => confirmDelete(order.id)} className="text-[11px] bg-red-900/30 border border-red-800/60 text-red-300 px-2 py-1 rounded">{lang === 'TR' ? 'Onayla' : 'Confirm'}</button>
                  <button onClick={closeConfirmDelete} className="text-[11px] bg-[#1a1a1f] border border-[#333] text-slate-300 px-2 py-1 rounded">{lang === 'TR' ? 'Vazgeç' : 'Cancel'}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default MyOrdersPanel;
