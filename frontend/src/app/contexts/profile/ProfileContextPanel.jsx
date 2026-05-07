import React from 'react';
import PaymentProfilePanel from './PaymentProfilePanel';
import MyOrdersPanel from './MyOrdersPanel';
import ActiveTradesPanel from './ActiveTradesPanel';
import { AccountPanel, HistoryPanel, ReputationPanel, SecurityPanel } from './ProfilePanels';

export const ProfileContextPanel = ({ activeTab, ...props }) => {
  if (activeTab === 'account') return <AccountPanel {...props} />;
  if (activeTab === 'payment') return <PaymentProfilePanel {...props} />;
  if (activeTab === 'reputation') return <ReputationPanel {...props} />;
  if (activeTab === 'orders') return <MyOrdersPanel {...props} />;
  if (activeTab === 'active') return <ActiveTradesPanel {...props} />;
  if (activeTab === 'history') return <HistoryPanel {...props} />;
  if (activeTab === 'security') return <SecurityPanel {...props} />;
  return null;
};

export default ProfileContextPanel;
