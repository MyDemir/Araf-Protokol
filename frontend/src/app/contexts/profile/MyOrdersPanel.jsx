import React from 'react';

export const MyOrdersPanel = ({ myOrders = [], lang = 'EN', setConfirmDeleteId }) => (
  <div className="space-y-2">
    {myOrders.map((order) => (
      <div key={order.id} className="bg-[#101014] border border-[#222] rounded-xl p-3">
        <p className="text-sm text-white">#{order.id} · {order.side}</p>
        <button onClick={() => setConfirmDeleteId(order.id)} className="mt-2 text-xs bg-red-900/20 border border-red-900/40 text-red-400 px-3 py-1 rounded-lg">{lang === 'TR' ? 'Sil' : 'Delete'}</button>
      </div>
    ))}
  </div>
);

export default MyOrdersPanel;
