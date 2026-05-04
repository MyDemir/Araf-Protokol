import React from 'react';
import AccountPanel from './AccountPanel';
import PaymentProfilePanel from './PaymentProfilePanel';
import ReputationPanel from './ReputationPanel';
import MyOrdersPanel from './MyOrdersPanel';
import ActiveTradesPanel from './ActiveTradesPanel';
import HistoryPanel from './HistoryPanel';
import SecurityPanel from './SecurityPanel';

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
