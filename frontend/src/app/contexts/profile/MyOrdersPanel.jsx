import React from 'react';
import { getOrderSideCopy } from '../../orderUiModel';

export const MyOrdersPanel = ({ myOrders = [], lang = 'EN', setConfirmDeleteId }) => (
  <div className="space-y-2">
    {myOrders.map((order) => (
      <div key={order.id} className="bg-surface border border-borderSubtle rounded-xl p-3">
        <p className="text-sm text-textPrimary">#{order.id} · {order.sideLabel || getOrderSideCopy(order.side, 'order', lang) || order.side}</p>
        <button onClick={() => setConfirmDeleteId(order.id)} className="mt-2 text-xs bg-red-900/20 border border-red-900/40 text-red-400 px-3 py-1 rounded-lg">{lang === 'TR' ? 'Sil' : 'Delete'}</button>
      </div>
    ))}
  </div>
);

export default MyOrdersPanel;
